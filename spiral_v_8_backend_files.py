# =============================
# app/models/v8.py
# =============================
from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field

from app.models.v7 import BiofeedbackState, IntentMode, SpiralCoreState


class SessionState(str, Enum):
    IDLE = "idle"
    PRIMED = "primed"
    REHEARSING = "rehearsing"
    PERFORMING = "performing"
    AUTONOMOUS = "autonomous"
    DEGRADED = "degraded"
    ROLLBACK = "rollback"
    COMPLETE = "complete"


class EventEnvelope(BaseModel):
    event_id: str
    session_id: str
    user_id: str
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class SessionSnapshot(BaseModel):
    snapshot_id: str
    session_id: str
    user_id: str
    state: SessionState
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode
    biofeedback: BiofeedbackState
    spiral_core: SpiralCoreState
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class SessionCreateRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(0.5, ge=0.0, le=1.0)
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)


class SessionTransitionRequest(BaseModel):
    user_id: str
    session_id: str
    to_state: SessionState
    reason: str = ""


class SessionExecuteRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)
    dry_run: bool = True
    section_name: str = "v8_section"
    osc_host: str = "127.0.0.1"
    osc_port: int = 11000
    output_dir: str = "exports"


class SessionRollbackRequest(BaseModel):
    user_id: str
    session_id: str
    reason: str = "manual rollback"


class SessionScore(BaseModel):
    coherence: float
    execution_success: float
    biofeedback_alignment: float
    memory_match: float
    intent_fidelity: float
    reward: float


# =============================
# app/core/fsm.py
# =============================
from __future__ import annotations

from app.models.v8 import SessionState


ALLOWED_TRANSITIONS: dict[SessionState, set[SessionState]] = {
    SessionState.IDLE: {SessionState.PRIMED},
    SessionState.PRIMED: {SessionState.REHEARSING, SessionState.PERFORMING, SessionState.AUTONOMOUS, SessionState.DEGRADED},
    SessionState.REHEARSING: {SessionState.PERFORMING, SessionState.AUTONOMOUS, SessionState.DEGRADED, SessionState.COMPLETE},
    SessionState.PERFORMING: {SessionState.AUTONOMOUS, SessionState.DEGRADED, SessionState.ROLLBACK, SessionState.COMPLETE},
    SessionState.AUTONOMOUS: {SessionState.PERFORMING, SessionState.DEGRADED, SessionState.ROLLBACK, SessionState.COMPLETE},
    SessionState.DEGRADED: {SessionState.ROLLBACK, SessionState.COMPLETE, SessionState.PRIMED},
    SessionState.ROLLBACK: {SessionState.PRIMED, SessionState.REHEARSING, SessionState.COMPLETE},
    SessionState.COMPLETE: set(),
}


def can_transition(from_state: SessionState, to_state: SessionState) -> bool:
    return to_state in ALLOWED_TRANSITIONS.get(from_state, set())


# =============================
# app/core/policies.py
# =============================
from __future__ import annotations

from app.models.v7 import EmotionalTone, IntentMode
from app.models.v8 import SessionExecuteRequest, SessionState


def evaluate_policy(request: SessionExecuteRequest, session_state: SessionState, health: dict[str, str]) -> list[str]:
    violations: list[str] = []

    if session_state == SessionState.DEGRADED and request.intent == IntentMode.DESTROY:
        violations.append("Destroy intent is disabled while session is degraded.")

    if request.energy > 0.95:
        violations.append("Energy exceeds hard ceiling of 0.95.")

    if request.biofeedback.voice_intensity > 0.95 and request.intent == IntentMode.DESTROY:
        violations.append("Voice intensity too high for destroy intent.")

    if request.biofeedback.emotional_tone == EmotionalTone.AGITATED and request.energy > 0.85:
        violations.append("Agitated tone requires lower energy for safe execution.")

    if health.get("api") == "error":
        violations.append("API health is degraded; execution blocked.")

    return violations


# =============================
# app/services/v8_scoring.py
# =============================
from __future__ import annotations

from app.models.v7 import IntentMode
from app.models.v8 import SessionScore


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, round(value, 4)))


class V8ScoringService:
    def score(
        self,
        *,
        coherence: float,
        execution_success: float,
        biofeedback_alignment: float,
        memory_match: float,
        intent_fidelity: float,
    ) -> SessionScore:
        reward = (
            0.30 * coherence
            + 0.20 * execution_success
            + 0.20 * biofeedback_alignment
            + 0.20 * memory_match
            + 0.10 * intent_fidelity
        )
        return SessionScore(
            coherence=clamp01(coherence),
            execution_success=clamp01(execution_success),
            biofeedback_alignment=clamp01(biofeedback_alignment),
            memory_match=clamp01(memory_match),
            intent_fidelity=clamp01(intent_fidelity),
            reward=clamp01(reward),
        )

    def derive_biofeedback_alignment(self, heart_rate: int, breath_rate: int, voice_intensity: float, energy: float) -> float:
        heart_term = 1.0 - min(abs((heart_rate / 140.0) - energy), 1.0)
        breath_term = 1.0 - min(abs((breath_rate / 30.0) - energy), 1.0)
        voice_term = 1.0 - min(abs(voice_intensity - energy), 1.0)
        return clamp01((heart_term + breath_term + voice_term) / 3.0)

    def derive_intent_fidelity(self, intent: IntentMode, energy: float, coherence: float) -> float:
        if intent == IntentMode.DESTROY:
            return clamp01((energy * 0.7) + ((1.0 - coherence) * 0.3))
        if intent == IntentMode.STABILIZE:
            return clamp01((coherence * 0.7) + ((1.0 - abs(energy - 0.5)) * 0.3))
        if intent == IntentMode.ASCEND:
            return clamp01((energy * 0.5) + (coherence * 0.5))
        if intent == IntentMode.EXPAND:
            return clamp01((coherence * 0.4) + (energy * 0.4) + 0.2)
        return clamp01((coherence * 0.5) + (energy * 0.3) + 0.2)


# =============================
# app/db/event_store.py
# =============================
from __future__ import annotations

import json
from uuid import uuid4

from app.db.sqlite import get_connection
from app.models.v8 import EventEnvelope
from app.utils.helpers import utc_now


class EventStore:
    def initialize(self) -> None:
        conn = get_connection()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS v8_events (
                    event_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def append(self, session_id: str, user_id: str, event_type: str, payload: dict) -> EventEnvelope:
        event = EventEnvelope(
            event_id=str(uuid4()),
            session_id=session_id,
            user_id=user_id,
            event_type=event_type,
            payload=payload,
            created_at=utc_now(),
        )
        conn = get_connection()
        try:
            conn.execute(
                "INSERT INTO v8_events (event_id, session_id, user_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (event.event_id, event.session_id, event.user_id, event.event_type, json.dumps(event.payload), event.created_at),
            )
            conn.commit()
            return event
        finally:
            conn.close()

    def list_for_session(self, session_id: str) -> list[EventEnvelope]:
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT * FROM v8_events WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
            return [
                EventEnvelope(
                    event_id=row["event_id"],
                    session_id=row["session_id"],
                    user_id=row["user_id"],
                    event_type=row["event_type"],
                    payload=json.loads(row["payload_json"]),
                    created_at=row["created_at"],
                )
                for row in rows
            ]
        finally:
            conn.close()


# =============================
# app/db/session_store.py
# =============================
from __future__ import annotations

import json
from uuid import uuid4

from app.db.sqlite import get_connection
from app.models.v8 import SessionSnapshot, SessionState
from app.models.v7 import BiofeedbackState, IntentMode, SpiralCoreState
from app.utils.helpers import utc_now


class SessionStore:
    def initialize(self) -> None:
        conn = get_connection()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS v8_sessions (
                    session_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    snapshot_id TEXT NOT NULL,
                    state TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    energy REAL NOT NULL,
                    intent TEXT NOT NULL,
                    biofeedback_json TEXT NOT NULL,
                    spiral_core_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS v8_snapshots (
                    snapshot_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    state TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    energy REAL NOT NULL,
                    intent TEXT NOT NULL,
                    biofeedback_json TEXT NOT NULL,
                    spiral_core_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def upsert_session(self, snapshot: SessionSnapshot) -> SessionSnapshot:
        conn = get_connection()
        try:
            conn.execute(
                """
                INSERT INTO v8_sessions (
                    session_id, user_id, snapshot_id, state, prompt, energy, intent,
                    biofeedback_json, spiral_core_json, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    user_id=excluded.user_id,
                    snapshot_id=excluded.snapshot_id,
                    state=excluded.state,
                    prompt=excluded.prompt,
                    energy=excluded.energy,
                    intent=excluded.intent,
                    biofeedback_json=excluded.biofeedback_json,
                    spiral_core_json=excluded.spiral_core_json,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    snapshot.session_id,
                    snapshot.user_id,
                    snapshot.snapshot_id,
                    snapshot.state.value,
                    snapshot.prompt,
                    snapshot.energy,
                    snapshot.intent.value,
                    snapshot.biofeedback.model_dump_json(),
                    snapshot.spiral_core.model_dump_json(),
                    json.dumps(snapshot.metadata),
                    snapshot.created_at,
                    utc_now(),
                ),
            )
            conn.execute(
                "INSERT INTO v8_snapshots (snapshot_id, session_id, user_id, state, prompt, energy, intent, biofeedback_json, spiral_core_json, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    snapshot.snapshot_id,
                    snapshot.session_id,
                    snapshot.user_id,
                    snapshot.state.value,
                    snapshot.prompt,
                    snapshot.energy,
                    snapshot.intent.value,
                    snapshot.biofeedback.model_dump_json(),
                    snapshot.spiral_core.model_dump_json(),
                    json.dumps(snapshot.metadata),
                    snapshot.created_at,
                ),
            )
            conn.commit()
            return snapshot
        finally:
            conn.close()

    def get_session(self, session_id: str) -> SessionSnapshot | None:
        conn = get_connection()
        try:
            row = conn.execute("SELECT * FROM v8_sessions WHERE session_id = ?", (session_id,)).fetchone()
            if not row:
                return None
            return SessionSnapshot(
                snapshot_id=row["snapshot_id"],
                session_id=row["session_id"],
                user_id=row["user_id"],
                state=SessionState(row["state"]),
                prompt=row["prompt"],
                energy=row["energy"],
                intent=IntentMode(row["intent"]),
                biofeedback=BiofeedbackState.model_validate_json(row["biofeedback_json"]),
                spiral_core=SpiralCoreState.model_validate_json(row["spiral_core_json"]),
                metadata=json.loads(row["metadata_json"]),
                created_at=row["created_at"],
            )
        finally:
            conn.close()

    def latest_safe_snapshot(self, session_id: str) -> SessionSnapshot | None:
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM v8_snapshots WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            return SessionSnapshot(
                snapshot_id=row["snapshot_id"],
                session_id=row["session_id"],
                user_id=row["user_id"],
                state=SessionState(row["state"]),
                prompt=row["prompt"],
                energy=row["energy"],
                intent=IntentMode(row["intent"]),
                biofeedback=BiofeedbackState.model_validate_json(row["biofeedback_json"]),
                spiral_core=SpiralCoreState.model_validate_json(row["spiral_core_json"]),
                metadata=json.loads(row["metadata_json"]),
                created_at=row["created_at"],
            )
        finally:
            conn.close()

    def new_snapshot(
        self,
        *,
        session_id: str,
        user_id: str,
        state: SessionState,
        prompt: str,
        energy: float,
        intent: IntentMode,
        biofeedback: BiofeedbackState,
        spiral_core: SpiralCoreState,
        metadata: dict[str, Any] | None = None,
    ) -> SessionSnapshot:
        return SessionSnapshot(
            snapshot_id=str(uuid4()),
            session_id=session_id,
            user_id=user_id,
            state=state,
            prompt=prompt,
            energy=energy,
            intent=intent,
            biofeedback=biofeedback,
            spiral_core=spiral_core,
            metadata=metadata or {},
            created_at=utc_now(),
        )


# =============================
# app/services/v8_orchestrator.py
# =============================
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.core.fsm import can_transition
from app.core.policies import evaluate_policy
from app.db.event_store import EventStore
from app.db.repository import V7MemoryRepository
from app.db.session_store import SessionStore
from app.models.v7 import MemoryEntry
from app.models.v8 import (
    SessionCreateRequest,
    SessionExecuteRequest,
    SessionRollbackRequest,
    SessionSnapshot,
    SessionState,
    SessionTransitionRequest,
)
from app.services.v7_core import V7Context, V7CoreService
from app.services.v8_scoring import V8ScoringService


class V8Orchestrator:
    def __init__(self) -> None:
        self.v7 = V7CoreService()
        self.scoring = V8ScoringService()
        self.events = EventStore()
        self.sessions = SessionStore()
        self.memory = V7MemoryRepository()
        self.events.initialize()
        self.sessions.initialize()
        self.memory.initialize()

    def create_session(self, request: SessionCreateRequest) -> dict[str, Any]:
        snapshot = self.sessions.new_snapshot(
            session_id=request.session_id,
            user_id=request.user_id,
            state=SessionState.PRIMED,
            prompt=request.prompt,
            energy=request.energy,
            intent=request.intent,
            biofeedback=request.biofeedback,
            spiral_core=request.spiral_core,
            metadata={"created_by": "v8.create_session"},
        )
        self.sessions.upsert_session(snapshot)
        event = self.events.append(request.session_id, request.user_id, "session.created", snapshot.model_dump())
        return {"status": "ok", "session": snapshot.model_dump(), "event": event.model_dump()}

    def transition_session(self, request: SessionTransitionRequest) -> dict[str, Any]:
        current = self.sessions.get_session(request.session_id)
        if current is None:
            raise ValueError("Session not found.")
        if not can_transition(current.state, request.to_state):
            raise ValueError(f"Invalid transition from {current.state.value} to {request.to_state.value}.")
        snapshot = self.sessions.new_snapshot(
            session_id=current.session_id,
            user_id=current.user_id,
            state=request.to_state,
            prompt=current.prompt,
            energy=current.energy,
            intent=current.intent,
            biofeedback=current.biofeedback,
            spiral_core=current.spiral_core,
            metadata={**current.metadata, "transition_reason": request.reason},
        )
        self.sessions.upsert_session(snapshot)
        event = self.events.append(request.session_id, request.user_id, "session.transitioned", {"from": current.state.value, "to": request.to_state.value, "reason": request.reason})
        return {"status": "ok", "session": snapshot.model_dump(), "event": event.model_dump()}

    def execute_session(self, request: SessionExecuteRequest) -> dict[str, Any]:
        current = self.sessions.get_session(request.session_id)
        if current is None:
            raise ValueError("Session not found. Create it first.")

        health = {"api": "ok", "ws": "connected"}
        violations = evaluate_policy(request, current.state, health)
        if violations:
            self.events.append(request.session_id, request.user_id, "policy.blocked", {"violations": violations})
            return {"status": "blocked", "violations": violations}

        memories: list[MemoryEntry] = self.v7.rank_memory(self.memory.read_memory(request.user_id), request.intent, request.energy)
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
        agent = self.v7.build_agent_decision(ctx)
        enhanced_prompt = self.v7.build_enhanced_prompt(ctx, agent)
        transport = self.v7.derive_transport(ctx)
        automation = self.v7.derive_automation(ctx)

        osc_push = {
            "status": "ok",
            "dry_run": request.dry_run,
            "host": request.osc_host,
            "port": request.osc_port,
            "messages": [
                {"address": "/live/song/set/tempo", "args": [transport["bpm"]]},
                {"address": "/spiral/intent", "args": [request.intent.value]},
            ],
        }
        midi_export = {
            "status": "ok",
            "file_path": f"{request.output_dir}/{request.session_id}_{request.section_name}.mid",
        }

        coherence = request.spiral_core.coherence
        execution_success = 1.0 if osc_push["status"] == "ok" and midi_export["status"] == "ok" else 0.0
        biofeedback_alignment = self.scoring.derive_biofeedback_alignment(
            request.biofeedback.heart_rate,
            request.biofeedback.breath_rate,
            request.biofeedback.voice_intensity,
            request.energy,
        )
        memory_match = memories[0].score if memories else 0.4
        intent_fidelity = self.scoring.derive_intent_fidelity(request.intent, request.energy, coherence)
        score = self.scoring.score(
            coherence=coherence,
            execution_success=execution_success,
            biofeedback_alignment=biofeedback_alignment,
            memory_match=memory_match,
            intent_fidelity=intent_fidelity,
        )

        section = {
            "section_name": request.section_name,
            "transport": transport,
            "automation": automation,
            "spiral_snapshot": request.spiral_core.model_dump(),
            "v8_context": {
                "enhanced_prompt": enhanced_prompt,
                "agent": agent.model_dump(),
                "memory_labels": [m.label for m in memories],
                "score": score.model_dump(),
            },
        }

        written_memory = self.memory.new_memory_entry(
            user_id=request.user_id,
            session_id=request.session_id,
            label=f"{request.intent.value}:{request.section_name}",
            energy=request.energy,
            intent=request.intent,
            score=score.reward,
            notes="auto-captured from v8 session execute",
            payload={"section": section, "agent": agent.model_dump(), "score": score.model_dump()},
        )
        self.memory.write_memory(written_memory)

        new_state = SessionState.REHEARSING if request.dry_run else SessionState.PERFORMING
        snapshot = self.sessions.new_snapshot(
            session_id=request.session_id,
            user_id=request.user_id,
            state=new_state,
            prompt=request.prompt,
            energy=request.energy,
            intent=request.intent,
            biofeedback=request.biofeedback,
            spiral_core=request.spiral_core,
            metadata={"last_score": score.reward, "last_section": request.section_name},
        )
        self.sessions.upsert_session(snapshot)

        self.events.append(request.session_id, request.user_id, "agent.decision.made", agent.model_dump())
        self.events.append(request.session_id, request.user_id, "osc.push.completed", osc_push)
        self.events.append(request.session_id, request.user_id, "midi.export.completed", midi_export)
        self.events.append(request.session_id, request.user_id, "session.scored", score.model_dump())

        return {
            "status": "ok",
            "session": snapshot.model_dump(),
            "section": section,
            "osc_push": osc_push,
            "midi_export": midi_export,
            "decision": agent.model_dump(),
            "score": score.model_dump(),
            "memory_written": written_memory.model_dump(),
        }

    def rollback_session(self, request: SessionRollbackRequest) -> dict[str, Any]:
        snapshot = self.sessions.latest_safe_snapshot(request.session_id)
        if snapshot is None:
            raise ValueError("No snapshot available for rollback.")
        rollback_snapshot = self.sessions.new_snapshot(
            session_id=snapshot.session_id,
            user_id=snapshot.user_id,
            state=SessionState.ROLLBACK,
            prompt=snapshot.prompt,
            energy=snapshot.energy,
            intent=snapshot.intent,
            biofeedback=snapshot.biofeedback,
            spiral_core=snapshot.spiral_core,
            metadata={**snapshot.metadata, "rollback_reason": request.reason},
        )
        self.sessions.upsert_session(rollback_snapshot)
        event = self.events.append(request.session_id, request.user_id, "rollback.triggered", {"reason": request.reason, "snapshot_id": snapshot.snapshot_id})
        return {"status": "ok", "session": rollback_snapshot.model_dump(), "event": event.model_dump(), "restored_snapshot": snapshot.model_dump()}

    def get_state(self, session_id: str) -> dict[str, Any]:
        snapshot = self.sessions.get_session(session_id)
        if snapshot is None:
            raise ValueError("Session not found.")
        return {"status": "ok", "session": snapshot.model_dump()}

    def get_events(self, session_id: str) -> dict[str, Any]:
        events = self.events.list_for_session(session_id)
        return {"status": "ok", "events": [event.model_dump() for event in events]}


# =============================
# app/routes/v8.py
# =============================
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.v8 import (
    SessionCreateRequest,
    SessionExecuteRequest,
    SessionRollbackRequest,
    SessionTransitionRequest,
)
from app.services.v8_orchestrator import V8Orchestrator

router = APIRouter(prefix="/v8", tags=["v8"])
orchestrator = V8Orchestrator()


@router.post("/session/create")
def create_session(request: SessionCreateRequest):
    try:
        return orchestrator.create_session(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/transition")
def transition_session(request: SessionTransitionRequest):
    try:
        return orchestrator.transition_session(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/execute")
def execute_session(request: SessionExecuteRequest):
    try:
        return orchestrator.execute_session(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/session/rollback")
def rollback_session(request: SessionRollbackRequest):
    try:
        return orchestrator.rollback_session(request)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/session/{session_id}/state")
def get_state(session_id: str):
    try:
        return orchestrator.get_state(session_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/session/{session_id}/events")
def get_events(session_id: str):
    try:
        return orchestrator.get_events(session_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# =============================
# app/main.py patch
# =============================
# from app.routes.v8 import router as v8_router
# app.include_router(v8_router)
