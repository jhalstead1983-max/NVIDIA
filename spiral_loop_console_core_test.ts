import { describe, expect, it } from "vitest";
import {
  buildInitialState,
  canStartLoop,
  defaultSettings,
  reducer,
  shouldConfirmLiveExecute,
  type IntentMode,
} from "./spiral-loop-console-core";

describe("loop console reducer (real)", () => {
  it("patches settings safely", () => {
    const state = buildInitialState();
    const next = reducer(state, { type: "patchSettings", patch: { sessionId: "abc-123", liveMode: "refresh" } });
    expect(next.settings.sessionId).toBe("abc-123");
    expect(next.settings.liveMode).toBe("refresh");
    expect(next.settings.userId).toBe(state.settings.userId);
  });

  it("records action history entries", () => {
    const state = buildInitialState();
    const next = reducer(state, { type: "pushAction", action: "start loop", status: "success", detail: "ok" });
    expect(next.actionHistory.length).toBeGreaterThan(0);
    expect(next.actionHistory[0].action).toBe("start loop");
    expect(next.actionHistory[0].status).toBe("success");
  });

  it("marks websocket stale", () => {
    const state = buildInitialState();
    const next = reducer(state, { type: "setWsStale", value: true });
    expect(next.isWsStale).toBe(true);
  });

  it("stores loop status updates", () => {
    const state = buildInitialState();
    const next = reducer(state, {
      type: "setLoopStatus",
      loop: {
        session_id: "s1",
        user_id: "u1",
        is_running: true,
        current_step: 3,
        max_steps: 12,
        interval_seconds: 8,
      },
    });
    expect(next.loopStatus?.is_running).toBe(true);
    expect(next.loopStatus?.current_step).toBe(3);
  });

  it("adds toast notifications", () => {
    const state = buildInitialState();
    const next = reducer(state, { type: "toast", title: "Loop started", tone: "default" });
    expect(next.toasts.length).toBeGreaterThan(0);
    expect(next.toasts[0].title).toBe("Loop started");
  });
});

describe("risky confirmations (real)", () => {
  it("requires confirmation for high-energy live run", () => {
    const settings = { ...defaultSettings, dryRun: false, energy: [0.9], intent: "transform" as IntentMode };
    expect(shouldConfirmLiveExecute(settings)).toBe(true);
  });

  it("requires confirmation for destroy live run even at lower energy", () => {
    const settings = { ...defaultSettings, dryRun: false, energy: [0.4], intent: "destroy" as IntentMode };
    expect(shouldConfirmLiveExecute(settings)).toBe(true);
  });

  it("does not require confirmation for dry run", () => {
    const settings = { ...defaultSettings, dryRun: true, energy: [0.95], intent: "destroy" as IntentMode };
    expect(shouldConfirmLiveExecute(settings)).toBe(false);
  });
});

describe("degraded-state guards (real)", () => {
  it("blocks loop start when session is degraded", () => {
    const state = buildInitialState();
    state.sessionState = {
      snapshot_id: "snap-1",
      session_id: "s1",
      user_id: "u1",
      state: "degraded",
      prompt: "test",
      energy: 0.4,
      intent: "transform",
      biofeedback: defaultSettings.biofeedback,
      spiral_core: defaultSettings.spiralCore,
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const result = canStartLoop(state.sessionState);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("degraded");
  });

  it("blocks loop start when session is rollback", () => {
    const state = buildInitialState();
    state.sessionState = {
      snapshot_id: "snap-2",
      session_id: "s1",
      user_id: "u1",
      state: "rollback",
      prompt: "test",
      energy: 0.4,
      intent: "transform",
      biofeedback: defaultSettings.biofeedback,
      spiral_core: defaultSettings.spiralCore,
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const result = canStartLoop(state.sessionState);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("rollback");
  });

  it("allows loop start in healthy state", () => {
    const state = buildInitialState();
    state.sessionState = {
      snapshot_id: "snap-3",
      session_id: "s1",
      user_id: "u1",
      state: "autonomous",
      prompt: "test",
      energy: 0.4,
      intent: "transform",
      biofeedback: defaultSettings.biofeedback,
      spiral_core: defaultSettings.spiralCore,
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const result = canStartLoop(state.sessionState);
    expect(result.ok).toBe(true);
  });
});
