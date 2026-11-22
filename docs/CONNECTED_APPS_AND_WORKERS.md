# PocketMind: connected apps and distributed Workers

This branch adds a first operational slice for connected-app automation and task distribution. It does not claim to be a fully sharded multi-GPU inference engine.

## Architecture

- **PocketMind app** submits inference jobs to a Coordinator and displays connected-app actions.
- **Coordinator** authenticates callers, maintains a persistent single-process task queue, assigns compatible jobs to opted-in Workers, tracks leases, retries expired jobs, and validates returned model/worker/task metadata.
- **Windows Worker** polls the Coordinator and invokes a local OpenAI-compatible llama.cpp/Ollama endpoint. The model server remains bound to localhost.
- **Android Worker** is an explicit user-started foreground service with Headless JS inference. It only polls when the configured charging, network, battery, and thermal rules are satisfied.
- **Connected-app webhooks** forward app actions to trusted HTTPS automation endpoints. Read actions are sent directly; actions that write, send, publish, delete, or change data wait for in-app approval.

## Coordinator deployment

The Node service is in `worker-server/`. It requires Node.js 22.11+ and no third-party runtime packages.

Generate two independent secrets (at least 32 random bytes each):

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Set them as `POCKETMIND_API_TOKEN` and `POCKETMIND_ENROLLMENT_TOKEN`. Never use the same value for both. Do not commit real values or a `.env` file.

### Docker

```sh
cd worker-server
export POCKETMIND_API_TOKEN="..."
export POCKETMIND_ENROLLMENT_TOKEN="..."
docker compose up -d --build
```

The compose file binds the service to localhost port 8787. Put a TLS reverse proxy in front of it and use its HTTPS URL from mobile devices. Do not publish the coordinator as plain HTTP on the public internet. The named Docker volume preserves task/worker state across container restarts.

### Direct Node

```sh
cd worker-server
POCKETMIND_API_TOKEN="..." POCKETMIND_ENROLLMENT_TOKEN="..." npm start
```

The coordinator JSON file is a single-process persistence layer. It is suitable for a single coordinator instance, not horizontally scaled/HA deployment. Do not run multiple replicas against the same JSON file. A production multi-instance service should move the queue and leases to a transactional database/Redis-backed implementation.

## PocketMind app setup

1. Deploy the coordinator and note its HTTPS URL.
2. In PocketMind, open **PC GPU / Worker settings**.
3. Set the Coordinator URL and the `POCKETMIND_API_TOKEN`.
4. Enable remote inference. Any model tier can now be routed through the Worker queue when remote mode is enabled. Mid/high tiers require a GPU-capable Worker and the catalog's minimum RAM.
5. If no compatible Worker is online, the task remains queued until a Worker claims it or the app's 10-minute inference wait expires.

The app checks `GET /v1/health` to distinguish the PocketMind Coordinator from an older OpenAI-compatible PC inference endpoint. The older endpoint remains supported as a fallback when the configured URL is not a PocketMind Coordinator.

## Windows GPU Worker

Requirements: Windows 10/11, Python 3.10+, and a local OpenAI-compatible inference server (llama.cpp server or Ollama).

Start the local inference server on `127.0.0.1` first. Do not expose that local model endpoint to the LAN/public internet. Follow [workers/windows/README.md](../workers/windows/README.md) for PowerShell configuration.

The Worker uses `nvidia-smi` for NVIDIA GPU detection. Other backends must be explicitly configured after verifying that the local inference server actually uses the GPU. GPU advertisement defaults to fail-closed (CPU) if detection is unavailable. Use `POCKETMIND_LOCAL_MODEL_MAP_JSON` when the local server's model aliases differ from PocketMind model IDs.

## Android Worker

1. Install at least one GGUF model in PocketMind.
2. Open the Android Worker screen from the side menu.
3. Enter the Coordinator URL and the enrollment token.
4. Select the installed model(s) the device can serve.
5. Enable GPU only when the installed llama.rn runtime on that device supports the relevant GPU backend.
6. Start the Worker. Android shows an ongoing notification while the service is enabled.

The service requires the user to start it explicitly. The current defaults require charging and an unmetered network, and pause at low battery or serious/critical thermal state. Results and task leases are reported back to the Coordinator. When the user stops the service from PocketMind, it sends an offline heartbeat before shutting down where possible.

Android may still stop a foreground service under system pressure, user force-stop, vendor power policies, or network loss. This implementation is not a promise of uninterrupted execution.

## Connected apps

The app hub currently contains 53 integrations. In addition to Gmail, Google Calendar, Drive, Outlook, Dropbox, Notion, Slack, GitHub, Discord, Telegram, Todoist, Jira, Microsoft 365, Airtable, Asana, Zoom, YouTube, Spotify, and WordPress, it includes Google Contacts/Tasks, Box, GitLab, Bitbucket, Figma, ClickUp, monday.com, Salesforce, HubSpot, Zendesk, Freshdesk, Calendly, Reddit, Mastodon, RSS, Shopify, WooCommerce, Stripe, PayPal, Cloudflare, Amazon S3, Supabase, Twilio, SendGrid, and custom webhooks.

A catalog entry is **not** an authenticated provider connection. Configure the provider's official OAuth/API credentials in a trusted adapter or automation platform (for example n8n, Make, Zapier, or a custom service), then map the integration ID to that adapter's HTTPS webhook using `POCKETMIND_INTEGRATION_WEBHOOKS_JSON`:

```json
{
  "google-gmail": "https://automation.example/webhook/gmail",
  "google-calendar": "https://automation.example/webhook/calendar",
  "notion": "https://automation.example/webhook/notion",
  "custom-webhook": "https://automation.example/webhook/pocketmind"
}
```

The coordinator lists only configured IDs. Server-side action policy determines whether an action is read, write, or sensitive; the client cannot lower the required risk level. Read actions dispatch immediately. Write/sensitive actions are held in `awaiting_approval` until the user taps **Approve and run** in PocketMind. Rejected and stale pending approvals are not executed.

The webhook adapter must validate the request, apply the provider's OAuth scopes, and return a useful response. Configure provider secrets at the adapter, not in the mobile app or the Git repository. High-impact provider actions (payments, orders, public publishing, deleting accounts, etc.) should also require provider-side confirmation.

For Pickle-style one-tap account connection, configure `POCKETMIND_INTEGRATION_CONNECTORS_JSON` with HTTPS `actionUrl`, `connectUrl`, `statusUrl`, and `disconnectUrl` values for each provider. PocketMind requests a secure provider authorization URL, opens the official login page, returns through `pocketmind://integrations/callback`, and checks `statusUrl` before enabling actions. The adapter owns OAuth state validation, token exchange, encrypted refresh-token storage, token revocation, and HMAC request verification. Provider credentials are never stored in the APK or Coordinator JSON state.

The same one-tap contract works for every catalog ID; adding a provider does not require a new APK once its trusted adapter is installed on the Coordinator. Services that use API keys or signed credentials instead of OAuth still use the same connect/status/disconnect contract so the app can show an accurate account state without receiving the secret.

## API overview

- `GET /v1/health`: public health check.
- `POST /v1/workers/enroll`: enrollment-token protected; returns a per-worker bearer token once.
- `POST /v1/workers/heartbeat`: worker-token protected.
- `GET /v1/workers`: API-token protected worker inventory.
- `POST /v1/tasks`: API-token protected task submission.
- `POST /v1/tasks/claim`: worker task claim with capability/power checks.
- `POST /v1/tasks/:id/result` and `/fail`: lease-owner protected result/failure.
- `GET /v1/tasks/:id`, `POST /v1/tasks/:id/cancel`: API-token protected task status/cancellation.
- `GET /v1/integrations`, `POST /v1/integrations/actions`, and action `approve`/`reject` routes: connected-app automation.
- `POST /v1/integrations/:id/connect`, `/status`, and `/disconnect`: one-tap account connection through a trusted OAuth adapter.

## Important boundaries

- **This is task distribution, not tensor/model parallelism.** A given inference is run by one Worker that has the complete requested model. Multiple independent requests can be processed by different Workers. Splitting one model's layers/weights across multiple devices and combining partial GPU execution is not implemented.
- **iOS does not run an always-on background GPU Worker.** iOS background scheduling is system-controlled; this branch does not claim a persistent iPhone worker. Use an iPhone as an active foreground app/client, not as an always-on compute node.
- **Provider OAuth adapters are external configuration.** The catalog and approval UI are included, but each provider needs a configured, trusted adapter/webhook and provider credentials before it can execute real account actions.
- **Coordinator storage is single-process JSON.** Multi-instance queue locking and a transactional shared database are not implemented.
- **No APK is built by the quality workflow.** The PR workflow runs TypeScript/Jest and Coordinator tests only. Android packaging is left separate and is not run as part of this code change.
