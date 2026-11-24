# PocketMind development roadmap

This roadmap follows the product direction: all planned capabilities, a simple GPT-style interface, and balanced delivery of usability, performance, and reliability. The existing Cloudflare Worker deployment is preserved; server changes are not made as part of client-only milestones.

## Delivery principles

- Ship small, testable increments rather than enabling unfinished controls.
- Keep local chat history and model execution usable without a Cloudflare deployment change.
- Treat connected-app actions as unavailable until a trusted provider adapter and credentials are configured.
- Report unsupported device telemetry as unavailable; never estimate temperatures or performance.
- Keep distributed compute opt-in, with explicit device enrollment and clear battery/network/thermal limits.
- Verify TypeScript, unit tests, coordinator tests, and Android native compilation before publishing each APK.

## Milestones

### 1. Chat usability and history
- [x] Persist recent conversations locally.
- [x] Show a one-line local topic summary in each history button and preserve custom titles.
- [x] Configure Enter, blank-line sending, text size, device metrics and scrolling.
- [x] Search conversation titles and previews.
- [x] Pin important conversations in the sidebar.
- [x] Add safe conversation rename and delete actions.
- [x] Add message copy, retry, edit/resend, and generation stop actions.
- [ ] Add robust export/import and backup/restore.

### 2. On-device model experience
- [x] Discover installed GGUF files and allow model selection.
- [ ] Verify download size/checksum and recover interrupted downloads.
- [ ] Explain model RAM requirements before download and loading.
- [ ] Add model runtime state, generation speed, and clear failure recovery.
- [ ] Add document/image input only after supported parsers and permissions are integrated.

### 3. Device health and multi-device workers
- [x] Show best-effort CPU, memory, thermal, and USB telemetry.
- [x] Keep Android Worker opt-in and expose enrollment status.
- [ ] Show telemetry freshness and distinguish unsupported from temporarily unavailable.
- [ ] Add worker health, last-seen time, and task outcome details.
- [ ] Test real Galaxy Tab battery, thermal, and background behavior.
- [ ] Evaluate LAN discovery and reliable job recovery before implementing new transports.

### 4. Connected apps and automation
- [x] Provide a catalog and approval UI for write actions.
- [x] Add a standard one-tap OAuth broker flow, Android callback deep link, live status check, and disconnect control.
- [x] Expand the connected-app catalog from 28 to 53 services under the same connection contract.
- [x] Scan the complete enabled 60-plugin catalog before inference and route related natural-language commands deterministically.
- [ ] Add and verify production OAuth adapters/credentials for each provider.
- [x] Add searchable connection status, setup filters, refresh feedback, and official setup links.
- [ ] Add action history and clear retry/error states.
- [ ] Enable only integrations with a verified trusted adapter and official credentials.

### 5. Voice, documents, and privacy
- [ ] Add accessible voice input/output with explicit permission and playback controls.
- [ ] Add document import and extraction with file size/type limits.
- [ ] Add privacy controls, local data deletion, and export.
- [ ] Add app lock only after a secure platform-backed implementation is verified.

## Architecture boundaries to preserve

- The currently deployed Cloudflare Worker is not modified by this roadmap.
- The existing coordinator architecture routes complete jobs to eligible workers; it does not combine multiple devices' GPU memory or split one model's weights across devices.
- The wired experiment is separate from the Coordinator. A Windows llama.cpp host can explicitly shard a GGUF onto an authorized Android Vulkan peer and a foreground iOS Metal peer over USB. Actual cross-device performance, driver compatibility and physical installs still require testing.
- Device temperature availability depends on Android/OEM thermal-zone exposure.
- A successful CI build is not a substitute for installation and runtime testing on the target Galaxy Tab.
