# Claude Code Session Monitor

Electron desktop app that monitors local Claude Code sessions in real time. It tails the JSONL
transcripts Claude Code writes under `~/.claude/projects/` and shows a live-updating list of
sessions with status, context usage, token counts, and running cost.

## Features

- **Live monitoring** — watches `~/.claude/projects/**/*.jsonl` with chokidar and tails new
  lines incrementally (per-file byte offsets, no re-reading).
- **Cost tracking** — sums `message.usage` from assistant records, deduplicated by message id,
  with per-model pricing (input / output / cache-write / cache-read). Subagent transcripts
  (`<session>/subagents/*.jsonl`) are attributed to their parent session's cost.
- **Context usage** — estimates the live context window fill from the latest assistant turn's
  usage against the model's context window.
- **Status inference** — running / completed / interrupted / error, inferred from recency and
  the shape of the trailing records (there is no explicit end-of-session record).
- **Persistence** — aggregated session rows are stored in SQLite (`better-sqlite3`) in the app's
  user-data directory, so history survives Claude Code's ~30-day transcript auto-purge.

## Install (no build required)

Download the latest release for your platform from
[GitHub Releases](https://github.com/morgstrum/Claude-Code-Session-Monitor/releases):

- **macOS** — `.dmg` (or `.zip`) for Apple Silicon (`arm64`) and Intel (`x64`)
- **Windows** — `.exe` installer
- **Linux** — `.AppImage`

The builds are not notarized with Apple / signed with a Windows cert (no paid developer
certificates), so on first launch:

- **macOS**: Gatekeeper blocks the app — depending on macOS version it says "unidentified
  developer" or claims the app is **"damaged"** (it isn't). Either allow it via
  System Settings → Privacy & Security → **Open Anyway**, or run:

  ```sh
  xattr -cr "/Applications/Claude Code Session Monitor.app"
  ```

- **Windows**: SmartScreen may warn — choose **More info → Run anyway**.

## Install from source (macOS — no Gatekeeper warnings)

Apps built locally never get the quarantine attribute, so this path has no security
prompts at all:

```sh
git clone https://github.com/morgstrum/Claude-Code-Session-Monitor.git
cd Claude-Code-Session-Monitor
npm install
npm run install:app   # builds for your architecture and installs to /Applications
```

## Releasing

Releases are built by [GitHub Actions](.github/workflows/release.yml). **Bump `version` in
package.json to match the tag first** — electron-builder names artifacts and picks the GitHub
release from package.json, not the git tag (CI fails fast on a mismatch):

```sh
npm version 0.2.0 --no-git-tag-version   # or edit package.json
git commit -am "v0.2.0" && git tag v0.2.0 && git push origin main v0.2.0
```

Local packaging: `npm run dist:mac` (or `dist:win` / `dist:linux`) — output lands in `release/`.

## Development

```sh
npm install        # also rebuilds better-sqlite3 against Electron
npm run dev        # launch the app with hot reload
npm test           # vitest suite for the parser/aggregator/tailer core
npm run typecheck  # strict TS across main + renderer
npm run build      # production bundles into out/
```

**After running `npm run dist`/`dist:mac`, run `npx electron-rebuild -f -w better-sqlite3` before
`npm run dev`** — the multi-arch mac build finishes on Intel and leaves an x64 build of the
native SQLite module in `node_modules`, which fails to load in dev on Apple Silicon. If dev
fails with "Electron uninstall" instead, re-run `node node_modules/electron/install.js`.

Headless smoke test (parses all local transcripts, prints a JSON snapshot, exits):

```sh
npm run build && SESSION_MONITOR_SMOKE=1 npx electron .
```

## Architecture

```
src/
  core/       Electron-free, unit-tested pipeline
    tailer.ts      incremental JSONL line reader (byte offsets, partial lines, truncation)
    parser.ts      defensive typed view over transcript records
    aggregator.ts  per-session aggregation: tokens, cost, context, status, title
    pricing.ts     per-model pricing table + context windows
  main/       Electron main process
    monitor.ts     chokidar watcher -> tailer -> parser -> aggregator, debounced pushes
    db.ts          SQLite persistence (upsert per session)
    index.ts       app bootstrap + IPC
  preload/    contextBridge API (`window.sessionMonitor`)
  renderer/   React session list (sortable, filterable, live)
```

The transcript schema is not a stable public API and changes across Claude Code versions —
the parser is deliberately defensive (verified against Claude Code 2.1.x transcripts). Notable
schema realities: cost must be aggregated from every assistant record's `message.usage` (there
is no final cost summary record); one API response can span multiple assistant records sharing
a `message.id`, so usage is deduplicated; session titles come from `ai-title` records.

## Out of scope (for now)

- Multi-machine / team aggregation (possible v2: shared ingestion endpoint).
- Historical trend charts.
