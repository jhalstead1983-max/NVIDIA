type AutonomousDecision = {
  id: string;
  ts: string;
  sourceEventId?: string;
  action: "mutate_energy" | "replay_osc" | "re_export_midi" | "prepare_live_session";
  reason: string;
  confidence: number;
  nextEnergy?: number;
  payload?: any;
};

const [autonomousMode, setAutonomousMode] = useState(false);
const [loopIntervalSec, setLoopIntervalSec] = useState(12);
const [qualityThreshold, setQualityThreshold] = useState(0.72);
const [autoMutateEnergy, setAutoMutateEnergy] = useState(true);
const [autonomousLog, setAutonomousLog] = useState<AutonomousDecision[]>([]);

const appendAutonomousDecision = (decision: Omit<AutonomousDecision, "id" | "ts">) => {
  const full: AutonomousDecision = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toLocaleTimeString(),
    ...decision,
  };
  setAutonomousLog((prev) => [full, ...prev].slice(0, 100));
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

const selectBestTimelineEvent = () => {
  const ranked = timeline
    .map((item) => ({ item, score: deriveEventScore(item.payload) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
};

const mutatedEnergyFromBest = (base: number) => {
  const delta = Math.random() * 0.16 - 0.08;
  return Math.max(0, Math.min(1, Number((base + delta).toFixed(2))));
};

const executeAutonomousCycle = async () => {
  const best = selectBestTimelineEvent();
  if (!best) {
    appendAutonomousDecision({
      action: "prepare_live_session",
      reason: "No timeline events yet.",
      confidence: 0.2,
    });
    return;
  }

  if (best.score < qualityThreshold) {
    appendAutonomousDecision({
      sourceEventId: best.item.id,
      action: "prepare_live_session",
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
    appendAutonomousDecision({
      sourceEventId: best.item.id,
      action: "prepare_live_session",
      reason: err instanceof Error ? err.message : "Autonomous cycle failed.",
      confidence: best.score,
    });
  }
};

useEffect(() => {
  if (!autonomousMode) return;
  const id = window.setInterval(() => {
    executeAutonomousCycle();
  }, Math.max(5, loopIntervalSec) * 1000);
  return () => window.clearInterval(id);
}, [
  autonomousMode,
  loopIntervalSec,
  qualityThreshold,
  autoMutateEnergy,
  timeline,
  dryRun,
  apiBase,
  sessionId,
  oscHost,
  oscPort,
  livePrompt,
  selectedTemplateId,
  template,
]);
<TabsTrigger value="autonomous">Autonomous</TabsTrigger>
<TabsContent value="autonomous">
  <Card className="rounded-2xl shadow-sm">
    <CardHeader>
      <CardTitle>Autonomous Loop Inspector</CardTitle>
      <CardDescription>Inspect how the system chooses source states and what it does next.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border p-4">
        <div className="mb-2 font-medium">Best Timeline Candidate</div>
        <pre className="text-xs overflow-x-auto">{JSON.stringify(selectBestTimelineEvent(), null, 2)}</pre>
      </div>
      <div className="rounded-2xl border p-4">
        <div className="mb-2 font-medium">Latest Autonomous Payload</div>
        <pre className="text-xs overflow-x-auto">{JSON.stringify(autonomousLog[0] || null, null, 2)}</pre>
      </div>
    </CardContent>
  </Card>
</TabsContent>