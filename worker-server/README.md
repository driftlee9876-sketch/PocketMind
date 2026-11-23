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
- The JSON persistence model is intended for one coordinator process. It is not a multi-instance database or HA queue. Task prompts, results, and integration action inputs are persisted without application-level encryption. Protect the volume and backups with encrypted storage and strict access controls; do not send passwords or long-lived provider secrets as task input.

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

### One-tap OAuth connection contract

PocketMind can open a provider's official login flow from the app and verify the connection when the user returns. Configure a trusted OAuth broker/adapter with `POCKETMIND_INTEGRATION_CONNECTORS_JSON`:

```json
{
  "google-gmail": {
    "actionUrl": "https://connector.example/pocketmind/actions",
    "connectUrl": "https://connector.example/pocketmind/connect",
    "statusUrl": "https://connector.example/pocketmind/status",
    "disconnectUrl": "https://connector.example/pocketmind/disconnect"
  }
}
```

All URLs must be HTTPS. The Coordinator sends signed JSON `POST` requests using `X-PocketMind-Signature` and the same `POCKETMIND_WEBHOOK_SIGNING_SECRET` used by action webhooks.

- `connectUrl` receives `pocketmind.integration.connect`, an integration ID, a random state nonce, and the app return URL. It returns `{ "authorizationUrl": "https://provider.example/oauth/..." }` after binding the nonce server-side.
- `statusUrl` receives `pocketmind.integration.status` and returns `{ "connected": true, "accountLabel": "user@example.com" }` only after the provider token is valid.
- `disconnectUrl` receives `pocketmind.integration.disconnect`, revokes/deletes the provider token, and returns successful JSON.
- `actionUrl` receives the existing signed action events. It must reject actions when its provider token is missing or expired.

Provider client secrets and refresh tokens belong in the trusted adapter's encrypted server-side storage. They must never be returned to the app, placed in these environment variables, or committed to Git. The legacy `POCKETMIND_INTEGRATION_WEBHOOKS_JSON` format remains supported for webhook-only integrations.

This contract is provider-neutral: any ID in the mobile connected-app catalog can use it. API-key services should expose the same signed connect/status/disconnect interface from their trusted adapter rather than sending the key to the mobile app.

### Built-in Gmail OAuth

Gmail can run without a separate webhook adapter. Create a Google OAuth **Web application** client, enable the Gmail API, and set its exact authorized redirect URI to:

```text
https://YOUR-COORDINATOR.example/v1/oauth/google/callback
```

Then configure the Coordinator:

```dotenv
POCKETMIND_PUBLIC_BASE_URL=https://YOUR-COORDINATOR.example
POCKETMIND_TOKEN_ENCRYPTION_KEY=<independent random 32+ byte secret>
GOOGLE_OAUTH_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<Google OAuth web client secret>
```

When all four values are valid, `google-gmail` appears as a one-tap connector automatically. PocketMind opens Google's official consent page and returns through its Android deep link after the callback. Refresh and access tokens are encrypted at rest with AES-256-GCM in the Coordinator state file; neither token is returned to the app. The built-in adapter supports message search/read, draft creation, and sending. Draft and send requests remain behind PocketMind's approval flow.

Use a persistent disk for `POCKETMIND_DATA_FILE`. Changing `POCKETMIND_TOKEN_ENCRYPTION_KEY` makes existing stored OAuth tokens unreadable and requires reconnecting Gmail.
