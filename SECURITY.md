# Security and privacy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/solosenkov/easy-sniff-extension/security/advisories/new) when available. If that channel is unavailable, open an issue titled **Security contact request** without vulnerability details, and ask the maintainer for a private reporting channel. Do not put real credentials, private recordings, or an exploit against someone else's service in a public issue. A private report should include the affected version, reproduction on a local fixture, expected behavior, and impact. There is no guaranteed response SLA.

## Data handling

Easy Sniff has no application backend or analytics. Capture and recordings remain in the browser unless you export them. API requests go to the URL you specify; AI requests go directly to your selected model provider.

Provider keys, saved requests, history, and environments are stored locally without encryption or browser sync. They are not a credential vault. Recording video and HTTP details are stored in IndexedDB until you delete them or remove the extension.

AI context redacts common credential fields and known provider keys. This is best-effort filtering, not a guarantee that arbitrary application data is anonymous. Inspect the context and choose a provider suitable for your data. AI-generated traffic changes are proposals requiring a user action.

Bug Replay's **Full HTTP details** setting is off by default. Enabling it intentionally stores raw URLs, headers, cookies, Authorization values, and available bodies in the recording and exported ZIP. Normal recording summaries hide common secret query parameters, but videos and console messages can still reveal sensitive data.

## Permissions

| Permission                | Purpose                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `debugger`                | Read Chrome DevTools Protocol network/console events and apply traffic overrides to the connected tab. |
| `tabs`, `activeTab`       | Select a tab and obtain the user's tab-capture grant after clicking the extension icon.                |
| `tabCapture`, `offscreen` | Record the selected tab using an offscreen media recorder.                                             |
| `storage`                 | Save local settings and workspace data.                                                                |
| `scripting`               | Support extension interaction with page contexts.                                                      |
| HTTP/HTTPS host access    | Send API/model requests to user-selected endpoints and work with test pages on different hosts.        |

Capture applies to the connected tab. The extension has powerful permissions; use it on applications you are authorized to test and inspect the source if needed.

## Supported release

Use the latest release. Security fixes are made on the current version; older versions do not have a separate maintenance policy.
