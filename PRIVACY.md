# Easy Sniff — Privacy Policy

Last updated: October 3, 2026

Easy Sniff is a local QA workspace browser extension. This policy explains what data the extension handles, where it is stored, and what leaves your device (almost nothing).

## The short version

Easy Sniff has no backend, no accounts, and no analytics. It does not send your data to us, because there is no "us" to send it to. Everything the extension records — captured traffic, recordings, saved requests, settings — stays in your browser's local storage on your device until you delete it or uninstall the extension.

## What the extension stores locally

All of the following lives in `chrome.storage.local`, `chrome.storage.session`, or IndexedDB on your device:

- **Captured traffic** (HTTP/WS requests, headers, bodies) for the tab you explicitly connect — session-scoped, cleared when you stop capture or start a new session.
- **Bug Replay recordings** (video, console, network events) for the tab you record — kept in IndexedDB until you delete them in the UI.
- **Your workspace data**: saved requests, collections, environments, history, override rules.
- **AI provider settings**: the base URL, model ID, and API key you enter for your own AI provider. Keys are stored locally without encryption and never leave your device except as an authentication header to the provider you chose.
- **UI preferences**: language, layout, theme.

## What leaves your device, and only when you ask

1. **API requests you send from the API client** go to the URL you enter — same as if you called it from the page. Not routed through any Easy Sniff server.
2. **AI requests** go directly from your browser to the provider you configured (OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint). Before sending, Easy Sniff redacts common credential patterns (Bearer tokens, JWTs, known key formats, secret-named fields) from the context. Redaction is best-effort: your traffic may contain sensitive data, so choose a provider you trust.
3. **Exports you create** (ZIP reports, JSON exports, cURL commands) are generated locally. Sharing them is your choice, your channel, your responsibility.

## What we never do

- No analytics, telemetry, or crash reporting.
- No accounts, sign-ups, or emails.
- No remote code execution — the extension ships as-is from the Chrome Web Store.
- No data sold, shared, or used for any purpose other than the extension's features.

## Third parties

There are none. Easy Sniff does not embed analytics SDKs, ad networks, or trackers of any kind. The only network destinations are the ones you explicitly configure (API endpoints, AI providers) or the pages you test.

## Permissions and why

- `debugger` — reads network/console events and applies your overrides to the tab you connect. Without it, capture and mocking do not work. Chrome shows a visible debugger banner while attached; the extension only attaches when you click to start capture.
- `tabs` / `activeTab` — lets you pick which tab to capture or record. No browsing history is read beyond the tab list and the tab you select.
- `tabCapture` + `offscreen` — records the selected tab's video when you press record, in the background, via an offscreen document.
- `scripting` — injects the WebSocket bridge into the page you connected, to observe and mock socket events.
- `storage` — saves the local data described above.
- Host permissions (`http://*/*`, `https://*/*`) — the API client and capture must work on any test host you choose, including localhost and internal stands. Host access is not used to read pages you didn't connect.

## User rights

Everything is local: uninstalling the extension deletes all stored data. You can also clear recordings and captured data from the extension UI at any time. Nothing to request, no one to email — you hold the only copy.

## Contact

This is an open-source project. File questions or concerns at https://github.com/solosenkov/easy-sniff-extension/issues

## License notice

The extension source code is MIT-licensed: https://github.com/solosenkov/easy-sniff-extension/blob/main/LICENSE