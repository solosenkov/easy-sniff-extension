# Easy Sniff 3

A local QA workspace for Chrome and Chromium browsers. Capture traffic, inspect responses, replay API requests, prepare overrides, decode payloads, and ask your own AI model for help. The tool opens in a separate window.

## Install without Node.js

1. Download **`easy-sniff-v3.5.0.zip`** from [GitHub Releases](https://github.com/solosenkov/easy-sniff-extension/releases/tag/v3.5.0).
2. Unzip it into a permanent folder. `manifest.json` must be directly inside that folder.
3. Open `chrome://extensions` (or your Chromium browser's extensions page) and enable **Developer mode**.
4. Click **Load unpacked**, select the unzipped folder, then click the Easy Sniff icon.

The repository and release are currently private. Team members need repository access to download the ZIP. To update, replace the extracted files, click **Reload** on the extension card, and reopen its window.

For development with Node.js 22.12+:

```sh
npm install
npm run build
```

Then load the `dist` folder via **Load unpacked**. `npm run dev` serves a browser preview, but traffic capture and overrides require the installed extension.

## What it does

- API client with cURL import/export, request tabs, query parameters, headers, JSON or text bodies, Bearer auth, timeout, cancellation, collections, and local environments.
- Network capture for one selected browser tab. Filter by All, XHR, Fetch, WS, Images, Documents, Scripts, Styles, or Other. Search, inspect headers and available text bodies, copy URLs and raw response bodies, and export JSON.
- WebSocket view showing captured connections, status, URL topics, message counts, and incoming/outgoing frames. Its scenario panel can send text through the page's socket, inject a synthetic incoming message into the app, and save rules that replace future incoming text messages. Start capture before the connection opens and reload the test tab. Worker sockets and already-open sockets are not controllable. URL topics are shown when present; hidden subscriptions require reading captured frames.
- Response mocks (including HTTP 500), request changes, header changes, blocking, and delay. Select a request in Network and click **Modify** to prepare a rule from it. Rules affect future traffic on the connected tab only. A mock returns a synthetic response before the request reaches the server.
- JSON, JWT, Base64, URL, and WebSocket payload decoding.
- Bug Replay records one tab as WebM alongside a synchronized timeline of console messages, HTTP requests and responses, WebSocket metadata, errors, and QA markers. Review it locally, then export a ZIP with `report.html`, `video.webm`, and `session.json`. This feature is available in the v3.6.0 source build; the linked v3.5.0 release predates it.
- English interface by default, with a persistent **RU** language switch in the top bar.

Chrome displays a debugger notice while capture is active. Opening DevTools may disconnect the capture. Stopping capture also stops applying overrides to the page. The journal stores up to 300 requests and 300 WebSocket messages within a size budget; large or binary bodies may be truncated or unavailable. Starting capture on another tab resets the journal.

## Bug Replay

Open the page to record and click the Easy Sniff extension icon on that tab. In the tool window, open **Bug Replay**, confirm the tab, and click **Start recording**. Chrome grants tab capture to the tab where you invoked the extension. Reproduce the bug and click **Bug appeared** to mark the moment; then click **Stop**. The recording has a five-minute limit and also stops when the tab closes. Select the saved session to review its video and timeline. Red markers indicate console errors, uncaught exceptions, failed requests, and HTTP 4xx/5xx responses. Click a marker or event to jump to that point. **Download ZIP** produces an offline report for a developer: unzip it, then open `report.html` beside `video.webm`.

Recordings stay in this browser's IndexedDB until deleted. The export omits request/response bodies and headers. It strips common secret query parameters from URLs and common keys from console text, but the video itself may show sensitive data. Review it before sharing. Opening DevTools on the recorded tab can disconnect Easy Sniff's debugger; video may continue briefly, but technical events stop and the recording is finalized. Bug Replay documents what happened; it does not replay user actions or network traffic.

## AI assistant (beta)

Open **AI** in the top bar or **Ask AI** on a captured request. Add an **OpenAI-compatible endpoint**, OpenRouter, Ollama Cloud, local Ollama, or LM Studio in the connection settings. Enter your own API base URL, model ID, and API key if needed. You can load `/models`, test tool calling, and set a model timeout from 30 to 900 seconds (default: 600). Multiple connections can be saved and switched locally.

For example, ask the assistant to find a request and prepare a 500 response. It returns an editable proposal; click its action to open or save the rule, then enable the rule and repeat the request. AI proposals do not silently change live traffic. The assistant can also find and decode captured WebSocket events, prepare a modified incoming event or a disabled replacement rule while preserving Base64/compression, inspect scoped data, prepare API requests and environments, and propose capture controls or exports. A previously received WS event cannot be changed retroactively; inject a modified copy manually or enable an exact-match rule for a future identical frame.

When the traffic scope is selected, the assistant previews the newest 40 non-WebSocket requests for prompt size but searches the entire current capture buffer. It refreshes that buffer before each tool action, so requests arriving during a slow model turn can be found. Select a specific request in Network and use **Ask AI** when you want to pin the assistant to that request.

Requests to the model go directly from your browser to the chosen provider. Common credentials are redacted from context, but captured traffic may still contain sensitive data; choose a provider you trust. Provider keys are stored without encryption in `chrome.storage.local` (or `localStorage` in preview), with no sync or Easy Sniff server. Chat history lasts only while the tool window is open.

## Limitations

- The API client uses browser `fetch`; browser-managed headers such as Cookie, Host, Origin, and User-Agent cannot be set manually. CORS applies in the browser preview. TLS verification cannot be disabled.
- cURL import parses commands locally; it never runs a shell. Multipart files, HTTP/2 options, and shell expansion are not supported.
- Captured HTTP bodies are limited to 24,000 characters and WebSocket frames to 8,000 characters. Binary frames are shown as supplied by Chrome DevTools Protocol.
- WebSocket topic discovery reads URL query parameters; it cannot infer server-side subscriptions it has not seen. WS scenarios operate on text messages opened in the page context after capture starts; synthetic and replaced events are local to the app, and the network journal keeps raw server frames. Compressed or encoded app protocols require payloads in the same format.
- JWT decoding does not verify the signature.
- Collections, history, environments, and provider settings are stored on this device and may contain tokens.

## Development

```sh
npm run build
npm run format:check
```
