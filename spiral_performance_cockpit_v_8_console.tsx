import React, { useEffect, useMemo, useState } from "react";
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
  Bot,
  Brain,
  Cable,
  Database,
  HeartPulse,
  Orbit,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  TimerReset,
  Waves,
} from "lucide-react";

type IntentMode = "ascend" | "destroy" | "expand" | "stabilize" | "transform";
type SessionState = "idle" | "primed" | "rehearsing" | "performing" | "autonomous" | "degraded" | "rollback" | "complete";
type EmotionalTone = "calm" | "focused" | "driven" | "agitated";

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
  violations?: Array<string | Record<string, any>>;
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

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE = "ws://127.0.0.1:8000";
const STORAGE_KEY = "spiral-v8-console";

const presetMap = [
  {
    id: "gold",
    name: "Gold Launch",
    prompt: "aggressive spiral live gold section for full launch",
    energy: 0.86,
    intent: "transform" as IntentMode,
  },
  {
    id: "safe",
    name: "Safe Rehearsal",
    prompt: "controlled rehearsal state with safe automation",
    energy: 0.48,
    intent: "stabilize" as IntentMode,
  },
  {
    id: "destroy",
    name: "Destructive Push",
    prompt: "violent peak-state push with controlled force",
    energy: 0.91,
    intent: "destroy" as IntentMode,
  },
];

async function api<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
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

function safeParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default function SpiralPerformanceCockpitV8Console() {
  const persisted = typeof window !== "undefined" ? safeParse(window.localStorage.getItem(STORAGE_KEY)) : null;

  const [apiBase, setApiBase] = useState(persisted?.apiBase || DEFAULT_API_BASE);
  const [wsBase, setWsBase] = useState(persisted?.wsBase || DEFAULT_WS_BASE);
  const [userId, setUserId] = useState(persisted?.userId || "jon");
  const [sessionId, setSessionId] = useState(persisted?.sessionId || "session-v8-001");
  const [prompt, setPrompt] = useState(persisted?.prompt || presetMap[0].prompt);
  const [energy, setEnergy] = useState<number[]>(persisted?.energy || [presetMap[0].energy]);
  const [intent, setIntent] = useState<IntentMode>(persisted?.intent || presetMap[0].intent);
  const [dryRun, setDryRun] = useState<boolean>(persisted?.dryRun ?? true);
  const [oscHost, setOscHost] = useState(persisted?.oscHost || "127.0.0.1");
  const [oscPort, setOscPort] = useState(persisted?.oscPort || "11000");
  const [selectedPreset, setSelectedPreset] = useState<string>(persisted?.selectedPreset || presetMap[0].id);

  const [biofeedback, setBiofeedback] = useState<BiofeedbackState>(persisted?.biofeedback || {
    heart_rate: 88,
    breath_rate: 15,
    voice_intensity: 0.62,
    emotional_tone: "focused",
    source: "manual",
  });
  const [spiralCore, setSpiralCore] = useState<SpiralCoreState>(persisted?.spiralCore || {
    radius: 0.58,
    angle: 180,
    angular_velocity: 0.62,
    expansion: 0.55,
    coherence: 0.7,
  });

  const [sessionState, setSessionState] = useState<SessionSnapshot | null>(null);
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [lastExecute, setLastExecute] = useState<ExecuteResponse | null>(null);
  const [wsEvents, setWsEvents] = useState<any[]>([]);
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [log, setLog] = useState<string[]>(["V8 console ready.", "Backend is now the source of truth."]);
  const [timelineSearch, setTimelineSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [spiralResult, setSpiralResult] = useState<SpiralResponse | null>(null);
  const [maxSpirals, setMaxSpirals] = useState<number[]>([4]);
  const [confidenceTarget, setConfidenceTarget] = useState<number[]>([0.85]);
  const [noveltyThreshold, setNoveltyThreshold] = useState<number[]>([0.03]);
  const [firstGateApproved, setFirstGateApproved] = useState(false);
  const [firstGateReviewer, setFirstGateReviewer] = useState("alice");
  const [firstGateReason, setFirstGateReason] = useState("approved");
  const [secondGateApproved, setSecondGateApproved] = useState(false);
  const [secondGateReviewer, setSecondGateReviewer] = useState("bob");
  const [secondGateReason, setSecondGateReason] = useState("approved");

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        apiBase,
        wsBase,
        userId,
        sessionId,
        prompt,
        energy,
        intent,
        dryRun,
        oscHost,
        oscPort,
        selectedPreset,
        biofeedback,
        spiralCore,
      }),
    );
  }, [apiBase, wsBase, userId, sessionId, prompt, energy, intent, dryRun, oscHost, oscPort, selectedPreset, biofeedback, spiralCore]);

  const pushLog = (entry: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} - ${entry}`, ...prev].slice(0, 120));
  };

  const clearError = () => setError("");

  const applyPreset = (id: string) => {
    setSelectedPreset(id);
    const found = presetMap.find((p) => p.id === id);
    if (!found) return;
    setPrompt(found.prompt);
    setEnergy([found.energy]);
    setIntent(found.intent);
    pushLog(`Applied preset '${found.name}'.`);
  };

  const createSession = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ status: string; session: SessionSnapshot }>(apiBase, "/v8/session/create", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt,
          energy: Number(energy[0].toFixed(2)),
          intent,
          biofeedback,
          spiral_core: spiralCore,
        }),
      });
      setSessionState(data.session);
      setStatus(`Session created: ${data.session.state}`);
      pushLog(`Created session ${sessionId}.`);
      await refreshState();
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create session.";
      setError(msg);
      setStatus("Create failed");
      pushLog(`Create failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const transitionSession = async (toState: SessionState, reason: string) => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ status: string; session: SessionSnapshot }>(apiBase, "/v8/session/transition", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          to_state: toState,
          reason,
        }),
      });
      setSessionState(data.session);
      setStatus(`Transitioned to ${data.session.state}`);
      pushLog(`Transitioned session to ${toState}.`);
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transition failed.";
      setError(msg);
      setStatus("Transition failed");
      pushLog(`Transition failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const executeSession = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<ExecuteResponse>(apiBase, "/v8/session/execute", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt,
          energy: Number(energy[0].toFixed(2)),
          intent,
          biofeedback,
          spiral_core: spiralCore,
          dry_run: dryRun,
          section_name: dryRun ? "v8_rehearsal" : "v8_live",
          osc_host: oscHost,
          osc_port: Number(oscPort),
          output_dir: "exports",
        }),
      });
      setLastExecute(data);
      if (data.session) setSessionState(data.session);
      setStatus(data.status === "blocked" ? "Policy blocked" : dryRun ? "Rehearsal executed" : "Performance executed");
      pushLog(data.status === "blocked" ? "Execution blocked by policy engine." : "Executed authoritative V8 session route.");
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed.";
      setError(msg);
      setStatus("Execute failed");
      pushLog(`Execute failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const rollbackSession = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ status: string; session: SessionSnapshot; restored_snapshot: SessionSnapshot }>(apiBase, "/v8/session/rollback", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          reason: "operator rollback from cockpit",
        }),
      });
      setSessionState(data.session);
      setStatus("Rollback complete");
      pushLog("Rolled back to latest safe snapshot.");
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rollback failed.";
      setError(msg);
      setStatus("Rollback failed");
      pushLog(`Rollback failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const spiralPayload = () => ({
    user_id: userId,
    session_id: sessionId,
    prompt,
    energy: Number(energy[0].toFixed(2)),
    intent,
    biofeedback,
    spiral_core: spiralCore,
    dry_run: dryRun,
    max_spirals: Math.max(1, Math.round(maxSpirals[0])),
    confidence_target: Number(confidenceTarget[0].toFixed(2)),
    novelty_threshold: Number(noveltyThreshold[0].toFixed(2)),
    section_prefix: dryRun ? "spiral_rehearsal" : "spiral_live",
  });

  const runSpiral = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<SpiralResponse>(apiBase, "/v8/session/spiral/run", {
        method: "POST",
        body: JSON.stringify(spiralPayload()),
      });
      setSpiralResult(data);
      setStatus(`Spiral: ${data?.spiral?.stop_reason || "complete"}`);
      pushLog("Spiral run completed.");
      if (data.final_execution) setLastExecute(data.final_execution);
      await refreshState();
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Spiral run failed.";
      setError(msg);
      setStatus("Spiral failed");
      pushLog(`Spiral failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const runSpiralWithSingleGate = async () => {
    setIsBusy(true);
    clearError();
    try {
      const decision: HumanGateDecision = {
        approved: firstGateApproved,
        reviewer: firstGateReviewer,
        reason: firstGateReason,
      };
      const data = await api<SpiralResponse>(apiBase, "/v8/session/spiral/run-with-human-gate", {
        method: "POST",
        body: JSON.stringify({
          request: spiralPayload(),
          decision,
        }),
      });
      setSpiralResult(data);
      setStatus(`Spiral+Gate: ${data?.human_gate?.status || "complete"}`);
      pushLog("Spiral run with single human gate completed.");
      if (data.final_execution) setLastExecute(data.final_execution);
      await refreshState();
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Spiral + gate failed.";
      setError(msg);
      setStatus("Spiral + gate failed");
      pushLog(`Spiral + gate failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const runSpiralWithTwoPersonGate = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<SpiralResponse>(apiBase, "/v8/session/spiral/run-with-two-person-gate", {
        method: "POST",
        body: JSON.stringify({
          request: spiralPayload(),
          decisions: {
            first: {
              approved: firstGateApproved,
              reviewer: firstGateReviewer,
              reason: firstGateReason,
            },
            second: {
              approved: secondGateApproved,
              reviewer: secondGateReviewer,
              reason: secondGateReason,
            },
          },
        }),
      });
      setSpiralResult(data);
      setStatus(`Spiral+2P Gate: ${data?.human_gate?.status || "complete"}`);
      pushLog("Spiral run with two-person gate completed.");
      if (data.final_execution) setLastExecute(data.final_execution);
      await refreshState();
      await refreshEvents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Spiral + two-person gate failed.";
      setError(msg);
      setStatus("Spiral + 2P gate failed");
      pushLog(`Spiral + 2P gate failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const refreshState = async () => {
    try {
      const data = await api<{ status: string; session: SessionSnapshot }>(apiBase, `/v8/session/${encodeURIComponent(sessionId)}/state`);
      setSessionState(data.session);
    } catch {
      // ignore refresh noise
    }
  };

  const refreshEvents = async () => {
    try {
      const data = await api<{ status: string; events: EventEnvelope[] }>(apiBase, `/v8/session/${encodeURIComponent(sessionId)}/events`);
      setEvents(data.events || []);
    } catch {
      // ignore refresh noise
    }
  };

  useEffect(() => {
    refreshState();
    refreshEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const session = sessionId.trim();
    if (!session) return;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(`${wsBase}/ws/${encodeURIComponent(session)}`);
      socket.onopen = () => {
        setWsConnected(true);
        pushLog(`WebSocket connected for ${session}.`);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setWsEvents((prev) => [data, ...prev].slice(0, 80));
        } catch {
          setWsEvents((prev) => [{ type: "raw", payload: event.data }, ...prev].slice(0, 80));
        }
      };
      socket.onclose = () => setWsConnected(false);
      socket.onerror = () => setWsConnected(false);
    } catch {
      setWsConnected(false);
    }
    return () => {
      if (socket) socket.close();
    };
  }, [wsBase, sessionId]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const typeOk = eventFilter === "all" || event.event_type === eventFilter;
      const q = timelineSearch.trim().toLowerCase();
      const searchOk = !q || event.event_type.toLowerCase().includes(q) || JSON.stringify(event.payload).toLowerCase().includes(q);
      return typeOk && searchOk;
    });
  }, [events, eventFilter, timelineSearch]);

  const eventTypes = useMemo(() => {
    const set = new Set<string>(events.map((e) => e.event_type));
    return ["all", ...Array.from(set)];
  }, [events]);

  const score = lastExecute?.score;
  const rewardPercent = ((score?.reward || 0) * 100).toFixed(0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto grid max-w-7xl gap-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-2xl"><Waves className="h-6 w-6" /> Spiral Performance Cockpit V8 Console</CardTitle>
                  <CardDescription>Server-authoritative console for the sovereign V8 backend brain.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">V8 Live</Badge>
                  <Badge variant="outline">Backend Truth</Badge>
                  <Badge variant={wsConnected ? "secondary" : "outline"}>{wsConnected ? "WS Live" : "WS Offline"}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-6">
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4" /> User</div><div className="mt-2 text-xl font-semibold">{userId}</div></div>
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><Cable className="h-4 w-4" /> OSC</div><div className="mt-2 text-xl font-semibold">{oscHost}:{oscPort}</div></div>
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" /> Events</div><div className="mt-2 text-xl font-semibold">{events.length}</div></div>
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><HeartPulse className="h-4 w-4" /> HR</div><div className="mt-2 text-xl font-semibold">{biofeedback.heart_rate}</div></div>
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><Orbit className="h-4 w-4" /> Intent</div><div className="mt-2 text-xl font-semibold capitalize">{intent}</div></div>
              <div className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-sm font-medium"><Radio className="h-4 w-4" /> Status</div><div className="mt-2 text-sm font-semibold">{status}</div></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Command Deck</CardTitle>
              <CardDescription>Create, transition, execute, and rollback sessions.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label>Preset</Label>
                <Select value={selectedPreset} onValueChange={applyPreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {presetMap.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Backend Base URL</Label><Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} /></div>
              <div className="grid gap-2"><Label>WebSocket Base URL</Label><Input value={wsBase} onChange={(e) => setWsBase(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>User ID</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} /></div>
                <div className="grid gap-2"><Label>Session ID</Label><Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={createSession} disabled={isBusy}>Create</Button>
                <Button variant="outline" onClick={() => refreshState()} disabled={isBusy}><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
                <Button variant="outline" onClick={() => transitionSession("rehearsing", "operator rehearsal")}>Rehearse</Button>
                <Button variant="outline" onClick={() => transitionSession("performing", "operator performance")}>Perform</Button>
                <Button variant="outline" onClick={() => transitionSession("autonomous", "operator autonomous")}>Autonomous</Button>
                <Button variant="outline" onClick={rollbackSession}><RotateCcw className="mr-2 h-4 w-4" /> Rollback</Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {error ? <Alert className="rounded-2xl"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Biofeedback</CardTitle><CardDescription>Operator state to V8 backend.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2"><Label>Heart Rate</Label><Input type="number" value={biofeedback.heart_rate} onChange={(e) => setBiofeedback((p) => ({ ...p, heart_rate: Number(e.target.value || 0) }))} /></div>
              <div className="grid gap-2"><Label>Breath Rate</Label><Input type="number" value={biofeedback.breath_rate} onChange={(e) => setBiofeedback((p) => ({ ...p, breath_rate: Number(e.target.value || 0) }))} /></div>
              <div className="grid gap-2"><Label>Voice Intensity</Label><Slider value={[biofeedback.voice_intensity]} onValueChange={(v) => setBiofeedback((p) => ({ ...p, voice_intensity: Number(v[0].toFixed(2)) }))} min={0} max={1} step={0.01} /></div>
              <div className="grid gap-2"><Label>Tone</Label><Select value={biofeedback.emotional_tone} onValueChange={(v) => setBiofeedback((p) => ({ ...p, emotional_tone: v as EmotionalTone }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="calm">calm</SelectItem><SelectItem value="focused">focused</SelectItem><SelectItem value="driven">driven</SelectItem><SelectItem value="agitated">agitated</SelectItem></SelectContent></Select></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Intent + Prompt</CardTitle><CardDescription>High-level purpose layer.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2"><Label>Intent</Label><Select value={intent} onValueChange={(v) => setIntent(v as IntentMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ascend">ascend</SelectItem><SelectItem value="destroy">destroy</SelectItem><SelectItem value="expand">expand</SelectItem><SelectItem value="stabilize">stabilize</SelectItem><SelectItem value="transform">transform</SelectItem></SelectContent></Select></div>
              <div className="grid gap-2"><Label>Prompt</Label><Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} /></div>
              <div className="grid gap-2"><Label>Energy</Label><Slider value={energy} onValueChange={setEnergy} min={0} max={1} step={0.01} /></div>
              <div className="flex items-center justify-between rounded-2xl border p-3"><span className="text-sm">Dry Run</span><Switch checked={dryRun} onCheckedChange={setDryRun} /></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Spiral Core</CardTitle><CardDescription>Backend source-of-truth spiral state.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2"><Label>Radius</Label><Slider value={[spiralCore.radius]} onValueChange={(v) => setSpiralCore((p) => ({ ...p, radius: Number(v[0].toFixed(2)) }))} min={0} max={1} step={0.01} /></div>
              <div className="grid gap-2"><Label>Angle</Label><Slider value={[spiralCore.angle]} onValueChange={(v) => setSpiralCore((p) => ({ ...p, angle: Number(v[0].toFixed(0)) }))} min={0} max={360} step={1} /></div>
              <div className="grid gap-2"><Label>Velocity</Label><Slider value={[spiralCore.angular_velocity]} onValueChange={(v) => setSpiralCore((p) => ({ ...p, angular_velocity: Number(v[0].toFixed(2)) }))} min={0} max={1} step={0.01} /></div>
              <div className="grid gap-2"><Label>Expansion</Label><Slider value={[spiralCore.expansion]} onValueChange={(v) => setSpiralCore((p) => ({ ...p, expansion: Number(v[0].toFixed(2)) }))} min={0} max={1} step={0.01} /></div>
              <div className="grid gap-2"><Label>Coherence</Label><Slider value={[spiralCore.coherence]} onValueChange={(v) => setSpiralCore((p) => ({ ...p, coherence: Number(v[0].toFixed(2)) }))} min={0} max={1} step={0.01} /></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Execute</CardTitle><CardDescription>Authoritative V8 path.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2"><Label>OSC Host</Label><Input value={oscHost} onChange={(e) => setOscHost(e.target.value)} /></div>
                <div className="grid gap-2"><Label>OSC Port</Label><Input value={oscPort} onChange={(e) => setOscPort(e.target.value)} /></div>
              </div>
              <Button onClick={executeSession} disabled={isBusy}><Play className="mr-2 h-4 w-4" /> Execute Session</Button>
              <Button variant="outline" onClick={refreshEvents}><RefreshCcw className="mr-2 h-4 w-4" /> Refresh Events</Button>
              <div className="rounded-2xl border p-3">
                <div className="text-xs text-muted-foreground">Reward</div>
                <div className="mt-1 text-2xl font-semibold">{rewardPercent}%</div>
                <Progress className="mt-2" value={score?.reward ? score.reward * 100 : 0} />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <Tabs defaultValue="state" className="grid gap-6">
          <TabsList className="w-full justify-start flex-wrap rounded-2xl">
            <TabsTrigger value="state">Session State</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="spiral">Spiral Logic</TabsTrigger>
            <TabsTrigger value="score">Scoring</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
            <TabsTrigger value="response">Execution</TabsTrigger>
            <TabsTrigger value="ws">WebSocket</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="state" className="grid gap-6 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Current Session Snapshot</CardTitle><CardDescription>Source-of-truth state from `/v8/session/:id/state`.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[360px]">{JSON.stringify(sessionState, null, 2)}</pre></CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Latest Section Snapshot</CardTitle><CardDescription>Most recent execution section payload.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[360px]">{JSON.stringify(lastExecute?.section || null, null, 2)}</pre></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>Replayable Event Log</CardTitle>
                    <CardDescription>Authoritative event history from V8 event store.</CardDescription>
                  </div>
                  <Button variant="outline" onClick={refreshEvents}><RefreshCcw className="mr-2 h-4 w-4" /> Refresh</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search events" value={timelineSearch} onChange={(e) => setTimelineSearch(e.target.value)} /></div>
                  <Select value={eventFilter} onValueChange={setEventFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>
                </div>
                <ScrollArea className="h-[520px] rounded-2xl border p-4">
                  <div className="grid gap-3">
                    {filteredEvents.length === 0 ? <div className="text-sm text-muted-foreground">No events match current filters.</div> : filteredEvents.map((event) => (
                      <div key={event.event_id} className="rounded-2xl border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap"><Badge>{event.event_type}</Badge><span className="font-medium">{event.session_id}</span></div>
                          <span className="text-xs text-muted-foreground">{event.created_at}</span>
                        </div>
                        <pre className="mt-3 overflow-x-auto rounded-xl border p-3 text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spiral" className="grid gap-6 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Spiral Runner + Gates</CardTitle>
                <CardDescription>Run core spiral logic and optional human approval gates.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Max Spirals ({Math.round(maxSpirals[0])})</Label>
                  <Slider value={maxSpirals} onValueChange={setMaxSpirals} min={1} max={12} step={1} />
                </div>
                <div className="grid gap-2">
                  <Label>Confidence Target ({confidenceTarget[0].toFixed(2)})</Label>
                  <Slider value={confidenceTarget} onValueChange={setConfidenceTarget} min={0} max={1} step={0.01} />
                </div>
                <div className="grid gap-2">
                  <Label>Novelty Threshold ({noveltyThreshold[0].toFixed(2)})</Label>
                  <Slider value={noveltyThreshold} onValueChange={setNoveltyThreshold} min={0} max={1} step={0.01} />
                </div>

                <div className="rounded-2xl border p-3 grid gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium"><Shield className="h-4 w-4" /> Gate #1 (single gate + two-person first)</div>
                  <div className="flex items-center justify-between rounded-xl border p-2">
                    <span className="text-sm">Approved</span>
                    <Switch checked={firstGateApproved} onCheckedChange={setFirstGateApproved} />
                  </div>
                  <div className="grid gap-2"><Label>Reviewer</Label><Input value={firstGateReviewer} onChange={(e) => setFirstGateReviewer(e.target.value)} /></div>
                  <div className="grid gap-2"><Label>Reason</Label><Input value={firstGateReason} onChange={(e) => setFirstGateReason(e.target.value)} /></div>
                </div>

                <div className="rounded-2xl border p-3 grid gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium"><Shield className="h-4 w-4" /> Gate #2 (two-person only)</div>
                  <div className="flex items-center justify-between rounded-xl border p-2">
                    <span className="text-sm">Approved</span>
                    <Switch checked={secondGateApproved} onCheckedChange={setSecondGateApproved} />
                  </div>
                  <div className="grid gap-2"><Label>Reviewer</Label><Input value={secondGateReviewer} onChange={(e) => setSecondGateReviewer(e.target.value)} /></div>
                  <div className="grid gap-2"><Label>Reason</Label><Input value={secondGateReason} onChange={(e) => setSecondGateReason(e.target.value)} /></div>
                </div>

                <div className="grid gap-2">
                  <Button onClick={runSpiral} disabled={isBusy}><Bot className="mr-2 h-4 w-4" /> Run Spiral</Button>
                  <Button variant="outline" onClick={runSpiralWithSingleGate} disabled={isBusy}><Shield className="mr-2 h-4 w-4" /> Run + Human Gate</Button>
                  <Button variant="outline" onClick={runSpiralWithTwoPersonGate} disabled={isBusy}><Shield className="mr-2 h-4 w-4" /> Run + Two-Person Gate</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Spiral Result</CardTitle>
                <CardDescription>Stop conditions, emotion/compassion signals, gate status, and phase trace.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-muted-foreground">Emotion</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">{String(spiralResult?.emotion?.inferred_emotion || "n/a")}</Badge>
                      <Badge variant="outline">mode:{String(spiralResult?.emotion?.empathy_mode || "n/a")}</Badge>
                      <Badge variant="outline">stress:{String(spiralResult?.emotion?.stress ?? "n/a")}</Badge>
                      <Badge variant="outline">urgency:{String(spiralResult?.emotion?.urgency ?? "n/a")}</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs text-muted-foreground">Compassion Policy</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={spiralResult?.compassion_policy?.allowed ? "secondary" : "outline"}>
                        {String(spiralResult?.compassion_policy?.status || "n/a")}
                      </Badge>
                      <Badge variant="outline">care:{String(spiralResult?.compassion_policy?.care_score ?? "n/a")}</Badge>
                      <Badge variant="outline">gate:{String(spiralResult?.human_gate?.status || "n/a")}</Badge>
                    </div>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[180px]">{JSON.stringify(spiralResult?.spiral || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[180px]">{JSON.stringify(spiralResult?.emotion || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[180px]">{JSON.stringify(spiralResult?.compassion_policy || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[180px]">{JSON.stringify(spiralResult?.human_gate || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[180px]">{JSON.stringify(spiralResult?.rollback || null, null, 2)}</pre>
                <pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[220px]">{JSON.stringify(spiralResult?.phase_results || null, null, 2)}</pre>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="score" className="grid gap-6 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Reward Breakdown</CardTitle><CardDescription>Server-authoritative V8 score components.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[320px]">{JSON.stringify(score || null, null, 2)}</pre></CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Memory Write</CardTitle><CardDescription>What the backend stored after execution.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[320px]">{JSON.stringify(lastExecute?.memory_written || null, null, 2)}</pre></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="decision">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> Agent Decision</CardTitle><CardDescription>Decision object returned by the backend brain.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[360px]">{JSON.stringify(lastExecute?.decision || null, null, 2)}</pre></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="response" className="grid gap-6 md:grid-cols-2">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Execution Response</CardTitle><CardDescription>Raw response from `/v8/session/execute`.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[360px]">{JSON.stringify(lastExecute || null, null, 2)}</pre></CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Policy Block / Violations</CardTitle><CardDescription>Any server-side policy rejections.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-xs min-h-[360px]">{JSON.stringify(lastExecute?.violations || null, null, 2)}</pre></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ws">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>WebSocket Stream</CardTitle><CardDescription>Realtime session channel messages.</CardDescription></CardHeader>
              <CardContent>
                <ScrollArea className="h-[520px] rounded-2xl border p-4">
                  <div className="grid gap-3">
                    {wsEvents.length === 0 ? <div className="text-sm text-muted-foreground">No websocket events yet.</div> : wsEvents.map((event, idx) => (
                      <div key={idx} className="rounded-2xl border p-4">
                        <pre className="overflow-x-auto text-xs">{JSON.stringify(event, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>Operator Log</CardTitle>
                    <CardDescription>Local console actions and backend interactions.</CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setLog([])}><TimerReset className="mr-2 h-4 w-4" /> Clear</Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[520px] rounded-2xl border p-4">
                  <div className="grid gap-2">
                    {log.map((entry, idx) => <div key={`${entry}-${idx}`} className="rounded-xl border p-3 text-sm">{entry}</div>)}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
