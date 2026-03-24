import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_PER_WINDOW = Number.parseInt(process.env.SPIRAL_RATE_LIMIT_PER_MIN ?? "60", 10);
const DEFAULT_RESEARCH_MAX_STEPS = Number.parseInt(process.env.SPIRAL_RESEARCH_MAX_STEPS ?? "5", 10);
const DEFAULT_RESEARCH_TIMEOUT_MS = Number.parseInt(process.env.SPIRAL_RESEARCH_TIMEOUT_MS ?? "30000", 10);

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeIp(rawIp) {
  if (!rawIp) return "";
  return rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedValue && forwardedValue.length > 0) {
    return normalizeIp(forwardedValue.split(",")[0].trim());
  }
  return normalizeIp(req.socket.remoteAddress);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function parseAllowedIps() {
  const raw = process.env.SPIRAL_ALLOWED_IPS ?? "";
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

function parseApiKeys() {
  // Format: "key_id_1:secret_1,key_id_2:secret_2"
  const raw = process.env.SPIRAL_API_KEYS ?? "";
  const out = new Map();
  for (const pair of raw.split(",")) {
    const item = pair.trim();
    if (!item) continue;
    const idx = item.indexOf(":");
    if (idx <= 0 || idx === item.length - 1) continue;
    const id = item.slice(0, idx).trim();
    const secret = item.slice(idx + 1).trim();
    if (id && secret) out.set(id, secret);
  }
  return out;
}

function signatureBase({ method, path, timestamp, nonce, body }) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${sha256Hex(body)}`;
}

function computeSignature(secret, parts) {
  return createHmac("sha256", secret).update(signatureBase(parts)).digest("hex");
}

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function shouldAllowIp(allowedIps, clientIp) {
  if (allowedIps.size === 0) return true;
  return allowedIps.has(clientIp);
}

function makeNonceStore() {
  const used = new Map();
  return {
    has(key) {
      const exp = used.get(key);
      if (!exp) return false;
      if (Date.now() > exp) {
        used.delete(key);
        return false;
      }
      return true;
    },
    add(key) {
      used.set(key, Date.now() + NONCE_TTL_MS);
    },
    sweep() {
      const now = Date.now();
      for (const [k, exp] of used.entries()) {
        if (exp <= now) used.delete(k);
      }
    },
  };
}

function makeRateLimiter() {
  const counters = new Map();
  return {
    consume(ip) {
      const now = Date.now();
      const current = counters.get(ip);
      if (!current || now - current.windowStart >= RATE_WINDOW_MS) {
        counters.set(ip, { windowStart: now, count: 1 });
        return true;
      }
      if (current.count >= RATE_LIMIT_PER_WINDOW) return false;
      current.count += 1;
      return true;
    },
  };
}

async function readBody(req) {
  const chunks = [];
  let seen = 0;
  for await (const chunk of req) {
    seen += chunk.length;
    if (seen > MAX_BODY_BYTES) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runSpiralIntelligence(input) {
  // Replace this with your real private Spiral intelligence pipeline.
  return {
    trace_id: randomUUID(),
    decision: "hold",
    confidence: 0.91,
    input_echo: input,
    processed_at: new Date().toISOString(),
  };
}

const ROUTES = [
  { method: "POST", path: "/v1/spiral/execute" },
  { method: "POST", path: "/v1/spiral/session/create" },
  { method: "POST", path: "/v1/spiral/session/update" },
  { method: "POST", path: "/v1/spiral/session/archive" },
  { method: "POST", path: "/v1/spiral/session/resume" },
  { method: "GET", path: "/v1/spiral/session/status" },
  { method: "GET", path: "/v1/spiral/session/snapshot" },
  { method: "GET", path: "/v1/spiral/session/events" },
  { method: "POST", path: "/v1/spiral/loop/start" },
  { method: "POST", path: "/v1/spiral/loop/stop" },
  { method: "POST", path: "/v1/spiral/loop/tick" },
  { method: "GET", path: "/v1/spiral/loop/status" },
  { method: "POST", path: "/v1/spiral/loop/configure" },
  { method: "POST", path: "/v1/spiral/loop/reset" },
  { method: "POST", path: "/v1/spiral/score/calculate" },
  { method: "GET", path: "/v1/spiral/score/latest" },
  { method: "GET", path: "/v1/spiral/score/history" },
  { method: "POST", path: "/v1/spiral/decision/make" },
  { method: "GET", path: "/v1/spiral/decision/latest" },
  { method: "POST", path: "/v1/spiral/memory/write" },
  { method: "POST", path: "/v1/spiral/memory/read" },
  { method: "POST", path: "/v1/spiral/memory/search" },
  { method: "POST", path: "/v1/spiral/memory/prune" },
  { method: "POST", path: "/v1/spiral/mutation/apply" },
  { method: "GET", path: "/v1/spiral/mutation/latest" },
  { method: "POST", path: "/v1/spiral/export/midi" },
  { method: "POST", path: "/v1/spiral/export/osc" },
  { method: "POST", path: "/v1/spiral/realtime/subscribe" },
  { method: "POST", path: "/v1/spiral/realtime/unsubscribe" },
  { method: "GET", path: "/v1/spiral/realtime/status" },
  { method: "POST", path: "/v1/spiral/alerts/create" },
  { method: "GET", path: "/v1/spiral/alerts/list" },
  { method: "POST", path: "/v1/spiral/admin/rotate-keys" },
  { method: "GET", path: "/v1/spiral/admin/audit-log" },
  { method: "POST", path: "/v1/spiral/research/run" },
  { method: "GET", path: "/v1/spiral/research/status" },
  { method: "POST", path: "/v1/spiral/research/stop" },
  { method: "GET", path: "/v1/spiral/research/providers/status" },
  { method: "POST", path: "/v1/spiral/research/providers/reset" },
];

const ROUTE_MAP = new Map(ROUTES.map((route) => [`${route.method} ${route.path}`, route]));

function lookupRoute(method, path) {
  return ROUTE_MAP.get(`${method.toUpperCase()} ${path}`) ?? null;
}

function normalizeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function parseCsvSet(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function searchWithProvider({ query, maxResults, fetchImpl = fetch }) {
  const provider = String(process.env.SPIRAL_SEARCH_PROVIDER ?? "wikipedia").toLowerCase();
  return searchWithSpecificProvider({ provider, query, maxResults, fetchImpl });
}

async function searchWithSpecificProvider({ provider, query, maxResults, fetchImpl }) {
  const limit = Math.max(1, Math.min(maxResults, 10));
  const encoded = encodeURIComponent(query);

  if (provider === "brave") {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return [];
    const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${limit}`, {
      headers: { "x-subscription-token": apiKey, accept: "application/json" },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
    return results
      .map((item) => item?.url)
      .filter((value) => typeof value === "string");
  }

  if (provider === "serpapi") {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];
    const response = await fetchImpl(`https://serpapi.com/search.json?engine=google&q=${encoded}&num=${limit}&api_key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) return [];
    const payload = await response.json();
    const results = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
    return results
      .map((item) => item?.link)
      .filter((value) => typeof value === "string");
  }

  if (provider === "tavily") {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return [];
    const response = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: limit }),
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results
      .map((item) => item?.url)
      .filter((value) => typeof value === "string");
  }

  // Baseline provider fallback.
  const urlValue = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encoded}&limit=${limit}&namespace=0&format=json`;
  const response = await fetchImpl(urlValue);
  if (!response.ok) return [];
  const payload = await response.json();
  const urls = Array.isArray(payload?.[3]) ? payload[3] : [];
  return urls.filter((value) => typeof value === "string");
}

function parseProviderChain() {
  const raw = String(process.env.SPIRAL_SEARCH_PROVIDER_CHAIN ?? "").trim();
  if (!raw) {
    const single = String(process.env.SPIRAL_SEARCH_PROVIDER ?? "wikipedia").toLowerCase();
    return [single];
  }
  const providers = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return providers.length > 0 ? providers : ["wikipedia"];
}

function parseSearchResilienceSettings() {
  const retryCount = Math.max(0, Math.min(Number.parseInt(process.env.SPIRAL_SEARCH_RETRY_COUNT ?? "1", 10), 5));
  const baseBackoffMs = Math.max(0, Math.min(Number.parseInt(process.env.SPIRAL_SEARCH_BACKOFF_MS ?? "250", 10), 10_000));
  const timeoutMs = Math.max(200, Math.min(Number.parseInt(process.env.SPIRAL_SEARCH_TIMEOUT_MS ?? "7000", 10), 120_000));
  const breakerFailureThreshold = Math.max(1, Math.min(Number.parseInt(process.env.SPIRAL_SEARCH_BREAKER_FAILURE_THRESHOLD ?? "3", 10), 20));
  const breakerCooldownMs = Math.max(500, Math.min(Number.parseInt(process.env.SPIRAL_SEARCH_BREAKER_COOLDOWN_MS ?? "60000", 10), 600_000));
  return { retryCount, baseBackoffMs, timeoutMs, breakerFailureThreshold, breakerCooldownMs };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const providerCircuitState = new Map();
const MAX_AUDIT_LOG_ITEMS = Math.max(100, Math.min(Number.parseInt(process.env.SPIRAL_AUDIT_LOG_MAX ?? "1000", 10), 10_000));
const adminAuditLog = [];
const AUDIT_LOG_FILE = resolve(process.cwd(), process.env.SPIRAL_AUDIT_LOG_FILE ?? "./data/spiral_audit_log.jsonl");
const AUDIT_LOG_ROTATE_MAX_BYTES = Math.max(64 * 1024, Math.min(Number.parseInt(process.env.SPIRAL_AUDIT_LOG_ROTATE_MAX_BYTES ?? "5242880", 10), 200 * 1024 * 1024));
const AUDIT_LOG_ROTATE_KEEP_FILES = Math.max(1, Math.min(Number.parseInt(process.env.SPIRAL_AUDIT_LOG_ROTATE_KEEP_FILES ?? "5", 10), 100));
const AUDIT_LOG_DAILY_ROTATION = String(process.env.SPIRAL_AUDIT_LOG_DAILY_ROTATION ?? "false").toLowerCase() === "true";

function getProviderCircuit(provider) {
  if (!providerCircuitState.has(provider)) {
    providerCircuitState.set(provider, { failures: 0, openUntil: 0 });
  }
  return providerCircuitState.get(provider);
}

export function getProviderCircuitSnapshot(nowMs = Date.now()) {
  const providers = parseProviderChain();
  return providers.map((provider) => {
    const state = getProviderCircuit(provider);
    const isOpen = state.openUntil > nowMs;
    return {
      provider,
      failures: state.failures,
      circuit_open: isOpen,
      open_until: state.openUntil > 0 ? new Date(state.openUntil).toISOString() : null,
      retry_after_ms: isOpen ? Math.max(0, state.openUntil - nowMs) : 0,
    };
  });
}

export function resetProviderCircuitState(targetProvider = "all") {
  const normalized = String(targetProvider ?? "all").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    for (const state of providerCircuitState.values()) {
      state.failures = 0;
      state.openUntil = 0;
    }
    return { reset: "all", count: providerCircuitState.size };
  }

  const state = getProviderCircuit(normalized);
  state.failures = 0;
  state.openUntil = 0;
  return { reset: normalized, count: 1 };
}

export function appendAuditEvent(event) {
  const entry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...event,
  };
  adminAuditLog.unshift(entry);
  if (adminAuditLog.length > MAX_AUDIT_LOG_ITEMS) {
    adminAuditLog.length = MAX_AUDIT_LOG_ITEMS;
  }
  try {
    mkdirSync(dirname(AUDIT_LOG_FILE), { recursive: true });
    rotateAuditLogIfNeeded();
    appendFileSync(AUDIT_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Keep runtime resilient if disk is unavailable.
  }
}

function rotateAuditLogIfNeeded() {
  if (AUDIT_LOG_DAILY_ROTATION) {
    rotateAuditLogDailyIfNeeded();
  }
  if (!existsSync(AUDIT_LOG_FILE)) return;
  let size = 0;
  try {
    size = statSync(AUDIT_LOG_FILE).size;
  } catch {
    return;
  }
  if (size < AUDIT_LOG_ROTATE_MAX_BYTES) return;

  const oldest = `${AUDIT_LOG_FILE}.${AUDIT_LOG_ROTATE_KEEP_FILES}`;
  if (existsSync(oldest)) {
    try {
      unlinkSync(oldest);
    } catch {
      // Ignore cleanup failures.
    }
  }

  for (let i = AUDIT_LOG_ROTATE_KEEP_FILES - 1; i >= 1; i -= 1) {
    const current = `${AUDIT_LOG_FILE}.${i}`;
    const next = `${AUDIT_LOG_FILE}.${i + 1}`;
    if (!existsSync(current)) continue;
    try {
      renameSync(current, next);
    } catch {
      // Ignore rotation step failures.
    }
  }

  try {
    renameSync(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`);
  } catch {
    // Ignore if active file cannot be rotated this cycle.
  }
}

function rotateAuditLogDailyIfNeeded() {
  if (!existsSync(AUDIT_LOG_FILE)) return;
  let stat;
  try {
    stat = statSync(AUDIT_LOG_FILE);
  } catch {
    return;
  }
  const modified = stat.mtime;
  const now = new Date();
  const sameUtcDay =
    modified.getUTCFullYear() === now.getUTCFullYear() &&
    modified.getUTCMonth() === now.getUTCMonth() &&
    modified.getUTCDate() === now.getUTCDate();
  if (sameUtcDay) return;

  const y = modified.getUTCFullYear();
  const m = String(modified.getUTCMonth() + 1).padStart(2, "0");
  const d = String(modified.getUTCDate()).padStart(2, "0");
  const dailyFile = `${AUDIT_LOG_FILE}.${y}-${m}-${d}`;
  try {
    renameSync(AUDIT_LOG_FILE, dailyFile);
  } catch {
    // Ignore daily rotation failure and continue normal writes.
  }
}

export function getAuditEvents(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  return adminAuditLog.slice(0, safeLimit);
}

export function loadAuditEventsFromDisk() {
  if (!existsSync(AUDIT_LOG_FILE)) return 0;
  try {
    const raw = readFileSync(AUDIT_LOG_FILE, "utf8");
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip malformed lines to keep loading robust.
      }
    }
    parsed.reverse();
    adminAuditLog.length = 0;
    for (const item of parsed.slice(0, MAX_AUDIT_LOG_ITEMS)) {
      adminAuditLog.push(item);
    }
    return adminAuditLog.length;
  } catch {
    return 0;
  }
}

export async function searchWithProviderFailover({ query, maxResults, fetchImpl = fetch, sleepImpl = sleep, nowFn = Date.now }) {
  const chain = parseProviderChain();
  const errors = [];
  const { retryCount, baseBackoffMs, timeoutMs, breakerFailureThreshold, breakerCooldownMs } = parseSearchResilienceSettings();

  for (const provider of chain) {
    const circuit = getProviderCircuit(provider);
    const now = nowFn();
    if (circuit.openUntil > now) {
      errors.push({ provider, reason: "circuit_open", open_until: new Date(circuit.openUntil).toISOString() });
      continue;
    }

    let providerHadException = false;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const timedFetch = async (url, init = {}) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fetchImpl(url, { ...init, signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        };
        const urls = await searchWithSpecificProvider({ provider, query, maxResults, fetchImpl: timedFetch });
        if (urls.length > 0) {
          circuit.failures = 0;
          circuit.openUntil = 0;
          return { urls, provider, tried: chain, errors };
        }
        errors.push({ provider, attempt, reason: "empty_results" });
      } catch (error) {
        providerHadException = true;
        errors.push({ provider, attempt, reason: "exception", detail: String(error) });
      }
      if (attempt < retryCount) {
        const backoff = baseBackoffMs * Math.pow(2, attempt);
        if (backoff > 0) await sleepImpl(backoff);
      }
    }

    if (providerHadException) {
      circuit.failures += 1;
      if (circuit.failures >= breakerFailureThreshold) {
        circuit.openUntil = nowFn() + breakerCooldownMs;
        errors.push({ provider, reason: "circuit_opened", failures: circuit.failures, cooldown_ms: breakerCooldownMs });
      }
    }
  }

  return { urls: [], provider: null, tried: chain, errors };
}

export function makeResearchManager(options = {}) {
  const jobs = new Map();
  const blockedHosts = parseCsvSet(process.env.SPIRAL_RESEARCH_BLOCKED_HOSTS);
  const allowedHosts = parseCsvSet(process.env.SPIRAL_RESEARCH_ALLOWED_HOSTS);
  const fetchImpl = options.fetchImpl ?? fetch;

  function isHostAllowed(urlValue) {
    const host = normalizeHost(urlValue);
    if (!host) return false;
    if (blockedHosts.has(host)) return false;
    if (allowedHosts.size === 0) return true;
    return allowedHosts.has(host);
  }

  async function fetchText(urlValue, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(urlValue, { signal: controller.signal });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchWeb(query, maxResults) {
    try {
      const result = await searchWithProviderFailover({ query, maxResults, fetchImpl });
      return result.urls;
    } catch {
      return [];
    }
  }

  function summarizeText(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    return cleaned.slice(0, 500);
  }

  async function runJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;
    job.status = "running";
    job.started_at = new Date().toISOString();

    try {
      const query = String(job.input.query ?? "").trim();
      const maxSteps = Math.max(1, Math.min(Number(job.input.max_steps ?? DEFAULT_RESEARCH_MAX_STEPS), 12));
      const timeoutMs = Math.max(1000, Math.min(Number(job.input.timeout_ms ?? DEFAULT_RESEARCH_TIMEOUT_MS), 120000));
      const candidateUrls = [];

      if (Array.isArray(job.input.seed_urls)) {
        for (const urlValue of job.input.seed_urls) {
          if (typeof urlValue === "string") candidateUrls.push(urlValue);
        }
      }

      if (query) {
        const fromSearch = await searchWeb(query, maxSteps * 2);
        for (const urlValue of fromSearch) candidateUrls.push(urlValue);
      }

      for (const urlValue of candidateUrls) {
        if (job.cancel_requested) break;
        if (job.sources.length >= maxSteps) break;
        if (!isHostAllowed(urlValue)) continue;

        const fetched = await fetchText(urlValue, timeoutMs);
        const snippet = summarizeText(fetched.text);
        job.sources.push({
          url: urlValue,
          ok: fetched.ok,
          status: fetched.status,
          snippet,
        });
        job.trace.push({
          at: new Date().toISOString(),
          action: "fetch",
          url: urlValue,
          ok: fetched.ok,
          status: fetched.status,
        });
      }

      job.status = job.cancel_requested ? "stopped" : "completed";
      job.completed_at = new Date().toISOString();
      job.result = {
        summary: job.sources.map((s) => s.snippet).filter(Boolean).slice(0, 4).join("\n"),
        source_count: job.sources.length,
      };
    } catch (error) {
      job.status = "failed";
      job.completed_at = new Date().toISOString();
      job.error = String(error);
    }
  }

  return {
    run(input) {
      const id = randomUUID();
      const job = {
        id,
        status: "queued",
        created_at: new Date().toISOString(),
        started_at: null,
        completed_at: null,
        cancel_requested: false,
        input: input ?? {},
        sources: [],
        trace: [],
        result: null,
        error: null,
      };
      jobs.set(id, job);
      void runJob(id);
      return { job_id: id, status: "queued" };
    },
    status(jobId) {
      return jobs.get(jobId) ?? null;
    },
    stop(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      job.cancel_requested = true;
      job.trace.push({ at: new Date().toISOString(), action: "stop_requested" });
      return { job_id: jobId, status: job.status, cancel_requested: true };
    },
  };
}

async function handleSpiralRoute(route, input, context) {
  if (route.path === "/v1/spiral/execute") {
    const result = await runSpiralIntelligence(input);
    return { ok: true, result };
  }
  if (route.path === "/v1/spiral/research/run") {
    const launched = context.research.run(input ?? {});
    appendAuditEvent({
      action: "research.run",
      route: route.path,
      actor_key_id: context.meta.keyId,
      actor_ip: context.meta.ip,
      details: { job_id: launched.job_id },
    });
    return { ok: true, ...launched };
  }
  if (route.path === "/v1/spiral/research/status") {
    const jobId = String(input?.job_id ?? "");
    const job = context.research.status(jobId);
    if (!job) return { ok: false, error: "job_not_found" };
    return { ok: true, job };
  }
  if (route.path === "/v1/spiral/research/stop") {
    const jobId = String(input?.job_id ?? "");
    const stopped = context.research.stop(jobId);
    if (!stopped) return { ok: false, error: "job_not_found" };
    appendAuditEvent({
      action: "research.stop",
      route: route.path,
      actor_key_id: context.meta.keyId,
      actor_ip: context.meta.ip,
      details: { job_id: jobId },
    });
    return { ok: true, ...stopped };
  }
  if (route.path === "/v1/spiral/research/providers/status") {
    appendAuditEvent({
      action: "research.providers.status",
      route: route.path,
      actor_key_id: context.meta.keyId,
      actor_ip: context.meta.ip,
    });
    return { ok: true, providers: getProviderCircuitSnapshot() };
  }
  if (route.path === "/v1/spiral/research/providers/reset") {
    const target = String(input?.provider ?? "all");
    const result = resetProviderCircuitState(target);
    appendAuditEvent({
      action: "research.providers.reset",
      route: route.path,
      actor_key_id: context.meta.keyId,
      actor_ip: context.meta.ip,
      details: { target },
    });
    return { ok: true, ...result, providers: getProviderCircuitSnapshot() };
  }
  if (route.path === "/v1/spiral/admin/audit-log") {
    const limit = Number(input?.limit ?? 100);
    appendAuditEvent({
      action: "admin.audit_log.read",
      route: route.path,
      actor_key_id: context.meta.keyId,
      actor_ip: context.meta.ip,
      details: { limit },
    });
    return { ok: true, events: getAuditEvents(limit) };
  }

  // Endpoint scaffold response. Replace each branch with domain logic as you wire systems.
  return {
    ok: true,
    endpoint: route.path,
    method: route.method,
    status: "accepted",
    trace_id: randomUUID(),
    received_at: new Date().toISOString(),
    input_echo: input,
  };
}

export function createSpiralApiServer() {
  const allowedIps = parseAllowedIps();
  const keys = parseApiKeys();
  const nonceStore = makeNonceStore();
  const rate = makeRateLimiter();
  const research = makeResearchManager();

  if (keys.size === 0) {
    throw new Error("SPIRAL_API_KEYS is required. Example: owner:supersecretvalue");
  }

  loadAuditEventsFromDisk();
  setInterval(() => nonceStore.sweep(), 60_000).unref();

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = lookupRoute(method, url.pathname);

      if (url.pathname === "/health" && method === "GET") {
        return json(res, 200, { ok: true });
      }

      if (url.pathname === "/v1/spiral/routes" && method === "GET") {
        return json(res, 200, { ok: true, count: ROUTES.length, routes: ROUTES });
      }

      if (!route) {
        return json(res, 404, { error: "not_found" });
      }

      const ip = getClientIp(req);
      if (!shouldAllowIp(allowedIps, ip)) {
        return json(res, 403, { error: "ip_not_allowed" });
      }

      if (!rate.consume(ip || "unknown")) {
        return json(res, 429, { error: "rate_limited" });
      }

      const body = await readBody(req);
      const keyId = String(req.headers["x-spiral-key-id"] ?? "");
      const timestamp = String(req.headers["x-spiral-timestamp"] ?? "");
      const nonce = String(req.headers["x-spiral-nonce"] ?? "");
      const signature = String(req.headers["x-spiral-signature"] ?? "");

      if (!keyId || !timestamp || !nonce || !signature) {
        return json(res, 401, { error: "missing_auth_headers" });
      }

      const tsNumber = Number(timestamp);
      if (!Number.isFinite(tsNumber) || Math.abs(Date.now() - tsNumber) > MAX_CLOCK_SKEW_MS) {
        return json(res, 401, { error: "timestamp_out_of_range" });
      }

      const replayKey = `${keyId}:${nonce}`;
      if (nonceStore.has(replayKey)) {
        return json(res, 401, { error: "replay_detected" });
      }

      const secret = keys.get(keyId);
      if (!secret) {
        return json(res, 401, { error: "unknown_key" });
      }

      const expected = computeSignature(secret, {
        method,
        path: url.pathname,
        timestamp,
        nonce,
        body,
      });
      if (!safeEqualHex(expected, signature)) {
        return json(res, 401, { error: "invalid_signature" });
      }
      nonceStore.add(replayKey);

      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }
      const requestInput =
        method === "GET"
          ? { ...parsed, ...Object.fromEntries(url.searchParams.entries()) }
          : parsed;

      const output = await handleSpiralRoute(route, requestInput, {
        research,
        meta: { keyId, ip },
      });
      return json(res, 200, output);
    } catch (error) {
      return json(res, 500, { error: "internal_error", detail: String(error) });
    }
  });
}

export function buildSpiralSignature({ secret, method, path, timestamp, nonce, body }) {
  return computeSignature(secret, { method, path, timestamp, nonce, body });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);
  const server = createSpiralApiServer();
  server.listen(port, "0.0.0.0", () => {
    // Keep logs minimal to avoid leaking sensitive request data.
    console.log(`[spiral-private-api] listening on ${port}`);
  });
}
