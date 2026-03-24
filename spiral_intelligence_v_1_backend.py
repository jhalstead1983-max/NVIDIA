from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from threading import Lock
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


# ============================================================
# Spiral Intelligence V1 Backend
# ------------------------------------------------------------
# Features:
# - FastAPI backend with /chat, /state, /memory, /health
# - In-memory short-term + long-term memory
# - Spiral state vector that evolves each turn
# - Simple planner with 3 modes: explore, act, reflect
# - Reflection loop that updates strategy and memory
# - Safe mock "brain" function you can later replace with an LLM
# ============================================================


app = FastAPI(
    title="Spiral Intelligence V1",
    version="1.0.0",
    description="A proto-evolving intelligence backend with spiral modeling.",
)


# ============================================================
# Models
# ============================================================


class SpiralMode(str, Enum):
    EXPLORE = "explore"
    ACT = "act"
    REFLECT = "reflect"


class ChatRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    session_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    mode: SpiralMode
    spiral_state: Dict[str, float]
    reflection: Dict[str, Any]
    memory_summary: Dict[str, Any]


class MessageRecord(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: str
    mode: Optional[SpiralMode] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


@dataclass
class SpiralState:
    focus: float = 0.50
    intensity: float = 0.50
    uncertainty: float = 0.50
    novelty: float = 0.50
    confidence: float = 0.50
    goal_convergence: float = 0.30

    def to_dict(self) -> Dict[str, float]:
        return {
            "focus": self.focus,
            "intensity": self.intensity,
            "uncertainty": self.uncertainty,
            "novelty": self.novelty,
            "confidence": self.confidence,
            "goal_convergence": self.goal_convergence,
        }


@dataclass
class UserIdentity:
    mission: str = "Help the user turn ideas into working systems."
    active_mode: SpiralMode = SpiralMode.EXPLORE
    recent_learning: str = "User prefers concrete builds over abstract theory."
    style: str = "direct, iterative, system-oriented"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mission": self.mission,
            "active_mode": self.active_mode.value,
            "recent_learning": self.recent_learning,
            "style": self.style,
        }


@dataclass
class ReflectionResult:
    success_score: float
    novelty_too_low: bool
    user_excited: bool
    summary: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MemoryStore:
    short_term: List[MessageRecord] = field(default_factory=list)
    long_term: List[str] = field(default_factory=list)
    extracted_preferences: Dict[str, str] = field(default_factory=dict)


@dataclass
class SessionState:
    session_id: str
    user_id: str
    created_at: str
    updated_at: str
    spiral: SpiralState = field(default_factory=SpiralState)
    identity: UserIdentity = field(default_factory=UserIdentity)
    memory: MemoryStore = field(default_factory=MemoryStore)


# ============================================================
# In-memory database
# ============================================================


class InMemoryDB:
    def __init__(self) -> None:
        self._sessions: Dict[str, SessionState] = {}
        self._lock = Lock()

    def get_or_create_session(self, user_id: str, session_id: Optional[str]) -> SessionState:
        with self._lock:
            if session_id and session_id in self._sessions:
                session = self._sessions[session_id]
                if session.user_id != user_id:
                    raise HTTPException(status_code=403, detail="Session does not belong to user.")
                return session

            new_id = session_id or str(uuid4())
            now = utc_now()
            session = SessionState(
                session_id=new_id,
                user_id=user_id,
                created_at=now,
                updated_at=now,
            )
            self._sessions[new_id] = session
            return session

    def save_session(self, session: SessionState) -> None:
        with self._lock:
            session.updated_at = utc_now()
            self._sessions[session.session_id] = session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        with self._lock:
            return self._sessions.get(session_id)


DB = InMemoryDB()


# ============================================================
# Helpers
# ============================================================


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def recent_messages(memory: MemoryStore, limit: int = 6) -> List[MessageRecord]:
    return memory.short_term[-limit:]


def message_contains(text: str, keywords: List[str]) -> bool:
    lower = text.lower()
    return any(keyword in lower for keyword in keywords)


# ============================================================
# Perception Layer
# ============================================================


def build_perception(session: SessionState, user_message: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    recent = recent_messages(session.memory, limit=6)

    energy_keywords = ["fast", "aggressive", "powerful", "intense", "hard", "evolve"]
    reflection_keywords = ["why", "understand", "reflect", "meaning", "explain"]
    building_keywords = ["build", "code", "make", "backend", "app", "system"]

    perceived_energy = 0.75 if message_contains(user_message, energy_keywords) else 0.45
    asks_for_reflection = message_contains(user_message, reflection_keywords)
    asks_for_build = message_contains(user_message, building_keywords)

    return {
        "goal": infer_goal(user_message),
        "emotion_estimate": "driven" if perceived_energy > 0.6 else "neutral",
        "energy_level": perceived_energy,
        "asks_for_reflection": asks_for_reflection,
        "asks_for_build": asks_for_build,
        "recent_memory_count": len(recent),
        "metadata": metadata,
    }


def infer_goal(user_message: str) -> str:
    text = user_message.strip().lower()
    if "backend" in text or "code" in text or "build" in text:
        return "build a working system"
    if "music" in text:
        return "create adaptive music behavior"
    if "spiral" in text:
        return "develop spiral-based intelligence"
    return "help the user progress toward their objective"


# ============================================================
# Meaning + Planner Layer
# ============================================================


def choose_mode(perception: Dict[str, Any], spiral: SpiralState) -> SpiralMode:
    if perception["asks_for_reflection"] or spiral.uncertainty > 0.72:
        return SpiralMode.REFLECT
    if perception["asks_for_build"] or spiral.goal_convergence > 0.45:
        return SpiralMode.ACT
    return SpiralMode.EXPLORE


def build_interpretation(session: SessionState, perception: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "surface_goal": perception["goal"],
        "deeper_goal": "create a system that feels adaptive, alive, and iterative",
        "user_style": session.identity.style,
        "current_mode_bias": session.identity.active_mode.value,
        "known_preferences": session.memory.extracted_preferences,
    }


def make_plan(mode: SpiralMode, interpretation: Dict[str, Any], spiral: SpiralState) -> Dict[str, Any]:
    if mode == SpiralMode.EXPLORE:
        return {
            "mode": mode.value,
            "strategy": "clarify direction, widen possibilities, propose next steps",
            "constraints": ["be concrete", "keep momentum"],
        }
    if mode == SpiralMode.ACT:
        return {
            "mode": mode.value,
            "strategy": "produce an implementation artifact or decisive output",
            "constraints": ["be usable", "avoid fluff", "show structure"],
        }
    return {
        "mode": mode.value,
        "strategy": "analyze progress, explain reasoning, suggest corrections",
        "constraints": ["be honest", "identify gaps"],
    }


# ============================================================
# Brain / Response Generation
# Replace this with a real LLM call later.
# ============================================================


def run_brain(user_message: str, plan: Dict[str, Any], session: SessionState) -> str:
    mode = plan["mode"]
    spiral = session.spiral

    if mode == SpiralMode.ACT.value:
        return (
            "I can turn this into a working build. "
            "Right now the next useful step is to create a concrete backend layer "
            "with session memory, spiral state updates, and a reflection loop. "
            "Your current spiral profile suggests high build intent and moderate confidence, "
            "so I am prioritizing implementation over theory."
        )

    if mode == SpiralMode.REFLECT.value:
        return (
            "Here is the reflection pass: your request suggests you want something that feels more alive, "
            "not just something that answers. That means the system needs memory, self-scoring, "
            "and mode switching so each loop changes future behavior."
        )

    return (
        "I see a broad exploratory phase. We should shape the goal, identify the current mode, "
        "and decide whether the next pass should widen options or collapse into a concrete build."
    )


# ============================================================
# Reflection + Evolution Layer
# ============================================================


def reflect_on_turn(user_message: str, reply: str, mode: SpiralMode) -> ReflectionResult:
    build_signal = any(word in user_message.lower() for word in ["build", "code", "backend", "system"])
    strong_energy = any(word in user_message.lower() for word in ["powerful", "aggressive", "real", "evolving"])
    reply_is_generic = len(reply.split()) < 20

    success_score = 0.80 if build_signal else 0.65
    if mode == SpiralMode.ACT:
        success_score += 0.05
    if reply_is_generic:
        success_score -= 0.10

    success_score = clamp(success_score)

    return ReflectionResult(
        success_score=success_score,
        novelty_too_low=reply_is_generic,
        user_excited=strong_energy,
        summary=(
            "The system detected strong action intent and updated its state toward execution."
            if build_signal
            else "The system remains in a lighter exploratory cycle."
        ),
    )


def update_spiral_state(spiral: SpiralState, reflection: ReflectionResult, perception: Dict[str, Any], mode: SpiralMode) -> SpiralState:
    spiral.focus = clamp(spiral.focus + (0.08 if mode == SpiralMode.ACT else 0.03))
    spiral.intensity = clamp(spiral.intensity + (0.07 if reflection.user_excited else -0.02))
    spiral.uncertainty = clamp(spiral.uncertainty - (0.08 if reflection.success_score > 0.75 else 0.01))
    spiral.novelty = clamp(spiral.novelty + (0.08 if reflection.novelty_too_low else -0.03))
    spiral.confidence = clamp(spiral.confidence + (0.07 if reflection.success_score > 0.75 else -0.04))
    spiral.goal_convergence = clamp(
        spiral.goal_convergence + (0.12 if perception["asks_for_build"] else 0.04)
    )
    return spiral


def update_identity(identity: UserIdentity, mode: SpiralMode, reflection: ReflectionResult) -> UserIdentity:
    identity.active_mode = mode
    if reflection.success_score > 0.75:
        identity.recent_learning = "Concrete implementation increased alignment and momentum."
    else:
        identity.recent_learning = "The system may need clearer grounding or stronger outputs next turn."
    return identity


def update_memory(memory: MemoryStore, user_message: str, reply: str, mode: SpiralMode) -> MemoryStore:
    now = utc_now()
    memory.short_term.append(
        MessageRecord(role="user", content=user_message, timestamp=now, mode=mode)
    )
    memory.short_term.append(
        MessageRecord(role="assistant", content=reply, timestamp=now, mode=mode)
    )

    # Keep short-term memory bounded.
    if len(memory.short_term) > 40:
        memory.short_term = memory.short_term[-40:]

    lower = user_message.lower()
    if "music" in lower:
        memory.extracted_preferences["interest_music"] = "true"
    if "spiral" in lower:
        memory.extracted_preferences["interest_spiral_modeling"] = "true"
    if any(word in lower for word in ["build", "code", "backend", "system"]):
        memory.extracted_preferences["prefers_concrete_builds"] = "true"

    summary = summarize_for_long_term(user_message)
    if summary:
        memory.long_term.append(summary)
        memory.long_term = memory.long_term[-20:]

    return memory


def summarize_for_long_term(user_message: str) -> Optional[str]:
    lower = user_message.lower()
    if "spiral" in lower and "build" in lower:
        return "User wants a spiral-modeled evolving intelligence and prefers implementation."
    if "music" in lower:
        return "User is interested in adaptive or evolving music systems."
    if "agi" in lower:
        return "User is interested in AGI-like systems and evolving intelligence."
    return None


# ============================================================
# Orchestrator
# ============================================================


def process_turn(session: SessionState, user_message: str, metadata: Dict[str, Any]) -> ChatResponse:
    perception = build_perception(session, user_message, metadata)
    interpretation = build_interpretation(session, perception)
    mode = choose_mode(perception, session.spiral)
    plan = make_plan(mode, interpretation, session.spiral)
    reply = run_brain(user_message, plan, session)
    reflection = reflect_on_turn(user_message, reply, mode)

    session.spiral = update_spiral_state(session.spiral, reflection, perception, mode)
    session.identity = update_identity(session.identity, mode, reflection)
    session.memory = update_memory(session.memory, user_message, reply, mode)

    DB.save_session(session)

    return ChatResponse(
        session_id=session.session_id,
        reply=reply,
        mode=mode,
        spiral_state=session.spiral.to_dict(),
        reflection=reflection.to_dict(),
        memory_summary={
            "short_term_messages": len(session.memory.short_term),
            "long_term_entries": len(session.memory.long_term),
            "preferences": session.memory.extracted_preferences,
            "identity": session.identity.to_dict(),
        },
    )


# ============================================================
# Routes
# ============================================================


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "spiral-intelligence-v1"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    session = DB.get_or_create_session(user_id=request.user_id, session_id=request.session_id)
    return process_turn(session, request.message, request.metadata)


@app.get("/state/{session_id}")
def get_state(session_id: str) -> Dict[str, Any]:
    session = DB.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    return {
        "session_id": session.session_id,
        "user_id": session.user_id,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "spiral_state": session.spiral.to_dict(),
        "identity": session.identity.to_dict(),
    }


@app.get("/memory/{session_id}")
def get_memory(session_id: str) -> Dict[str, Any]:
    session = DB.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    return {
        "session_id": session.session_id,
        "short_term": [msg.model_dump() for msg in session.memory.short_term],
        "long_term": session.memory.long_term,
        "preferences": session.memory.extracted_preferences,
    }


@app.delete("/memory/{session_id}")
def clear_memory(session_id: str) -> Dict[str, str]:
    session = DB.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    session.memory = MemoryStore()
    DB.save_session(session)
    return {"status": "cleared", "session_id": session_id}


# ============================================================
# Local dev entry point
# Run with:
#   uvicorn spiral_intelligence_v1_backend:app --reload
# ============================================================


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("spiral_intelligence_v1_backend:app", host="0.0.0.0", port=8000, reload=True)
