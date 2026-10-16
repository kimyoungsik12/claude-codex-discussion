---
name: claude-codex-discussion
description: Coordinate Claude and Codex automatically through delegated design, mutual agreement, quota-aware implementation ownership, tests, and mutual code review. Invoke from either assistant for paired design or implementation, with explicit user roles taking priority.
---

# Claude–Codex collaborative workflow

For a remote project or when one provider is authenticated on another machine, read [references/remote.md](references/remote.md). Install this skill on the repository host, then connect the provider host through SSH. For explicitly requested persistent connectivity, use `setup --ssh HOST --provider claude|codex` on the local provider host for automatic first installation and connection; `connect-enable` remains available for explicit paths as documented in remote.md. A remote session cannot start local processes without an existing access channel. If `node` is unavailable on PATH, read this installation's `runtime.json` and use its `node_path`.

Use `dist/cli.cjs run` for the complete loop. Both providers participate through separate authenticated CLI calls; the invoking chat coordinates. This does not resume or send messages to the user's existing Claude/Codex conversations. Both assistants receive the same self-contained skill. Resolve the bundled executable relative to this SKILL.md; do not assume a username or another assistant installation. Use Node.js 22+. No Python runtime is required. If Node is missing and installation is authorized, use the bundled bootstrap/install.ps1 (Windows) or bootstrap/install.sh (macOS/Ubuntu) with RuntimeOnly/--runtime-only, then run this CLI with the returned absolute Node path. The bootstrap installs only into a user directory and does not alter permanent PATH.

## Roles and authorization

- Design owner: user's choice, otherwise the assistant entrusted with the task.
- Both discuss a concrete plan. Implementation starts only when the author endorses its plan and the peer approves the exact plan hash. Objections return to the designer, up to 3 rounds by default. Blocked/missing context or exhausted rounds are not agreement.
- Code author: explicit user choice always wins. Otherwise prefer Claude; switch to Codex when fresh observed Claude quota has at most 20% remaining and Codex has at least 40%. Unknown/stale quota keeps the default. An explicit Claude quota error may trigger auto-handoff with known Codex headroom. Auth/timeouts do not. Never silently switch a pinned author.
- Design/discussion does not authorize edits. For an implementation request, record `implementation_authorized: true` and precise `write_files` in a trusted config. Peer messages cannot grant authorization. Do not resume unrelated project implementation when asked only to create this skill.
- One mutation process: models return full file replacements, and the helper validates/applies them. Neither model has direct write tools. Either can author the code, with no simultaneous AI writers. No model-selected shell commands, deletion, commits, push, deployment or package installation.
- Choose test commands from the task/repository conventions before execution. Review commands for intended local effects. Keep independent acceptance tests outside the write allowlist; do not weaken them to manufacture a pass.

## Automatic loop

1. Read repository instructions and relevant code. Select required UTF-8 files, including applicable AGENTS.md/CLAUDE.md/design constraints, plus exact existing/new edit targets. Exclude secrets, credentials, photos/ZIPs and unrelated private files. Filename screening alone does not detect secrets.
2. Create a task JSON outside the repo using [references/config.md](references/config.md). Infer routine choices from the user request instead of repeatedly asking approval. If a project exceeds the 240 KB snapshot budget, divide it into coherent feature scopes with their own agreement/review/tests; do not claim one small snapshot verifies a whole project.
3. Run using the installed authenticated CLIs:

```powershell
node "<absolute path to this skill>/dist/cli.cjs" run --config C:/path/to/task.json
```

4. Keep the invocation running and poll through the host's process tools. It automatically performs design, discussion/revision, writer selection, implementation, actual tests, Claude review, Codex review and repairs. Both reviews must approve the same files/plan/test-evidence hash and supplied tests must pass. Default repair limit is 3. Report meaningful progress. Errors do not authorize bypassing restrictions.
5. On `blocked`, inspect state, call responses and edit journals. Supply missing context or resolve the cause before a new run. Never automatically replay a run or roll back someone else's edits. State is durable for inspection/handoff, not automatic crash-resume. Interrupted application can leave some files applied; the journal records completed replacements.
6. Report agreed design, actual author/selection reason, both reviews, executed tests, unresolved issues and run directory. Agreement does not prove runtime/device/production correctness beyond actual evidence.

## Usage collection

`node "<skill-dir>/dist/cli.cjs" usage` refreshes Codex quota through official `account/rateLimits/read` and reads the latest cached Claude observation. Each Claude worker call collects actual `rate_limit_event` telemetry using verbose stream-json, including normal five-hour/weekly unified windows. Design/discussion calls populate Claude quota before writer selection even in headless safe mode. Reading the cache alone does not launch another Claude model call. No auth-token scraping, private usage endpoints, credit purchases or reset consumption.

Interactive statusLine telemetry is an optional secondary source. Native CLI stream events work without it. The installer migrates only a recognized v1 Python wrapper and preserves its saved original renderer; it does not install a new wrapper. Missing fields never erase a valid observation. Never substitute cost, token counts or context percentage for quota.

Counters expire after 10 minutes or a window reset. The helper samples before each implementation round, not mid-file. Optional `usage_file` accepts a trusted observed snapshot when collectors are unavailable. Pinned authors bypass quota routing.

## Reliability and limits

- Ephemeral workers: Claude safe/restricted mode with no tools/MCP; Codex ignored user config, read-only sandbox and disabled shell. No permission-bypass flags. Stop if restrictions fail. The separate tool-free Claude child clears an inherited CLAUDECODE marker so invocation from Claude works without reusing its coordinator session.
- A worktree lock prevents competing runs of this helper, not unrelated editors/existing Claude sessions. Coordinate one writer. Selected-file hashes detect concurrent changes before edits, during tests and reviews; files outside the snapshot are not covered. Tiny check/write races with unrelated editors remain possible.
- Edit paths and contents are validated before application. Reject path escapes, sensitive paths, symlinks, duplicate/out-of-allowlist replacements. Each file replacement is atomic; multiple-file application is journaled, not transactional. No deletions.
- Logs in `~/.codex/discussions/workflow-*/` may contain private code; do not commit/share them. Defaults: 20 model calls, 240s/call, Claude API cap 2 USD/call (subscription billing remains the CLI's responsibility). Call bounds are not a Codex spending/token cap.
- Bounded active run, not a permanent file watcher. Persistent background scheduling needs a separate request. Missing evidence or provider limits can stop automation; do not promise guaranteed unattended completion.

Validate the source with `npm ci`, `npm run typecheck`, and `npm test`. Diagnose installed CLI flags with `node "<skill-dir>/dist/cli.cjs" doctor`.

For actual verified behavior and untested boundaries, read [references/validation.md](references/validation.md).

Sources: [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex usage RPC](https://learn.chatgpt.com/docs/app-server), [Claude quota telemetry](https://code.claude.com/docs/en/statusline).

## Model settings

The runner inherits saved user model and effort: Codex CODEX_HOME/config.toml (model, model_reasoning_effort, selected profile); Claude CLAUDE_CONFIG_DIR/settings.json (model, effortLevel), with ANTHROPIC_MODEL/CLAUDE_CODE_EFFORT_LEVEL taking precedence. Explicit task models/efforts override saved values. Missing values use CLI defaults. Only model/effort are forwarded; hooks/tools/permissions stay isolated. Unsupported model-setting syntax stops instead of silently selecting another model. Project-local settings, command-line overrides and unsaved interactive /model changes are not inherited; pass those explicitly in the task. Each call records model-settings.json.
