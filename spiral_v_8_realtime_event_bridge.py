# =============================
# app/core/realtime.py
# =============================
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any
from fastapi import WebSocket


class RealtimeSessionHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[session_id].add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            if session_id in self._connections:
                self._connections[session_id].discard(websocket)
                if not self._connections[session_id]:
                    del self._connections[session_id]

    async def publish(self, session_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.get(session_id, set()))

        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(message)
            except Exception:
                stale.append(socket)

        if stale:
            async with self._lock:
                for socket in stale:
                    self._connections[session_id].discard(socket)
                if session_id in self._connections and not self._connections[session_id]:
                    del self._connections[session_id]


realtime_hub = RealtimeSessionHub()


# =============================
# app/services/v8_event_bridge.py
# =============================
from __future__ import annotations

from typing import Any

from app.core.realtime import realtime_hub
from app.models.v8 import EventEnvelope


class V8EventBridge:
    async def publish_event(self, event: EventEnvelope) -> None:
        await realtime_hub.publish(
            event.session_id,
            {
                "type": event.event_type,
                "event_id": event.event_id,
                "session_id": event.session_id,
                "user_id": event.user_id,
                "payload": event.payload,
                "created_at": event.created_at,
            },
        )

    async def publish_state(self, session_id: str, user_id: str, state: dict[str, Any]) -> None:
        await realtime_hub.publish(
            session_id,
            {
                "type": "session.state.updated",
                "session_id": session_id,
                "user_id": user_id,
                "payload": state,
            },
        )


# =============================
# app/routes/ws.py
# =============================
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.realtime import realtime_hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str) -> None:
    await realtime_hub.connect(session_id, websocket)
    try:
        await websocket.send_json(
            {
                "type": "ws.connected",
                "session_id": session_id,
                "payload": {"status": "ok"},
            }
        )
        while True:
            incoming = await websocket.receive_text()
            await websocket.send_json(
                {
                    "type": "ws.echo",
                    "session_id": session_id,
                    "payload": {"message": incoming},
                }
            )
    except WebSocketDisconnect:
        await realtime_hub.disconnect(session_id, websocket)
    except Exception:
        await realtime_hub.disconnect(session_id, websocket)


# =============================
# app/services/v8_orchestrator.py (realtime patch)
# Replace your V8Orchestrator with this upgraded version.
# =============================
from __future__ import annotations

import asyncio
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
    SessionState,
    SessionTransitionRequest,
)
from app.services.v7_core import V7Context, V7CoreService
from app.services.v8_event_bridge import V8EventBridge
from app.services.v8_scoring import V8ScoringService


class V8Orchestrator:
    def __init__(self) -> None:
        self.v7 = V7CoreService()
        self.scoring = V8ScoringService()
        self.events = EventStore()
        self.sessions = SessionStore()
        self.memory = V7MemoryRepository()
        self.bridge = V8EventBridge()
        self.events.initialize()
        self.sessions.initialize()
        self.memory.initialize()

    def _emit(self, event) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.bridge.publish_event(event))
        except RuntimeError:
            pass

    def _emit_state(self, snapshot) -> None:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.bridge.publish_state(snapshot.session_id, snapshot.user_id, snapshot.model_dump()))
        except RuntimeError:
            pass

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
        self._emit(event)
        self._emit_state(snapshot)
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
        self._emit(event)
        self._emit_state(snapshot)
        return {"status": "ok", "session": snapshot.model_dump(), "event": event.model_dump()}

    def execute_session(self, request: SessionExecuteRequest) -> dict[str, Any]:
        current = self.sessions.get_session(request.session_id)
        if current is None:
            raise ValueError("Session not found. Create it first.")

        health = {"api": "ok", "ws": "connected"}
        violations = evaluate_policy(request, current.state, health)
        if violations:
            event = self.events.append(request.session_id, request.user_id, "policy.blocked", {"violations": violations})
            self._emit(event)
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

        event_decision = self.events.append(request.session_id, request.user_id, "agent.decision.made", agent.model_dump())
        event_osc = self.events.append(request.session_id, request.user_id, "osc.push.completed", osc_push)
        event_midi = self.events.append(request.session_id, request.user_id, "midi.export.completed", midi_export)
        event_score = self.events.append(request.session_id, request.user_id, "session.scored", score.model_dump())
        event_execute = self.events.append(request.session_id, request.user_id, "session.executed", {
            "section": section,
            "decision": agent.model_dump(),
            "score": score.model_dump(),
            "memory_written": written_memory.model_dump(),
        })

        for event in (event_decision, event_osc, event_midi, event_score, event_execute):
            self._emit(event)
        self._emit_state(snapshot)

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
        self._emit(event)
        self._emit_state(rollback_snapshot)
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
# app/main.py patch
# =============================
# from app.routes.ws import router as ws_router
# app.include_router(ws_router)
# from app.routes.v8 import router as v8_router
# app.include_router(v8_router)
