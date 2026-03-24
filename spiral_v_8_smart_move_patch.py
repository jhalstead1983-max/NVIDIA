from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class IntentMode(str, Enum):
    ASCEND = "ascend"
    DESTROY = "destroy"
    EXPAND = "expand"
    STABILIZE = "stabilize"
    TRANSFORM = "transform"


class SessionState(str, Enum):
    IDLE = "idle"
    PRIMED = "primed"
    REHEARSING = "rehearsing"
    PERFORMING = "performing"
    AUTONOMOUS = "autonomous"
    DEGRADED = "degraded"
    ROLLBACK = "rollback"
    COMPLETE = "complete"


class BiofeedbackState(BaseModel):
    heart_rate: int = 88
    breath_rate: int = 15
    voice_intensity: float = 0.62
    emotional_tone: str = "focused"
    source: str = "manual"


class SpiralCoreState(BaseModel):
    radius: float = 0.58
    angle: float = 180.0
    angular_velocity: float = 0.62
    expansion: float = 0.55
    coherence: float = 0.70


class MemoryEntry(BaseModel):
    user_id: str
    session_id: str
    label: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode
    score: float
    notes: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now)


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
    created_at: str = Field(default_factory=utc_now)


class SessionCreateRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
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
    osc_host: str = "127.0.0.1"
    osc_port: int = 11000
    output_dir: str = "exports"
    section_name: str = "v8_section"
    request_id: str = ""


class SessionRollbackRequest(BaseModel):
    user_id: str
    session_id: str
    reason: str = "operator rollback"


class AutonomousStepRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)
    dry_run: bool = True
    osc_host: str = "127.0.0.1"
    osc_port: int = 11000
    output_dir: str = "exports"
    base_section_name: str = "v8_auto"


class AutonomousLoopStartRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)
    dry_run: bool = True
    osc_host: str = "127.0.0.1"
    osc_port: int = 11000
    output_dir: str = "exports"
    base_section_name: str = "v8_loop"
    interval_seconds: float = Field(8.0, ge=0.0, le=300.0)
    max_steps: int = Field(12, ge=1, le=100)


class AutonomousLoopStopRequest(BaseModel):
    user_id: str
    session_id: str
    reason: str = "operator stop"


class AutonomousLoopStatus(BaseModel):
    session_id: str
    user_id: str
    is_running: bool
    current_step: int = 0
    max_steps: int = 0
    interval_seconds: float = 0.0
    last_error: str | None = None
    last_result: dict[str, Any] | None = None
    started_at: str | None = None
    stopped_at: str | None = None


class SessionStateMachine:
    def __init__(self) -> None:
        self.allowed: dict[SessionState, set[SessionState]] = {
            SessionState.IDLE: {SessionState.PRIMED},
            SessionState.PRIMED: {SessionState.REHEARSING, SessionState.PERFORMING, SessionState.AUTONOMOUS, SessionState.DEGRADED},
            SessionState.REHEARSING: {SessionState.PERFORMING, SessionState.AUTONOMOUS, SessionState.DEGRADED, SessionState.COMPLETE},
            SessionState.PERFORMING: {SessionState.AUTONOMOUS, SessionState.DEGRADED, SessionState.ROLLBACK, SessionState.COMPLETE},
            SessionState.AUTONOMOUS: {SessionState.PERFORMING, SessionState.DEGRADED, SessionState.ROLLBACK, SessionState.COMPLETE},
            SessionState.DEGRADED: {SessionState.ROLLBACK, SessionState.COMPLETE, SessionState.PRIMED},
            SessionState.ROLLBACK: {SessionState.PRIMED, SessionState.REHEARSING, SessionState.COMPLETE},
            SessionState.COMPLETE: set(),
        }

    def can_transition(self, from_state: SessionState, to_state: SessionState) -> bool:
        return to_state in self.allowed.get(from_state, set())

    def transition_or_raise(self, from_state: SessionState, to_state: SessionState) -> None:
        if not self.can_transition(from_state, to_state):
            raise ValueError(f"Invalid transition from {from_state.value} to {to_state.value}.")


class PolicyResult(BaseModel):
    severity: str
    code: str
    message: str


class PolicyEngine:
    def __init__(self) -> None:
        self._rules: list[Callable[[SessionExecuteRequest, SessionState, dict[str, str]], PolicyResult | None]] = [
            self._rule_energy_ceiling,
            self._rule_degraded_destroy,
            self._rule_api_health,
        ]

    def _rule_energy_ceiling(self, request: SessionExecuteRequest, _: SessionState, __: dict[str, str]) -> PolicyResult | None:
        if request.energy > 0.95:
            return PolicyResult(severity="block", code="ENERGY_CEILING", message="Energy exceeds hard ceiling of 0.95.")
        return None

    def _rule_degraded_destroy(
        self, request: SessionExecuteRequest, current_state: SessionState, _: dict[str, str]
    ) -> PolicyResult | None:
        if current_state == SessionState.DEGRADED and request.intent == IntentMode.DESTROY:
            return PolicyResult(severity="block", code="DEGRADED_DESTROY_DISABLED", message="Destroy intent disabled while degraded.")
        return None

    def _rule_api_health(self, _: SessionExecuteRequest, __: SessionState, health: dict[str, str]) -> PolicyResult | None:
        if health.get("api") != "ok":
            return PolicyResult(severity="block", code="API_HEALTH_DEGRADED", message="API health is degraded; execution blocked.")
        return None

    def evaluate(self, request: SessionExecuteRequest, current_state: SessionState, health: dict[str, str]) -> list[PolicyResult]:
        return [r for r in (rule(request, current_state, health) for rule in self._rules) if r is not None]


class _ModelLike:
    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data
        for k, v in data.items():
            setattr(self, k, v)

    def model_dump(self) -> dict[str, Any]:
        return self._data


class EventStore:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    def initialize(self) -> None:
        return None

    def append(self, session_id: str, user_id: str, event_type: str, payload: dict[str, Any]) -> Any:
        with self._lock:
            event = {
                "event_id": f"evt_{len(self.items) + 1}",
                "session_id": session_id,
                "user_id": user_id,
                "event_type": event_type,
                "payload": payload,
                "created_at": utc_now(),
            }
            self.items.append(event)
        return _ModelLike(event)

    def list_for_session(self, session_id: str) -> list[Any]:
        with self._lock:
            return [_ModelLike(x) for x in self.items if x["session_id"] == session_id]


class SessionStore:
    SAFE_STATES = {SessionState.PRIMED, SessionState.REHEARSING, SessionState.PERFORMING, SessionState.COMPLETE}

    def __init__(self) -> None:
        self.sessions: dict[str, SessionSnapshot] = {}
        self.snapshots: dict[str, list[SessionSnapshot]] = {}
        self._snapshot_counter = 0
        self._lock = threading.RLock()

    def initialize(self) -> None:
        return None

    def new_snapshot(self, **kwargs: Any) -> SessionSnapshot:
        with self._lock:
            self._snapshot_counter += 1
            return SessionSnapshot(snapshot_id=f"snap_{self._snapshot_counter}", **kwargs)

    def upsert_session(self, snapshot: SessionSnapshot) -> None:
        with self._lock:
            self.sessions[snapshot.session_id] = snapshot
            self.snapshots.setdefault(snapshot.session_id, []).append(snapshot)

    def get_session(self, session_id: str) -> SessionSnapshot | None:
        with self._lock:
            return self.sessions.get(session_id)

    def latest_safe_snapshot(self, session_id: str) -> SessionSnapshot | None:
        with self._lock:
            snaps = self.snapshots.get(session_id, [])
            for snapshot in reversed(snaps):
                explicit_safe = bool(snapshot.metadata.get("safe_checkpoint", snapshot.state in self.SAFE_STATES))
                if explicit_safe:
                    return snapshot
            return None


class V7MemoryRepository:
    def __init__(self) -> None:
        self.memories: list[MemoryEntry] = []
        self._lock = threading.RLock()

    def initialize(self) -> None:
        return None

    def read_memory(self, user_id: str) -> list[MemoryEntry]:
        with self._lock:
            return [m for m in self.memories if m.user_id == user_id]

    def write_memory(self, entry: MemoryEntry) -> None:
        with self._lock:
            self.memories.append(entry)

    def new_memory_entry(self, **kwargs: Any) -> MemoryEntry:
        return MemoryEntry(**kwargs)


class V8EventBridge:
    async def publish_event(self, event: Any) -> None:
        return None

    async def publish_state(self, session_id: str, user_id: str, payload: dict[str, Any]) -> None:
        return None


class V7Context(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float
    intent: IntentMode
    biofeedback: BiofeedbackState
    spiral_core: SpiralCoreState
    memory_matches: list[MemoryEntry] = Field(default_factory=list)


class V7CoreService:
    def rank_memory(self, memories: list[MemoryEntry], intent: IntentMode, energy: float) -> list[MemoryEntry]:
        return sorted(memories, key=lambda m: abs(m.energy - energy))

    def build_agent_decision(self, ctx: V7Context) -> _ModelLike:
        return _ModelLike({"intent": ctx.intent.value, "energy": ctx.energy, "summary": f"Decision for {ctx.intent.value} at {ctx.energy:.2f}"})

    def build_enhanced_prompt(self, ctx: V7Context, agent: Any) -> str:
        return f"{ctx.prompt} | intent:{ctx.intent.value} | energy:{ctx.energy:.2f}"

    def derive_transport(self, ctx: V7Context) -> dict[str, Any]:
        return {"bpm": int(120 + ctx.energy * 40)}

    def derive_automation(self, ctx: V7Context) -> dict[str, Any]:
        return {"drive": round(ctx.energy, 3), "coherence": round(ctx.spiral_core.coherence, 3)}

    def mutate_for_autonomous_cycle(self, spiral_core: SpiralCoreState, intent: IntentMode, energy: float) -> tuple[SpiralCoreState, IntentMode, float]:
        order = [IntentMode.ASCEND, IntentMode.DESTROY, IntentMode.EXPAND, IntentMode.STABILIZE, IntentMode.TRANSFORM]
        idx = order.index(intent) if intent in order else 0
        next_intent = order[(idx + 1) % len(order)]
        next_energy = min(1.0, round(energy + 0.03, 3))
        next_core = SpiralCoreState(
            radius=min(1.0, spiral_core.radius + 0.01),
            angle=(spiral_core.angle + 15.0) % 360.0,
            angular_velocity=min(1.0, spiral_core.angular_velocity + 0.01),
            expansion=min(1.0, spiral_core.expansion + 0.01),
            coherence=min(1.0, spiral_core.coherence + 0.01),
        )
        return next_core, next_intent, next_energy


class V8ScoringService:
    def derive_biofeedback_alignment(self, heart_rate: int, breath_rate: int, voice_intensity: float, energy: float) -> float:
        return max(0.0, min(1.0, (voice_intensity + energy) / 2.0))

    def derive_intent_fidelity(self, intent: IntentMode, energy: float, coherence: float) -> float:
        return max(0.0, min(1.0, (energy + coherence) / 2.0))

    def score(
        self, *, coherence: float, execution_success: float, biofeedback_alignment: float, memory_match: float, intent_fidelity: float
    ) -> _ModelLike:
        reward = round((coherence + execution_success + biofeedback_alignment + memory_match + intent_fidelity) / 5.0, 4)
        return _ModelLike(
            {
                "coherence": coherence,
                "execution_success": execution_success,
                "biofeedback_alignment": biofeedback_alignment,
                "memory_match": memory_match,
                "intent_fidelity": intent_fidelity,
                "reward": reward,
            }
        )


@dataclass
class _LoopRecord:
    task: asyncio.Task | None
    status: AutonomousLoopStatus
    stop_flag: bool = False


class V8Orchestrator:
    def __init__(self) -> None:
        self.v7 = V7CoreService()
        self.scoring = V8ScoringService()
        self.events = EventStore()
        self.sessions = SessionStore()
        self.memory = V7MemoryRepository()
        self.bridge = V8EventBridge()
        self.state_machine = SessionStateMachine()
        self.policy = PolicyEngine()
        self.events.initialize()
        self.sessions.initialize()
        self.memory.initialize()
        self._loops: dict[str, _LoopRecord] = {}
        self._loop_history: dict[str, AutonomousLoopStatus] = {}
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.RLock()

    @contextmanager
    def _session_lock(self, session_id: str) -> Any:
        with self._locks_guard:
            lock = self._locks.setdefault(session_id, threading.RLock())
        with lock:
            yield

    def _schedule(self, coro: Any) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(coro)
        except RuntimeError:
            if asyncio.iscoroutine(coro):
                coro.close()

    def _emit_event(self, event: Any) -> None:
        self._schedule(self.bridge.publish_event(event))

    def _emit_state(self, snapshot: SessionSnapshot) -> None:
        self._schedule(self.bridge.publish_state(snapshot.session_id, snapshot.user_id, snapshot.model_dump()))

    def _append_and_emit(self, session_id: str, user_id: str, event_type: str, payload: dict[str, Any]) -> Any:
        event = self.events.append(session_id, user_id, event_type, payload)
        self._emit_event(event)
        return event

    def _set_session(
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
        metadata: dict[str, Any],
    ) -> SessionSnapshot:
        metadata = dict(metadata)
        metadata.setdefault("safe_checkpoint", state in SessionStore.SAFE_STATES)
        snapshot = self.sessions.new_snapshot(
            session_id=session_id,
            user_id=user_id,
            state=state,
            prompt=prompt,
            energy=energy,
            intent=intent,
            biofeedback=biofeedback,
            spiral_core=spiral_core,
            metadata=metadata,
        )
        self.sessions.upsert_session(snapshot)
        self._emit_state(snapshot)
        return snapshot

    def emit_heartbeat(self, session_id: str, user_id: str, note: str = "alive") -> dict[str, Any]:
        event = self._append_and_emit(session_id, user_id, "session.heartbeat", {"note": note})
        return {"status": "ok", "event": event.model_dump()}

    def _loop_status_for(self, session_id: str, user_id: str) -> AutonomousLoopStatus:
        record = self._loops.get(session_id)
        if record:
            return record.status
        history = self._loop_history.get(session_id)
        if history:
            return history
        return AutonomousLoopStatus(session_id=session_id, user_id=user_id, is_running=False)

    async def _run_loop(self, request: AutonomousLoopStartRequest) -> None:
        record = self._loops[request.session_id]
        self._append_and_emit(
            request.session_id,
            request.user_id,
            "autonomous.loop.started",
            {"interval_seconds": request.interval_seconds, "max_steps": request.max_steps, "dry_run": request.dry_run},
        )
        current_energy = request.energy
        current_intent = request.intent
        current_core = request.spiral_core
        try:
            for step in range(1, request.max_steps + 1):
                if record.stop_flag:
                    break
                record.status.current_step = step
                result = self.autonomous_step(
                    AutonomousStepRequest(
                        user_id=request.user_id,
                        session_id=request.session_id,
                        prompt=request.prompt,
                        energy=current_energy,
                        intent=current_intent,
                        biofeedback=request.biofeedback,
                        spiral_core=current_core,
                        dry_run=request.dry_run,
                        osc_host=request.osc_host,
                        osc_port=request.osc_port,
                        output_dir=request.output_dir,
                        base_section_name=request.base_section_name,
                    )
                )
                record.status.last_result = result
                mutation = result.get("autonomous_mutation", {})
                current_energy = float(mutation.get("next_energy", current_energy))
                current_intent = IntentMode(mutation.get("next_intent", current_intent.value))
                current_core = SpiralCoreState(**mutation.get("spiral_core", current_core.model_dump()))
                self._append_and_emit(
                    request.session_id,
                    request.user_id,
                    "autonomous.loop.tick",
                    {"step": step, "max_steps": request.max_steps, "reward": result.get("score", {}).get("reward")},
                )
                if step < request.max_steps and not record.stop_flag:
                    await asyncio.sleep(request.interval_seconds)
        except asyncio.CancelledError:
            record.status.last_error = "cancelled"
            self._append_and_emit(request.session_id, request.user_id, "autonomous.loop.cancelled", {"step": record.status.current_step})
            raise
        except Exception as exc:
            record.status.last_error = str(exc)
            self._append_and_emit(request.session_id, request.user_id, "autonomous.loop.error", {"error": str(exc)})
        finally:
            record.status.is_running = False
            record.status.stopped_at = utc_now()
            self._append_and_emit(
                request.session_id,
                request.user_id,
                "autonomous.loop.stopped",
                {"current_step": record.status.current_step, "last_error": record.status.last_error},
            )
            self._loop_history[request.session_id] = record.status
            self._loops.pop(request.session_id, None)

    def start_autonomous_loop(self, request: AutonomousLoopStartRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            existing = self._loops.get(request.session_id)
            if existing and existing.status.is_running:
                raise ValueError("Autonomous loop is already running for this session.")
            status = AutonomousLoopStatus(
                session_id=request.session_id,
                user_id=request.user_id,
                is_running=True,
                current_step=0,
                max_steps=request.max_steps,
                interval_seconds=request.interval_seconds,
                started_at=utc_now(),
            )
            task = asyncio.create_task(self._run_loop(request))
            self._loops[request.session_id] = _LoopRecord(task=task, status=status, stop_flag=False)
            return {"status": "ok", "loop": status.model_dump()}

    def stop_autonomous_loop(self, request: AutonomousLoopStopRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            record = self._loops.get(request.session_id)
            if not record or not record.status.is_running:
                return {"status": "ok", "loop": self._loop_status_for(request.session_id, request.user_id).model_dump()}
            record.stop_flag = True
            if record.task and not record.task.done():
                record.task.cancel()
            record.status.is_running = False
            record.status.stopped_at = utc_now()
            self._append_and_emit(request.session_id, request.user_id, "autonomous.loop.stop_requested", {"reason": request.reason})
            return {"status": "ok", "loop": record.status.model_dump()}

    def autonomous_loop_status(self, session_id: str, user_id: str) -> dict[str, Any]:
        return {"status": "ok", "loop": self._loop_status_for(session_id, user_id).model_dump()}

    def create_session(self, request: SessionCreateRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            snapshot = self._set_session(
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
            event = self._append_and_emit(request.session_id, request.user_id, "session.created", snapshot.model_dump())
            return {"status": "ok", "session": snapshot.model_dump(), "event": event.model_dump()}

    def transition_session(self, request: SessionTransitionRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            current = self.sessions.get_session(request.session_id)
            if current is None:
                raise ValueError("Session not found.")
            self.state_machine.transition_or_raise(current.state, request.to_state)
            snapshot = self._set_session(
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
            event = self._append_and_emit(
                request.session_id,
                request.user_id,
                "session.transitioned",
                {"from": current.state.value, "to": request.to_state.value, "reason": request.reason},
            )
            return {"status": "ok", "session": snapshot.model_dump(), "event": event.model_dump()}

    def execute_session(self, request: SessionExecuteRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            current = self.sessions.get_session(request.session_id)
            if current is None:
                raise ValueError("Session not found. Create it first.")
            self._append_and_emit(
                request.session_id,
                request.user_id,
                "session.execution.started",
                {
                    "dry_run": request.dry_run,
                    "intent": request.intent.value,
                    "energy": request.energy,
                    "section_name": request.section_name,
                    "request_id": request.request_id,
                },
            )
            health = {"api": "ok", "ws": "connected"}
            policy_results = self.policy.evaluate(request, current.state, health)
            blocking = [p for p in policy_results if p.severity == "block"]
            if blocking:
                blocked_payload = [p.model_dump() for p in blocking]
                self._append_and_emit(request.session_id, request.user_id, "policy.blocked", {"violations": blocked_payload})
                degraded = self._set_session(
                    session_id=current.session_id,
                    user_id=current.user_id,
                    state=SessionState.DEGRADED,
                    prompt=current.prompt,
                    energy=current.energy,
                    intent=current.intent,
                    biofeedback=current.biofeedback,
                    spiral_core=current.spiral_core,
                    metadata={**current.metadata, "policy_violations": blocked_payload, "safe_checkpoint": False},
                )
                return {"status": "blocked", "violations": blocked_payload, "session": degraded.model_dump()}
            memories = self.v7.rank_memory(self.memory.read_memory(request.user_id), request.intent, request.energy)
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
            midi_export = {"status": "ok", "file_path": f"{request.output_dir}/{request.session_id}_{request.section_name}.mid"}
            coherence = request.spiral_core.coherence
            execution_success = 1.0 if osc_push["status"] == "ok" and midi_export["status"] == "ok" else 0.0
            biofeedback_alignment = self.scoring.derive_biofeedback_alignment(
                request.biofeedback.heart_rate, request.biofeedback.breath_rate, request.biofeedback.voice_intensity, request.energy
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
            self.state_machine.transition_or_raise(current.state, new_state)
            snapshot = self._set_session(
                session_id=request.session_id,
                user_id=request.user_id,
                state=new_state,
                prompt=request.prompt,
                energy=request.energy,
                intent=request.intent,
                biofeedback=request.biofeedback,
                spiral_core=request.spiral_core,
                metadata={"last_score": score.reward, "last_section": request.section_name, "request_id": request.request_id},
            )
            for event_type, payload in (
                ("agent.decision.made", agent.model_dump()),
                ("osc.push.completed", osc_push),
                ("midi.export.completed", midi_export),
                ("session.scored", score.model_dump()),
                ("memory.written", written_memory.model_dump()),
                (
                    "session.executed",
                    {"section": section, "decision": agent.model_dump(), "score": score.model_dump(), "memory_written": written_memory.model_dump()},
                ),
            ):
                self._append_and_emit(request.session_id, request.user_id, event_type, payload)
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

    def autonomous_step(self, request: AutonomousStepRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            current = self.sessions.get_session(request.session_id)
            if current is None:
                raise ValueError("Session not found. Create it first.")
            mutated_core, next_intent, next_energy = self.v7.mutate_for_autonomous_cycle(request.spiral_core, request.intent, request.energy)
            self._append_and_emit(
                request.session_id,
                request.user_id,
                "autonomous.mutation.applied",
                {
                    "from_intent": request.intent.value,
                    "to_intent": next_intent.value,
                    "from_energy": request.energy,
                    "to_energy": next_energy,
                    "spiral_core": mutated_core.model_dump(),
                },
            )
            self.state_machine.transition_or_raise(current.state, SessionState.AUTONOMOUS)
            auto_snapshot = self._set_session(
                session_id=request.session_id,
                user_id=request.user_id,
                state=SessionState.AUTONOMOUS,
                prompt=request.prompt,
                energy=next_energy,
                intent=next_intent,
                biofeedback=request.biofeedback,
                spiral_core=mutated_core,
                metadata={**current.metadata, "autonomous": True, "safe_checkpoint": False},
            )
            execute_result = self.execute_session(
                SessionExecuteRequest(
                    user_id=request.user_id,
                    session_id=request.session_id,
                    prompt=request.prompt,
                    energy=next_energy,
                    intent=next_intent,
                    biofeedback=request.biofeedback,
                    spiral_core=mutated_core,
                    dry_run=request.dry_run,
                    osc_host=request.osc_host,
                    osc_port=request.osc_port,
                    output_dir=request.output_dir,
                    section_name=f"{request.base_section_name}_{next_intent.value}",
                )
            )
            self._append_and_emit(
                request.session_id,
                request.user_id,
                "autonomous.step.completed",
                {"next_intent": next_intent.value, "next_energy": next_energy, "session_state": auto_snapshot.state.value},
            )
            execute_result["autonomous_mutation"] = {
                "next_intent": next_intent.value,
                "next_energy": next_energy,
                "spiral_core": mutated_core.model_dump(),
            }
            return execute_result

    def rollback_session(self, request: SessionRollbackRequest) -> dict[str, Any]:
        with self._session_lock(request.session_id):
            snapshot = self.sessions.latest_safe_snapshot(request.session_id)
            if snapshot is None:
                raise ValueError("No safe snapshot available for rollback.")
            rollback_snapshot = self._set_session(
                session_id=snapshot.session_id,
                user_id=snapshot.user_id,
                state=SessionState.ROLLBACK,
                prompt=snapshot.prompt,
                energy=snapshot.energy,
                intent=snapshot.intent,
                biofeedback=snapshot.biofeedback,
                spiral_core=snapshot.spiral_core,
                metadata={**snapshot.metadata, "rollback_reason": request.reason, "safe_checkpoint": False},
            )
            event = self._append_and_emit(
                request.session_id,
                request.user_id,
                "rollback.triggered",
                {"reason": request.reason, "snapshot_id": snapshot.snapshot_id},
            )
            return {
                "status": "ok",
                "session": rollback_snapshot.model_dump(),
                "event": event.model_dump(),
                "restored_snapshot": snapshot.model_dump(),
            }

    def get_state(self, session_id: str) -> dict[str, Any]:
        snapshot = self.sessions.get_session(session_id)
        if snapshot is None:
            raise ValueError("Session not found.")
        return {"status": "ok", "session": snapshot.model_dump()}

    def get_events(self, session_id: str) -> dict[str, Any]:
        events = self.events.list_for_session(session_id)
        return {"status": "ok", "events": [event.model_dump() for event in events]}


class SpiralReasonerRequest(BaseModel):
    user_id: str
    session_id: str
    prompt: str
    energy: float = Field(..., ge=0.0, le=1.0)
    intent: IntentMode = IntentMode.TRANSFORM
    biofeedback: BiofeedbackState = Field(default_factory=BiofeedbackState)
    spiral_core: SpiralCoreState = Field(default_factory=SpiralCoreState)
    dry_run: bool = True
    max_spirals: int = Field(4, ge=1, le=12)
    confidence_target: float = Field(0.85, ge=0.0, le=1.0)
    novelty_threshold: float = Field(0.03, ge=0.0, le=1.0)
    min_delta_confidence: float = Field(0.02, ge=0.0, le=1.0)
    section_prefix: str = "spiral"
    operator_consent: bool = True
    care_weight: float = Field(0.75, ge=0.0, le=1.0)


class HumanGateDecision(BaseModel):
    approved: bool = False
    reviewer: str = "human_operator"
    reason: str = ""


class TwoPersonGateDecision(BaseModel):
    first: HumanGateDecision = Field(default_factory=HumanGateDecision)
    second: HumanGateDecision = Field(default_factory=HumanGateDecision)


class SpiralPhaseResult(BaseModel):
    pass_index: int
    phase: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    novelty: float = Field(..., ge=0.0, le=1.0)
    notes: list[str] = Field(default_factory=list)


class EmotionReasoningOutput(BaseModel):
    inferred_emotion: str
    empathy_mode: str
    urgency: float = Field(..., ge=0.0, le=1.0)
    stress: float = Field(..., ge=0.0, le=1.0)
    confidence_bias: float = Field(..., ge=-0.2, le=0.2)
    rationale: list[str] = Field(default_factory=list)


class CompassionPolicyDecision(BaseModel):
    allowed: bool
    status: str
    reasons: list[str] = Field(default_factory=list)
    care_score: float = Field(..., ge=0.0, le=1.0)


class EmotionReasoner:
    def infer(self, request: SpiralReasonerRequest) -> EmotionReasoningOutput:
        stress = 0.0
        rationale: list[str] = []
        if request.biofeedback.heart_rate >= 105:
            stress += 0.25
            rationale.append("elevated heart rate")
        if request.biofeedback.voice_intensity >= 0.8:
            stress += 0.2
            rationale.append("high voice intensity")
        if request.biofeedback.emotional_tone in {"agitated", "driven"}:
            stress += 0.2
            rationale.append(f"tone={request.biofeedback.emotional_tone}")
        stress = min(1.0, round(stress, 3))

        urgency = min(1.0, round((request.energy + stress) / 2.0, 3))
        inferred = "calm" if stress < 0.25 else "focused" if stress < 0.5 else "strained"
        empathy_mode = "supportive" if stress >= 0.5 else "balanced"
        confidence_bias = -0.05 if stress >= 0.6 else 0.03 if request.biofeedback.emotional_tone == "focused" else 0.0
        return EmotionReasoningOutput(
            inferred_emotion=inferred,
            empathy_mode=empathy_mode,
            urgency=urgency,
            stress=stress,
            confidence_bias=confidence_bias,
            rationale=rationale or ["baseline emotional profile"],
        )


class CompassionPolicyEngine:
    def evaluate(self, request: SpiralReasonerRequest, emotion: EmotionReasoningOutput) -> CompassionPolicyDecision:
        reasons: list[str] = []
        if request.intent == IntentMode.DESTROY and not request.operator_consent:
            reasons.append("operator consent required for destroy intent")
        if request.intent == IntentMode.DESTROY and emotion.stress > 0.7:
            reasons.append("destroy intent blocked under high stress")

        care_score = round(
            max(
                0.0,
                min(
                    1.0,
                    request.care_weight
                    + (0.1 if request.intent in {IntentMode.STABILIZE, IntentMode.TRANSFORM} else -0.05)
                    - (0.15 if request.intent == IntentMode.DESTROY else 0.0)
                    - (0.1 if emotion.stress > 0.7 else 0.0),
                ),
            ),
            3,
        )
        if reasons:
            return CompassionPolicyDecision(allowed=False, status="blocked", reasons=reasons, care_score=care_score)
        return CompassionPolicyDecision(allowed=True, status="allowed", reasons=["policy check passed"], care_score=care_score)


class SpiralReasoner:
    PHASES = ("orient", "draft", "stress_test", "refine", "decide")
    RISKY_INTENTS = {IntentMode.DESTROY}
    ULTRA_RISKY_INTENTS = {IntentMode.DESTROY}

    def __init__(self, orchestrator: V8Orchestrator) -> None:
        self.orchestrator = orchestrator
        self.emotion = EmotionReasoner()
        self.compassion = CompassionPolicyEngine()

    def _phase_step(self, phase: str, confidence: float, novelty: float, intent: IntentMode) -> tuple[float, float, list[str], IntentMode]:
        if phase == "orient":
            confidence = min(1.0, confidence + 0.06)
            novelty = max(0.0, novelty - 0.01)
            notes = ["mapped goals, constraints, and uncertainty buckets"]
            return confidence, novelty, notes, intent
        if phase == "draft":
            confidence = min(1.0, confidence + 0.08)
            novelty = max(0.0, novelty - 0.01)
            notes = ["produced initial candidate strategy"]
            return confidence, novelty, notes, intent
        if phase == "stress_test":
            confidence = max(0.0, confidence - 0.03)
            novelty = min(1.0, novelty + 0.05)
            notes = ["challenged assumptions and identified edge cases"]
            next_intent = IntentMode.STABILIZE if intent == IntentMode.DESTROY else intent
            return confidence, novelty, notes, next_intent
        if phase == "refine":
            confidence = min(1.0, confidence + 0.10)
            novelty = max(0.0, novelty - 0.04)
            notes = ["applied fixes for weakest links"]
            return confidence, novelty, notes, intent
        confidence = min(1.0, confidence + 0.02)
        novelty = max(0.0, novelty - 0.02)
        notes = ["ready to decide whether to act or spiral again"]
        return confidence, novelty, notes, intent

    def build_two_person_decision(
        self,
        *,
        first_approved: bool,
        first_reviewer: str,
        first_reason: str,
        second_approved: bool,
        second_reviewer: str,
        second_reason: str,
        require_distinct_reviewers: bool = True,
    ) -> TwoPersonGateDecision:
        first_reviewer = first_reviewer.strip()
        second_reviewer = second_reviewer.strip()
        if not first_reviewer or not second_reviewer:
            raise ValueError("Both reviewer identities are required.")
        if require_distinct_reviewers and first_reviewer == second_reviewer:
            raise ValueError("Two-person gate requires distinct reviewers.")
        return TwoPersonGateDecision(
            first=HumanGateDecision(approved=first_approved, reviewer=first_reviewer, reason=first_reason),
            second=HumanGateDecision(approved=second_approved, reviewer=second_reviewer, reason=second_reason),
        )

    def run(self, request: SpiralReasonerRequest) -> dict[str, Any]:
        if self.orchestrator.sessions.get_session(request.session_id) is None:
            self.orchestrator.create_session(
                SessionCreateRequest(
                    user_id=request.user_id,
                    session_id=request.session_id,
                    prompt=request.prompt,
                    energy=request.energy,
                    intent=request.intent,
                    biofeedback=request.biofeedback,
                    spiral_core=request.spiral_core,
                )
            )

        phase_results: list[SpiralPhaseResult] = []
        emotion = self.emotion.infer(request)
        confidence = max(0.25, min(0.8, request.spiral_core.coherence + emotion.confidence_bias))
        novelty = 0.5
        current_intent = request.intent
        current_energy = request.energy
        current_core = request.spiral_core
        stop_reason = "max_spirals_reached"
        action_taken = False
        final_execution: dict[str, Any] | None = None

        for pass_index in range(1, request.max_spirals + 1):
            start_confidence = confidence
            for phase in self.PHASES:
                confidence, novelty, notes, current_intent = self._phase_step(phase, confidence, novelty, current_intent)
                phase_results.append(
                    SpiralPhaseResult(
                        pass_index=pass_index,
                        phase=phase,
                        confidence=round(confidence, 4),
                        novelty=round(novelty, 4),
                        notes=notes,
                    )
                )
            delta_confidence = confidence - start_confidence
            if confidence >= request.confidence_target:
                stop_reason = "confidence_target_reached"
                break
            if novelty < request.novelty_threshold:
                stop_reason = "novelty_exhausted"
                break
            if delta_confidence < request.min_delta_confidence:
                stop_reason = "confidence_plateau"
                break
            current_core, current_intent, current_energy = self.orchestrator.v7.mutate_for_autonomous_cycle(
                current_core, current_intent, current_energy
            )

        if confidence >= request.confidence_target:
            compassion = self.compassion.evaluate(request, emotion)
            if not compassion.allowed:
                return {
                    "status": "blocked",
                    "spiral": {
                        "passes_completed": phase_results[-1].pass_index if phase_results else 0,
                        "phases_completed": len(phase_results),
                        "stop_reason": "compassion_policy_blocked",
                        "final_confidence": round(confidence, 4),
                        "final_novelty": round(novelty, 4),
                        "action_taken": False,
                    },
                    "phase_results": [x.model_dump() for x in phase_results],
                    "emotion": emotion.model_dump(),
                    "compassion_policy": compassion.model_dump(),
                    "final_execution": None,
                }
            execute = self.orchestrator.execute_session(
                SessionExecuteRequest(
                    user_id=request.user_id,
                    session_id=request.session_id,
                    prompt=request.prompt,
                    energy=current_energy,
                    intent=current_intent,
                    biofeedback=request.biofeedback,
                    spiral_core=current_core,
                    dry_run=request.dry_run,
                    section_name=f"{request.section_prefix}_{current_intent.value}",
                    request_id=f"spiral_{request.session_id}_{len(phase_results)}",
                )
            )
            action_taken = execute.get("status") == "ok"
            final_execution = execute

        return {
            "status": "ok",
            "spiral": {
                "passes_completed": phase_results[-1].pass_index if phase_results else 0,
                "phases_completed": len(phase_results),
                "stop_reason": stop_reason,
                "final_confidence": round(confidence, 4),
                "final_novelty": round(novelty, 4),
                "action_taken": action_taken,
            },
            "phase_results": [x.model_dump() for x in phase_results],
            "emotion": emotion.model_dump(),
            "compassion_policy": self.compassion.evaluate(request, emotion).model_dump(),
            "final_execution": final_execution,
        }

    def run_with_human_gate(
        self,
        request: SpiralReasonerRequest,
        decision: HumanGateDecision | None = None,
    ) -> dict[str, Any]:
        result = self.run(request)
        spiral = result["spiral"]
        action_taken = bool(spiral.get("action_taken"))

        if not action_taken:
            result["human_gate"] = {
                "required": False,
                "approved": False,
                "reviewer": "",
                "reason": "no_action_to_gate",
                "status": "not_applicable",
            }
            return result

        execution = result.get("final_execution") or {}
        intent_value = ""
        try:
            intent_value = execution.get("session", {}).get("intent", "")
        except Exception:
            intent_value = ""

        risky_values = {x.value for x in self.RISKY_INTENTS}
        is_risky = (request.intent in self.RISKY_INTENTS) or (intent_value in risky_values)
        if not is_risky:
            result["human_gate"] = {
                "required": False,
                "approved": True,
                "reviewer": "system_auto",
                "reason": "intent_not_risky",
                "status": "passed",
            }
            return result

        decision = decision or HumanGateDecision()
        if decision.approved:
            result["human_gate"] = {
                "required": True,
                "approved": True,
                "reviewer": decision.reviewer,
                "reason": decision.reason,
                "status": "passed",
            }
            return result

        rollback = self.orchestrator.rollback_session(
            SessionRollbackRequest(
                user_id=request.user_id,
                session_id=request.session_id,
                reason=f"human gate denied: {decision.reason or 'no reason provided'}",
            )
        )
        spiral["action_taken"] = False
        result["final_execution"] = None
        result["human_gate"] = {
            "required": True,
            "approved": False,
            "reviewer": decision.reviewer,
            "reason": decision.reason,
            "status": "blocked_and_rolled_back",
        }
        result["rollback"] = rollback
        return result

    def run_with_two_person_gate(
        self,
        request: SpiralReasonerRequest,
        decisions: TwoPersonGateDecision | None = None,
    ) -> dict[str, Any]:
        result = self.run(request)
        spiral = result["spiral"]
        action_taken = bool(spiral.get("action_taken"))

        if not action_taken:
            result["human_gate"] = {
                "required": False,
                "mode": "two_person",
                "approved": False,
                "status": "not_applicable",
                "reason": "no_action_to_gate",
            }
            return result

        execution = result.get("final_execution") or {}
        intent_value = ""
        try:
            intent_value = execution.get("session", {}).get("intent", "")
        except Exception:
            intent_value = ""

        risky_values = {x.value for x in self.ULTRA_RISKY_INTENTS}
        requires_two_person = (request.intent in self.ULTRA_RISKY_INTENTS) or (intent_value in risky_values)
        if not requires_two_person:
            result["human_gate"] = {
                "required": False,
                "mode": "two_person",
                "approved": True,
                "status": "passed",
                "reason": "intent_not_ultra_risky",
            }
            return result

        decisions = decisions or TwoPersonGateDecision()
        first = decisions.first
        second = decisions.second
        unique_reviewers = bool(first.reviewer and second.reviewer and first.reviewer != second.reviewer)
        both_approved = first.approved and second.approved and unique_reviewers

        if both_approved:
            result["human_gate"] = {
                "required": True,
                "mode": "two_person",
                "approved": True,
                "status": "passed",
                "reviewers": [first.reviewer, second.reviewer],
                "reasons": [first.reason, second.reason],
            }
            return result

        deny_reason_parts: list[str] = []
        if not first.approved:
            deny_reason_parts.append(f"first_reviewer_denied:{first.reason}")
        if not second.approved:
            deny_reason_parts.append(f"second_reviewer_denied:{second.reason}")
        if not unique_reviewers:
            deny_reason_parts.append("reviewers_must_be_distinct")
        deny_reason = "; ".join(x for x in deny_reason_parts if x) or "two_person_gate_denied"

        rollback = self.orchestrator.rollback_session(
            SessionRollbackRequest(
                user_id=request.user_id,
                session_id=request.session_id,
                reason=f"two-person gate denied: {deny_reason}",
            )
        )
        spiral["action_taken"] = False
        result["final_execution"] = None
        result["human_gate"] = {
            "required": True,
            "mode": "two_person",
            "approved": False,
            "status": "blocked_and_rolled_back",
            "reviewers": [first.reviewer, second.reviewer],
            "reasons": [first.reason, second.reason],
            "deny_reason": deny_reason,
        }
        result["rollback"] = rollback
        return result


def _build_create_request() -> SessionCreateRequest:
    return SessionCreateRequest(
        user_id="u1",
        session_id="s1",
        prompt="test prompt",
        energy=0.5,
        intent=IntentMode.TRANSFORM,
        biofeedback=BiofeedbackState(),
        spiral_core=SpiralCoreState(),
    )


def test_create_and_execute_session() -> None:
    orch = V8Orchestrator()
    created = orch.create_session(_build_create_request())
    assert created["status"] == "ok"
    executed = orch.execute_session(
        SessionExecuteRequest(
            user_id="u1",
            session_id="s1",
            prompt="go",
            energy=0.5,
            intent=IntentMode.TRANSFORM,
            biofeedback=BiofeedbackState(),
            spiral_core=SpiralCoreState(),
            dry_run=True,
            section_name="sec1",
        )
    )
    assert executed["status"] == "ok"
    assert executed["session"]["state"] == SessionState.REHEARSING


def test_rollback_uses_safe_checkpoint() -> None:
    orch = V8Orchestrator()
    orch.create_session(_build_create_request())
    blocked = orch.execute_session(
        SessionExecuteRequest(
            user_id="u1",
            session_id="s1",
            prompt="too hot",
            energy=0.99,
            intent=IntentMode.DESTROY,
            biofeedback=BiofeedbackState(),
            spiral_core=SpiralCoreState(),
            dry_run=False,
            section_name="bad",
        )
    )
    assert blocked["status"] == "blocked"
    rolled = orch.rollback_session(SessionRollbackRequest(user_id="u1", session_id="s1"))
    assert rolled["restored_snapshot"]["state"] != SessionState.DEGRADED


def test_loop_status_persists_after_cleanup() -> None:
    async def runner() -> None:
        orch = V8Orchestrator()
        orch.create_session(_build_create_request())
        orch.start_autonomous_loop(
            AutonomousLoopStartRequest(
                user_id="u1",
                session_id="s1",
                prompt="loop",
                energy=0.5,
                intent=IntentMode.TRANSFORM,
                interval_seconds=0.0,
                max_steps=1,
            )
        )
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        status = orch.autonomous_loop_status("s1", "u1")
        assert status["loop"]["is_running"] is False
        assert status["loop"]["stopped_at"] is not None

    asyncio.run(runner())


def test_spiral_reasoner_stops_and_returns_trace() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_spiral",
            prompt="compose stable transformation",
            energy=0.55,
            intent=IntentMode.TRANSFORM,
            confidence_target=0.75,
            max_spirals=4,
        )
    )
    assert result["status"] == "ok"
    assert result["spiral"]["phases_completed"] > 0
    assert result["spiral"]["stop_reason"] in {"confidence_target_reached", "novelty_exhausted", "confidence_plateau", "max_spirals_reached"}
    assert isinstance(result["phase_results"], list)


def test_spiral_reasoner_executes_when_confident() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_exec",
            prompt="perform action",
            energy=0.5,
            intent=IntentMode.TRANSFORM,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        )
    )
    assert result["status"] == "ok"
    assert result["spiral"]["action_taken"] is True
    assert result["final_execution"] is not None


def test_human_gate_blocks_risky_intent_without_approval() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run_with_human_gate(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_gate_block",
            prompt="destructive plan",
            energy=0.5,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        ),
        HumanGateDecision(approved=False, reviewer="op", reason="unsafe"),
    )
    assert result["status"] == "ok"
    assert result["human_gate"]["required"] is True
    assert result["human_gate"]["approved"] is False
    assert result["human_gate"]["status"] == "blocked_and_rolled_back"
    assert result["spiral"]["action_taken"] is False
    assert result["rollback"]["status"] == "ok"


def test_human_gate_allows_risky_intent_with_approval() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run_with_human_gate(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_gate_allow",
            prompt="destructive plan",
            energy=0.5,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        ),
        HumanGateDecision(approved=True, reviewer="op", reason="sandbox approved"),
    )
    assert result["status"] == "ok"
    assert result["human_gate"]["required"] is True
    assert result["human_gate"]["approved"] is True
    assert result["human_gate"]["status"] == "passed"
    assert result["final_execution"] is not None


def test_two_person_gate_blocks_when_one_denies() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run_with_two_person_gate(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_two_block_1",
            prompt="ultra risky action",
            energy=0.5,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        ),
        TwoPersonGateDecision(
            first=HumanGateDecision(approved=True, reviewer="alice", reason="sandbox"),
            second=HumanGateDecision(approved=False, reviewer="bob", reason="too risky"),
        ),
    )
    assert result["status"] == "ok"
    assert result["human_gate"]["mode"] == "two_person"
    assert result["human_gate"]["approved"] is False
    assert result["human_gate"]["status"] == "blocked_and_rolled_back"
    assert result["spiral"]["action_taken"] is False


def test_two_person_gate_blocks_same_reviewer() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run_with_two_person_gate(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_two_block_2",
            prompt="ultra risky action",
            energy=0.5,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        ),
        TwoPersonGateDecision(
            first=HumanGateDecision(approved=True, reviewer="alice", reason="ok"),
            second=HumanGateDecision(approved=True, reviewer="alice", reason="also ok"),
        ),
    )
    assert result["status"] == "ok"
    assert result["human_gate"]["approved"] is False
    assert "reviewers_must_be_distinct" in result["human_gate"]["deny_reason"]


def test_two_person_gate_passes_when_both_approve_distinct() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run_with_two_person_gate(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_two_pass",
            prompt="ultra risky action",
            energy=0.5,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            max_spirals=3,
            dry_run=True,
        ),
        TwoPersonGateDecision(
            first=HumanGateDecision(approved=True, reviewer="alice", reason="bounded"),
            second=HumanGateDecision(approved=True, reviewer="bob", reason="observed"),
        ),
    )
    assert result["status"] == "ok"
    assert result["human_gate"]["mode"] == "two_person"
    assert result["human_gate"]["approved"] is True
    assert result["human_gate"]["status"] == "passed"
    assert result["final_execution"] is not None


def test_build_two_person_decision_valid() -> None:
    reasoner = SpiralReasoner(V8Orchestrator())
    decision = reasoner.build_two_person_decision(
        first_approved=True,
        first_reviewer="alice",
        first_reason="checked",
        second_approved=True,
        second_reviewer="bob",
        second_reason="approved",
    )
    assert decision.first.reviewer == "alice"
    assert decision.second.reviewer == "bob"
    assert decision.first.approved is True
    assert decision.second.approved is True


def test_build_two_person_decision_rejects_same_reviewer() -> None:
    reasoner = SpiralReasoner(V8Orchestrator())
    try:
        reasoner.build_two_person_decision(
            first_approved=True,
            first_reviewer="alice",
            first_reason="ok",
            second_approved=True,
            second_reviewer="alice",
            second_reason="ok",
        )
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_build_two_person_decision_rejects_blank_reviewer() -> None:
    reasoner = SpiralReasoner(V8Orchestrator())
    try:
        reasoner.build_two_person_decision(
            first_approved=True,
            first_reviewer="",
            first_reason="ok",
            second_approved=True,
            second_reviewer="bob",
            second_reason="ok",
        )
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_spiral_compassion_blocks_destroy_without_consent() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_compassion_block",
            prompt="execute destructive plan now",
            energy=0.7,
            intent=IntentMode.DESTROY,
            confidence_target=0.7,
            operator_consent=False,
            dry_run=True,
        )
    )
    assert result["status"] == "blocked"
    assert result["spiral"]["stop_reason"] == "compassion_policy_blocked"
    assert result["compassion_policy"]["allowed"] is False


def test_spiral_emotion_payload_present() -> None:
    orch = V8Orchestrator()
    reasoner = SpiralReasoner(orch)
    result = reasoner.run(
        SpiralReasonerRequest(
            user_id="u1",
            session_id="s_emotion",
            prompt="gentle transform",
            energy=0.5,
            intent=IntentMode.TRANSFORM,
            confidence_target=0.7,
            dry_run=True,
        )
    )
    assert "emotion" in result
    assert "inferred_emotion" in result["emotion"]
    assert "compassion_policy" in result


if __name__ == "__main__":
    test_create_and_execute_session()
    test_rollback_uses_safe_checkpoint()
    test_loop_status_persists_after_cleanup()
    test_spiral_reasoner_stops_and_returns_trace()
    test_spiral_reasoner_executes_when_confident()
    test_human_gate_blocks_risky_intent_without_approval()
    test_human_gate_allows_risky_intent_with_approval()
    test_two_person_gate_blocks_when_one_denies()
    test_two_person_gate_blocks_same_reviewer()
    test_two_person_gate_passes_when_both_approve_distinct()
    test_build_two_person_decision_valid()
    test_build_two_person_decision_rejects_same_reviewer()
    test_build_two_person_decision_rejects_blank_reviewer()
    test_spiral_compassion_blocks_destroy_without_consent()
    test_spiral_emotion_payload_present()
    print("ok")
