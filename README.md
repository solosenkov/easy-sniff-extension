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
- English interface by default, with a persistent **RU** language switch in the top bar.
- Time Machine scenario packs: export complete captured text responses and WebSocket frames to a versioned JSON file, import a teammate's file, replay recorded HTTP responses in order per URL/method, and manually play incoming WS frames through the page's open socket.

Chrome displays a debugger notice while capture is active. Opening DevTools may disconnect the capture. Stopping capture also stops applying overrides to the page. The journal stores up to 300 requests and 300 WebSocket messages within a size budget; large or binary bodies may be truncated or unavailable. Starting capture on another tab resets the journal.

## Time Machine

Capture a tab, reproduce the flow, then open **Time Machine** and create a pack from the current session. Download its `.easysniff.json` file to share it. A teammate can import that file, start capture on their own test tab, then click **Start replay**. Repeat the application actions: recorded HTTP URLs and methods receive the saved responses in their original per-endpoint order, with recorded delays. Click **Play WS frames** after the page has opened its WebSocket connection to inject recorded incoming text frames in order. Stop replay when done.

Packs include only complete text responses and text WS frames. Enabled rules are included for reference and are not applied on import. The file can contain application data, so inspect it before sharing. Replay only intercepts recorded HTTP URLs; other requests still reach the network. Navigation, clicks, binary resources, and fully offline replay are outside this first version.

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
- Scenario replay intercepts recorded HTTP URLs and methods only. Other requests still go to the network; this is not a fully offline page recording. Clicks and navigation are not recorded. Review exported packs before sharing because response bodies may contain private data.

## Development

```sh
npm run build
npm run format:check
```
