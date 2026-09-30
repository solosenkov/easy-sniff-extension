# Contributing

Try Easy Sniff on a demo application, report reproducible bugs, or propose a small improvement to a QA workflow. This is an early project; focused contributions are welcome.

## Local setup

Use Node.js 22.12 or later and npm.

```sh
npm ci
npm test
npm run build
npm run format:check
```

Load `dist/` as an unpacked extension. After rebuilding, reload the extension in `chrome://extensions` and reopen its tool window. `npm run dev` provides a UI preview; browser traffic capture requires the installed extension.

The public `test/` suite uses fake data and local HTTP fixtures. It does not require provider credentials or access to a private application. `docs/`, `tests/`, and `output/` are excluded local working directories.

## Pull requests

Explain the user-visible problem, the resulting behavior, and the checks you ran. Keep generated builds, recordings, provider keys, private endpoints, and screenshots of real customer data out of commits. Use `example.test` or local fixtures in tests. Add a regression test when it covers a meaningful behavior.

## Feedback

Use the bug report or feature request template. Include the browser version, Easy Sniff version, and a minimal reproduction. Review and sanitize attachments before uploading them: full HTTP Bug Replay reports can contain credentials. See [SECURITY.md](SECURITY.md) for vulnerability reports.
