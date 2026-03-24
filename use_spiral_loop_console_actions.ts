type SessionState = "idle" | "primed" | "rehearsing" | "performing" | "autonomous" | "degraded" | "rollback" | "complete";
type ActionStatus = "pending" | "success" | "failed";
type Tone = "default" | "warning" | "error";

type SessionSnapshot = {
  state: SessionState;
};

type ExecuteResponse = {
  status: string;
  session?: any;
  section?: any;
  osc_push?: any;
  midi_export?: any;
  decision?: any;
  score?: any;
  memory_written?: any;
  autonomous_mutation?: any;
};

type SpiralResponse = {
  spiral?: {
    stop_reason?: string;
  };
  final_execution?: ExecuteResponse | null;
  human_gate?: {
    status?: string;
  };
};

type HumanGateDecision = {
  approved: boolean;
  reviewer: string;
  reason: string;
};

type Settings = {
  userId: string;
  sessionId: string;
  prompt: string;
  energy: number[];
  intent: string;
  biofeedback: any;
  spiralCore: any;
  dryRun: boolean;
  oscHost: string;
  oscPort: string;
  autonomousDryRun: boolean;
  autonomousBaseSection: string;
  loopIntervalSeconds: number;
  loopMaxSteps: number;
  liveMode: "stream" | "refresh";
  spiralMaxSpirals: number;
  spiralConfidenceTarget: number;
  spiralNoveltyThreshold: number;
  gate1Approved: boolean;
  gate1Reviewer: string;
  gate1Reason: string;
  gate2Approved: boolean;
  gate2Reviewer: string;
  gate2Reason: string;
};

type ApiClient = {
  getSessionState: (sessionId: string) => Promise<{ session: any }>;
  getEvents: (sessionId: string) => Promise<{ events: any[] }>;
  getLoopStatus: (sessionId: string, userId: string) => Promise<{ loop: any }>;
  heartbeat: (sessionId: string, userId: string) => Promise<{ status: string }>;
  createSession: (body: any) => Promise<{ session: any }>;
  transitionSession: (body: any) => Promise<{ session: any }>;
  executeSession: (body: any) => Promise<ExecuteResponse>;
  autonomousStep: (body: any) => Promise<ExecuteResponse>;
  runSpiral: (body: any) => Promise<SpiralResponse>;
  runSpiralWithHumanGate: (body: any) => Promise<SpiralResponse>;
  runSpiralWithTwoPersonGate: (body: any) => Promise<SpiralResponse>;
  startLoop: (body: any) => Promise<{ loop: any }>;
  stopLoop: (body: any) => Promise<{ loop: any }>;
  rollback: (body: any) => Promise<{ session: any }>;
};

type HookOptions = {
  api: ApiClient;
  settings: Settings;
  sessionState: SessionSnapshot | null;
  dispatch: (action: any) => void;
  setField: (key: keyof Settings | string, value: any) => void;
  confirmHighRisk: (message: string) => boolean;
  pushAction: (action: string, status: ActionStatus, detail?: string) => void;
  pushLog: (entry: string) => void;
  toast: (title: string, tone?: Tone) => void;
};

function shouldConfirmLiveExecute(settings: Settings): boolean {
  return !settings.dryRun && (settings.intent === "destroy" || settings.energy[0] >= 0.85);
}

function canStartLoop(sessionState: SessionSnapshot | null): { ok: boolean; reason?: string } {
  if (sessionState?.state === "degraded" || sessionState?.state === "rollback") {
    return { ok: false, reason: "Cannot start a loop while session is degraded or rollback." };
  }
  return { ok: true };
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function useSpiralLoopConsoleActions(options: HookOptions) {
  const { api, settings, sessionState, dispatch, setField, confirmHighRisk, pushAction, pushLog, toast } = options;

  const refreshState = async () => {
    try {
      const data = await api.getSessionState(settings.sessionId);
      dispatch({ type: "setSession", session: data.session });
    } catch {
      // ignore
    }
  };

  const refreshEvents = async () => {
    try {
      const data = await api.getEvents(settings.sessionId);
      dispatch({ type: "setEvents", events: data.events || [] });
    } catch {
      // ignore
    }
  };

  const refreshLoopStatus = async () => {
    try {
      const data = await api.getLoopStatus(settings.sessionId, settings.userId);
      dispatch({ type: "setLoopStatus", loop: data.loop });
    } catch {
      // ignore
    }
  };

  const sendHeartbeat = async () => {
    try {
      await api.heartbeat(settings.sessionId, settings.userId);
      dispatch({ type: "setHeartbeatAt", value: new Date().toISOString() });
    } catch {
      // ignore
    }
  };

  const applyExecuteResult = (data: ExecuteResponse, okStatus: string) => {
    dispatch({ type: "setLastExecute", value: data });
    if (data.session) dispatch({ type: "setSession", session: data.session });
    if (data.decision) dispatch({ type: "setLastDecision", value: data.decision });
    if (data.score) dispatch({ type: "setLastScore", value: data.score });
    if (data.osc_push) dispatch({ type: "setLastOscPush", value: data.osc_push });
    if (data.midi_export) dispatch({ type: "setLastMidiExport", value: data.midi_export });
    if (data.autonomous_mutation) dispatch({ type: "setLastAutonomousMutation", value: data.autonomous_mutation });
    dispatch({ type: "setStatus", value: data.status === "blocked" ? "Policy blocked" : okStatus });
  };

  const refreshAll = async () => {
    await Promise.all([refreshState(), refreshEvents(), refreshLoopStatus()]);
  };

  const createSession = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("create session", "pending");
    try {
      const data = await api.createSession({
        user_id: settings.userId,
        session_id: settings.sessionId,
        prompt: settings.prompt,
        energy: Number(settings.energy[0].toFixed(2)),
        intent: settings.intent,
        biofeedback: settings.biofeedback,
        spiral_core: settings.spiralCore,
      });
      dispatch({ type: "setSession", session: data.session });
      dispatch({ type: "setStatus", value: `Session created: ${data.session.state}` });
      pushLog(`Created session ${settings.sessionId}.`);
      pushAction("create session", "success", settings.sessionId);
      toast("Session created", "default");
      await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to create session.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Create failed" });
      pushLog(`Create failed: ${msg}`);
      pushAction("create session", "failed", msg);
      toast("Create session failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const transitionSession = async (toState: SessionState, reason: string) => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction(`transition to ${toState}`, "pending");
    try {
      const data = await api.transitionSession({ user_id: settings.userId, session_id: settings.sessionId, to_state: toState, reason });
      dispatch({ type: "setSession", session: data.session });
      dispatch({ type: "setStatus", value: `Transitioned to ${data.session.state}` });
      pushLog(`Transitioned session to ${toState}.`);
      pushAction(`transition to ${toState}`, "success");
      toast(`Transitioned to ${toState}`, "default");
      if (settings.liveMode === "refresh") await refreshEvents();
    } catch (err) {
      const msg = getErrorMessage(err, "Transition failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Transition failed" });
      pushLog(`Transition failed: ${msg}`);
      pushAction(`transition to ${toState}`, "failed", msg);
      toast(`Transition failed: ${toState}`, "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const executeSession = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("execute session", "pending");
    if (shouldConfirmLiveExecute(settings) && !confirmHighRisk(`Run live execution with ${settings.intent} intent at energy ${settings.energy[0].toFixed(2)}?`)) {
      pushAction("execute session", "failed", "cancelled by operator");
      toast("Live execution cancelled", "warning");
      dispatch({ type: "setBusy", value: false });
      return;
    }
    try {
      const data = await api.executeSession({
        user_id: settings.userId,
        session_id: settings.sessionId,
        prompt: settings.prompt,
        energy: Number(settings.energy[0].toFixed(2)),
        intent: settings.intent,
        biofeedback: settings.biofeedback,
        spiral_core: settings.spiralCore,
        dry_run: settings.dryRun,
        osc_host: settings.oscHost,
        osc_port: Number(settings.oscPort),
        output_dir: "exports",
        section_name: settings.dryRun ? "v8_rehearsal" : "v8_live",
      });
      applyExecuteResult(data, settings.dryRun ? "Rehearsal executed" : "Performance executed");
      pushAction("execute session", data.status === "blocked" ? "failed" : "success", data.status);
      toast(data.status === "blocked" ? "Execution blocked" : "Execution complete", data.status === "blocked" ? "warning" : "default");
      if (settings.liveMode === "refresh") await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Execution failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Execute failed" });
      pushLog(`Execute failed: ${msg}`);
      pushAction("execute session", "failed", msg);
      toast("Execute failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const autonomousStep = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("autonomous step", "pending");
    try {
      const data = await api.autonomousStep({
        user_id: settings.userId,
        session_id: settings.sessionId,
        prompt: settings.prompt,
        energy: Number(settings.energy[0].toFixed(2)),
        intent: settings.intent,
        biofeedback: settings.biofeedback,
        spiral_core: settings.spiralCore,
        dry_run: settings.autonomousDryRun,
        osc_host: settings.oscHost,
        osc_port: Number(settings.oscPort),
        output_dir: "exports",
        base_section_name: settings.autonomousBaseSection,
      });
      applyExecuteResult(data, settings.autonomousDryRun ? "Autonomous rehearsal step executed" : "Autonomous live step executed");
      if (data.autonomous_mutation) {
        dispatch({ type: "setLastAutonomousMutation", value: data.autonomous_mutation });
        if (data.autonomous_mutation.next_intent) setField("intent", data.autonomous_mutation.next_intent);
        if (typeof data.autonomous_mutation.next_energy === "number") setField("energy", [data.autonomous_mutation.next_energy]);
        if (data.autonomous_mutation.spiral_core) setField("spiralCore", data.autonomous_mutation.spiral_core);
      }
      pushAction("autonomous step", data.status === "blocked" ? "failed" : "success", data.status);
      toast(data.status === "blocked" ? "Autonomous step blocked" : "Autonomous step complete", data.status === "blocked" ? "warning" : "default");
      if (settings.liveMode === "refresh") await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Autonomous step failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Autonomous step failed" });
      pushLog(`Autonomous step failed: ${msg}`);
      pushAction("autonomous step", "failed", msg);
      toast("Autonomous step failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const startLoop = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("start loop", "pending");
    const startGuard = canStartLoop(sessionState);
    if (!startGuard.ok) {
      dispatch({ type: "setError", value: startGuard.reason || "Loop start blocked." });
      pushAction("start loop", "failed", startGuard.reason || "blocked by guard");
      toast("Loop blocked in degraded state", "error");
      dispatch({ type: "setBusy", value: false });
      return;
    }
    const risky = !settings.autonomousDryRun || settings.intent === "destroy" || settings.energy[0] >= 0.85 || settings.loopMaxSteps >= 20;
    if (risky && !confirmHighRisk(`Start ${settings.autonomousDryRun ? "dry-run" : "live"} loop with ${settings.loopMaxSteps} steps at ${settings.loopIntervalSeconds}s intervals?`)) {
      pushAction("start loop", "failed", "cancelled by operator");
      toast("Loop start cancelled", "warning");
      dispatch({ type: "setBusy", value: false });
      return;
    }
    try {
      const data = await api.startLoop({
        user_id: settings.userId,
        session_id: settings.sessionId,
        prompt: settings.prompt,
        energy: Number(settings.energy[0].toFixed(2)),
        intent: settings.intent,
        biofeedback: settings.biofeedback,
        spiral_core: settings.spiralCore,
        dry_run: settings.autonomousDryRun,
        osc_host: settings.oscHost,
        osc_port: Number(settings.oscPort),
        output_dir: "exports",
        base_section_name: settings.autonomousBaseSection,
        interval_seconds: Number(settings.loopIntervalSeconds),
        max_steps: Number(settings.loopMaxSteps),
      });
      dispatch({ type: "setLoopStatus", loop: data.loop });
      dispatch({ type: "setStatus", value: "Autonomous loop started" });
      pushLog("Started backend autonomous loop.");
      pushAction("start loop", "success");
      toast("Autonomous loop started", "default");
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to start autonomous loop.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Loop start failed" });
      pushLog(`Loop start failed: ${msg}`);
      pushAction("start loop", "failed", msg);
      toast("Loop start failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const stopLoop = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("stop loop", "pending");
    try {
      const data = await api.stopLoop({ user_id: settings.userId, session_id: settings.sessionId, reason: "operator stop from cockpit" });
      dispatch({ type: "setLoopStatus", loop: data.loop });
      dispatch({ type: "setStatus", value: "Autonomous loop stop requested" });
      pushLog("Requested backend loop stop.");
      pushAction("stop loop", "success");
      toast("Loop stop requested", "warning");
    } catch (err) {
      const msg = getErrorMessage(err, "Failed to stop autonomous loop.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Loop stop failed" });
      pushLog(`Loop stop failed: ${msg}`);
      pushAction("stop loop", "failed", msg);
      toast("Loop stop failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const rollbackSession = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("rollback session", "pending");
    if (!confirmHighRisk("Trigger rollback to latest safe snapshot?")) {
      pushAction("rollback session", "failed", "cancelled by operator");
      toast("Rollback cancelled", "warning");
      dispatch({ type: "setBusy", value: false });
      return;
    }
    try {
      const data = await api.rollback({ user_id: settings.userId, session_id: settings.sessionId, reason: "operator rollback from cockpit" });
      dispatch({ type: "setSession", session: data.session });
      dispatch({ type: "setStatus", value: "Rollback complete" });
      pushLog("Rolled back to latest safe snapshot.");
      pushAction("rollback session", "success");
      toast("Rollback complete", "warning");
      if (settings.liveMode === "refresh") await Promise.all([refreshEvents(), refreshLoopStatus()]);
    } catch (err) {
      const msg = getErrorMessage(err, "Rollback failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Rollback failed" });
      pushLog(`Rollback failed: ${msg}`);
      pushAction("rollback session", "failed", msg);
      toast("Rollback failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const spiralRequestPayload = () => ({
    user_id: settings.userId,
    session_id: settings.sessionId,
    prompt: settings.prompt,
    energy: Number(settings.energy[0].toFixed(2)),
    intent: settings.intent,
    biofeedback: settings.biofeedback,
    spiral_core: settings.spiralCore,
    dry_run: settings.dryRun,
    max_spirals: Number(settings.spiralMaxSpirals),
    confidence_target: Number(settings.spiralConfidenceTarget),
    novelty_threshold: Number(settings.spiralNoveltyThreshold),
    section_prefix: settings.dryRun ? "spiral_rehearsal" : "spiral_live",
  });

  const applySpiralResult = (data: SpiralResponse, statusLabel: string) => {
    dispatch({ type: "setSpiralResult", value: data });
    dispatch({ type: "setStatus", value: statusLabel });
    if (data.final_execution) {
      applyExecuteResult(data.final_execution, statusLabel);
    }
  };

  const runSpiral = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("run spiral", "pending");
    try {
      const data = await api.runSpiral(spiralRequestPayload());
      applySpiralResult(data, `Spiral: ${data?.spiral?.stop_reason || "complete"}`);
      pushAction("run spiral", "success", data?.spiral?.stop_reason || "ok");
      toast("Spiral run complete", "default");
      if (settings.liveMode === "refresh") await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Spiral run failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Spiral failed" });
      pushLog(`Spiral failed: ${msg}`);
      pushAction("run spiral", "failed", msg);
      toast("Spiral run failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const runSpiralWithHumanGate = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("run spiral + human gate", "pending");
    try {
      const decision: HumanGateDecision = {
        approved: settings.gate1Approved,
        reviewer: settings.gate1Reviewer,
        reason: settings.gate1Reason,
      };
      const data = await api.runSpiralWithHumanGate({ request: spiralRequestPayload(), decision });
      applySpiralResult(data, `Spiral+Gate: ${data?.human_gate?.status || "complete"}`);
      pushAction("run spiral + human gate", "success", data?.human_gate?.status || "ok");
      toast("Spiral + human gate complete", "default");
      if (settings.liveMode === "refresh") await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Spiral + human gate failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Spiral + gate failed" });
      pushLog(`Spiral + gate failed: ${msg}`);
      pushAction("run spiral + human gate", "failed", msg);
      toast("Spiral + gate failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  const runSpiralWithTwoPersonGate = async () => {
    dispatch({ type: "setBusy", value: true });
    dispatch({ type: "setError", value: "" });
    pushAction("run spiral + two-person gate", "pending");
    try {
      const data = await api.runSpiralWithTwoPersonGate({
        request: spiralRequestPayload(),
        decisions: {
          first: {
            approved: settings.gate1Approved,
            reviewer: settings.gate1Reviewer,
            reason: settings.gate1Reason,
          },
          second: {
            approved: settings.gate2Approved,
            reviewer: settings.gate2Reviewer,
            reason: settings.gate2Reason,
          },
        },
      });
      applySpiralResult(data, `Spiral+2P Gate: ${data?.human_gate?.status || "complete"}`);
      pushAction("run spiral + two-person gate", "success", data?.human_gate?.status || "ok");
      toast("Spiral + two-person gate complete", "default");
      if (settings.liveMode === "refresh") await refreshAll();
    } catch (err) {
      const msg = getErrorMessage(err, "Spiral + two-person gate failed.");
      dispatch({ type: "setError", value: msg });
      dispatch({ type: "setStatus", value: "Spiral + 2P gate failed" });
      pushLog(`Spiral + 2P gate failed: ${msg}`);
      pushAction("run spiral + two-person gate", "failed", msg);
      toast("Spiral + 2P gate failed", "error");
    } finally {
      dispatch({ type: "setBusy", value: false });
    }
  };

  return {
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
  };
}
