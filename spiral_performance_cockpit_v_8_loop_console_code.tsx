import React, { useEffect, useMemo, useReducer } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Activity,
  Brain,
  Cable,
  Database,
  HeartPulse,
  Orbit,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  TimerReset,
  Waves,
  Wifi,
} from "lucide-react";
import { useSpiralLoopConsoleActions } from "./use_spiral_loop_console_actions";
import { useSpiralLoopConsoleRealtime } from "./use_spiral_loop_console_realtime";

type IntentMode = "ascend" | "destroy" | "expand" | "stabilize" | "transform";
type SessionState = "idle" | "primed" | "rehearsing" | "performing" | "autonomous" | "degraded" | "rollback" | "complete";
type EmotionalTone = "calm" | "focused" | "driven" | "agitated";
type LiveMode = "stream" | "refresh";
type ActionStatus = "pending" | "success" | "failed";

type BiofeedbackState = {
  heart_rate: number;
  breath_rate: number;
  voice_intensity: number;
  emotional_tone: EmotionalTone;
  source: string;
};

type SpiralCoreState = {
  radius: number;
  angle: number;
  angular_velocity: number;
  expansion: number;
  coherence: number;
};

type SessionSnapshot = {
  snapshot_id: string;
  session_id: string;
  user_id: string;
  state: SessionState;
  prompt: string;
  energy: number;
  intent: IntentMode;
  biofeedback: BiofeedbackState;
  spiral_core: SpiralCoreState;
  metadata: Record<string, any>;
  created_at: string;
};

type EventEnvelope = {
  event_id: string;
  session_id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
};

type ScoreShape = {
  coherence: number;
  execution_success: number;
  biofeedback_alignment: number;
  memory_match: number;
  intent_fidelity: number;
  reward: number;
};

type ExecuteResponse = {
  status: string;
  session?: SessionSnapshot;
  section?: any;
  osc_push?: any;
  midi_export?: any;
  decision?: any;
  score?: ScoreShape;
  memory_written?: any;
  violations?: string[];
  autonomous_mutation?: any;
};

type HumanGateDecision = {
  approved: boolean;
  reviewer: string;
  reason: string;
};

type SpiralResponse = {
  status: string;
  spiral?: {
    passes_completed: number;
    phases_completed: number;
    stop_reason: string;
    final_confidence: number;
    final_novelty: number;
    action_taken: boolean;
  };
  phase_results?: Array<{
    pass_index: number;
    phase: string;
    confidence: number;
    novelty: number;
    notes: string[];
  }>;
  final_execution?: ExecuteResponse | null;
  emotion?: Record<string, any>;
  compassion_policy?: Record<string, any>;
  human_gate?: Record<string, any>;
  rollback?: Record<string, any>;
};

type LoopStatus = {
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

type WsRealtimeEvent = {
  type: string;
  event_id?: string;
  session_id: string;
  user_id?: string;
  created_at?: string;
  payload?: any;
};

type ActionRecord = {
  id: string;
  action: string;
  status: ActionStatus;
  detail?: string;
  at: string;
};

type ToastItem = {
  id: string;
  title: string;
  tone: "default" | "warning" | "error";
};

type Settings = {
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
  spiralMaxSpirals: number;
  spiralConfidenceTarget: number;
  spiralNoveltyThreshold: number;
  gate1Approved: boolean;
  gate1Reviewer: string;
  gate1Reason: string;
  gate2Approved: boolean;
  gate2Reviewer: string;
  gate2Reason: string;
  biofeedback: BiofeedbackState;
  spiralCore: SpiralCoreState;
};

type AppState = {
  settings: Settings;
  sessionState: SessionSnapshot | null;
  events: EventEnvelope[];
  lastExecute: ExecuteResponse | null;
  lastDecision: any;
  lastScore: ScoreShape | null;
  lastOscPush: any;
  lastMidiExport: any;
  lastAutonomousMutation: any;
  spiralResult: SpiralResponse | null;
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

type Action =
  | { type: "patchSettings"; patch: Partial<Settings> }
  | { type: "setField"; key: keyof Settings; value: any }
  | { type: "setSession"; session: SessionSnapshot | null }
  | { type: "setEvents"; events: EventEnvelope[] }
  | { type: "prependEvent"; event: EventEnvelope }
  | { type: "setLoopStatus"; loop: LoopStatus | null }
  | { type: "setLastExecute"; value: ExecuteResponse | null }
  | { type: "setLastDecision"; value: any }
  | { type: "setLastScore"; value: ScoreShape | null }
  | { type: "setLastOscPush"; value: any }
  | { type: "setLastMidiExport"; value: any }
  | { type: "setLastAutonomousMutation"; value: any }
  | { type: "setSpiralResult"; value: SpiralResponse | null }
  | { type: "setStatus"; value: string }
  | { type: "setError"; value: string }
  | { type: "setBusy"; value: boolean }
  | { type: "setWsConnected"; value: boolean }
  | { type: "setReconnecting"; value: boolean }
  | { type: "setReconnectAttempt"; value: number | ((prev: number) => number) }
  | { type: "setHeartbeatAt"; value: string | null }
  | { type: "setLastWsEventAt"; value: string | null }
  | { type: "setWsStale"; value: boolean }
  | { type: "appendWsEvent"; value: WsRealtimeEvent }
  | { type: "pushLog"; value: string }
  | { type: "clearLog" }
  | { type: "pushAction"; action: string; status: ActionStatus; detail?: string }
  | { type: "setTimelineSearch"; value: string }
  | { type: "setEventFilter"; value: string }
  | { type: "toast"; title: string; tone: "default" | "warning" | "error" }
  | { type: "dismissToast"; id: string };

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE = "ws://127.0.0.1:8000";
const STORAGE_KEY = "spiral-v8-loop-console-v2";

const presetMap = [
  { id: "gold", name: "Gold Launch", prompt: "aggressive spiral live gold section for full launch", energy: 0.86, intent: "transform" as IntentMode },
  { id: "safe", name: "Safe Rehearsal", prompt: "controlled rehearsal state with safe automation", energy: 0.48, intent: "stabilize" as IntentMode },
  { id: "destroy", name: "Destructive Push", prompt: "violent peak-state push with controlled force", energy: 0.91, intent: "destroy" as IntentMode },
];

const defaultSettings: Settings = {
  apiBase: DEFAULT_API_BASE,
  wsBase: DEFAULT_WS_BASE,
  userId: "jon",
  sessionId: "session-v8-001",
  prompt: presetMap[0].prompt,
  energy: [presetMap[0].energy],
  intent: presetMap[0].intent,
  dryRun: true,
  oscHost: "127.0.0.1",
  oscPort: "11000",
  selectedPreset: presetMap[0].id,
  autonomousDryRun: true,
  autonomousBaseSection: "v8_loop",
  loopIntervalSeconds: 8,
  loopMaxSteps: 12,
  liveMode: "stream",
  heartbeatIntervalMs: 15000,
  staleThresholdMs: 30000,
  spiralMaxSpirals: 4,
  spiralConfidenceTarget: 0.85,
  spiralNoveltyThreshold: 0.03,
  gate1Approved: false,
  gate1Reviewer: "alice",
  gate1Reason: "approved",
  gate2Approved: false,
  gate2Reviewer: "bob",
  gate2Reason: "approved",
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

function safeParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildInitialState(): AppState {
  const persisted = typeof window !== "undefined" ? safeParse(window.localStorage.getItem(STORAGE_KEY)) : null;
  return {
    settings: { ...defaultSettings, ...(persisted || {}) },
    sessionState: null,
    events: [],
    lastExecute: null,
    lastDecision: null,
    lastScore: null,
    lastOscPush: null,
    lastMidiExport: null,
    lastAutonomousMutation: null,
    spiralResult: null,
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
    log: ["V8 loop console ready.", "Backend autonomous loop control is wired in."],
    actionHistory: [],
    timelineSearch: "",
    eventFilter: "all",
    toasts: [],
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "patchSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "setField":
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };
    case "setSession":
      return { ...state, sessionState: action.session };
    case "setEvents":
      return { ...state, events: action.events };
    case "prependEvent":
      return { ...state, events: [action.event, ...state.events].slice(0, 300) };
    case "setLoopStatus":
      return { ...state, loopStatus: action.loop };
    case "setLastExecute":
      return { ...state, lastExecute: action.value };
    case "setLastDecision":
      return { ...state, lastDecision: action.value };
    case "setLastScore":
      return { ...state, lastScore: action.value };
    case "setLastOscPush":
      return { ...state, lastOscPush: action.value };
    case "setLastMidiExport":
      return { ...state, lastMidiExport: action.value };
    case "setLastAutonomousMutation":
      return { ...state, lastAutonomousMutation: action.value };
    case "setSpiralResult":
      return { ...state, spiralResult: action.value };
    case "setStatus":
      return { ...state, status: action.value };
    case "setError":
      return { ...state, error: action.value };
    case "setBusy":
      return { ...state, isBusy: action.value };
    case "setWsConnected":
      return { ...state, wsConnected: action.value };
    case "setReconnecting":
      return { ...state, isReconnecting: action.value };
    case "setReconnectAttempt":
      return {
        ...state,
        reconnectAttempt:
          typeof action.value === "function" ? action.value(state.reconnectAttempt) : action.value,
      };
    case "setHeartbeatAt":
      return { ...state, lastHeartbeatAt: action.value };
    case "setLastWsEventAt":
      return { ...state, lastWsEventAt: action.value };
    case "setWsStale":
      return { ...state, isWsStale: action.value };
    case "appendWsEvent":
      return { ...state, wsEvents: [action.value, ...state.wsEvents].slice(0, 160) };
    case "pushLog":
      return { ...state, log: [`${new Date().toLocaleTimeString()} - ${action.value}`, ...state.log].slice(0, 180) };
    case "clearLog":
      return { ...state, log: [] };
    case "pushAction":
      return {
        ...state,
        actionHistory: [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            action: action.action,
            status: action.status,
            detail: action.detail,
            at: new Date().toISOString(),
          },
          ...state.actionHistory,
        ].slice(0, 120),
      };
    case "setTimelineSearch":
      return { ...state, timelineSearch: action.value };
    case "setEventFilter":
      return { ...state, eventFilter: action.value };
    case "toast":
      return {
        ...state,
        toasts: [
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: action.title, tone: action.tone },
          ...state.toasts,
        ].slice(0, 4),
      };
    case "dismissToast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    default:
      return state;
  }
}

function makeApiClient(baseUrl: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
    if (!res.ok) {
      let message = `Request failed: ${res.status}`;
      try {
        const data = await res.json();
        message = data?.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : JSON.stringify(data);
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return res.json();
  }
  return {
    getSessionState: (sessionId: string) => request<{ status: string; session: SessionSnapshot }>(`/v8/session/${encodeURIComponent(sessionId)}/state`),
    getEvents: (sessionId: string) => request<{ status: string; events: EventEnvelope[] }>(`/v8/session/${encodeURIComponent(sessionId)}/events`),
    getLoopStatus: (sessionId: string, userId: string) => request<{ status: string; loop: LoopStatus }>(`/v8/session/${encodeURIComponent(sessionId)}/autonomous-loop/status?user_id=${encodeURIComponent(userId)}`),
    heartbeat: (sessionId: string, userId: string) => request<{ status: string }>(`/v8/session/${encodeURIComponent(sessionId)}/heartbeat?user_id=${encodeURIComponent(userId)}`, { method: "POST" }),
    createSession: (body: any) => request<{ status: string; session: SessionSnapshot }>("/v8/session/create", { method: "POST", body: JSON.stringify(body) }),
    transitionSession: (body: any) => request<{ status: string; session: SessionSnapshot }>("/v8/session/transition", { method: "POST", body: JSON.stringify(body) }),
    executeSession: (body: any) => request<ExecuteResponse>("/v8/session/execute", { method: "POST", body: JSON.stringify(body) }),
    autonomousStep: (body: any) => request<ExecuteResponse>("/v8/session/autonomous-step", { method: "POST", body: JSON.stringify(body) }),
    runSpiral: (body: any) => request<SpiralResponse>("/v8/session/spiral/run", { method: "POST", body: JSON.stringify(body) }),
    runSpiralWithHumanGate: (body: any) => request<SpiralResponse>("/v8/session/spiral/run-with-human-gate", { method: "POST", body: JSON.stringify(body) }),
    runSpiralWithTwoPersonGate: (body: any) => request<SpiralResponse>("/v8/session/spiral/run-with-two-person-gate", { method: "POST", body: JSON.stringify(body) }),
    startLoop: (body: any) => request<{ status: string; loop: LoopStatus }>("/v8/session/autonomous-loop/start", { method: "POST", body: JSON.stringify(body) }),
    stopLoop: (body: any) => request<{ status: string; loop: LoopStatus }>("/v8/session/autonomous-loop/stop", { method: "POST", body: JSON.stringify(body) }),
    rollback: (body: any) => request<{ status: string; session: SessionSnapshot }>("/v8/session/rollback", { method: "POST", body: JSON.stringify(body) }),
  };
}

function StatusRail(props: {
  userId: string;
  oscHost: string;
  oscPort: string;
  eventsCount: number;
  heartRate: number;
  intent: IntentMode;
  status: string;
  wsConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  isWsStale: boolean;
  loopStatus: LoopStatus | null;
  score: ScoreShape | null;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl"><Waves className="h-6 w-6" /> Spiral Performance Cockpit V8 Loop Console</CardTitle>
            <CardDescription>Realtime backend console with managed autonomous loop control.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">V8 Loop</Badge>
            <Badge variant="outline">Backend Truth</Badge>
            <Badge variant={props.wsConnected ? "secondary" : "outline"}>{props.wsConnected ? "WS Live" : "WS Offline"}</Badge>
            <Badge variant={props.isReconnecting ? "outline" : "secondary"}>{props.isReconnecting ? `Reconnecting ${props.reconnectAttempt}` : "Stable"}</Badge>
            <Badge variant={props.isWsStale ? "outline" : "secondary"}>{props.isWsStale ? "Stream Stale" : "Stream Fresh"}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-8">
        <StatCard icon={<Database className="h-4 w-4" />} label="User" value={props.userId} />
        <StatCard icon={<Cable className="h-4 w-4" />} label="OSC" value={`${props.oscHost}:${props.oscPort}`} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Events" value={String(props.eventsCount)} />
        <StatCard icon={<HeartPulse className="h-4 w-4" />} label="HR" value={String(props.heartRate)} />
        <StatCard icon={<Orbit className="h-4 w-4" />} label="Intent" value={props.intent} capitalize />
        <StatCard icon={<Wifi className="h-4 w-4" />} label="Status" value={props.status} />
        <StatCard icon={<Sparkles className="h-4 w-4" />} label="Loop" value={props.loopStatus?.is_running ? `step ${props.loopStatus.current_step}/${props.loopStatus.max_steps}` : "stopped"} />
        <StatCard icon={<Brain className="h-4 w-4" />} label="Reward" value={props.score ? `${Math.round(props.score.reward * 100)}%` : "n/a"} />
      </CardContent>
    </Card>
  );
}

function StatCard(props: { icon: React.ReactNode; label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">{props.icon} {props.label}</div>
      <div className={`mt-2 text-sm font-semibold ${props.capitalize ? "capitalize" : ""}`}>{props.value}</div>
    </div>
  );
}

function WarningStack(props: { degradedState: boolean; policyBlocked: boolean; error: string }) {
  return (
    <>
      {props.degradedState ? <Alert className="rounded-2xl"><AlertDescription>Backend session is in a degraded or rollback state. High-risk actions should be avoided until stability is restored.</AlertDescription></Alert> : null}
      {props.policyBlocked ? <Alert className="rounded-2xl"><AlertDescription>The last backend action was blocked by policy checks. Review violations before retrying.</AlertDescription></Alert> : null}
      {props.error ? <Alert className="rounded-2xl"><AlertDescription>{props.error}</AlertDescription></Alert> : null}
    </>
  );
}

function ToastStack(props: { toasts: ToastItem[]; dismiss: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-4 z-50 grid gap-2">
      {props.toasts.map((toast) => (
        <div key={toast.id} className="rounded-2xl border bg-background px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <Badge variant={toast.tone === "default" ? "secondary" : "outline"}>{toast.tone}</Badge>
            <div className="text-sm font-medium">{toast.title}</div>
            <Button variant="ghost" size="sm" onClick={() => props.dismiss(toast.id)}>x</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandDeck(props: {
  settings: Settings;
  setField: (key: keyof Settings, value: any) => void;
  applyPreset: (id: string) => void;
  createSession: () => void;
  refreshAll: () => void;
  exportDiagnosticSnapshot: () => void;
  transitionSession: (to: SessionState, reason: string) => void;
  rollbackSession: () => void;
  isBusy: boolean;
  conflictingActionLocked: boolean;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle className="text-lg">Command Deck</CardTitle><CardDescription>Realtime operator controls with loop lifecycle management.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2"><Label>Preset</Label><Select value={props.settings.selectedPreset} onValueChange={props.applyPreset}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{presetMap.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-2"><Label>Backend Base URL</Label><Input value={props.settings.apiBase} onChange={(e) => props.setField("apiBase", e.target.value)} /></div>
        <div className="grid gap-2"><Label>WebSocket Base URL</Label><Input value={props.settings.wsBase} onChange={(e) => props.setField("wsBase", e.target.value)} /></div>
        <div className="flex items-center justify-between rounded-2xl border p-3">
          <div><div className="text-sm font-medium">Live Mode</div><div className="text-xs text-muted-foreground">Stream updates or force refresh after actions.</div></div>
          <Select value={props.settings.liveMode} onValueChange={(v) => props.setField("liveMode", v as LiveMode)}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="stream">stream</SelectItem><SelectItem value="refresh">refresh</SelectItem></SelectContent></Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2"><Label>User ID</Label><Input value={props.settings.userId} onChange={(e) => props.setField("userId", e.target.value)} /></div>
          <div className="grid gap-2"><Label>Session ID</Label><Input value={props.settings.sessionId} onChange={(e) => props.setField("sessionId", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={props.createSession} disabled={props.isBusy}>Create</Button>
          <Button variant="outline" onClick={props.refreshAll} disabled={props.isBusy}><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
          <Button variant="outline" onClick={() => props.transitionSession("rehearsing", "operator rehearsal")} disabled={props.conflictingActionLocked}>Rehearse</Button>
          <Button variant="outline" onClick={() => props.transitionSession("performing", "operator performance")} disabled={props.conflictingActionLocked}>Perform</Button>
          <Button variant="outline" onClick={() => props.transitionSession("autonomous", "operator autonomous")} disabled={props.conflictingActionLocked}>Autonomous</Button>
          <Button variant="outline" onClick={props.rollbackSession} disabled={props.conflictingActionLocked}><RotateCcw className="mr-2 h-4 w-4" /> Rollback</Button>
        </div>
        <Button variant="outline" onClick={props.exportDiagnosticSnapshot} disabled={props.isBusy}><TimerReset className="mr-2 h-4 w-4" /> Export Debug</Button>
      </CardContent>
    </Card>
  );
}

function ControlPanels(props: {
  settings: Settings;
  setField: (key: keyof Settings, value: any) => void;
  executeSession: () => void;
  autonomousStep: () => void;
  startLoop: () => void;
  stopLoop: () => void;
  isBusy: boolean;
  conflictingActionLocked: boolean;
  loopStatus: LoopStatus | null;
  score: ScoreShape | null;
}) {
  const rewardPercent = ((props.score?.reward || 0) * 100).toFixed(0);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-4">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Biofeedback</CardTitle><CardDescription>Operator state to V8 backend.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2"><Label>Heart Rate</Label><Input type="number" value={props.settings.biofeedback.heart_rate} onChange={(e) => props.setField("biofeedback", { ...props.settings.biofeedback, heart_rate: Number(e.target.value || 0) })} /></div>
          <div className="grid gap-2"><Label>Breath Rate</Label><Input type="number" value={props.settings.biofeedback.breath_rate} onChange={(e) => props.setField("biofeedback", { ...props.settings.biofeedback, breath_rate: Number(e.target.value || 0) })} /></div>
          <div className="grid gap-2"><Label>Voice Intensity</Label><Slider value={[props.settings.biofeedback.voice_intensity]} onValueChange={(v) => props.setField("biofeedback", { ...props.settings.biofeedback, voice_intensity: Number(v[0].toFixed(2)) })} min={0} max={1} step={0.01} /></div>
          <div className="grid gap-2"><Label>Tone</Label><Select value={props.settings.biofeedback.emotional_tone} onValueChange={(v) => props.setField("biofeedback", { ...props.settings.biofeedback, emotional_tone: v as EmotionalTone })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="calm">calm</SelectItem><SelectItem value="focused">focused</SelectItem><SelectItem value="driven">driven</SelectItem><SelectItem value="agitated">agitated</SelectItem></SelectContent></Select></div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Intent + Prompt</CardTitle><CardDescription>High-level purpose layer.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2"><Label>Intent</Label><Select value={props.settings.intent} onValueChange={(v) => props.setField("intent", v as IntentMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ascend">ascend</SelectItem><SelectItem value="destroy">destroy</SelectItem><SelectItem value="expand">expand</SelectItem><SelectItem value="stabilize">stabilize</SelectItem><SelectItem value="transform">transform</SelectItem></SelectContent></Select></div>
          <div className="grid gap-2"><Label>Prompt</Label><Textarea value={props.settings.prompt} onChange={(e) => props.setField("prompt", e.target.value)} rows={5} /></div>
          <div className="grid gap-2"><Label>Energy</Label><Slider value={props.settings.energy} onValueChange={(v) => props.setField("energy", v)} min={0} max={1} step={0.01} /></div>
        <div className="flex items-center justify-between rounded-2xl border p-3"><span className="text-sm">Dry Run</span><Switch aria-label="Dry Run" checked={props.settings.dryRun} onCheckedChange={(v) => props.setField("dryRun", v)} /></div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Spiral Core</CardTitle><CardDescription>Backend source-of-truth spiral state.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2"><Label>Radius</Label><Slider value={[props.settings.spiralCore.radius]} onValueChange={(v) => props.setField("spiralCore", { ...props.settings.spiralCore, radius: Number(v[0].toFixed(2)) })} min={0} max={1} step={0.01} /></div>
          <div className="grid gap-2"><Label>Angle</Label><Slider value={[props.settings.spiralCore.angle]} onValueChange={(v) => props.setField("spiralCore", { ...props.settings.spiralCore, angle: Number(v[0].toFixed(0)) })} min={0} max={360} step={1} /></div>
          <div className="grid gap-2"><Label>Velocity</Label><Slider value={[props.settings.spiralCore.angular_velocity]} onValueChange={(v) => props.setField("spiralCore", { ...props.settings.spiralCore, angular_velocity: Number(v[0].toFixed(2)) })} min={0} max={1} step={0.01} /></div>
          <div className="grid gap-2"><Label>Expansion</Label><Slider value={[props.settings.spiralCore.expansion]} onValueChange={(v) => props.setField("spiralCore", { ...props.settings.spiralCore, expansion: Number(v[0].toFixed(2)) })} min={0} max={1} step={0.01} /></div>
          <div className="grid gap-2"><Label>Coherence</Label><Slider value={[props.settings.spiralCore.coherence]} onValueChange={(v) => props.setField("spiralCore", { ...props.settings.spiralCore, coherence: Number(v[0].toFixed(2)) })} min={0} max={1} step={0.01} /></div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Execute + Loop</CardTitle><CardDescription>Single-step execution and managed autonomous loop.</CardDescription></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label>OSC Host</Label><Input value={props.settings.oscHost} onChange={(e) => props.setField("oscHost", e.target.value)} /></div>
            <div className="grid gap-2"><Label>OSC Port</Label><Input value={props.settings.oscPort} onChange={(e) => props.setField("oscPort", e.target.value)} /></div>
          </div>
          <Button onClick={props.executeSession} disabled={props.isBusy || props.conflictingActionLocked}><Play className="mr-2 h-4 w-4" /> Execute Session</Button>
          <Button variant="outline" onClick={props.autonomousStep} disabled={props.isBusy || props.conflictingActionLocked}><Sparkles className="mr-2 h-4 w-4" /> Run Autonomous Step</Button>
          <div className="rounded-2xl border p-3 grid gap-3">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Autonomous Dry Run</span><Switch aria-label="Autonomous Dry Run" checked={props.settings.autonomousDryRun} onCheckedChange={(v) => props.setField("autonomousDryRun", v)} /></div>
            <div className="grid gap-2"><Label>Base Section</Label><Input value={props.settings.autonomousBaseSection} onChange={(e) => props.setField("autonomousBaseSection", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2"><Label>Loop Interval (sec)</Label><Input type="number" value={props.settings.loopIntervalSeconds} onChange={(e) => props.setField("loopIntervalSeconds", Number(e.target.value || 0))} /></div>
              <div className="grid gap-2"><Label>Max Steps</Label><Input type="number" value={props.settings.loopMaxSteps} onChange={(e) => props.setField("loopMaxSteps", Number(e.target.value || 1))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={props.startLoop} disabled={props.isBusy || !!props.loopStatus?.is_running}><Sparkles className="mr-2 h-4 w-4" /> Start Loop</Button>
              <Button variant="outline" onClick={props.stopLoop} disabled={props.isBusy || !props.loopStatus?.is_running}><Square className="mr-2 h-4 w-4" /> Stop Loop</Button>
            </div>
          </div>
          <div className="rounded-2xl border p-3"><div className="text-xs text-muted-foreground">Reward</div><div className="mt-1 text-2xl font-semibold">{rewardPercent}%</div><Progress className="mt-2" value={props.score?.reward ? props.score.reward * 100 : 0} /></div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function JsonCard(props: { title: string; description: string; value: any; minHeight?: string }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>{props.title}</CardTitle><CardDescription>{props.description}</CardDescription></CardHeader>
      <CardContent><pre className={`overflow-x-auto rounded-2xl border p-4 text-xs ${props.minHeight || "min-h-[320px]"}`}>{JSON.stringify(props.value ?? null, null, 2)}</pre></CardContent>
    </Card>
  );
}

function EventLogPanel(props: { events: EventEnvelope[]; search: string; setSearch: (v: string) => void; filter: string; setFilter: (v: string) => void; refresh: () => void }) {
  const filteredEvents = useMemo(() => {
    return props.events.filter((event) => {
      const typeOk = props.filter === "all" || event.event_type === props.filter;
      const q = props.search.trim().toLowerCase();
      const searchOk = !q || event.event_type.toLowerCase().includes(q) || JSON.stringify(event.payload).toLowerCase().includes(q);
      return typeOk && searchOk;
    });
  }, [props.events, props.filter, props.search]);

  const eventTypes = useMemo(() => ["all", ...Array.from(new Set(props.events.map((e) => e.event_type)))], [props.events]);

  const badgeVariant = (type: string) => {
    if (type.includes("error") || type.includes("blocked") || type.includes("degraded")) return "outline" as const;
    if (type.includes("started") || type.includes("completed") || type.includes("scored")) return "secondary" as const;
    return "outline" as const;
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div><CardTitle>Replayable Event Log</CardTitle><CardDescription>Live websocket events plus manual refresh.</CardDescription></div>
          <Button variant="outline" onClick={props.refresh}><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search events" value={props.search} onChange={(e) => props.setSearch(e.target.value)} /></div>
          <Select value={props.filter} onValueChange={props.setFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>
        </div>
        <ScrollArea className="h-[520px] rounded-2xl border p-4">
          <div className="grid gap-3">
            {filteredEvents.length === 0 ? <div className="text-sm text-muted-foreground">No events match current filters.</div> : filteredEvents.map((event) => (
              <div key={event.event_id} className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap"><Badge variant={badgeVariant(event.event_type)}>{event.event_type}</Badge><span className="font-medium">{event.session_id}</span></div>
                  <span className="text-xs text-muted-foreground">{event.created_at}</span>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl border p-3 text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function LoopPanel(props: { loopStatus: LoopStatus | null; lastAutonomousMutation: any; lastExecute: ExecuteResponse | null; lastHeartbeatAt: string | null }) {
  const loopProgress = props.loopStatus && props.loopStatus.max_steps > 0 ? (props.loopStatus.current_step / props.loopStatus.max_steps) * 100 : 0;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle>Autonomous Loop Status</CardTitle><CardDescription>Live backend loop lifecycle with heartbeat fallback.</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={props.loopStatus?.is_running ? "secondary" : "outline"}>{props.loopStatus?.is_running ? "Running" : "Stopped"}</Badge>
            <Badge variant="outline">step {props.loopStatus?.current_step ?? 0}/{props.loopStatus?.max_steps ?? 0}</Badge>
            <Badge variant="outline">{props.loopStatus?.interval_seconds ?? 0}s interval</Badge>
            <Badge variant="outline">heartbeat {props.lastHeartbeatAt ? "ok" : "pending"}</Badge>
          </div>
          <div className="rounded-2xl border p-3"><div className="text-xs text-muted-foreground">Loop Progress</div><Progress className="mt-2" value={loopProgress} /></div>
          <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[280px]">{JSON.stringify(props.loopStatus, null, 2)}</pre>
        </CardContent>
      </Card>
      <JsonCard title="Autonomous Mutation" description="Latest sovereign mutation payload." value={props.lastAutonomousMutation || props.lastExecute?.autonomous_mutation || null} minHeight="min-h-[360px]" />
    </div>
  );
}

function ActionHistoryPanel(props: { items: ActionRecord[] }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Action Queue / History</CardTitle><CardDescription>Tracked operator actions with status and details.</CardDescription></CardHeader>
      <CardContent>
        <ScrollArea className="h-[520px] rounded-2xl border p-4">
          <div className="grid gap-2">
            {props.items.length === 0 ? <div className="text-sm text-muted-foreground">No actions yet.</div> : props.items.map((item) => (
              <div key={item.id} className="rounded-xl border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2"><Badge variant={item.status === "success" ? "secondary" : "outline"}>{item.status}</Badge><span className="font-medium">{item.action}</span></div>
                  <span className="text-xs text-muted-foreground">{item.at}</span>
                </div>
                {item.detail ? <div className="mt-2 text-xs text-muted-foreground">{item.detail}</div> : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function SpiralPerformanceCockpitV8LoopConsole() {
  const [state, dispatch] = useReducer(reducer, undefined, buildInitialState);
  const api = useMemo(() => makeApiClient(state.settings.apiBase), [state.settings.apiBase]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    }
  }, [state.settings]);

  useEffect(() => {
    if (state.toasts.length === 0) return;
    const timers = state.toasts.map((toast) => setTimeout(() => dispatch({ type: "dismissToast", id: toast.id }), 3000));
    return () => timers.forEach(clearTimeout);
  }, [state.toasts]);

  const pushLog = (entry: string) => dispatch({ type: "pushLog", value: entry });
  const pushAction = (action: string, status: ActionStatus, detail?: string) => dispatch({ type: "pushAction", action, status, detail });
  const toast = (title: string, tone: "default" | "warning" | "error" = "default") => dispatch({ type: "toast", title, tone });
  const setField = (key: keyof Settings, value: any) => dispatch({ type: "setField", key, value });
  const confirmHighRisk = (message: string) => (typeof window === "undefined" ? true : window.confirm(message));

  const degradedState = state.sessionState?.state === "degraded" || state.sessionState?.state === "rollback";
  const policyBlocked = state.lastExecute?.status === "blocked";
  const conflictingActionLocked = Boolean(state.loopStatus?.is_running);

  const applyPreset = (id: string) => {
    const found = presetMap.find((p) => p.id === id);
    if (!found) return;
    dispatch({
      type: "patchSettings",
      patch: { selectedPreset: id, prompt: found.prompt, energy: [found.energy], intent: found.intent },
    });
    pushLog(`Applied preset '${found.name}'.`);
  };

  const exportDiagnosticSnapshot = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      sessionState: state.sessionState,
      loopStatus: state.loopStatus,
      lastScore: state.lastScore,
      lastDecision: state.lastDecision,
      lastAutonomousMutation: state.lastAutonomousMutation,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastWsEventAt: state.lastWsEventAt,
      isWsStale: state.isWsStale,
      recentEvents: state.events.slice(0, 50),
      actionHistory: state.actionHistory.slice(0, 50),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spiral-v8-diagnostic-${state.settings.sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    pushLog("Exported diagnostic snapshot.");
    pushAction("export diagnostic snapshot", "success");
    toast("Diagnostic snapshot exported", "default");
  };

  const {
    refreshAll,
    refreshEvents,
    sendHeartbeat,
    createSession,
    transitionSession,
    executeSession,
    autonomousStep,
    startLoop,
    stopLoop,
    rollbackSession,
    runSpiral,
    runSpiralWithHumanGate,
    runSpiralWithTwoPersonGate,
  } = useSpiralLoopConsoleActions({
    api,
    settings: state.settings,
    sessionState: state.sessionState,
    dispatch,
    setField,
    confirmHighRisk,
    pushAction,
    pushLog,
    toast,
  });

  useSpiralLoopConsoleRealtime({
    settings: state.settings,
    loopStatus: state.loopStatus,
    lastExecute: state.lastExecute,
    wsConnected: state.wsConnected,
    lastWsEventAt: state.lastWsEventAt,
    dispatch,
    refreshAll,
    sendHeartbeat,
    setField,
    toast,
    pushLog,
  });

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <ToastStack toasts={state.toasts} dismiss={(id) => dispatch({ type: "dismissToast", id })} />
      <div className="mx-auto grid max-w-7xl gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
          <StatusRail
            userId={state.settings.userId}
            oscHost={state.settings.oscHost}
            oscPort={state.settings.oscPort}
            eventsCount={state.events.length}
            heartRate={state.settings.biofeedback.heart_rate}
            intent={state.settings.intent}
            status={state.status}
            wsConnected={state.wsConnected}
            isReconnecting={state.isReconnecting}
            reconnectAttempt={state.reconnectAttempt}
            isWsStale={state.isWsStale}
            loopStatus={state.loopStatus}
            score={state.lastScore || state.lastExecute?.score || null}
          />
          <CommandDeck
            settings={state.settings}
            setField={setField}
            applyPreset={applyPreset}
            createSession={createSession}
            refreshAll={refreshAll}
            exportDiagnosticSnapshot={exportDiagnosticSnapshot}
            transitionSession={transitionSession}
            rollbackSession={rollbackSession}
            isBusy={state.isBusy}
            conflictingActionLocked={conflictingActionLocked}
          />
        </motion.div>

        <WarningStack degradedState={degradedState} policyBlocked={policyBlocked} error={state.error} />

        <ControlPanels
          settings={state.settings}
          setField={setField}
          executeSession={executeSession}
          autonomousStep={autonomousStep}
          startLoop={startLoop}
          stopLoop={stopLoop}
          isBusy={state.isBusy}
          conflictingActionLocked={conflictingActionLocked}
          loopStatus={state.loopStatus}
          score={state.lastScore || state.lastExecute?.score || null}
        />

        <Tabs defaultValue="loop" className="grid gap-6">
          <TabsList className="w-full justify-start flex-wrap rounded-2xl">
            <TabsTrigger value="loop">Loop Control</TabsTrigger>
            <TabsTrigger value="spiral">Spiral Logic</TabsTrigger>
            <TabsTrigger value="state">Session State</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="score">Scoring</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
            <TabsTrigger value="io">OSC / MIDI</TabsTrigger>
            <TabsTrigger value="ws">WebSocket</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="ops">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="loop"><LoopPanel loopStatus={state.loopStatus} lastAutonomousMutation={state.lastAutonomousMutation} lastExecute={state.lastExecute} lastHeartbeatAt={state.lastHeartbeatAt} /></TabsContent>
          <TabsContent value="spiral" className="grid gap-6 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Spiral Runner + Gates</CardTitle><CardDescription>Run spiral reasoner with optional single and two-person gate approval.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Max Spirals ({state.settings.spiralMaxSpirals})</Label>
                  <Slider value={[state.settings.spiralMaxSpirals]} onValueChange={(v) => setField("spiralMaxSpirals", Number(v[0].toFixed(0)))} min={1} max={12} step={1} />
                </div>
                <div className="grid gap-2">
                  <Label>Confidence Target ({state.settings.spiralConfidenceTarget.toFixed(2)})</Label>
                  <Slider value={[state.settings.spiralConfidenceTarget]} onValueChange={(v) => setField("spiralConfidenceTarget", Number(v[0].toFixed(2)))} min={0} max={1} step={0.01} />
                </div>
                <div className="grid gap-2">
                  <Label>Novelty Threshold ({state.settings.spiralNoveltyThreshold.toFixed(2)})</Label>
                  <Slider value={[state.settings.spiralNoveltyThreshold]} onValueChange={(v) => setField("spiralNoveltyThreshold", Number(v[0].toFixed(2)))} min={0} max={1} step={0.01} />
                </div>
                <div className="rounded-2xl border p-3 grid gap-2">
                  <Label>Gate #1</Label>
                  <div className="flex items-center justify-between rounded-xl border p-2"><span className="text-sm">Approved</span><Switch aria-label="Gate 1 Approved" checked={state.settings.gate1Approved} onCheckedChange={(v) => setField("gate1Approved", v)} /></div>
                  <Input value={state.settings.gate1Reviewer} onChange={(e) => setField("gate1Reviewer", e.target.value)} placeholder="Reviewer" />
                  <Input value={state.settings.gate1Reason} onChange={(e) => setField("gate1Reason", e.target.value)} placeholder="Reason" />
                </div>
                <div className="rounded-2xl border p-3 grid gap-2">
                  <Label>Gate #2</Label>
                  <div className="flex items-center justify-between rounded-xl border p-2"><span className="text-sm">Approved</span><Switch aria-label="Gate 2 Approved" checked={state.settings.gate2Approved} onCheckedChange={(v) => setField("gate2Approved", v)} /></div>
                  <Input value={state.settings.gate2Reviewer} onChange={(e) => setField("gate2Reviewer", e.target.value)} placeholder="Reviewer" />
                  <Input value={state.settings.gate2Reason} onChange={(e) => setField("gate2Reason", e.target.value)} placeholder="Reason" />
                </div>
                <div className="grid gap-2">
                  <Button onClick={runSpiral} disabled={state.isBusy || conflictingActionLocked}><Sparkles className="mr-2 h-4 w-4" /> Run Spiral</Button>
                  <Button variant="outline" onClick={runSpiralWithHumanGate} disabled={state.isBusy || conflictingActionLocked}>Run + Human Gate</Button>
                  <Button variant="outline" onClick={runSpiralWithTwoPersonGate} disabled={state.isBusy || conflictingActionLocked}>Run + Two-Person Gate</Button>
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Spiral Result</CardTitle><CardDescription>Summary, emotion/compassion signals, gate decision, rollback payload, and phase trace.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-muted-foreground">Emotion</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">{String(state.spiralResult?.emotion?.inferred_emotion || "n/a")}</Badge>
                      <Badge variant="outline">mode:{String(state.spiralResult?.emotion?.empathy_mode || "n/a")}</Badge>
                      <Badge variant="outline">stress:{String(state.spiralResult?.emotion?.stress ?? "n/a")}</Badge>
                      <Badge variant="outline">urgency:{String(state.spiralResult?.emotion?.urgency ?? "n/a")}</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-muted-foreground">Compassion Policy</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={state.spiralResult?.compassion_policy?.allowed ? "secondary" : "outline"}>
                        {String(state.spiralResult?.compassion_policy?.status || "n/a")}
                      </Badge>
                      <Badge variant="outline">care:{String(state.spiralResult?.compassion_policy?.care_score ?? "n/a")}</Badge>
                      <Badge variant="outline">gate:{String(state.spiralResult?.human_gate?.status || "n/a")}</Badge>
                    </div>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[140px]">{JSON.stringify(state.spiralResult?.spiral || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[140px]">{JSON.stringify(state.spiralResult?.emotion || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[140px]">{JSON.stringify(state.spiralResult?.compassion_policy || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[140px]">{JSON.stringify(state.spiralResult?.human_gate || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[140px]">{JSON.stringify(state.spiralResult?.rollback || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[220px]">{JSON.stringify(state.spiralResult?.phase_results || null, null, 2)}</pre>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="state" className="grid gap-6 md:grid-cols-2">
            <JsonCard title="Current Session Snapshot" description="Auto-updated from session.state.updated." value={state.sessionState} minHeight="min-h-[360px]" />
            <JsonCard title="Latest Section Snapshot" description="Auto-updated from session.executed." value={state.lastExecute?.section || null} minHeight="min-h-[360px]" />
          </TabsContent>
          <TabsContent value="events"><EventLogPanel events={state.events} search={state.timelineSearch} setSearch={(v) => dispatch({ type: "setTimelineSearch", value: v })} filter={state.eventFilter} setFilter={(v) => dispatch({ type: "setEventFilter", value: v })} refresh={refreshEvents} /></TabsContent>
          <TabsContent value="score" className="grid gap-6 md:grid-cols-2">
            <JsonCard title="Reward Breakdown" description="Auto-updated from session.scored." value={state.lastScore || state.lastExecute?.score || null} />
            <JsonCard title="Memory Write" description="Captured from latest execution event." value={state.lastExecute?.memory_written || null} />
          </TabsContent>
          <TabsContent value="decision"><JsonCard title="Agent Decision" description="Auto-updated from agent.decision.made." value={state.lastDecision || state.lastExecute?.decision || null} minHeight="min-h-[360px]" /></TabsContent>
          <TabsContent value="io" className="grid gap-6 md:grid-cols-2">
            <JsonCard title="Latest OSC Push" description="Auto-updated from osc.push.completed." value={state.lastOscPush || state.lastExecute?.osc_push || null} />
            <JsonCard title="Latest MIDI Export" description="Auto-updated from midi.export.completed." value={state.lastMidiExport || state.lastExecute?.midi_export || null} />
          </TabsContent>
          <TabsContent value="ws"><JsonCard title="WebSocket Stream" description="Raw live stream feeding the console." value={state.wsEvents} minHeight="min-h-[520px]" /></TabsContent>
          <TabsContent value="logs">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>Operator Log</CardTitle><CardDescription>Local console actions and realtime backend interactions.</CardDescription></div><Button variant="outline" onClick={() => dispatch({ type: "clearLog" })}><TimerReset className="mr-2 h-4 w-4" /> Clear</Button></div></CardHeader>
              <CardContent><ScrollArea className="h-[520px] rounded-2xl border p-4"><div className="grid gap-2">{state.log.map((entry, idx) => <div key={`${entry}-${idx}`} className="rounded-xl border p-3 text-sm">{entry}</div>)}</div></ScrollArea></CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="ops"><ActionHistoryPanel items={state.actionHistory} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
