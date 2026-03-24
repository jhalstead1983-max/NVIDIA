import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Activity,
  Bot,
  Cable,
  Database,
  Disc3,
  Gauge,
  Orbit,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Shield,
  Sparkles,
  TimerReset,
  Waves,
  Zap,
} from "lucide-react";

type TrackConfig = {
  track_index: number;
  clip_index: number;
  name_suffix: string;
};

type MacroConfig = {
  track_index: number;
  device_index: number;
  parameter_index: number;
};

type TemplateShape = {
  name: string;
  tracks: Record<string, TrackConfig>;
  macros: Record<string, MacroConfig>;
  launch_on_push: boolean;
};

type SavedTemplateRecord = {
  template_id?: string;
  user_id?: string;
  name: string;
  template: TemplateShape;
  created_at?: string;
  updated_at?: string;
};

type OscMessage = {
  address: string;
  args: (string | number | boolean)[];
};

type TimelineEvent = {
  id: string;
  ts: string;
  type: string;
  summary: string;
  payload?: any;
  score?: number;
};

type CompareState = {
  a: any | null;
  b: any | null;
};

type AutonomousDecision = {
  id: string;
  ts: string;
  sourceEventId?: string;
  action: "mutate_energy" | "replay_osc" | "re_export_midi" | "prepare_live_session" | "skip";
  reason: string;
  confidence: number;
  nextEnergy?: number;
  payload?: any;
};

type HealthState = {
  api: "unknown" | "ok" | "error";
  ws: "unknown" | "connected" | "disconnected";
  lastCheckedAt: string;
};

type SessionPreset = {
  id: string;
  name: string;
  prompt: string;
  energy: number;
  oscHost: string;
  oscPort: string;
  dryRun: boolean;
  templateName?: string;
};

type RoutingCell = {
  track: string;
  clip: string;
  macroA: boolean;
  macroB: boolean;
  armed: boolean;
};

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE = "ws://127.0.0.1:8000";
const STORAGE_KEY = "spiral-performance-cockpit-v1";

const builtInTemplates: TemplateShape[] = [
  {
    name: "default_three_track",
    tracks: {
      lead: { track_index: 0, clip_index: 0, name_suffix: "lead" },
      bass: { track_index: 1, clip_index: 0, name_suffix: "bass" },
      drums: { track_index: 2, clip_index: 0, name_suffix: "drums" },
    },
    macros: {
      lead_filter: { track_index: 0, device_index: 0, parameter_index: 0 },
      lead_drive: { track_index: 0, device_index: 0, parameter_index: 1 },
      lead_reverb: { track_index: 0, device_index: 1, parameter_index: 0 },
    },
    launch_on_push: true,
  },
  {
    name: "performance_four_track",
    tracks: {
      lead: { track_index: 0, clip_index: 0, name_suffix: "lead" },
      bass: { track_index: 1, clip_index: 0, name_suffix: "bass" },
      drums: { track_index: 2, clip_index: 0, name_suffix: "drums" },
      fx: { track_index: 3, clip_index: 0, name_suffix: "fx" },
    },
    macros: {
      lead_filter: { track_index: 0, device_index: 0, parameter_index: 0 },
      lead_drive: { track_index: 0, device_index: 0, parameter_index: 1 },
      lead_reverb: { track_index: 3, device_index: 0, parameter_index: 0 },
    },
    launch_on_push: true,
  },
];

const defaultPresets: SessionPreset[] = [
  {
    id: "preset-1",
    name: "Gold Launch",
    prompt: "aggressive spiral live gold section for full launch",
    energy: 0.86,
    oscHost: "127.0.0.1",
    oscPort: "11000",
    dryRun: true,
    templateName: "performance_four_track",
  },
  {
    id: "preset-2",
    name: "Safe Rehearsal",
    prompt: "controlled rehearsal state with safe automation",
    energy: 0.48,
    oscHost: "127.0.0.1",
    oscPort: "11000",
    dryRun: true,
    templateName: "default_three_track",
  },
];

const defaultRouting: RoutingCell[] = [
  { track: "Lead", clip: "A1", macroA: true, macroB: true, armed: true },
  { track: "Bass", clip: "B1", macroA: true, macroB: false, armed: true },
  { track: "Drums", clip: "C1", macroA: false, macroB: true, armed: true },
  { track: "FX", clip: "D1", macroA: true, macroB: true, armed: false },
];

const initialSection = {
  section_name: "spiral_live_gold",
  transport: { bpm: 148, time_signature: "4/4", swing: 0.06 },
  automation: { filter_open: 0.78, drive: 0.52, reverb_mix: 0.23 },
};

function buildOscPreview(template: TemplateShape, section: typeof initialSection): OscMessage[] {
  const messages: OscMessage[] = [];
  messages.push({ address: "/live/song/set/tempo", args: [section.transport.bpm] });

  Object.entries(template.tracks).forEach(([role, cfg]) => {
    const clipName = `${section.section_name}_${cfg.name_suffix || role}`;
    messages.push({ address: "/live/track/set/name", args: [cfg.track_index, clipName] });
    messages.push({ address: "/live/clip/set/name", args: [cfg.track_index, cfg.clip_index, clipName] });
    if (template.launch_on_push) {
      messages.push({ address: "/live/clip/fire", args: [cfg.track_index, cfg.clip_index] });
    }
  });

  const macroMap: Record<string, number> = {
    lead_filter: section.automation.filter_open,
    lead_drive: section.automation.drive,
    lead_reverb: section.automation.reverb_mix,
  };

  Object.entries(template.macros).forEach(([name, cfg]) => {
    const value = macroMap[name];
    if (typeof value !== "number") return;
    messages.push({
      address: "/live/device/set/parameter/value",
      args: [cfg.track_index, cfg.device_index, cfg.parameter_index, Number(value.toFixed(2))],
    });
  });

  return messages;
}

function validateTemplateLocal(template: TemplateShape): string[] {
  const errors: string[] = [];
  if (!template.name.trim()) errors.push("Template name is required.");
  const trackEntries = Object.entries(template.tracks);
  if (!trackEntries.length) errors.push("At least one track is required.");

  trackEntries.forEach(([name, cfg]) => {
    if (cfg.track_index < 0) errors.push(`Track ${name}: track_index must be 0 or higher.`);
    if (cfg.clip_index < 0) errors.push(`Track ${name}: clip_index must be 0 or higher.`);
    if (!cfg.name_suffix.trim()) errors.push(`Track ${name}: name_suffix is required.`);
  });

  Object.entries(template.macros).forEach(([name, cfg]) => {
    if (cfg.track_index < 0 || cfg.device_index < 0 || cfg.parameter_index < 0) {
      errors.push(`Macro ${name}: indexes must be 0 or higher.`);
    }
  });

  return errors;
}

async function api<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = await res.json();
      message = data?.detail
        ? typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail)
        : JSON.stringify(data);
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return res.json();
}

function safeJsonParse(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default function SpiralPerformanceCockpit() {
  const persisted = typeof window !== "undefined" ? safeJsonParse(window.localStorage.getItem(STORAGE_KEY)) : null;

  const [template, setTemplate] = useState<TemplateShape>(persisted?.template || structuredClone(builtInTemplates[0]));
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(persisted?.selectedTemplateId || null);
  const [apiBase, setApiBase] = useState(persisted?.apiBase || DEFAULT_API_BASE);
  const [wsBase, setWsBase] = useState(persisted?.wsBase || DEFAULT_WS_BASE);
  const [userId, setUserId] = useState(persisted?.userId || "jon");
  const [sessionId, setSessionId] = useState(persisted?.sessionId || "session-gold-001");
  const [oscHost, setOscHost] = useState(persisted?.oscHost || "127.0.0.1");
  const [oscPort, setOscPort] = useState(persisted?.oscPort || "11000");
  const [dryRun, setDryRun] = useState(persisted?.dryRun ?? true);
  const [livePrompt, setLivePrompt] = useState(persisted?.livePrompt || defaultPresets[0].prompt);
  const [energy, setEnergy] = useState<number[]>(persisted?.energy || [defaultPresets[0].energy]);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplateRecord[]>([]);
  const [presets, setPresets] = useState<SessionPreset[]>(persisted?.presets || defaultPresets);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(persisted?.selectedPresetId || defaultPresets[0].id);
  const [routing, setRouting] = useState<RoutingCell[]>(persisted?.routing || defaultRouting);

  const [backendValidation, setBackendValidation] = useState<string[]>([]);
  const [previewMessages, setPreviewMessages] = useState<OscMessage[]>(buildOscPreview(template, initialSection));
  const [lastPayload, setLastPayload] = useState<any>(null);
  const [latestSpiralState, setLatestSpiralState] = useState<any>(null);
  const [latestOscPush, setLatestOscPush] = useState<any>(null);
  const [latestMidiExport, setLatestMidiExport] = useState<any>(null);
  const [currentMode, setCurrentMode] = useState<string>("-");
  const [lastReply, setLastReply] = useState<string>("-");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsEvents, setWsEvents] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [compareState, setCompareState] = useState<CompareState>({ a: null, b: null });
  const [log, setLog] = useState<string[]>(["Cockpit ready.", "Live performance mode engaged."]);

  const [autonomousMode, setAutonomousMode] = useState(false);
  const [loopIntervalSec, setLoopIntervalSec] = useState(12);
  const [qualityThreshold, setQualityThreshold] = useState(0.72);
  const [autoMutateEnergy, setAutoMutateEnergy] = useState(true);
  const [pauseOnError, setPauseOnError] = useState(true);
  const [maxAutoCycles, setMaxAutoCycles] = useState(10);
  const [autoCycleCount, setAutoCycleCount] = useState(0);
  const [autonomousLog, setAutonomousLog] = useState<AutonomousDecision[]>([]);

  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineTypeFilter, setTimelineTypeFilter] = useState("all");
  const [health, setHealth] = useState<HealthState>({ api: "unknown", ws: "unknown", lastCheckedAt: "-" });
  const [safeModeSnapshot, setSafeModeSnapshot] = useState<any>(null);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        template,
        selectedTemplateId,
        apiBase,
        wsBase,
        userId,
        sessionId,
        oscHost,
        oscPort,
        dryRun,
        livePrompt,
        energy,
        presets,
        selectedPresetId,
        routing,
      }),
    );
  }, [template, selectedTemplateId, apiBase, wsBase, userId, sessionId, oscHost, oscPort, dryRun, livePrompt, energy, presets, selectedPresetId, routing]);

  const validationErrors = useMemo(() => validateTemplateLocal(template), [template]);

  const pushLog = (entry: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${entry}`, ...prev].slice(0, 100));
  };

  const deriveEventScore = (payload: any) => {
    const spiral = payload?.section?.spiral_snapshot || payload?.spiral_state || latestSpiralState;
    const oscOk = payload?.osc_push?.status === "ok" || payload?.status === "ok";
    const midiOk = payload?.midi_export?.status === "ok" || payload?.file_path;
    const focus = Number(spiral?.focus ?? 0.5);
    const confidence = Number(spiral?.confidence ?? 0.5);
    const convergence = Number(spiral?.goal_convergence ?? 0.4);
    const executionBonus = oscOk || midiOk ? 0.08 : 0;
    return Math.max(0, Math.min(1, focus * 0.28 + confidence * 0.34 + convergence * 0.3 + executionBonus));
  };

  const appendTimeline = (type: string, summary: string, payload?: any) => {
    const score = deriveEventScore(payload);
    const event: TimelineEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toLocaleTimeString(),
      type,
      summary,
      payload,
      score,
    };
    setTimeline((prev) => [event, ...prev].slice(0, 250));
  };

  const appendAutonomousDecision = (decision: Omit<AutonomousDecision, "id" | "ts">) => {
    const full: AutonomousDecision = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toLocaleTimeString(),
      ...decision,
    };
    setAutonomousLog((prev) => [full, ...prev].slice(0, 120));
    pushLog(`Autonomous action: ${full.action}`);
  };

  const filteredTimeline = useMemo(() => {
    return timeline.filter((item) => {
      const matchesType = timelineTypeFilter === "all" || item.type === timelineTypeFilter;
      const q = timelineSearch.trim().toLowerCase();
      const matchesSearch = !q || item.summary.toLowerCase().includes(q) || item.type.toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [timeline, timelineSearch, timelineTypeFilter]);

  const timelineTypes = useMemo(() => {
    const set = new Set<string>(timeline.map((item) => item.type));
    return ["all", ...Array.from(set)];
  }, [timeline]);

  const chartData = useMemo(() => {
    return timeline.slice(0, 20).reverse().map((item, index) => ({
      idx: index + 1,
      score: Number((item.score ?? 0).toFixed(2)),
      type: item.type,
    }));
  }, [timeline]);

  const modeColor = (mode: string) => {
    if (mode === "act") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    if (mode === "reflect") return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    if (mode === "explore") return "bg-sky-500/15 text-sky-700 border-sky-500/30";
    return "bg-muted text-muted-foreground border-border";
  };

  const connectionColor = wsConnected
    ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
    : "bg-rose-500/15 text-rose-700 border-rose-500/30";

  const healthColor = (value: HealthState["api"] | HealthState["ws"]) => {
    if (value === "ok" || value === "connected") return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    if (value === "error" || value === "disconnected") return "bg-rose-500/15 text-rose-700 border-rose-500/30";
    return "bg-muted text-muted-foreground border-border";
  };

  const clearError = () => setError("");

  const runHealthCheck = async () => {
    try {
      await api(apiBase, "/health");
      setHealth((prev) => ({ ...prev, api: "ok", lastCheckedAt: new Date().toLocaleTimeString() }));
      pushLog("API health check passed.");
    } catch {
      setHealth((prev) => ({ ...prev, api: "error", lastCheckedAt: new Date().toLocaleTimeString() }));
      pushLog("API health check failed.");
    }
  };

  const loadUserTemplates = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ templates: SavedTemplateRecord[] }>(apiBase, `/tools/ableton/templates/user/${encodeURIComponent(userId)}`);
      setSavedTemplates(data.templates || []);
      setStatus(`Loaded ${data.templates?.length || 0} saved templates`);
      appendTimeline("templates_loaded", `Loaded ${data.templates?.length || 0} saved templates`, data.templates);
      pushLog(`Fetched saved templates for ${userId}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load templates.";
      setError(msg);
      setStatus("Template load failed");
      pushLog(`Template load failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    runHealthCheck();
    loadUserTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    heartbeatRef.current = window.setInterval(() => {
      runHealthCheck();
    }, 15000);
    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    };
  }, [apiBase]);

  useEffect(() => {
    const session = sessionId.trim();
    if (!session) return;

    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(`${wsBase}/ws/${encodeURIComponent(session)}`);
      socket.onopen = () => {
        setWsConnected(true);
        setHealth((prev) => ({ ...prev, ws: "connected", lastCheckedAt: new Date().toLocaleTimeString() }));
        setStatus("WebSocket connected");
        pushLog(`WebSocket connected for session ${session}.`);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setWsEvents((prev) => [data, ...prev].slice(0, 80));

          if (data.type === "spiral_update" || data.type === "voice_update") {
            setLatestSpiralState(data.payload?.spiral_state ?? null);
            setCurrentMode(data.payload?.mode ?? "-");
            setLastReply(data.payload?.reply ?? "-");
            appendTimeline(data.type, `Mode ${data.payload?.mode ?? "-"} response received`, data.payload);
          }

          if (data.type === "ableton_osc_push") {
            setLatestOscPush(data.payload ?? null);
            appendTimeline("ableton_osc_push", "Ableton OSC push completed", data.payload);
          }

          if (data.type === "midi_export") {
            setLatestMidiExport(data.payload ?? null);
            appendTimeline("midi_export", "MIDI export completed", data.payload);
          }

          if (data.type === "live_session" || data.type === "autonomous_live_session") {
            if (data.payload?.section?.spiral_snapshot) setLatestSpiralState(data.payload.section.spiral_snapshot);
            if (data.payload?.osc_push) setLatestOscPush(data.payload.osc_push);
            if (data.payload?.midi_export) setLatestMidiExport(data.payload.midi_export);
            appendTimeline(data.type, "Live session pipeline executed", data.payload);
          }

          pushLog(`WS event: ${data.type || "unknown"}`);
        } catch {
          setWsEvents((prev) => [{ type: "raw", payload: event.data }, ...prev].slice(0, 80));
          pushLog("WS raw event received.");
        }
      };
      socket.onclose = () => {
        setWsConnected(false);
        setHealth((prev) => ({ ...prev, ws: "disconnected", lastCheckedAt: new Date().toLocaleTimeString() }));
        pushLog(`WebSocket disconnected for session ${session}.`);
      };
      socket.onerror = () => {
        setWsConnected(false);
        setHealth((prev) => ({ ...prev, ws: "disconnected", lastCheckedAt: new Date().toLocaleTimeString() }));
        pushLog("WebSocket error.");
      };
    } catch {
      setWsConnected(false);
      setHealth((prev) => ({ ...prev, ws: "disconnected", lastCheckedAt: new Date().toLocaleTimeString() }));
    }

    return () => {
      if (socket) socket.close();
    };
  }, [wsBase, sessionId]);

  const updateTrack = (role: string, key: keyof TrackConfig, value: string) => {
    setTemplate((prev) => ({
      ...prev,
      tracks: {
        ...prev.tracks,
        [role]: {
          ...prev.tracks[role],
          [key]: key === "name_suffix" ? value : Number(value),
        },
      },
    }));
  };

  const updateMacro = (name: string, key: keyof MacroConfig, value: string) => {
    setTemplate((prev) => ({
      ...prev,
      macros: {
        ...prev.macros,
        [name]: {
          ...prev.macros[name],
          [key]: Number(value),
        },
      },
    }));
  };

  const updateRouting = (index: number, key: keyof RoutingCell, value: string | boolean) => {
    setRouting((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  const loadBuiltIn = (name: string) => {
    const found = builtInTemplates.find((t) => t.name === name);
    if (!found) return;
    setTemplate(structuredClone(found));
    setSelectedTemplateId(null);
    setBackendValidation([]);
    setPreviewMessages(buildOscPreview(found, initialSection));
    pushLog(`Loaded built-in template '${name}'.`);
  };

  const loadSavedTemplate = (record: SavedTemplateRecord) => {
    setTemplate(structuredClone(record.template));
    setSelectedTemplateId(record.template_id || null);
    setBackendValidation([]);
    setPreviewMessages(buildOscPreview(record.template, initialSection));
    pushLog(`Loaded saved template '${record.name}'.`);
  };

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setLivePrompt(preset.prompt);
    setEnergy([preset.energy]);
    setOscHost(preset.oscHost);
    setOscPort(preset.oscPort);
    setDryRun(preset.dryRun);
    if (preset.templateName) loadBuiltIn(preset.templateName);
    pushLog(`Applied preset '${preset.name}'.`);
  };

  const captureSafeModeSnapshot = () => {
    setSafeModeSnapshot({
      template,
      livePrompt,
      energy,
      oscHost,
      oscPort,
      dryRun,
      routing,
      currentMode,
      latestSpiralState,
    });
    pushLog("Captured safe mode snapshot.");
  };

  const rollbackSafeMode = () => {
    if (!safeModeSnapshot) return;
    setTemplate(safeModeSnapshot.template);
    setLivePrompt(safeModeSnapshot.livePrompt);
    setEnergy(safeModeSnapshot.energy);
    setOscHost(safeModeSnapshot.oscHost);
    setOscPort(safeModeSnapshot.oscPort);
    setDryRun(true);
    setRouting(safeModeSnapshot.routing);
    setLatestSpiralState(safeModeSnapshot.latestSpiralState);
    pushLog("Rolled back to safe mode snapshot.");
  };

  const validateWithBackend = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ valid: boolean; errors: string[] }>(apiBase, "/tools/ableton/templates/validate", {
        method: "POST",
        body: JSON.stringify(template),
      });
      setBackendValidation(data.errors || []);
      setStatus(data.valid ? "Backend validation passed" : "Backend validation returned errors");
      appendTimeline("template_validation", data.valid ? "Template validation passed" : "Template validation returned issues", data);
      pushLog(data.valid ? "Backend validation passed." : `Backend validation found ${data.errors.length} issue(s).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Backend validation failed.";
      setError(msg);
      setStatus("Validation failed");
      pushLog(`Validation failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (validationErrors.length) {
      pushLog("Save blocked. Fix local validation errors first.");
      return;
    }
    setIsBusy(true);
    clearError();
    try {
      const data = await api<{ status: string; saved: SavedTemplateRecord }>(apiBase, "/tools/ableton/templates/save", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          name: template.name,
          template,
          template_id: selectedTemplateId,
        }),
      });
      setSelectedTemplateId(data.saved.template_id || null);
      setStatus(`Saved template '${data.saved.name}'`);
      appendTimeline("template_saved", `Saved template '${data.saved.name}'`, data.saved);
      pushLog(`Saved template '${data.saved.name}' to backend.`);
      await loadUserTemplates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      setError(msg);
      setStatus("Save failed");
      pushLog(`Save failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) {
      pushLog("Delete skipped. No saved template selected.");
      return;
    }
    setIsBusy(true);
    clearError();
    try {
      await api(apiBase, "/tools/ableton/templates/delete", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, template_id: selectedTemplateId }),
      });
      setSelectedTemplateId(null);
      setStatus("Template deleted");
      appendTimeline("template_deleted", "Deleted selected template", { template_id: selectedTemplateId });
      pushLog("Deleted selected template from backend.");
      await loadUserTemplates();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed.";
      setError(msg);
      setStatus("Delete failed");
      pushLog(`Delete failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const runDryPreview = async () => {
    setIsBusy(true);
    clearError();
    try {
      const data = await api<any>(apiBase, "/tools/music/push-ableton", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt: livePrompt,
          energy: Number(energy[0].toFixed(2)),
          duration_bars: 16,
          section_name: initialSection.section_name,
          osc_host: oscHost,
          osc_port: Number(oscPort),
          template_id: selectedTemplateId,
          template_overrides: template,
          dry_run: true,
        }),
      });
      setPreviewMessages(data.messages || []);
      setLastPayload(data);
      setStatus(`Dry run ready with ${data.messages?.length || 0} OSC messages`);
      appendTimeline("dry_run", `Generated ${data.messages?.length || 0} OSC preview messages`, data);
      pushLog("Fetched OSC dry-run preview from backend.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dry preview failed.";
      setError(msg);
      setStatus("Dry preview failed");
      pushLog(`Dry preview failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const launchLiveSession = async () => {
    if (validationErrors.length) {
      pushLog("Live launch blocked. Fix local validation errors first.");
      return;
    }
    setIsBusy(true);
    clearError();
    try {
      const payload = {
        user_id: userId,
        session_id: sessionId,
        prompt: livePrompt,
        energy: Number(energy[0].toFixed(2)),
        duration_bars: 16,
        section_name: initialSection.section_name,
        output_dir: "exports",
        osc_host: oscHost,
        osc_port: Number(oscPort),
        push_osc: true,
        export_midi: true,
        template_id: selectedTemplateId,
        template_overrides: template,
        dry_run: dryRun,
      };
      const data = await api<any>(apiBase, "/tools/music/live-session", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setLastPayload(data);
      setPreviewMessages(data?.osc_push?.messages || []);
      setStatus(dryRun ? "Live-session dry run prepared" : "Live-session sent to backend");
      appendTimeline("live_session_request", dryRun ? "Prepared live-session dry run" : "Triggered live-session backend route", data);
      pushLog(dryRun ? "Prepared live-session dry run." : "Triggered live-session backend route.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Live session failed.";
      setError(msg);
      setStatus("Live session failed");
      if (pauseOnError) setAutonomousMode(false);
      pushLog(`Live session failed: ${msg}`);
    } finally {
      setIsBusy(false);
    }
  };

  const restoreFromEvent = (event: TimelineEvent) => {
    if (event.payload?.template) {
      setTemplate(event.payload.template);
      pushLog("Template restored from timeline event.");
    }
    if (event.payload?.section?.spiral_snapshot) {
      setLatestSpiralState(event.payload.section.spiral_snapshot);
      pushLog("Spiral state restored from timeline event.");
    }
  };

  const replayOscFromEvent = async (event: TimelineEvent) => {
    if (!event.payload) return;
    try {
      await api(apiBase, "/tools/music/push-ableton", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt: "replay",
          osc_host: oscHost,
          osc_port: Number(oscPort),
          dry_run: false,
          template_id: selectedTemplateId,
          template_overrides: template,
        }),
      });
      appendAutonomousDecision({
        sourceEventId: event.id,
        action: "replay_osc",
        reason: "Operator replayed OSC from timeline event.",
        confidence: 0.9,
        payload: event.payload,
      });
    } catch {
      pushLog("OSC replay failed.");
    }
  };

  const reExportMidiFromEvent = async (event?: TimelineEvent) => {
    try {
      await api(apiBase, "/tools/music/export-midi", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt: livePrompt,
          energy: Number(energy[0].toFixed(2)),
        }),
      });
      appendAutonomousDecision({
        sourceEventId: event?.id,
        action: "re_export_midi",
        reason: "Operator re-exported MIDI from timeline state.",
        confidence: 0.88,
        payload: event?.payload,
      });
    } catch {
      pushLog("MIDI re-export failed.");
    }
  };

  const setCompareSlot = (slot: "a" | "b", payload: any) => {
    setCompareState((prev) => ({ ...prev, [slot]: payload }));
  };

  const selectBestTimelineEvent = () => {
    const ranked = timeline
      .map((item) => ({ item, score: item.score ?? deriveEventScore(item.payload) }))
      .sort((a, b) => b.score - a.score);
    return ranked[0] || null;
  };

  const mutatedEnergyFromBest = (base: number) => {
    const delta = Math.random() * 0.16 - 0.08;
    return Math.max(0, Math.min(1, Number((base + delta).toFixed(2))));
  };

  const executeAutonomousCycle = async () => {
    if (autoCycleCount >= maxAutoCycles) {
      setAutonomousMode(false);
      appendAutonomousDecision({ action: "skip", reason: `Reached max autonomous cycles (${maxAutoCycles}).`, confidence: 1 });
      return;
    }
    const best = selectBestTimelineEvent();
    if (!best) {
      appendAutonomousDecision({ action: "skip", reason: "No timeline events yet.", confidence: 0.2 });
      return;
    }
    if (best.score < qualityThreshold) {
      appendAutonomousDecision({
        sourceEventId: best.item.id,
        action: "skip",
        reason: `Best score ${best.score.toFixed(2)} below threshold ${qualityThreshold.toFixed(2)}.`,
        confidence: best.score,
        payload: best.item.payload,
      });
      return;
    }

    const sourceEnergy = Number(energy[0].toFixed(2));
    const nextEnergy = autoMutateEnergy ? mutatedEnergyFromBest(sourceEnergy) : sourceEnergy;
    setEnergy([nextEnergy]);
    appendAutonomousDecision({
      sourceEventId: best.item.id,
      action: "mutate_energy",
      reason: `Derived next cycle from ${best.item.type}.`,
      confidence: best.score,
      nextEnergy,
      payload: best.item.payload,
    });

    try {
      const data = await api<any>(apiBase, "/tools/music/live-session", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          prompt: `${livePrompt} autonomous continuation`,
          energy: nextEnergy,
          duration_bars: 16,
          section_name: `${initialSection.section_name}_auto`,
          output_dir: "exports",
          osc_host: oscHost,
          osc_port: Number(oscPort),
          push_osc: true,
          export_midi: true,
          template_id: selectedTemplateId,
          template_overrides: template,
          dry_run: dryRun,
        }),
      });
      setLastPayload(data);
      setAutoCycleCount((prev) => prev + 1);
      appendTimeline("autonomous_live_session", "Autonomous loop executed a live-session cycle", data);
      appendAutonomousDecision({
        sourceEventId: best.item.id,
        action: "prepare_live_session",
        reason: "Autonomous cycle successfully triggered live-session route.",
        confidence: best.score,
        nextEnergy,
        payload: data,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Autonomous cycle failed.";
      appendAutonomousDecision({
        sourceEventId: best.item.id,
        action: "prepare_live_session",
        reason,
        confidence: best.score,
      });
      if (pauseOnError) setAutonomousMode(false);
    }
  };

  useEffect(() => {
    if (!autonomousMode) return;
    const id = window.setInterval(() => {
      executeAutonomousCycle();
    }, Math.max(5, loopIntervalSec) * 1000);
    return () => window.clearInterval(id);
  }, [autonomousMode, loopIntervalSec, qualityThreshold, autoMutateEnergy, pauseOnError, maxAutoCycles, autoCycleCount, timeline, dryRun, apiBase, sessionId, oscHost, oscPort, livePrompt, selectedTemplateId, template]);

  const bestTimelineCandidate = selectBestTimelineEvent();
  const requestPreview = {
    user_id: userId,
    session_id: sessionId,
    prompt: livePrompt,
    energy: Number(energy[0].toFixed(2)),
    duration_bars: 16,
    section_name: initialSection.section_name,
    output_dir: "exports",
    osc_host: oscHost,
    osc_port: Number(oscPort),
    push_osc: true,
    export_midi: true,
    template_id: selectedTemplateId,
    template_overrides: template,
    dry_run: dryRun,
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto grid max-w-7xl gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Waves className="h-6 w-6" /> Spiral Live Performance Cockpit
                  </CardTitle>
                  <CardDescription>
                    Full live control surface with presets, routing matrix, health checks, timeline scoring, autonomous loop mode, and safe rollback.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="rounded-full px-3 py-1">Cockpit Mode</Badge>
                  <Badge variant="outline" className="rounded-full px-3 py-1">Operator Grade</Badge>
                  <Badge className={`rounded-full px-3 py-1 border ${connectionColor}`}>{wsConnected ? "WS Live" : "WS Offline"}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-6">
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4" /> User</div>
                <div className="mt-2 text-2xl font-semibold">{userId}</div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Cable className="h-4 w-4" /> OSC</div>
                <div className="mt-2 text-2xl font-semibold">{oscHost}:{oscPort}</div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4" /> Events</div>
                <div className="mt-2 text-2xl font-semibold">{timeline.length}</div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Disc3 className="h-4 w-4" /> Energy</div>
                <div className="mt-2 text-2xl font-semibold">{energy[0].toFixed(2)}</div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Shield className="h-4 w-4" /> API</div>
                <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm ${healthColor(health.api)}`}>{health.api}</div>
              </div>
              <div className="rounded-2xl border p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><Gauge className="h-4 w-4" /> Status</div>
                <div className="mt-2 text-sm font-semibold">{status}</div>
                <div className="mt-1 text-xs text-muted-foreground">Last check: {health.lastCheckedAt}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Launch Control</CardTitle>
              <CardDescription>Fast access to live-session, dry-run, health, presets, and rollback.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Preset</Label>
                <Select value={selectedPresetId} onValueChange={applyPreset}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Backend Base URL</Label>
                <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>WebSocket Base URL</Label>
                <Input value={wsBase} onChange={(e) => setWsBase(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>OSC Host</Label>
                  <Input value={oscHost} onChange={(e) => setOscHost(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>OSC Port</Label>
                  <Input value={oscPort} onChange={(e) => setOscPort(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button className="rounded-2xl" onClick={launchLiveSession} disabled={isBusy}>
                  <Play className="mr-2 h-4 w-4" /> {dryRun ? "Run Dry Session" : "Launch Session"}
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={runDryPreview} disabled={isBusy}>
                  <Radio className="mr-2 h-4 w-4" /> Preview OSC
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={runHealthCheck}>
                  <Zap className="mr-2 h-4 w-4" /> Health Check
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={loadUserTemplates}>
                  <RefreshCcw className="mr-2 h-4 w-4" /> Reload
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={captureSafeModeSnapshot}>
                  <Shield className="mr-2 h-4 w-4" /> Capture Safe Mode
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={rollbackSafeMode} disabled={!safeModeSnapshot}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Safe Rollback
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {error ? (
          <Alert className="rounded-2xl">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg flex items-center gap-2"><Bot className="h-5 w-5" /> Autonomous Performance Engine</CardTitle>
                <CardDescription>Live automation with guardrails, scoring, and cycle limits.</CardDescription>
              </div>
              <Badge className={`rounded-full px-3 py-1 border ${autonomousMode ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
                {autonomousMode ? "Autonomous On" : "Autonomous Off"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-6">
            <div className="rounded-2xl border p-4">
              <div className="text-sm font-medium">Loop Interval</div>
              <Input className="mt-2" type="number" value={loopIntervalSec} onChange={(e) => setLoopIntervalSec(Number(e.target.value || 12))} />
            </div>
            <div className="rounded-2xl border p-4">
              <div className="text-sm font-medium">Quality Threshold</div>
              <div className="mt-3">
                <Slider value={[qualityThreshold]} onValueChange={(v) => setQualityThreshold(Number(v[0].toFixed(2)))} min={0} max={1} step={0.01} />
                <div className="mt-2 text-sm text-muted-foreground">{qualityThreshold.toFixed(2)}</div>
              </div>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="text-sm font-medium">Max Cycles</div>
              <Input className="mt-2" type="number" value={maxAutoCycles} onChange={(e) => setMaxAutoCycles(Number(e.target.value || 10))} />
              <div className="mt-2 text-xs text-muted-foreground">Used {autoCycleCount}</div>
            </div>
            <div className="rounded-2xl border p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Mutate Energy</div>
                <div className="text-xs text-muted-foreground">Create controlled variance.</div>
              </div>
              <Switch checked={autoMutateEnergy} onCheckedChange={setAutoMutateEnergy} />
            </div>
            <div className="rounded-2xl border p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Pause On Error</div>
                <div className="text-xs text-muted-foreground">Fail closed.</div>
              </div>
              <Switch checked={pauseOnError} onCheckedChange={setPauseOnError} />
            </div>
            <div className="rounded-2xl border p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Autonomous Mode</div>
                <div className="text-xs text-muted-foreground">Run loop cycles.</div>
              </div>
              <Switch checked={autonomousMode} onCheckedChange={setAutonomousMode} />
            </div>
            <div className="md:col-span-6 flex flex-wrap gap-2">
              <Button className="rounded-2xl" onClick={executeAutonomousCycle}><Sparkles className="mr-2 h-4 w-4" /> Run Cycle Now</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => { setAutonomousMode((v) => !v); if (!autonomousMode) setAutoCycleCount(0); }}>
                {autonomousMode ? "Stop Loop" : "Start Loop"}
              </Button>
              <div className="flex-1 min-w-[220px] rounded-2xl border p-3">
                <div className="text-xs text-muted-foreground">Cycle Progress</div>
                <Progress className="mt-2" value={(autoCycleCount / Math.max(1, maxAutoCycles)) * 100} />
              </div>
            </div>
          </CardContent>
        </Card>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Latest Spiral State</CardTitle><CardDescription>Current live spiral snapshot.</CardDescription></CardHeader>
            <CardContent><pre className="min-h-[180px] overflow-x-auto rounded-2xl border p-3 text-xs">{JSON.stringify(latestSpiralState, null, 2)}</pre></CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Latest OSC Push</CardTitle><CardDescription>Most recent live Ableton control result.</CardDescription></CardHeader>
            <CardContent><pre className="min-h-[180px] overflow-x-auto rounded-2xl border p-3 text-xs">{JSON.stringify(latestOscPush, null, 2)}</pre></CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Latest MIDI Export</CardTitle><CardDescription>Most recent file export state.</CardDescription></CardHeader>
            <CardContent><pre className="min-h-[180px] overflow-x-auto rounded-2xl border p-3 text-xs">{JSON.stringify(latestMidiExport, null, 2)}</pre></CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader><CardTitle className="text-base">Current Mode + Reply</CardTitle><CardDescription>Latest system response context.</CardDescription></CardHeader>
            <CardContent className="grid gap-3">
              <div className={`rounded-2xl border p-3 ${modeColor(currentMode)}`}>
                <div className="text-xs opacity-80">Current Mode</div>
                <div className="mt-1 flex items-center gap-2 text-lg font-semibold"><Orbit className="h-4 w-4" /> {currentMode}</div>
              </div>
              <div className="rounded-2xl border p-3">
                <div className="text-xs text-muted-foreground">Last Reply</div>
                <div className="mt-1 text-sm">{lastReply}</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <Tabs defaultValue="cockpit" className="grid gap-6">
          <TabsList className="w-full justify-start rounded-2xl flex-wrap">
            <TabsTrigger value="cockpit">Cockpit</TabsTrigger>
            <TabsTrigger value="routing">Routing Matrix</TabsTrigger>
            <TabsTrigger value="template">Template Editor</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="autonomous">Autonomous</TabsTrigger>
            <TabsTrigger value="response">Backend Response</TabsTrigger>
          </TabsList>

          <TabsContent value="cockpit" className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Performance Presets</CardTitle>
                <CardDescription>Quick launch scenes for different performance modes.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {presets.map((preset) => (
                  <button key={preset.id} onClick={() => applyPreset(preset.id)} className="rounded-2xl border p-4 text-left hover:bg-muted">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{preset.name}</div>
                      <Badge variant="outline">{preset.energy.toFixed(2)}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{preset.prompt}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Session Controls</CardTitle>
                <CardDescription>Realtime session settings and launch parameters.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2"><Label>User ID</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} /></div>
                  <div className="grid gap-2"><Label>Session ID</Label><Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} /></div>
                </div>
                <div className="grid gap-2"><Label>Prompt</Label><Textarea value={livePrompt} onChange={(e) => setLivePrompt(e.target.value)} rows={4} /></div>
                <div className="grid gap-2"><Label>Energy</Label><Slider value={energy} onValueChange={setEnergy} min={0} max={1} step={0.01} /></div>
                <div className="flex items-center justify-between rounded-2xl border p-3">
                  <div><div className="font-medium">Dry Run</div><div className="text-sm text-muted-foreground">Keep live launch non-destructive.</div></div>
                  <Switch checked={dryRun} onCheckedChange={setDryRun} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button className="rounded-2xl" onClick={launchLiveSession} disabled={isBusy}><Play className="mr-2 h-4 w-4" /> Launch</Button>
                  <Button variant="outline" className="rounded-2xl" onClick={runDryPreview} disabled={isBusy}><Send className="mr-2 h-4 w-4" /> Preview</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="routing">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle>Clip / Track Routing Matrix</CardTitle>
                <CardDescription>Live routing table for performance tracks and macro assignments.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {routing.map((row, index) => (
                    <div key={`${row.track}-${index}`} className="grid gap-3 rounded-2xl border p-4 md:grid-cols-6">
                      <div className="grid gap-2"><Label>Track</Label><Input value={row.track} onChange={(e) => updateRouting(index, "track", e.target.value)} /></div>
                      <div className="grid gap-2"><Label>Clip</Label><Input value={row.clip} onChange={(e) => updateRouting(index, "clip", e.target.value)} /></div>
                      <div className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm">Macro A</span><Switch checked={row.macroA} onCheckedChange={(v) => updateRouting(index, "macroA", v)} /></div>
                      <div className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm">Macro B</span><Switch checked={row.macroB} onCheckedChange={(v) => updateRouting(index, "macroB", v)} /></div>
                      <div className="flex items-center justify-between rounded-xl border p-3"><span className="text-sm">Armed</span><Switch checked={row.armed} onCheckedChange={(v) => updateRouting(index, "armed", v)} /></div>
                      <div className="flex items-end"><Badge variant={row.armed ? "secondary" : "outline"}>{row.armed ? "live" : "idle"}</Badge></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="template" className="grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" /> Template Editor</CardTitle><CardDescription>Edit mappings and save them through backend persistence.</CardDescription></CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid gap-2"><Label>Template Name</Label><Input value={template.name} onChange={(e) => setTemplate((prev) => ({ ...prev, name: e.target.value }))} /></div>
                <div className="flex items-center justify-between rounded-2xl border p-3">
                  <div><div className="font-medium">Launch On Push</div><div className="text-sm text-muted-foreground">Fire target clips automatically after naming.</div></div>
                  <Switch checked={template.launch_on_push} onCheckedChange={(checked) => setTemplate((prev) => ({ ...prev, launch_on_push: checked }))} />
                </div>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Tracks</h3><Button variant="outline" className="rounded-2xl" onClick={() => setTemplate((prev) => ({ ...prev, tracks: { ...prev.tracks, [`track_${Object.keys(prev.tracks).length}`]: { track_index: 0, clip_index: 0, name_suffix: `track_${Object.keys(prev.tracks).length}` } } }))}>Add Track</Button></div>
                  {Object.entries(template.tracks).map(([role, cfg]) => (
                    <div key={role} className="grid gap-3 rounded-2xl border p-4 md:grid-cols-4">
                      <div className="grid gap-2"><Label>{role} Name Suffix</Label><Input value={cfg.name_suffix} onChange={(e) => updateTrack(role, "name_suffix", e.target.value)} /></div>
                      <div className="grid gap-2"><Label>Track Index</Label><Input value={cfg.track_index} onChange={(e) => updateTrack(role, "track_index", e.target.value)} /></div>
                      <div className="grid gap-2"><Label>Clip Index</Label><Input value={cfg.clip_index} onChange={(e) => updateTrack(role, "clip_index", e.target.value)} /></div>
                      <div className="flex items-end"><Badge variant="secondary">{role}</Badge></div>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="grid gap-3">
                  <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Macros</h3><Button variant="outline" className="rounded-2xl" onClick={() => setTemplate((prev) => ({ ...prev, macros: { ...prev.macros, [`macro_${Object.keys(prev.macros).length}`]: { track_index: 0, device_index: 0, parameter_index: 0 } } }))}>Add Macro</Button></div>
                  {Object.entries(template.macros).map(([name, cfg]) => (
                    <div key={name} className="grid gap-3 rounded-2xl border p-4 md:grid-cols-4">
                      <div className="flex items-end"><Badge variant="outline">{name}</Badge></div>
                      <div className="grid gap-2"><Label>Track Index</Label><Input value={cfg.track_index} onChange={(e) => updateMacro(name, "track_index", e.target.value)} /></div>
                      <div className="grid gap-2"><Label>Device Index</Label><Input value={cfg.device_index} onChange={(e) => updateMacro(name, "device_index", e.target.value)} /></div>
                      <div className="grid gap-2"><Label>Parameter Index</Label><Input value={cfg.parameter_index} onChange={(e) => updateMacro(name, "parameter_index", e.target.value)} /></div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="rounded-2xl" onClick={saveTemplate} disabled={isBusy}><Save className="mr-2 h-4 w-4" /> Save to Backend</Button>
                  <Button variant="outline" className="rounded-2xl" onClick={validateWithBackend} disabled={isBusy}><Send className="mr-2 h-4 w-4" /> Validate</Button>
                  <Button variant="outline" className="rounded-2xl" onClick={deleteTemplate} disabled={isBusy || !selectedTemplateId}>Delete</Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Validation</CardTitle><CardDescription>Local vs backend validation.</CardDescription></CardHeader>
                <CardContent className="grid gap-4">
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">Local validation</div>
                    {validationErrors.length === 0 ? <div className="mt-2 text-sm text-muted-foreground">No local errors.</div> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{validationErrors.map((err) => <li key={err}>{err}</li>)}</ul>}
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="font-medium">Backend validation</div>
                    {backendValidation.length === 0 ? <div className="mt-2 text-sm text-muted-foreground">No backend validation errors currently loaded.</div> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{backendValidation.map((err) => <li key={err}>{err}</li>)}</ul>}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader><CardTitle>Template Library</CardTitle><CardDescription>Built-ins plus saved backend templates.</CardDescription></CardHeader>
                <CardContent className="grid gap-4">
                  <div>
                    <div className="mb-2 font-medium">Built-in</div>
                    <div className="flex flex-wrap gap-2">{builtInTemplates.map((item) => <Button key={item.name} variant="outline" className="rounded-2xl" onClick={() => loadBuiltIn(item.name)}>Load {item.name}</Button>)}</div>
                  </div>
                  <Separator />
                  <div>
                    <div className="mb-2 font-medium">Saved in backend</div>
                    <div className="grid gap-2">
                      {savedTemplates.length === 0 ? <div className="text-sm text-muted-foreground">No saved templates for this user yet.</div> : savedTemplates.map((item) => (
                        <button key={item.template_id || item.name} onClick={() => loadSavedTemplate(item)} className="rounded-2xl border p-3 text-left hover:bg-muted">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.template_id || "no-id"}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="timeline">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>Session Timeline</CardTitle>
                    <CardDescription>Actionable timeline with scoring and filters.</CardDescription>
                  </div>
                  <Button variant="outline" className="rounded-2xl" onClick={() => setTimeline([])}><TimerReset className="mr-2 h-4 w-4" /> Clear Timeline</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search timeline" value={timelineSearch} onChange={(e) => setTimelineSearch(e.target.value)} /></div>
                  <Select value={timelineTypeFilter} onValueChange={setTimelineTypeFilter}>
                    <SelectTrigger><SelectValue placeholder="Filter type" /></SelectTrigger>
                    <SelectContent>{timelineTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <ScrollArea className="h-[520px] rounded-2xl border p-4">
                  <div className="grid gap-3">
                    {filteredTimeline.length === 0 ? <div className="text-sm text-muted-foreground">No timeline entries match the current filter.</div> : filteredTimeline.map((item) => (
                      <div key={item.id} className="rounded-2xl border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-wrap"><Badge>{item.type}</Badge><Badge variant="outline">score {(item.score ?? 0).toFixed(2)}</Badge><span className="font-medium">{item.summary}</span></div>
                          <span className="text-xs text-muted-foreground">{item.ts}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => restoreFromEvent(item)}>Restore</Button>
                          <Button size="sm" variant="outline" onClick={() => replayOscFromEvent(item)}>Replay OSC</Button>
                          <Button size="sm" variant="outline" onClick={() => reExportMidiFromEvent(item)}>Re-export MIDI</Button>
                          <Button size="sm" variant="outline" onClick={() => setCompareSlot("a", item.payload)}>Set A</Button>
                          <Button size="sm" variant="outline" onClick={() => setCompareSlot("b", item.payload)}>Set B</Button>
                        </div>
                        <pre className="mt-3 overflow-x-auto rounded-xl border p-3 text-xs">{JSON.stringify(item.payload, null, 2)}</pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="metrics" className="grid gap-6 md:grid-cols-[0.9fr_1.1fr]">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Spiral Score Trend</CardTitle><CardDescription>Recent timeline scores across session events.</CardDescription></CardHeader>
              <CardContent className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="idx" />
                    <YAxis domain={[0, 1]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Compare States</CardTitle><CardDescription>Compare two timeline payloads side by side.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <pre className="rounded-2xl border p-3 text-xs overflow-x-auto">{JSON.stringify(compareState.a, null, 2)}</pre>
                <pre className="rounded-2xl border p-3 text-xs overflow-x-auto">{JSON.stringify(compareState.b, null, 2)}</pre>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="autonomous">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Autonomous Inspector</CardTitle><CardDescription>Source state selection, latest decisions, and guardrails.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border p-4">
                  <div className="mb-2 font-medium">Best Timeline Candidate</div>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(bestTimelineCandidate, null, 2)}</pre>
                </div>
                <div className="rounded-2xl border p-4">
                  <div className="mb-2 font-medium">Health + Guardrails</div>
                  <div className="grid gap-2 text-sm">
                    <div>API: <span className="font-medium">{health.api}</span></div>
                    <div>WS: <span className="font-medium">{health.ws}</span></div>
                    <div>Pause on error: <span className="font-medium">{pauseOnError ? "yes" : "no"}</span></div>
                    <div>Cycle count: <span className="font-medium">{autoCycleCount} / {maxAutoCycles}</span></div>
                  </div>
                </div>
                <div className="md:col-span-2 rounded-2xl border p-4">
                  <div className="mb-3 font-medium">Autonomous Decisions</div>
                  <ScrollArea className="h-[280px]"><div className="grid gap-2 pr-3">{autonomousLog.length === 0 ? <div className="text-sm text-muted-foreground">No autonomous decisions yet.</div> : autonomousLog.map((item) => (
                    <div key={item.id} className="rounded-xl border p-3 text-sm">
                      <div className="flex items-center justify-between gap-3"><div className="font-medium">{item.action}</div><div className="text-xs text-muted-foreground">{item.ts}</div></div>
                      <div className="mt-1 text-muted-foreground">{item.reason}</div>
                      <div className="mt-2 text-xs">confidence: {item.confidence.toFixed(2)}{typeof item.nextEnergy === "number" ? ` • nextEnergy: ${item.nextEnergy.toFixed(2)}` : ""}</div>
                    </div>
                  ))}</div></ScrollArea>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="response" className="grid gap-6 md:grid-cols-[0.95fr_1.05fr]">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Backend Route Payload</CardTitle><CardDescription>Payload sent to `/tools/music/live-session`.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-sm">{JSON.stringify(requestPreview, null, 2)}</pre></CardContent>
            </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader><CardTitle>Backend Response</CardTitle><CardDescription>Most recent backend response.</CardDescription></CardHeader>
              <CardContent><pre className="overflow-x-auto rounded-2xl border p-4 text-sm min-h-[320px]">{JSON.stringify(lastPayload, null, 2)}</pre></CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
