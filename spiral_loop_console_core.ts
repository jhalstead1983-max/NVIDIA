export type IntentMode = "ascend" | "destroy" | "expand" | "stabilize" | "transform";
export type SessionState = "idle" | "primed" | "rehearsing" | "performing" | "autonomous" | "degraded" | "rollback" | "complete";
export type LiveMode = "stream" | "refresh";
export type ActionStatus = "pending" | "success" | "failed";

export type BiofeedbackState = {
  heart_rate: number;
  breath_rate: number;
  voice_intensity: number;
  emotional_tone: "calm" | "focused" | "driven" | "agitated";
  source: string;
};

export type SpiralCoreState = {
  radius: number;
  angle: number;
  angular_velocity: number;
  expansion: number;
  coherence: number;
};

export type SessionSnapshot = {
  snapshot_id: string;
  session_id: string;
  user_id: string;
  state: SessionState;
  prompt: string;
  energy: number;
  intent: IntentMode;
  biofeedback: BiofeedbackState;
  spiral_core: SpiralCoreState;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ScoreShape = {
  coherence: number;
  execution_success: number;
  biofeedback_alignment: number;
  memory_match: number;
  intent_fidelity: number;
  reward: number;
};

export type ExecuteResponse = {
  status: string;
  session?: SessionSnapshot;
  section?: unknown;
  osc_push?: unknown;
  midi_export?: unknown;
  decision?: unknown;
  score?: ScoreShape;
  memory_written?: unknown;
  violations?: string[];
  autonomous_mutation?: unknown;
};

export type LoopStatus = {
  session_id: string;
  user_id: string;
  is_running: boolean;
  current_step: number;
  max_steps: number;
  interval_seconds: number;
  last_error?: string | null;
  last_result?: Record<string, unknown> | null;
  started_at?: string | null;
  stopped_at?: string | null;
};

export type WsRealtimeEvent = {
  type: string;
  event_id?: string;
  session_id: string;
  user_id?: string;
  created_at?: string;
  payload?: unknown;
};

export type ActionRecord = {
  id: string;
  action: string;
  status: ActionStatus;
  detail?: string;
  at: string;
};

export type ToastItem = {
  id: string;
  title: string;
  tone: "default" | "warning" | "error";
};

export type Settings = {
  apiBase: string;
  wsBase: string;
  userId: string;
  sessionId: string;
  prompt: string;
  energy: number[];
  intent: IntentMode;
  dryRun: boolean;
  oscHost: string;
  oscPort: string;
  selectedPreset: string;
  autonomousDryRun: boolean;
  autonomousBaseSection: string;
  loopIntervalSeconds: number;
  loopMaxSteps: number;
  liveMode: LiveMode;
  heartbeatIntervalMs: number;
  staleThresholdMs: number;
  biofeedback: BiofeedbackState;
  spiralCore: SpiralCoreState;
};

export type EventEnvelope = {
  event_id: string;
  session_id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AppState = {
  settings: Settings;
  sessionState: SessionSnapshot | null;
  events: EventEnvelope[];
  lastExecute: ExecuteResponse | null;
  lastDecision: unknown;
  lastScore: ScoreShape | null;
  lastOscPush: unknown;
  lastMidiExport: unknown;
  lastAutonomousMutation: unknown;
  loopStatus: LoopStatus | null;
  wsEvents: WsRealtimeEvent[];
  status: string;
  error: string;
  isBusy: boolean;
  wsConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  lastHeartbeatAt: string | null;
  lastWsEventAt: string | null;
  isWsStale: boolean;
  log: string[];
  actionHistory: ActionRecord[];
  timelineSearch: string;
  eventFilter: string;
  toasts: ToastItem[];
};

export type ReducerAction =
  | { type: "patchSettings"; patch: Partial<Settings> }
  | { type: "setField"; key: keyof Settings; value: unknown }
  | { type: "setSession"; session: SessionSnapshot | null }
  | { type: "setLoopStatus"; loop: LoopStatus | null }
  | { type: "setStatus"; value: string }
  | { type: "setError"; value: string }
  | { type: "setWsStale"; value: boolean }
  | { type: "pushAction"; action: string; status: ActionStatus; detail?: string }
  | { type: "toast"; title: string; tone: "default" | "warning" | "error" };

export const defaultSettings: Settings = {
  apiBase: "http://127.0.0.1:8000",
  wsBase: "ws://127.0.0.1:8000",
  userId: "jon",
  sessionId: "session-v8-001",
  prompt: "aggressive spiral live gold section for full launch",
  energy: [0.86],
  intent: "transform",
  dryRun: true,
  oscHost: "127.0.0.1",
  oscPort: "11000",
  selectedPreset: "gold",
  autonomousDryRun: true,
  autonomousBaseSection: "v8_loop",
  loopIntervalSeconds: 8,
  loopMaxSteps: 12,
  liveMode: "stream",
  heartbeatIntervalMs: 15000,
  staleThresholdMs: 30000,
  biofeedback: {
    heart_rate: 88,
    breath_rate: 15,
    voice_intensity: 0.62,
    emotional_tone: "focused",
    source: "manual",
  },
  spiralCore: {
    radius: 0.58,
    angle: 180,
    angular_velocity: 0.62,
    expansion: 0.55,
    coherence: 0.7,
  },
};

export function buildInitialState(): AppState {
  return {
    settings: { ...defaultSettings },
    sessionState: null,
    events: [],
    lastExecute: null,
    lastDecision: null,
    lastScore: null,
    lastOscPush: null,
    lastMidiExport: null,
    lastAutonomousMutation: null,
    loopStatus: null,
    wsEvents: [],
    status: "Idle",
    error: "",
    isBusy: false,
    wsConnected: false,
    isReconnecting: false,
    reconnectAttempt: 0,
    lastHeartbeatAt: null,
    lastWsEventAt: null,
    isWsStale: false,
    log: [],
    actionHistory: [],
    timelineSearch: "",
    eventFilter: "all",
    toasts: [],
  };
}

export function reducer(state: AppState, action: ReducerAction): AppState {
  switch (action.type) {
    case "patchSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "setField":
      return { ...state, settings: { ...state.settings, [action.key]: action.value } as Settings };
    case "setSession":
      return { ...state, sessionState: action.session };
    case "setLoopStatus":
      return { ...state, loopStatus: action.loop };
    case "setStatus":
      return { ...state, status: action.value };
    case "setError":
      return { ...state, error: action.value };
    case "setWsStale":
      return { ...state, isWsStale: action.value };
    case "pushAction":
      return {
        ...state,
        actionHistory: [
          {
            id: `action-${state.actionHistory.length + 1}`,
            action: action.action,
            status: action.status,
            detail: action.detail,
            at: new Date().toISOString(),
          },
          ...state.actionHistory,
        ].slice(0, 120),
      };
    case "toast":
      return {
        ...state,
        toasts: [
          { id: `toast-${state.toasts.length + 1}`, title: action.title, tone: action.tone },
          ...state.toasts,
        ].slice(0, 4),
      };
    default:
      return state;
  }
}

export function shouldConfirmLiveExecute(settings: Settings): boolean {
  return !settings.dryRun && (settings.intent === "destroy" || settings.energy[0] >= 0.85);
}

export function canStartLoop(sessionState: SessionSnapshot | null): { ok: boolean; reason?: string } {
  if (sessionState?.state === "degraded" || sessionState?.state === "rollback") {
    return { ok: false, reason: "Cannot start a loop while session is degraded or rollback." };
  }
  return { ok: true };
}
