# Safe examples

All examples contain fictional data. They are intended for learning and screenshots, not access to an external service.

- `demo-server.mjs`: run with `node examples/demo-server.mjs`, then open `http://127.0.0.1:4318`. It provides a tiny shop, a successful items API, a failing save API, and a text WebSocket echo endpoint. It binds only to localhost and is a demonstration server, not a production WebSocket implementation.
- `request.curl`: import this command into the API client while the demo server is running.
- `network.json`: an example of the current network JSON export shape. The extension does not import this as an automated scenario.
- `bug-replay-session.json`: an illustrative exported report dataset with HTTP details and synthetic timeline events. The demo release ZIP pairs it with a video of the fictional shop; unzip and open `report.html` to explore it.

There is no `.easysniff.json` scenario-pack format in the current release. Bug Replay shares evidence with a developer; it does not repeat browser actions.
