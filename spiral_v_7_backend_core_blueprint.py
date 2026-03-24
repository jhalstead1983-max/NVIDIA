from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any
from uuid import uuid4
import math
import random


class IntentMode(str, Enum):
    ASCEND = "ascend"
    DESTROY = "destroy"
    EXPAND = "expand"
    STABILIZE = "stabilize"
    TRANSFORM = "transform"


class EmotionalTone(str, Enum):
    CALM = "calm"
    FOCUSED = "focused"
    DRIVEN = "driven"
    AGITATED = "agitated"


@dataclass
class BiofeedbackState:
    heart_rate: int = 88
    breath_rate: int = 15
    voice_intensity: float = 0.62
    emotional_tone: EmotionalTone = EmotionalTone.FOCUSED
    source: str = "manual"


@dataclass
class SpiralCoreState:
    radius: float = 0.58
    angle: float = 180.0
    angular_velocity: float = 0.62
    expansion: float = 0.55
    coherence: float = 0.70


@dataclass
class MemoryEntry:
    memory_id: str
    user_id: str
    session_id: str
    label: str
    energy: float
    intent: IntentMode
    score: float
    notes: str
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""


@dataclass
class AgentDecision:
    conductor: str
    sound_designer: str
    rhythm: str
    critic: str
    combined_decision: str
    confidence: float


@dataclass
class V7Context:
    user_id: str
    session_id: str
    prompt: str
    energy: float
    intent: IntentMode
    biofeedback: BiofeedbackState
    spiral_core: SpiralCoreState
    memory_matches: list[MemoryEntry] = field(default_factory=list)


INTENT_RULES: dict[IntentMode, dict[str, Any]] = {
    IntentMode.ASCEND: {
        "bpm_delta": 6,
        "filter_boost": 0.08,
        "drive_boost": 0.02,
        "density_bias": -0.02,
        "note": "Lift pitch and brightness over time.",
    },
    IntentMode.DESTROY: {
        "bpm_delta": 10,
        "filter_boost": 0.12,
        "drive_boost": 0.14,
        "density_bias": 0.10,
        "note": "Push aggression and impact.",
    },
    IntentMode.EXPAND: {
        "bpm_delta": 2,
        "filter_boost": 0.04,
        "drive_boost": 0.03,
        "density_bias": 0.02,
        "note": "Broaden space and width.",
    },
    IntentMode.STABILIZE: {
        "bpm_delta": -2,
        "filter_boost": -0.02,
        "drive_boost": -0.03,
        "density_bias": -0.06,
        "note": "Reduce volatility and settle rhythm.",
    },
    IntentMode.TRANSFORM: {
        "bpm_delta": 4,
        "filter_boost": 0.06,
        "drive_boost": 0.06,
        "density_bias": 0.04,
        "note": "Keep motion but shift character.",
    },
}


def memory_match_score(entry: MemoryEntry, intent: IntentMode, energy: float) -> float:
    intent_bonus = 0.14 if entry.intent == intent else 0.0
    energy_distance = abs(entry.energy - energy)
    return max(0.0, min(1.0, entry.score + intent_bonus + (0.2 - energy_distance * 0.25)))


def rank_memory(memories: list[MemoryEntry], intent: IntentMode, energy: float) -> list[MemoryEntry]:
    ranked = sorted(
        memories,
        key=lambda entry: memory_match_score(entry, intent, energy),
        reverse=True,
    )
    return ranked[:5]


def build_agent_decision(ctx: V7Context) -> AgentDecision:
    rules = INTENT_RULES[ctx.intent]
    best_memory = ctx.memory_matches[0] if ctx.memory_matches else None

    conductor = (
        f"Intent '{ctx.intent.value}' with coherence {ctx.spiral_core.coherence:.2f} suggests "
        f"{rules['note']}"
    )

    if ctx.biofeedback.heart_rate > 96 or ctx.biofeedback.emotional_tone == EmotionalTone.DRIVEN:
        sound_designer = "Open filter, widen stereo, and add drive in controlled bursts."
    else:
        sound_designer = "Keep filter moderate and preserve clarity."

    if ctx.biofeedback.breath_rate > 18 or ctx.energy > 0.75:
        rhythm = "Increase rhythmic subdivision pressure and tighten kick pattern."
    else:
        rhythm = "Favor steadier groove and longer phrasing."

    critic = (
        f"Closest high-score memory is '{best_memory.label}' at {best_memory.score:.2f}."
        if best_memory
        else "No strong memory candidate yet. Use exploratory caution."
    )

    confidence = max(
        0.35,
        min(
            0.98,
            ctx.spiral_core.coherence * 0.40
            + ctx.energy * 0.25
            + (best_memory.score if best_memory else 0.5) * 0.25
            + ctx.biofeedback.voice_intensity * 0.10,
        ),
    )

    combined = f"{conductor} {sound_designer} {rhythm}"
    return AgentDecision(
        conductor=conductor,
        sound_designer=sound_designer,
        rhythm=rhythm,
        critic=critic,
        combined_decision=combined,
        confidence=confidence,
    )


@dataclass
class MusicSection:
    section_name: str
    transport: dict[str, Any]
    automation: dict[str, Any]
    spiral_snapshot: dict[str, Any]
    v7_context: dict[str, Any]


class V7CoreService:
    def build_enhanced_prompt(self, ctx: V7Context, agent: AgentDecision) -> str:
        best_memory = ctx.memory_matches[0].label if ctx.memory_matches else "none"
        return (
            f"{ctx.prompt} | intent:{ctx.intent.value}"
            f" | bio:hr={ctx.biofeedback.heart_rate},breath={ctx.biofeedback.breath_rate},"
            f"voice={ctx.biofeedback.voice_intensity:.2f},tone={ctx.biofeedback.emotional_tone.value}"
            f" | spiral:r={ctx.spiral_core.radius:.2f},angle={ctx.spiral_core.angle:.0f},"
            f"vel={ctx.spiral_core.angular_velocity:.2f},expand={ctx.spiral_core.expansion:.2f},"
            f"cohere={ctx.spiral_core.coherence:.2f}"
            f" | memory:{best_memory}"
            f" | agent:{agent.combined_decision}"
        )

    def derive_transport(self, ctx: V7Context) -> dict[str, Any]:
        rules = INTENT_RULES[ctx.intent]
        base_bpm = 128 + int(ctx.energy * 24)
        bpm = max(80, min(180, base_bpm + int(rules["bpm_delta"])))
        swing = max(0.0, min(0.25, 0.03 + ctx.spiral_core.angular_velocity * 0.08))
        return {
            "bpm": bpm,
            "time_signature": "4/4",
            "swing": round(swing, 3),
        }

    def derive_automation(self, ctx: V7Context) -> dict[str, Any]:
        rules = INTENT_RULES[ctx.intent]
        filter_open = max(0.0, min(1.0, ctx.energy * 0.65 + rules["filter_boost"] + ctx.biofeedback.voice_intensity * 0.1))
        drive = max(0.0, min(1.0, ctx.energy * 0.35 + rules["drive_boost"] + (0.08 if ctx.biofeedback.emotional_tone == EmotionalTone.DRIVEN else 0.0)))
        reverb_mix = max(0.0, min(1.0, 0.18 + ctx.spiral_core.expansion * 0.25))
        density = max(0.0, min(1.0, ctx.energy + rules["density_bias"]))
        return {
            "filter_open": round(filter_open, 3),
            "drive": round(drive, 3),
            "reverb_mix": round(reverb_mix, 3),
            "density": round(density, 3),
        }

    def create_music_section(self, ctx: V7Context, agent: AgentDecision, section_name: str) -> MusicSection:
        return MusicSection(
            section_name=section_name,
            transport=self.derive_transport(ctx),
            automation=self.derive_automation(ctx),
            spiral_snapshot=asdict(ctx.spiral_core),
            v7_context={
                "intent": ctx.intent.value,
                "biofeedback": asdict(ctx.biofeedback),
                "agent": asdict(agent),
                "memory_labels": [m.label for m in ctx.memory_matches],
                "enhanced_prompt": self.build_enhanced_prompt(ctx, agent),
            },
        )

    def mutate_for_autonomous_cycle(self, spiral_core: SpiralCoreState, intent: IntentMode, energy: float) -> tuple[SpiralCoreState, IntentMode, float]:
        intents = list(IntentMode)
        next_intent = intents[(intents.index(intent) + 1) % len(intents)]
        next_energy = max(0.0, min(1.0, round(energy + random.uniform(-0.08, 0.08), 2)))
        mutated = SpiralCoreState(
            radius=max(0.0, min(1.0, spiral_core.radius + 0.04)),
            angle=(spiral_core.angle + 36.0) % 360.0,
            angular_velocity=max(0.0, min(1.0, spiral_core.angular_velocity + 0.03)),
            expansion=max(0.0, min(1.0, spiral_core.expansion + 0.02)),
            coherence=max(0.0, min(1.0, spiral_core.coherence + 0.01)),
        )
        return mutated, next_intent, next_energy


# -------------------------
# FastAPI route blueprint
# -------------------------
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/v7", tags=["v7-core"])
service = V7CoreService()
MEMORY_DB: list[MemoryEntry] = []


class BiofeedbackRequest(BaseModel):
    user_id: str
    session_id: str
    heart_rate: int = Field(88, ge=30, le=220)
    breath_rate: int = Field(15, ge=1, le=80)
    voice_intensity: float = Field(0.62, ge=0.0, le=1.0)
    emotional_tone: EmotionalTone = EmotionalTone.FOCUSED
    source: str = "manual"


class MemoryWriteRequest(BaseModel):
    user_id: str
    session_id: str
    label: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode
    score: float = Field(..., ge=0.0, le=1.0)
    notes: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""


class MemoryReadRequest(BaseModel):
    user_id: str
    session_id: str | None = None
    intent: IntentMode | None = None
    energy: float | None = Field(default=None, ge=0.0, le=1.0)


class V7LiveSessionRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    section_name: str = "v7_section"
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)


@router.post("/biofeedback")
def update_biofeedback(request: BiofeedbackRequest) -> dict[str, Any]:
    return {
        "status": "ok",
        "biofeedback": request.model_dump(),
    }


@router.post("/memory/write")
def write_memory(request: MemoryWriteRequest) -> dict[str, Any]:
    entry = MemoryEntry(
        memory_id=str(uuid4()),
        user_id=request.user_id,
        session_id=request.session_id,
        label=request.label,
        energy=request.energy,
        intent=request.intent,
        score=request.score,
        notes=request.notes,
        payload=request.payload,
        created_at=request.created_at,
    )
    MEMORY_DB.append(entry)
    return {"status": "ok", "memory": asdict(entry)}


@router.post("/memory/read")
def read_memory(request: MemoryReadRequest) -> dict[str, Any]:
    filtered = [m for m in MEMORY_DB if m.user_id == request.user_id]
    if request.session_id:
        filtered = [m for m in filtered if m.session_id == request.session_id]
    if request.intent:
        filtered = [m for m in filtered if m.intent == request.intent]
    if request.energy is not None:
        filtered = rank_memory(filtered, request.intent or IntentMode.TRANSFORM, request.energy)
    return {"memories": [asdict(m) for m in filtered]}


@router.post("/agents/decide")
def agent_decision(request: V7LiveSessionRequest) -> dict[str, Any]:
    memories = rank_memory(
        [m for m in MEMORY_DB if m.user_id == request.user_id],
        request.intent,
        request.energy,
    )
    ctx = V7Context(
        user_id=request.user_id,
        session_id=request.session_id,
        prompt=request.prompt,
        energy=request.energy,
        intent=request.intent,
        biofeedback=request.biofeedback,
        spiral_core=request.spiral_core,
        memory_matches=memories,
    )
    decision = build_agent_decision(ctx)
    return {
        "status": "ok",
        "decision": asdict(decision),
        "memory_labels": [m.label for m in memories],
        "enhanced_prompt": service.build_enhanced_prompt(ctx, decision),
    }


@router.post("/live-session")
def v7_live_session(request: V7LiveSessionRequest) -> dict[str, Any]:
    memories = rank_memory(
        [m for m in MEMORY_DB if m.user_id == request.user_id],
        request.intent,
        request.energy,
    )
    ctx = V7Context(
        user_id=request.user_id,
        session_id=request.session_id,
        prompt=request.prompt,
        energy=request.energy,
        intent=request.intent,
        biofeedback=request.biofeedback,
        spiral_core=request.spiral_core,
        memory_matches=memories,
    )
    decision = build_agent_decision(ctx)
    section = service.create_music_section(ctx, decision, request.section_name)
    score = round(
        max(0.0, min(1.0, ctx.spiral_core.coherence * 0.45 + request.energy * 0.25 + decision.confidence * 0.30)),
        3,
    )
    memory = MemoryEntry(
        memory_id=str(uuid4()),
        user_id=request.user_id,
        session_id=request.session_id,
        label=f"{request.intent.value}:{request.section_name}",
        energy=request.energy,
        intent=request.intent,
        score=score,
        notes="auto-captured from v7 live session",
        payload={"section": asdict(section), "decision": asdict(decision)},
        created_at="",
    )
    MEMORY_DB.append(memory)
    return {
        "status": "ok",
        "section": asdict(section),
        "decision": asdict(decision),
        "memory_written": asdict(memory),
        "score": score,
    }


@router.post("/autonomous-step")
def autonomous_step(request: V7LiveSessionRequest) -> dict[str, Any]:
    mutated_core, next_intent, next_energy = service.mutate_for_autonomous_cycle(
        request.spiral_core,
        request.intent,
        request.energy,
    )
    next_request = V7LiveSessionRequest(
        user_id=request.user_id,
        session_id=request.session_id,
        prompt=request.prompt,
        energy=next_energy,
        section_name=f"{request.section_name}_auto",
        intent=next_intent,
        biofeedback=request.biofeedback,
        spiral_core=mutated_core,
    )
    result = v7_live_session(next_request)
    result["autonomous_mutation"] = {
        "next_intent": next_intent.value,
        "next_energy": next_energy,
        "spiral_core": asdict(mutated_core),
    }
    return result
