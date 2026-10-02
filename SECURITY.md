# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately, by email to **rhyneer.silas@gmail.com**. Do not open a public GitHub issue or pull request for a suspected vulnerability.

Include what you found, the version (`capture --version`) and platform, and the steps or a proof of concept that reproduce it. If the report involves a token, cookie or credential, redact it.

Reports are read by a single maintainer, and no response time is guaranteed. Fix timelines depend on severity and on what the fix involves. Say in your report if you want credit in the fix.

## Supported versions

Fixes land on `main` and ship in the next published release of [`@crouton-kit/capture`](https://www.npmjs.com/package/@crouton-kit/capture). Only the latest published version is supported.

## What is in scope

The code in this repository: the `capture` CLI and the files it writes. Of particular interest:

- The Chrome DevTools Protocol endpoint capture opens being reachable from anywhere other than the local machine.
- Session artifacts, HAR files, screenshots and the collector sockets under `/tmp/capture-sockets` being readable or writable by another user.
- A page capture is attached to reading local files or capture's own state, beyond what the page could already do in the browser.

capture drives a real browser, including one you are already signed into, and `page exec` runs JavaScript in the page. HAR files and artifacts contain what the page sent and received, cookies and tokens included. That is what it is for, not a vulnerability. Keep artifact directories private, and review them before you share them.
