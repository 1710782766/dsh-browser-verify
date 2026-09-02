# dsh-browser-verify

English | [中文](README.zh.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-blue.svg)](package.json)

**Give your DeepSeek Harness a pair of eyes on any web page** — read-only
browser verification in ≤4 tool calls: open, mock, assert, screenshot.

Pages that change every day (H5 carousels, payment flows, admin consoles) are
hard to verify by eye. This plugin lets the model drive a real headless
browser through four tools — open a page, intercept its APIs, assert on the
DOM, screenshot it — and the screenshot lands straight back into the model's
context as an image. No terminal scripts, no browser bookkeeping: a
verification is just tool calls.

## Quick start

```sh
dsh plugin --profile web add dsh-browser-verify@0.1.2
```

1. **Install** with the command above (or see [Install](#install)).
2. **Restart the GUI once** — plugins load at boot; the four tools become
   visible only after the restart.
3. **Open a new session** and tell the model — or call directly:

```
browser_open  url="http://localhost:5173/hweb/#/pages/lyp/livingPayment" waitSelector=".header"
        Opens the page in a fresh headless session and returns
        title / status / visible-text / console-errors.

browser_assert  selector=".empty-wrap" text="暂无可用缴费服务"
        Waits for the selector (5s default) and returns {pass, count,
        actualText, elapsedMs}. A miss is a normal pass:false, never an error.
```

That is the whole loop — two calls to answer "does the page show the empty
state?"; add `browser_screenshot` when you need to see the layout, or
`browser_mock` first when the page needs mocked APIs (see below).

## What it does

| Tool | Purpose |
|---|---|
| `browser_open` | Open a URL in a fresh scenario (headless Chromium, default viewport 390×844 @2x) and report title / HTTP status / visible-text summary / console errors. Optional `waitSelector` waits for a key element before returning, and optional inline `mocks` intercept APIs **before** the first navigation — for pages that boot against mocked data. |
| `browser_mock` | Register a playwright-glob route (`**/api/*.do*`) returning your JSON, then auto-reload the page to show the mocked state — the quickest way to verify empty / error / abnormal states without touching the backend. Duplicate patterns are rejected with a hint. |
| `browser_assert` | The cheapest and most precise check: wait for a CSS selector, verify its count and contained text, return `{pass, count, actualText, elapsedMs}`. A mismatch is `pass:false` (with the diff), never a throw — so failure is a first-class result, not an error you debug. |
| `browser_screenshot` | Capture the current page (viewport or full page) and **auto-project the image block into the model context** — the model sees the layout without any file handling. Reports dimensions, sha256, and `identicalToPrevious:true` when the shot is byte-identical to the previous one (page probably not refreshed). |

Use `browser_assert` before `browser_screenshot`: an assertion is cheaper, and
a screenshot is for when the rendering itself must be judged.

### Worked example — two states, six calls

The typical verification (empty state + normal state) is 6 calls:

```
browser_open  url="…/livingPayment" mocks=[{urlPattern:"**/api/*.do*", json:{status:0,result:{list:[],data:{}}}}] waitSelector=".header"
browser_assert  selector=".empty-wrap"  text="暂无可用缴费服务"
browser_screenshot

browser_open  … (same url, mocks with one list item {wegType:"WATER",name:"水费",info:"128.00"})
browser_assert  selector=".grid-item"  text="水费"
browser_screenshot
```

## Install

```sh
dsh plugin --profile web add dsh-browser-verify@0.1.2
```

The version is pinned on purpose: pnpm 11 holds back packages published in the
last 24 hours, so a bare `add dsh-browser-verify` (latest) would silently
install the previous release on launch day. `--profile web` is the GUI profile
of this deployment — use your own profile name if it differs.

Requires **dsh ≥ 0.1.2-alpha.1**.

### Browser prerequisite (read this)

The plugin does **not** download Chromium — it finds a browser on your machine
instead. Install it once with:

```sh
npx playwright install chromium     # needs playwright-core@1.62.0
```

or point the plugin at an existing binary via `DSH_BROWSER_VERIFY_CHROMIUM`
(see [Environment variables](#environment-variables)). Without either, the
first `browser_open` fails with an actionable install hint.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BROWSER_VERIFY_CHROMIUM` | *(unset)* | Full path to a Chromium binary; wins over cache probing. If the path is wrong, startup fails with a hint. |
| `DSH_BROWSER_VERIFY_TIMEOUT` | `10000` | Wall-clock budget (ms) for the page-load path of `browser_open` (including wait-selector and mock reload). |
| `DSH_BROWSER_VERIFY_IDLE_MS` | `600000` | Idle window (ms) before the browser instance auto-closes; plugin disposal force-cleans in any case. |

## Reliability & housekeeping

- **One browser, one scenario** — a lazy singleton per process, FIFO-serialized
  tool access, an idle reclaim after 10 min, and a full teardown on dispose.
- **Screenshot dedup** — identical bytes report `identicalToPrevious:true`
  instead of re-sending the model the same image.
- **Garbage discipline** — the plugin writes only to the system temp dir
  (`dsh-browser-verify-*`), the harness attachment store, and explicit
  `--persist` paths. On host crashes, clean leftovers with:

  ```sh
  rm -rf "$(node -p 'require("os").tmpdir()')/dsh-browser-verify-*"
  ```

- **Error policy** — every error carries a `browser-verify: ` prefix and ends
  with actionable advice; verification "failures" are results (`pass:false`),
  never exceptions.

## Testing status

39 unit tests (fully offline — no browser needed), strict typecheck, and a
per-file ≥90% statement coverage gate. Verified **end-to-end in the real DSH
web GUI** on dsh 0.1.2-alpha.4: a two-state loop (empty + normal) against a
live uni-app H5 (hhhweb) in 6 tool calls, with screenshots auto-projected and
zero leftover temp dirs or zombie processes.

## Known limitations

- **Read-only**: no clicks, inputs, or scrolling — verification only. One
  scenario at a time; each `browser_open` resets mocks and page state.
- **Platform**: verified on macOS arm64. On other platforms set
  `DSH_BROWSER_VERIFY_CHROMIUM` to a browser binary.
- **Single-machine assumption**: the startup sweep only touches
  `dsh-browser-verify-*` pid dirs older than 1 h, so concurrent harnesses on
  one machine are safe.
- **No GUI config card** — configuration is env-var only (see above).

## Development

```bash
pnpm install
pnpm build            # tsc -b && tsdown → lib/ (clean build; lib/ is gitignored)
pnpm test             # vitest run (offline)
pnpm typecheck
pnpm vitest run --coverage   # per-file ≥90% gate on discover / cleanup / attachments
scripts/smoke.sh      # two-state end-to-end; requires the reference app dev server on :5173
```

CLI (harness-free debug path): `node lib/cli.js --url <u> [--mock <file.json>]
[--wait-selector <sel>] [--assert <sel>] [--screenshot] [--persist <dir>]
[--viewport <WxH>]`.

Contributors can install the local build with
`dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz` after
`pnpm build`; the tarball ships a prebuilt `lib/`, so no build step runs on
the installing machine.

## License & attribution

Apache-2.0. Architecture and implementation notes for agents and
contributors live in [AGENTS.md](AGENTS.md).
