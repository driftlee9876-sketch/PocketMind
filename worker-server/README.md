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
