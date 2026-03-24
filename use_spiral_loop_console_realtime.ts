import { useEffect, useRef } from "react";
import type { Dispatch } from "react";

type Tone = "default" | "warning" | "error";

type RealtimeSettings = {
  wsBase: string;
  sessionId: string;
  userId: string;
  loopMaxSteps: number;
  loopIntervalSeconds: number;
  heartbeatIntervalMs: number;
  staleThresholdMs: number;
};

type RealtimeLoopStatus = {
  session_id: string;
  user_id: string;
  is_running: boolean;
  current_step: number;
  max_steps: number;
  interval_seconds: number;
  last_error?: string | null;
  last_result?: Record<string, any> | null;
  started_at?: string | null;
  stopped_at?: string | null;
};

type RealtimeExecuteResponse = {
  status: string;
  section?: any;
  decision?: any;
  score?: any;
  memory_written?: any;
};

type RealtimeSessionSnapshot = {
  state: string;
};

type RealtimeEventEnvelope = {
  event_id: string;
  session_id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
};

type WsRealtimeEvent = {
  type: string;
  event_id?: string;
  session_id: string;
  user_id?: string;
  created_at?: string;
  payload?: any;
};

type RealtimeAction =
  | { type: "setSession"; session: RealtimeSessionSnapshot | null }
  | { type: "prependEvent"; event: RealtimeEventEnvelope }
  | { type: "setLastDecision"; value: any }
  | { type: "setLastScore"; value: any }
  | { type: "setLastOscPush"; value: any }
  | { type: "setLastMidiExport"; value: any }
  | { type: "setLastAutonomousMutation"; value: any }
  | { type: "setLastExecute"; value: RealtimeExecuteResponse | null }
  | { type: "setLoopStatus"; loop: RealtimeLoopStatus | null }
  | { type: "setStatus"; value: string }
  | { type: "setWsConnected"; value: boolean }
  | { type: "setReconnecting"; value: boolean }
  | { type: "setReconnectAttempt"; value: number | ((prev: number) => number) }
  | { type: "setLastWsEventAt"; value: string | null }
  | { type: "setWsStale"; value: boolean }
  | { type: "appendWsEvent"; value: WsRealtimeEvent };

type HookOptions = {
  settings: RealtimeSettings;
  loopStatus: RealtimeLoopStatus | null;
  lastExecute: RealtimeExecuteResponse | null;
  wsConnected: boolean;
  lastWsEventAt: string | null;
  dispatch: Dispatch<RealtimeAction>;
  refreshAll: () => Promise<void>;
  sendHeartbeat: () => Promise<void>;
  setField: (key: "intent" | "energy" | "spiralCore", value: any) => void;
  toast: (title: string, tone?: Tone) => void;
  pushLog: (entry: string) => void;
};

type RealtimeHandlerContext = {
  settings: RealtimeSettings;
  currentLoopStatus: RealtimeLoopStatus | null;
  currentLastExecute: RealtimeExecuteResponse | null;
  dispatch: Dispatch<RealtimeAction>;
  setField: HookOptions["setField"];
  toast: HookOptions["toast"];
  pushLog: HookOptions["pushLog"];
};

function buildRealtimeEventEnvelope(data: WsRealtimeEvent, fallbackUserId: string): RealtimeEventEnvelope | null {
  if (!data.event_id || data.type === "ws.connected" || data.type === "ws.echo") return null;
  return {
    event_id: data.event_id,
    session_id: data.session_id,
    user_id: data.user_id || fallbackUserId,
    event_type: data.type,
    payload: data.payload || {},
    created_at: data.created_at || new Date().toISOString(),
  };
}

function handleRealtimeMessage(data: WsRealtimeEvent, context: RealtimeHandlerContext) {
  const { settings, currentLoopStatus, currentLastExecute, dispatch, setField, toast, pushLog } = context;

  if (data.type === "session.state.updated" && data.payload) {
    dispatch({ type: "setSession", session: data.payload as RealtimeSessionSnapshot });
    dispatch({ type: "setStatus", value: `Live state: ${(data.payload as RealtimeSessionSnapshot).state}` });
  }

  const timelineEvent = buildRealtimeEventEnvelope(data, settings.userId);
  if (timelineEvent) {
    dispatch({ type: "prependEvent", event: timelineEvent });
  }

  switch (data.type) {
    case "agent.decision.made":
      dispatch({ type: "setLastDecision", value: data.payload });
      break;
    case "session.scored":
      dispatch({ type: "setLastScore", value: data.payload });
      break;
    case "osc.push.completed":
      dispatch({ type: "setLastOscPush", value: data.payload });
      break;
    case "midi.export.completed":
      dispatch({ type: "setLastMidiExport", value: data.payload });
      break;
    case "autonomous.mutation.applied":
      dispatch({ type: "setLastAutonomousMutation", value: data.payload || null });
      if (data.payload?.to_intent) setField("intent", data.payload.to_intent);
      if (typeof data.payload?.to_energy === "number") setField("energy", [data.payload.to_energy]);
      if (data.payload?.spiral_core) setField("spiralCore", data.payload.spiral_core);
      break;
    case "session.executed":
      dispatch({
        type: "setLastExecute",
        value: {
          ...(currentLastExecute || { status: "ok" }),
          status: "ok",
          section: data.payload?.section,
          decision: data.payload?.decision,
          score: data.payload?.score,
          memory_written: data.payload?.memory_written,
        },
      });
      break;
    case "autonomous.loop.started":
      dispatch({
        type: "setLoopStatus",
        loop: {
          session_id: settings.sessionId,
          user_id: settings.userId,
          is_running: true,
          current_step: currentLoopStatus?.current_step || 0,
          max_steps: data.payload?.max_steps ?? currentLoopStatus?.max_steps ?? settings.loopMaxSteps,
          interval_seconds: data.payload?.interval_seconds ?? currentLoopStatus?.interval_seconds ?? settings.loopIntervalSeconds,
          last_error: null,
          last_result: currentLoopStatus?.last_result || null,
          started_at: data.created_at || new Date().toISOString(),
          stopped_at: null,
        },
      });
      dispatch({ type: "setStatus", value: "Autonomous loop running" });
      toast("Loop running", "default");
      break;
    case "autonomous.loop.tick":
      if (currentLoopStatus) {
        dispatch({
          type: "setLoopStatus",
          loop: {
            ...currentLoopStatus,
            is_running: true,
            current_step: data.payload?.step ?? currentLoopStatus.current_step,
            max_steps: data.payload?.max_steps ?? currentLoopStatus.max_steps,
          },
        });
      }
      break;
    case "autonomous.loop.error":
      if (currentLoopStatus) {
        dispatch({
          type: "setLoopStatus",
          loop: {
            ...currentLoopStatus,
            last_error: data.payload?.error ?? "unknown",
          },
        });
      }
      dispatch({ type: "setStatus", value: "Autonomous loop error" });
      toast("Autonomous loop error", "error");
      break;
    case "autonomous.loop.stop_requested":
      dispatch({ type: "setStatus", value: "Autonomous loop stopping" });
      break;
    case "autonomous.loop.stopped":
      if (currentLoopStatus) {
        dispatch({
          type: "setLoopStatus",
          loop: {
            ...currentLoopStatus,
            is_running: false,
            current_step: data.payload?.current_step ?? currentLoopStatus.current_step,
            last_error: data.payload?.last_error ?? currentLoopStatus.last_error,
            stopped_at: data.created_at || new Date().toISOString(),
          },
        });
      }
      dispatch({ type: "setStatus", value: "Autonomous loop stopped" });
      toast("Autonomous loop stopped", "warning");
      break;
  }

  pushLog(`Realtime event: ${data.type}`);
}

export function useSpiralLoopConsoleRealtime(options: HookOptions) {
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(options.settings);
  const loopStatusRef = useRef(options.loopStatus);
  const lastExecuteRef = useRef(options.lastExecute);
  const helpersRef = useRef({
    refreshAll: options.refreshAll,
    sendHeartbeat: options.sendHeartbeat,
    setField: options.setField,
    toast: options.toast,
    pushLog: options.pushLog,
  });

  useEffect(() => {
    settingsRef.current = options.settings;
    loopStatusRef.current = options.loopStatus;
    lastExecuteRef.current = options.lastExecute;
    helpersRef.current = {
      refreshAll: options.refreshAll,
      sendHeartbeat: options.sendHeartbeat,
      setField: options.setField,
      toast: options.toast,
      pushLog: options.pushLog,
    };
  }, [
    options.settings,
    options.loopStatus,
    options.lastExecute,
    options.refreshAll,
    options.sendHeartbeat,
    options.setField,
    options.toast,
    options.pushLog,
  ]);

  useEffect(() => {
    options.refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void helpersRef.current.sendHeartbeat();
      if (!options.wsConnected) {
        void helpersRef.current.refreshAll();
      }
      if (options.wsConnected && options.lastWsEventAt) {
        const ageMs = Date.now() - new Date(options.lastWsEventAt).getTime();
        if (ageMs > options.settings.staleThresholdMs) {
          options.dispatch({ type: "setWsStale", value: true });
          options.dispatch({ type: "setStatus", value: "Realtime stale" });
        }
      }
    }, options.settings.heartbeatIntervalMs);

    return () => clearInterval(timer);
  }, [
    options.dispatch,
    options.lastWsEventAt,
    options.settings.heartbeatIntervalMs,
    options.settings.staleThresholdMs,
    options.wsConnected,
  ]);

  useEffect(() => {
    const session = options.settings.sessionId.trim();
    if (!session) return;

    let socket: WebSocket | null = null;
    let isActive = true;

    const connect = () => {
      try {
        socket = new WebSocket(`${options.settings.wsBase}/ws/${encodeURIComponent(session)}`);
        socket.onopen = () => {
          if (!isActive) return;
          options.dispatch({ type: "setWsConnected", value: true });
          options.dispatch({ type: "setReconnecting", value: false });
          options.dispatch({ type: "setReconnectAttempt", value: 0 });
          options.dispatch({ type: "setStatus", value: "Realtime connected" });
          helpersRef.current.pushLog(`WebSocket connected for ${session}.`);
        };
        socket.onmessage = (event) => {
          try {
            const data: WsRealtimeEvent = JSON.parse(event.data);
            options.dispatch({ type: "appendWsEvent", value: data });
            options.dispatch({ type: "setLastWsEventAt", value: data.created_at || new Date().toISOString() });
            options.dispatch({ type: "setWsStale", value: false });
            handleRealtimeMessage(data, {
              settings: settingsRef.current,
              currentLoopStatus: loopStatusRef.current,
              currentLastExecute: lastExecuteRef.current,
              dispatch: options.dispatch,
              setField: helpersRef.current.setField,
              toast: helpersRef.current.toast,
              pushLog: helpersRef.current.pushLog,
            });
          } catch {
            options.dispatch({ type: "appendWsEvent", value: { type: "raw", session_id: session, payload: event.data } });
            helpersRef.current.pushLog("Received raw websocket message.");
          }
        };
        socket.onclose = () => {
          if (!isActive) return;
          options.dispatch({ type: "setWsConnected", value: false });
          options.dispatch({ type: "setReconnecting", value: true });
          options.dispatch({ type: "setStatus", value: "Realtime disconnected" });
          options.dispatch({
            type: "setReconnectAttempt",
            value: (prev: number) => {
              const next = prev + 1;
              const delay = Math.min(1000 * Math.pow(2, Math.min(next, 4)), 10000);
              reconnectTimerRef.current = setTimeout(connect, delay);
              return next;
            },
          });
        };
        socket.onerror = () => {
          if (!isActive) return;
          options.dispatch({ type: "setWsConnected", value: false });
          options.dispatch({ type: "setReconnecting", value: true });
          options.dispatch({ type: "setStatus", value: "Realtime error" });
        };
      } catch {
        options.dispatch({ type: "setWsConnected", value: false });
        options.dispatch({ type: "setReconnecting", value: true });
      }
    };

    connect();

    return () => {
      isActive = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socket) socket.close();
    };
  }, [options.dispatch, options.settings.sessionId, options.settings.userId, options.settings.wsBase]);
}
