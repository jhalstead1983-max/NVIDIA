import { describe, expect, it } from "vitest";
import {
  appendAuditEvent,
  buildSpiralSignature,
  createSpiralApiServer,
  getAuditEvents,
  getProviderCircuitSnapshot,
  loadAuditEventsFromDisk,
  makeResearchManager,
  resetProviderCircuitState,
  searchWithProvider,
  searchWithProviderFailover,
} from "./spiral_private_api.js";

describe("spiral private api signature", () => {
  it("produces a stable HMAC signature for the same input", () => {
    const first = buildSpiralSignature({
      secret: "top_secret",
      method: "POST",
      path: "/v1/spiral/execute",
      timestamp: "1742812345678",
      nonce: "nonce-1",
      body: JSON.stringify({ session: "alpha", prompt: "test" }),
    });

    const second = buildSpiralSignature({
      secret: "top_secret",
      method: "POST",
      path: "/v1/spiral/execute",
      timestamp: "1742812345678",
      nonce: "nonce-1",
      body: JSON.stringify({ session: "alpha", prompt: "test" }),
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when body changes", () => {
    const one = buildSpiralSignature({
      secret: "top_secret",
      method: "POST",
      path: "/v1/spiral/execute",
      timestamp: "1742812345678",
      nonce: "nonce-1",
      body: JSON.stringify({ value: 1 }),
    });
    const two = buildSpiralSignature({
      secret: "top_secret",
      method: "POST",
      path: "/v1/spiral/execute",
      timestamp: "1742812345678",
      nonce: "nonce-1",
      body: JSON.stringify({ value: 2 }),
    });

    expect(one).not.toBe(two);
  });
});

describe("spiral private api routes", () => {
  it("publishes at least 30 routes", async () => {
    process.env.SPIRAL_API_KEYS = "owner:test_secret";
    const server = createSpiralApiServer();

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to bind test server");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/spiral/routes`);
    const payload = await response.json();
    server.close();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.count).toBeGreaterThanOrEqual(30);
    expect(Array.isArray(payload.routes)).toBe(true);
  });
});

describe("spiral research manager", () => {
  it("can launch and complete a simple research job", async () => {
    const manager = makeResearchManager();
    const launched = manager.run({ query: "", seed_urls: [], max_steps: 1 });
    expect(launched.job_id).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const job = manager.status(launched.job_id);
    expect(job).toBeTruthy();
    expect(["queued", "running", "completed"]).toContain(job.status);
  });

  it("can request stop for a running/queued job", () => {
    const manager = makeResearchManager();
    const launched = manager.run({ query: "", seed_urls: [], max_steps: 1 });
    const stopped = manager.stop(launched.job_id);
    expect(stopped).toBeTruthy();
    expect(stopped.cancel_requested).toBe(true);
  });
});

describe("spiral search providers", () => {
  it("uses Tavily adapter format", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER = "tavily";
    process.env.TAVILY_API_KEY = "tavily_test";
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        async json() {
          return { results: [{ url: "https://example.com/a" }] };
        },
      };
    };
    const results = await searchWithProvider({ query: "spiral ai", maxResults: 3, fetchImpl });
    expect(seen[0].url).toBe("https://api.tavily.com/search");
    expect(results).toEqual(["https://example.com/a"]);
  });

  it("falls back to wikipedia provider", async () => {
    delete process.env.SPIRAL_SEARCH_PROVIDER;
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return ["q", [], [], ["https://en.wikipedia.org/wiki/Spiral"]];
      },
    });
    const results = await searchWithProvider({ query: "spiral", maxResults: 2, fetchImpl });
    expect(results).toEqual(["https://en.wikipedia.org/wiki/Spiral"]);
  });

  it("uses provider chain failover and succeeds on later provider", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER_CHAIN = "brave,tavily,wikipedia";
    delete process.env.BRAVE_SEARCH_API_KEY;
    process.env.TAVILY_API_KEY = "tavily_key";

    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(String(url));
      if (String(url).includes("api.tavily.com")) {
        return {
          ok: true,
          async json() {
            return { results: [{ url: "https://example.com/failover-success" }] };
          },
        };
      }
      return { ok: false, async json() { return {}; } };
    };

    const outcome = await searchWithProviderFailover({ query: "spiral test", maxResults: 3, fetchImpl });
    expect(outcome.provider).toBe("tavily");
    expect(outcome.urls).toEqual(["https://example.com/failover-success"]);
    expect(seen.some((v) => v.includes("api.tavily.com"))).toBe(true);
  });

  it("retries provider calls before failing over", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER_CHAIN = "wikipedia,tavily";
    process.env.SPIRAL_SEARCH_RETRY_COUNT = "2";
    process.env.SPIRAL_SEARCH_BACKOFF_MS = "1";
    process.env.TAVILY_API_KEY = "tavily_key";

    let wikiCalls = 0;
    const slept = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.includes("wikipedia.org")) {
        wikiCalls += 1;
        throw new Error("transient network");
      }
      if (value.includes("api.tavily.com")) {
        return {
          ok: true,
          async json() {
            return { results: [{ url: "https://example.com/from-tavily" }] };
          },
        };
      }
      return { ok: false, async json() { return {}; } };
    };
    const sleepImpl = async (ms) => {
      slept.push(ms);
    };

    const outcome = await searchWithProviderFailover({ query: "retry test", maxResults: 2, fetchImpl, sleepImpl });
    expect(wikiCalls).toBe(3);
    expect(outcome.provider).toBe("tavily");
    expect(outcome.urls).toEqual(["https://example.com/from-tavily"]);
    expect(slept.length).toBeGreaterThanOrEqual(2);
  });

  it("opens circuit after repeated provider exceptions", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER_CHAIN = "wikipedia,tavily";
    process.env.SPIRAL_SEARCH_RETRY_COUNT = "0";
    process.env.SPIRAL_SEARCH_BREAKER_FAILURE_THRESHOLD = "1";
    process.env.SPIRAL_SEARCH_BREAKER_COOLDOWN_MS = "60000";
    process.env.TAVILY_API_KEY = "tavily_key";

    let now = 1000;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.includes("wikipedia.org")) throw new Error("provider down");
      if (value.includes("api.tavily.com")) {
        return {
          ok: true,
          async json() {
            return { results: [{ url: "https://example.com/tavily-ok" }] };
          },
        };
      }
      return { ok: false, async json() { return {}; } };
    };

    const first = await searchWithProviderFailover({
      query: "breaker first",
      maxResults: 2,
      fetchImpl,
      nowFn: () => now,
    });
    expect(first.provider).toBe("tavily");

    const second = await searchWithProviderFailover({
      query: "breaker second",
      maxResults: 2,
      fetchImpl,
      nowFn: () => now + 10,
    });
    expect(second.provider).toBe("tavily");
    expect(second.errors.some((e) => e.provider === "wikipedia" && e.reason === "circuit_open")).toBe(true);
  });

  it("exposes provider circuit state snapshot", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER_CHAIN = "wikipedia,tavily";
    const snapshot = getProviderCircuitSnapshot();
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot.some((item) => item.provider === "wikipedia")).toBe(true);
    expect(snapshot.some((item) => item.provider === "tavily")).toBe(true);
  });

  it("can reset provider circuit state", async () => {
    process.env.SPIRAL_SEARCH_PROVIDER_CHAIN = "wikipedia,tavily";
    process.env.SPIRAL_SEARCH_RETRY_COUNT = "0";
    process.env.SPIRAL_SEARCH_BREAKER_FAILURE_THRESHOLD = "1";
    process.env.SPIRAL_SEARCH_BREAKER_COOLDOWN_MS = "60000";
    process.env.TAVILY_API_KEY = "tavily_key";

    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.includes("wikipedia.org")) throw new Error("provider down");
      if (value.includes("api.tavily.com")) {
        return {
          ok: true,
          async json() {
            return { results: [{ url: "https://example.com/tavily-ok" }] };
          },
        };
      }
      return { ok: false, async json() { return {}; } };
    };

    await searchWithProviderFailover({
      query: "breaker reset seed",
      maxResults: 2,
      fetchImpl,
      nowFn: () => 1000,
    });

    const before = getProviderCircuitSnapshot(1001);
    const beforeWiki = before.find((p) => p.provider === "wikipedia");
    expect(beforeWiki?.circuit_open).toBe(true);

    const reset = resetProviderCircuitState("wikipedia");
    expect(reset.reset).toBe("wikipedia");

    const after = getProviderCircuitSnapshot(1001);
    const afterWiki = after.find((p) => p.provider === "wikipedia");
    expect(afterWiki?.circuit_open).toBe(false);
    expect(afterWiki?.failures).toBe(0);
  });
});

describe("admin audit log", () => {
  it("stores and returns newest events first", () => {
    appendAuditEvent({ action: "test.audit.one", route: "/test/one" });
    appendAuditEvent({ action: "test.audit.two", route: "/test/two" });
    const events = getAuditEvents(2);
    expect(events.length).toBe(2);
    expect(events[0].action).toBe("test.audit.two");
    expect(events[1].action).toBe("test.audit.one");
    expect(events[0].id).toBeTruthy();
  });

  it("loads persisted events from disk when available", () => {
    const loaded = loadAuditEventsFromDisk();
    expect(typeof loaded).toBe("number");
    expect(loaded).toBeGreaterThanOrEqual(0);
  });
});
