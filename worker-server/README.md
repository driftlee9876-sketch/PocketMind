# PocketMind Worker Coordinator

Node.js 22.11+ service. No third-party runtime dependencies.

## Start

1. Copy `.env.example` to `.env` and set two independent random secrets.
2. Export the variables in your hosting environment.
3. Run `npm start`.

Generate secrets with `openssl rand -hex 32`. Do not commit `.env` or the JSON state file.

## Deploy safely

- Put the service behind a TLS reverse proxy (HTTPS); do not expose plain HTTP to the internet.
- Restrict network access where possible and configure `POCKETMIND_ALLOWED_ORIGINS` for browser clients.
- Back up the state file and restrict its filesystem permissions.
- Keep API and enrollment tokens private. Enrollment creates a separate random worker token.
- The JSON persistence model is intended for one coordinator process. It is not a multi-instance database or HA queue.

## API

- `GET /v1/health` public health check.
- `POST /v1/workers/enroll` requires `X-Enrollment-Token`; body contains workerId, displayName, capabilities, and conditions. Returns a per-worker token once.
- `POST /v1/workers/heartbeat` requires the worker Bearer token.
- `POST /v1/tasks/claim` requires the worker Bearer token.
- `POST /v1/tasks/:id/result` and `/fail` require worker token and leaseId.
- `GET /v1/workers`, `POST /v1/tasks`, `GET /v1/tasks/:id`, and `POST /v1/tasks/:id/cancel` require the API Bearer token.

Tasks are only leased to workers that explicitly opted in, are idle and thermally safe, and satisfy the requested model/GPU/power/network requirements. Expired leases are retried up to three attempts. Results are checked against the lease owner and requested model id.

## Model execution

The coordinator does not run models. Workers run their local inference backend and send results back. See `../workers/windows/README.md` for the Windows GPU worker.

## Connected-app actions

The coordinator can dispatch approved app actions to **server-configured HTTPS webhooks** (n8n, Make, Zapier, or a trusted custom adapter). Set `POCKETMIND_INTEGRATION_WEBHOOKS_JSON` to a JSON object mapping catalog integration IDs to HTTPS webhook URLs, for example:

```json
{
  "google-gmail": "https://automation.example/webhook/gmail",
  "google-calendar": "https://automation.example/webhook/calendar",
  "custom-webhook": "https://automation.example/webhook/pocketmind"
}
```

- `GET /v1/integrations` lists only configured connector IDs.
- `POST /v1/integrations/actions` dispatches `risk=read` actions immediately.
- Actions with `risk=write` or `risk=sensitive` are stored as `awaiting_approval` and are **not sent** until `POST /v1/integrations/actions/:id/approve`.
- `POST /v1/integrations/actions/:id/reject` rejects a pending action.
- `GET /v1/integrations/actions/:id` returns status and adapter result.

The webhook URL and provider credentials stay on the coordinator, not in the mobile app. Configure OAuth/bot credentials in your automation platform or adapter. A catalog entry alone is not an authenticated provider integration: it becomes operational only after its trusted webhook is configured and its adapter is implemented. Payment, purchases, bookings, account deletion, and other irreversible actions should require an additional provider-side confirmation as well.
