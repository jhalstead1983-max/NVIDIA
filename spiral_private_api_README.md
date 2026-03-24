# Spiral Private API

This API is designed to be callable only by approved clients using:

- API key id + secret pair
- HMAC request signing
- Nonce replay protection
- Timestamp validation
- IP allowlist
- Rate limiting

## 1) Configure environment

Set these environment variables before starting:

- `SPIRAL_API_KEYS` Example: `owner:replace_with_long_secret`
- `SPIRAL_ALLOWED_IPS` Example: `127.0.0.1,192.168.1.20` (leave empty to allow any IP)
- `SPIRAL_RATE_LIMIT_PER_MIN` Example: `60`
- `PORT` Example: `8787`

## 2) Start server

```powershell
node .\spiral_private_api.js
```

## 3) Endpoints

- `GET /health` (no auth)
- `GET /v1/spiral/routes` (no auth, route catalog)
- 34 Spiral endpoints under `/v1/spiral/*` (auth required)

Example Spiral endpoints:

- `POST /v1/spiral/execute`
- `POST /v1/spiral/session/create`
- `GET /v1/spiral/session/status`
- `POST /v1/spiral/loop/start`
- `GET /v1/spiral/loop/status`
- `POST /v1/spiral/score/calculate`
- `POST /v1/spiral/memory/write`
- `POST /v1/spiral/export/midi`
- `POST /v1/spiral/realtime/subscribe`
- `POST /v1/spiral/admin/rotate-keys`
- `POST /v1/spiral/research/run`
- `GET /v1/spiral/research/status`
- `POST /v1/spiral/research/stop`
- `GET /v1/spiral/research/providers/status`
- `POST /v1/spiral/research/providers/reset`

Research flow:

1. Call `POST /v1/spiral/research/run` with a body like:
   - `query` string
   - `seed_urls` array (optional)
   - `max_steps` number (optional)
   - `timeout_ms` number (optional)
2. Poll `GET /v1/spiral/research/status?job_id=<id>`
3. Stop with `POST /v1/spiral/research/stop` and body `{ "job_id": "<id>" }`
4. View provider health: `GET /v1/spiral/research/providers/status`
5. Reset circuit state: `POST /v1/spiral/research/providers/reset` with body:
   - `{ "provider": "all" }` to reset all providers
   - `{ "provider": "wikipedia" }` to reset one provider
6. Read admin audit events: `GET /v1/spiral/admin/audit-log?limit=100`

Audit log details:

- In-memory rolling log (newest first)
- Includes route actions such as research start/stop, provider status/reset, and audit-log reads
- Controlled by `SPIRAL_AUDIT_LOG_MAX` (default `1000`)
- Persisted to JSONL on disk so logs survive restarts
- File path controlled by `SPIRAL_AUDIT_LOG_FILE` (default `./data/spiral_audit_log.jsonl`)
- Size-based log rotation with:
  - `SPIRAL_AUDIT_LOG_ROTATE_MAX_BYTES` (default `5242880`, about 5 MB)
  - `SPIRAL_AUDIT_LOG_ROTATE_KEEP_FILES` (default `5`)
- Optional daily rotation:
  - `SPIRAL_AUDIT_LOG_DAILY_ROTATION=true` (rotates to `*.YYYY-MM-DD` based on UTC day)

Research policy environment variables:

- `SPIRAL_RESEARCH_ALLOWED_HOSTS` comma list (optional allowlist)
- `SPIRAL_RESEARCH_BLOCKED_HOSTS` comma list (denylist)
- `SPIRAL_RESEARCH_MAX_STEPS` default max fetch steps
- `SPIRAL_RESEARCH_TIMEOUT_MS` default per-fetch timeout

Search provider environment variables:

- `SPIRAL_SEARCH_PROVIDER` one of: `wikipedia` (default), `brave`, `serpapi`, `tavily`
- `SPIRAL_SEARCH_PROVIDER_CHAIN` comma order for failover, example: `brave,tavily,wikipedia`
- `SPIRAL_SEARCH_RETRY_COUNT` retries per provider before failover (default `1`)
- `SPIRAL_SEARCH_BACKOFF_MS` exponential backoff base in milliseconds (default `250`)
- `SPIRAL_SEARCH_TIMEOUT_MS` timeout per provider request in milliseconds (default `7000`)
- `SPIRAL_SEARCH_BREAKER_FAILURE_THRESHOLD` consecutive failing runs before opening provider circuit (default `3`)
- `SPIRAL_SEARCH_BREAKER_COOLDOWN_MS` how long a failed provider stays skipped (default `60000`)
- `BRAVE_SEARCH_API_KEY` required if provider is `brave`
- `SERPAPI_API_KEY` required if provider is `serpapi`
- `TAVILY_API_KEY` required if provider is `tavily`

Required auth headers for every protected `/v1/spiral/*` request:

- `x-spiral-key-id`
- `x-spiral-timestamp` (unix ms)
- `x-spiral-nonce` (unique per request)
- `x-spiral-signature` (hex hmac sha256)

Signature base string:

```text
METHOD
/v1/spiral/<endpoint-path>
TIMESTAMP
NONCE
sha256Hex(raw_request_body)
```

Then:

```text
hmac_sha256_hex(secret, signature_base_string)
```

## Important security notes

- Never put the API secret in browser code.
- Put this API behind a private network/VPN and reverse proxy.
- Terminate TLS in front of this server and restrict ingress at firewall level.
- Rotate `SPIRAL_API_KEYS` regularly.
