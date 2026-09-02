# dsh-browser-verify

Read-only browser verification tools for the DeepSeek Harness web GUI — verify a page (H5/desktop) in **≤4 tool calls** with mock interception, DOM assertions, and screenshots that auto-project into the model context. If your verification fits the four tools below, this plugin beats ad-hoc toolchain setup (browser install, cache probing, script authoring, image inspection) roughly 4 calls to ~20 steps.

- **Registry**: `browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot`
- **Scope**: read-only verification only (no click/input/scroll). Runs headless Chromium via `playwright-core` (no browser download on the plugin side).
- **License**: Apache-2.0

## Install

> The plugin runs inside the harness process; install it into the harness profile. `dsh plugin` is invoked from the harness checkout.

### From a packed tarball (recommended for local/private use)

```bash
pnpm install && pnpm build && pnpm pack     # → dsh-browser-verify-<version>.tgz
dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz
```

### From a directory link (development)

```bash
pnpm build                                  # lib/ is gitignored — build first
dsh plugin --profile web add /path/to/dsh-browser-verify
```

### From a git URL (git+https)

pnpm installs a git dependency by cloning the repo and running its `prepare` script, so the remote repo must define `prepare` (build `lib/`), and the target profile must allow that build script via `allowBuilds` in its `pnpm-workspace.yaml`. The verified install paths for this repo are the packed tarball and the directory link above.

After install, restart the harness GUI, open a new session, and the four tools appear in the tool catalog.

## Quick start

```text
browser_open  url="http://localhost:5173/hweb/#/pages/lyp/livingPayment" waitSelector=".header"
        Opens the page in a fresh scenario (headless Chromium, default viewport 390×844 @2x) and
        returns title/status/visible-text/console-errors. Pass `mocks` here to intercept APIs before
        the first navigation, for pages that boot against mocked data.
```

```text
browser_mock  urlPattern="**/api/*.do*" json={status:0,result:{list:[],data:{}}} status=200
        Registers a playwright-glob route interception and auto-reloads the page to show the mocked
        state. Duplicate patterns error: browser_open a fresh scenario or use a different pattern.
```

```text
browser_assert  selector=".empty-wrap" count=1 text="暂无可用缴费服务"
        Waits for the selector (default 5s) and returns {pass, count, actualText, elapsedMs} —
        a miss is a normal `pass:false`, never a thrown error. This is the cheapest verification
        step; use it before ever taking a screenshot.
```

```text
browser_screenshot  name="livingPayment-empty" fullPage=false
        Captures the current page and auto-projects the image block into the model context;
        returns size/hash plus `identicalToPrevious:true` when the shot is byte-identical to the
        previous one (page probably not refreshed — re-open with browser_open).
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DSH_BROWSER_VERIFY_CHROMIUM` | *(unset)* | Full path to a Chromium binary; wins over cache probing. Checked for existence — startup fails with a hint if the path is wrong. |
| `DSH_BROWSER_VERIFY_TIMEOUT` | `10000` | Timeout (ms) for page load / wait-selector / mock reload; wraps `browser_open`'s page-load path only (the other tools are FIFO-serialized without a wall-clock timeout). |
| `DSH_BROWSER_VERIFY_IDLE_MS` | `600000` | Idle window (ms) before the browser instance auto-closes; plugin dispose force-cleans in any case. |

## Garbage cleanup

This plugin writes only to the system temp dir (its own `dsh-browser-verify-*` prefix), the harness attachment store, and `--persist` paths you choose explicitly. A startup sweep removes leftover dirs (>1 h old, own prefix) and kills stray Chromium; still, after a host crash the manual commands are:

```bash
# Temp dirs + profile dirs left by crashes (macOS tmpdir, not /tmp)
rm -rf "$(node -p 'require("os").tmpdir()')/dsh-browser-verify-*"
```

- **Attachment store**: screenshots persist to the harness-wide store at `~/.dsh/attachments` (content-addressed, identical bytes deduplicated). Their lifecycle is the harness attachment store's, not this plugin's — they are not deleted by tool exit.
- **Playwright cache**: first-run install (`npx playwright install chromium`, needs `playwright-core@1.62.0`) writes the machine cache (`~/Library/Caches/ms-playwright`). The whole directory can be deleted and reinstalled; the plugin also probes it for a usable binary instead of downloading anything itself.
- **Packed artifacts**: `*.tgz` from `pnpm pack` is gitignored; delete freely.

## Development

```bash
pnpm install
pnpm build            # tsc -b && tsdown  → lib/
pnpm test             # vitest run
pnpm vitest run --coverage   # per-file ≥90% statements gate on discover/cleanup/attachments
pnpm typecheck
node lib/cli.js --url 'http://localhost:5173/hweb/#/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-empty.json --wait-selector '.header' \
  --assert '.empty-wrap' --screenshot
scripts/smoke.sh      # two-state end-to-end; REQUIRES the hhhweb dev server on :5173
```

CLI options: `--url <u>` (required), `--mock <file.json>`, `--wait-selector <sel>`, `--assert <sel>`, `--screenshot`, `--persist <dir>` (keep the PNG), `--viewport <WxH>`.

## Moving to another machine

1. Copy/clone this repo and run `pnpm install && pnpm build && pnpm pack`.
2. `dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz` on the target machine.
3. The browser cache is **not** shipped with the repo: install once with `npx playwright install chromium` (or set `DSH_BROWSER_VERIFY_CHROMIUM` to an existing binary).

## Notes

- **Single-machine assumption**: the startup sweep assumes one harness instance per machine — it only removes `dsh-browser-verify-*` pid dirs older than 1 h (plus stray Chromium for those pids), so concurrent harnesses on one host keep their fresh dirs.
- **Platform**: verified on macOS arm64. On other platforms point `DSH_BROWSER_VERIFY_CHROMIUM` at a browser binary.

## Notes for real apps

- uni-app H5 pages use hash routes (`/hweb/#/pages/...`) and an API envelope of `{status, result}` — both confirmed against the reference app (hhhweb).
- Pages that re-route or bounce when real APIs answer “session invalid” need mocks registered **before** navigation: pass `mocks` to `browser_open` (or `--mock` to the CLI).
