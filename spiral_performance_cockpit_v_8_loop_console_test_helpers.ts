import { vi } from "vitest";

type MockSessionState = "degraded" | "rollback" | "autonomous" | "performing";

export type FetchMockOptions = {
  sessionState?: MockSessionState;
  sessionEnergy?: number;
  sessionIntent?: string;
  loopRunning?: boolean;
  failStartLoop?: boolean;
  failStopLoop?: boolean;
};

export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: ((ev: Event) => any) | null = null;
  onmessage: ((ev: MessageEvent) => any) | null = null;
  onclose: ((ev: CloseEvent) => any) | null = null;
  onerror: ((ev: Event) => any) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(new Event("open")), 0);
  }

  close() {
    this.onclose?.({} as CloseEvent);
  }

  send() {
    // noop
  }

  emitJson(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function makeSession(state: MockSessionState, energy = 0.5, intent = "transform") {
  return {
    snapshot_id: "snap-1",
    session_id: "session-v8-001",
    user_id: "jon",
    state,
    prompt: "test",
    energy,
    intent,
    biofeedback: {
      heart_rate: 88,
      breath_rate: 15,
      voice_intensity: 0.62,
      emotional_tone: "focused",
      source: "manual",
    },
    spiral_core: {
      radius: 0.58,
      angle: 180,
      angular_velocity: 0.62,
      expansion: 0.55,
      coherence: 0.7,
    },
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

export function installFetchMocks(options?: FetchMockOptions) {
  const sessionState = options?.sessionState ?? "autonomous";
  const sessionEnergy = options?.sessionEnergy ?? 0.5;
  const sessionIntent = options?.sessionIntent ?? "transform";
  const loopRunning = options?.loopRunning ?? false;
  const failStartLoop = options?.failStartLoop ?? false;
  const failStopLoop = options?.failStopLoop ?? false;

  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("/autonomous-loop/status")) {
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          loop: {
            session_id: "session-v8-001",
            user_id: "jon",
            is_running: loopRunning,
            current_step: loopRunning ? 2 : 0,
            max_steps: 12,
            interval_seconds: 8,
            last_error: null,
            last_result: null,
            started_at: null,
            stopped_at: null,
          },
        }),
      } as Response;
    }

    if (url.includes("/state")) {
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          session: makeSession(sessionState, sessionEnergy, sessionIntent),
        }),
      } as Response;
    }

    if (url.includes("/events")) {
      return {
        ok: true,
        json: async () => ({ status: "ok", events: [] }),
      } as Response;
    }

    if (url.includes("/heartbeat")) {
      return {
        ok: true,
        json: async () => ({ status: "ok" }),
      } as Response;
    }

    if (url.includes("/autonomous-loop/start")) {
      if (failStartLoop) {
        return {
          ok: false,
          json: async () => ({ detail: "loop start failed" }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          loop: {
            session_id: "session-v8-001",
            user_id: "jon",
            is_running: true,
            current_step: 0,
            max_steps: 12,
            interval_seconds: 8,
          },
        }),
      } as Response;
    }

    if (url.includes("/autonomous-loop/stop")) {
      if (failStopLoop) {
        return {
          ok: false,
          json: async () => ({ detail: "loop stop failed" }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          loop: {
            session_id: "session-v8-001",
            user_id: "jon",
            is_running: false,
            current_step: loopRunning ? 2 : 0,
            max_steps: 12,
            interval_seconds: 8,
            last_error: null,
            last_result: null,
            started_at: "2026-01-01T00:00:00.000Z",
            stopped_at: "2026-01-01T00:00:30.000Z",
          },
        }),
      } as Response;
    }

    if (url.includes("/rollback")) {
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          session: makeSession("rollback", sessionEnergy, sessionIntent),
        }),
      } as Response;
    }

    if (url.includes("/execute")) {
      return {
        ok: true,
        json: async () => ({
          status: "ok",
          session: makeSession("performing", sessionEnergy, sessionIntent),
          score: {
            coherence: 0.8,
            execution_success: 1,
            biofeedback_alignment: 0.7,
            memory_match: 0.6,
            intent_fidelity: 0.9,
            reward: 0.8,
          },
        }),
      } as Response;
    }

    return {
      ok: true,
      json: async () => ({ status: "ok" }),
    } as Response;
  }) as any;
}

export function resetMockWebSocket() {
  MockWebSocket.instances = [];
}
