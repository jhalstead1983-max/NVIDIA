// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import SpiralPerformanceCockpitV8LoopConsole from "./SpiralPerformanceCockpitV8LoopConsole";
import { MockWebSocket, installFetchMocks, resetMockWebSocket } from "./spiral_performance_cockpit_v_8_loop_console_test_helpers";

const originalFetch = global.fetch;
const originalConfirm = window.confirm;
const originalWebSocket = global.WebSocket;

describe("SpiralPerformanceCockpitV8LoopConsole UI", () => {
  beforeEach(() => {
    installFetchMocks();
    window.confirm = vi.fn(() => true);
    global.WebSocket = MockWebSocket as any;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
    global.WebSocket = originalWebSocket;
    resetMockWebSocket();
  });

  it("blocks Start Loop properly when the session is degraded", async () => {
    installFetchMocks({ sessionState: "degraded" });
    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByText(/degraded or rollback state/i)).toBeInTheDocument();
    });

    const startLoopButton = screen.getByRole("button", { name: /start loop/i });
    fireEvent.click(startLoopButton);

    await waitFor(() => {
      expect(screen.getByText(/cannot start a loop while session is degraded or rollback/i)).toBeInTheDocument();
    });

    const urls = (global.fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((url: string) => url.includes("/v8/session/autonomous-loop/start"))).toBe(false);
  });

  it("asks for confirmation before risky loop start", async () => {
    installFetchMocks({ sessionState: "autonomous", sessionEnergy: 0.9, sessionIntent: "destroy" });
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy;

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeInTheDocument();
    });

    const startLoopButton = screen.getByRole("button", { name: /start loop/i });
    fireEvent.click(startLoopButton);

    expect(confirmSpy).toHaveBeenCalled();

    const urls = (global.fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((url: string) => url.includes("/v8/session/autonomous-loop/start"))).toBe(false);

    await waitFor(() => {
      expect(screen.getByText(/loop start cancelled/i)).toBeInTheDocument();
    });
  });

  it("asks for confirmation before rollback and cancels properly", async () => {
    installFetchMocks({ sessionState: "autonomous" });
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy;

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /rollback/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /rollback/i }));

    expect(confirmSpy).toHaveBeenCalled();
    const urls = (global.fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((url: string) => url.includes("/v8/session/rollback"))).toBe(false);

    await waitFor(() => {
      expect(screen.getByText(/rollback cancelled/i)).toBeInTheDocument();
    });
  });

  it("starts the autonomous loop successfully and updates the UI", async () => {
    installFetchMocks({ sessionState: "autonomous", sessionEnergy: 0.5, sessionIntent: "transform" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /start loop/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });

    const startLoopCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/autonomous-loop/start"),
    );

    expect(startLoopCall).toBeTruthy();

    const requestBody = JSON.parse(String(startLoopCall[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      user_id: "jon",
      session_id: "session-v8-001",
      intent: "transform",
      dry_run: true,
      interval_seconds: 8,
      max_steps: 12,
    });

    expect(screen.getAllByText(/autonomous loop started/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
  });

  it("shows an error and recovers controls when loop start fails", async () => {
    installFetchMocks({ sessionState: "autonomous", failStartLoop: true });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /start loop/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/loop start failed/i).length).toBeGreaterThan(0);
    });

    const startLoopCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/autonomous-loop/start"),
    );

    expect(startLoopCall).toBeTruthy();
    expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /stop loop/i })).toBeDisabled();
  });

  it("applies websocket loop lifecycle events to the UI", async () => {
    installFetchMocks({ sessionState: "autonomous" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(socket).toBeTruthy();

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.started",
        event_id: "evt-loop-started",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:00:10.000Z",
        payload: {
          max_steps: 12,
          interval_seconds: 8,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
      expect(screen.getAllByText(/step 0\/12/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/loop running/i).length).toBeGreaterThan(0);
    });

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.tick",
        event_id: "evt-loop-tick",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:00:18.000Z",
        payload: {
          step: 3,
          max_steps: 12,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/step 3\/12/i).length).toBeGreaterThan(0);
    });

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.stopped",
        event_id: "evt-loop-stopped",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:00:26.000Z",
        payload: {
          current_step: 3,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeDisabled();
      expect(screen.getAllByText(/autonomous loop stopped/i).length).toBeGreaterThan(0);
    });
  });

  it("shows a stopping state when websocket stop_requested arrives", async () => {
    installFetchMocks({ sessionState: "autonomous" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(socket).toBeTruthy();

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.started",
        event_id: "evt-loop-started-stopping",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:01:00.000Z",
        payload: {
          max_steps: 12,
          interval_seconds: 8,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.stop_requested",
        event_id: "evt-loop-stop-requested",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:01:05.000Z",
        payload: {},
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/autonomous loop stopping/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });
  });

  it("shows websocket loop errors and preserves the last loop error detail", async () => {
    installFetchMocks({ sessionState: "autonomous" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(socket).toBeTruthy();

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.started",
        event_id: "evt-loop-started-error",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:02:00.000Z",
        payload: {
          max_steps: 12,
          interval_seconds: 8,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });

    await act(async () => {
      socket.emitJson({
        type: "autonomous.loop.error",
        event_id: "evt-loop-error",
        session_id: "session-v8-001",
        user_id: "jon",
        created_at: "2026-01-01T00:02:08.000Z",
        payload: {
          error: "fatal drift threshold exceeded",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/autonomous loop error/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/fatal drift threshold exceeded/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });
  });

  it("reconnects the websocket after a disconnect", async () => {
    installFetchMocks({ sessionState: "autonomous" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(1);
      expect(screen.getByText(/ws live/i)).toBeInTheDocument();
      expect(screen.getByText(/stable/i)).toBeInTheDocument();
    });

    const firstSocket = MockWebSocket.instances[0];
    expect(firstSocket).toBeTruthy();

    await act(async () => {
      firstSocket.close();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/ws offline/i)).toBeInTheDocument();
      expect(screen.getByText(/reconnecting 1/i)).toBeInTheDocument();
      expect(screen.getAllByText(/realtime disconnected/i).length).toBeGreaterThan(0);
    });

    expect(MockWebSocket.instances.length).toBe(1);

    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBe(2);
      expect(screen.getByText(/ws live/i)).toBeInTheDocument();
      expect(screen.getByText(/stable/i)).toBeInTheDocument();
      expect(screen.getAllByText(/realtime connected/i).length).toBeGreaterThan(0);
    }, { timeout: 4000 });
  });

  it("stops the autonomous loop successfully and updates the UI", async () => {
    installFetchMocks({ sessionState: "autonomous", loopRunning: true });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /stop loop/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start loop/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeDisabled();
      expect(screen.getAllByText(/loop stop requested/i).length).toBeGreaterThan(0);
    });

    const stopLoopCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/autonomous-loop/stop"),
    );

    expect(stopLoopCall).toBeTruthy();

    const requestBody = JSON.parse(String(stopLoopCall[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      user_id: "jon",
      session_id: "session-v8-001",
      reason: "operator stop from cockpit",
    });
  });

  it("shows an error and keeps loop controls active when stop loop fails", async () => {
    installFetchMocks({ sessionState: "autonomous", loopRunning: true, failStopLoop: true });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /stop loop/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/loop stop failed/i).length).toBeGreaterThan(0);
    });

    const stopLoopCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/autonomous-loop/stop"),
    );

    expect(stopLoopCall).toBeTruthy();
    expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
  });

  it("executes the session successfully and updates the UI", async () => {
    installFetchMocks({ sessionState: "autonomous", sessionEnergy: 0.5, sessionIntent: "transform" });

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /execute session/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /execute session/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/rehearsal executed/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/execution complete/i).length).toBeGreaterThan(0);
    });

    const executeCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/execute"),
    );

    expect(executeCall).toBeTruthy();

    const requestBody = JSON.parse(String(executeCall[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      user_id: "jon",
      session_id: "session-v8-001",
      intent: "transform",
      dry_run: true,
      section_name: "v8_rehearsal",
      output_dir: "exports",
    });

    expect(screen.getByRole("button", { name: /execute session/i })).toBeEnabled();
  });

  it("rolls back the session successfully and updates the UI", async () => {
    installFetchMocks({ sessionState: "autonomous" });
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /rollback/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /rollback/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/rollback complete/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/backend session is in a degraded or rollback state/i)).toBeInTheDocument();
    });

    expect(confirmSpy).toHaveBeenCalled();

    const rollbackCall = (global.fetch as any).mock.calls.find((call: any[]) =>
      String(call[0]).includes("/v8/session/rollback"),
    );

    expect(rollbackCall).toBeTruthy();

    const requestBody = JSON.parse(String(rollbackCall[1]?.body ?? "{}"));
    expect(requestBody).toMatchObject({
      user_id: "jon",
      session_id: "session-v8-001",
      reason: "operator rollback from cockpit",
    });
  });

  it("asks for confirmation before risky live execute and cancels properly", async () => {
    installFetchMocks({ sessionState: "autonomous", sessionEnergy: 0.92, sessionIntent: "destroy" });
    const confirmSpy = vi.fn(() => false);
    window.confirm = confirmSpy;

    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /^dry run$/i })).toBeInTheDocument();
    });

    const dryRunSwitch = screen.getByRole("switch", { name: /^dry run$/i });
    fireEvent.click(dryRunSwitch);

    const executeButton = screen.getByRole("button", { name: /execute session/i });
    fireEvent.click(executeButton);

    expect(confirmSpy).toHaveBeenCalled();
    const urls = (global.fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((url: string) => url.includes("/v8/session/execute"))).toBe(false);

    await waitFor(() => {
      expect(screen.getByText(/live execution cancelled/i)).toBeInTheDocument();
    });
  });

  it("disables conflicting controls while loop is running", async () => {
    installFetchMocks({ sessionState: "autonomous", loopRunning: true });
    render(<SpiralPerformanceCockpitV8LoopConsole />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop loop/i })).toBeEnabled();
    });

    expect(screen.getByRole("button", { name: /execute session/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /run autonomous step/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rehearse/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /perform/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^autonomous$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /rollback/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /start loop/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /stop loop/i })).not.toBeDisabled();
  });
});
