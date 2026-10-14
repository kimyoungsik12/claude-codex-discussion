# Validation evidence (2026-10-14)

- `python -X utf8 -m unittest discover -s <skill>/scripts -p "test_*.py"`: 15 tests passed.
- `python -m ruff check <skill>/scripts`: passed.
- Bundled skill-creator quick_validate passed for both Codex and Claude skill entrypoints.

Live authenticated CLI checks, using isolated temporary Python fixtures rather than the user's project:

1. Claude designer, Codex design reviewer, automatic default Claude writer, real unittest execution, Claude and Codex code review: **completed**.
   Evidence: `~/.codex/discussions/workflow-fea960a7098247748d0e37bb927a0823/state.json`.
2. Codex designer, Claude design reviewer, explicitly pinned Codex writer, real unittest execution, both code reviews: **completed**.
   Evidence: `~/.codex/discussions/workflow-bc95af67cc934480b0197a74e2d095fd/state.json`.
3. Codex account/rateLimits/read integration returned current quota through a local app-server process. No token files were read by this helper.
4. Claude statusLine wrapper preserves the existing GSD command. Executing it through Git Bash returned exit 0, GSD output and no stderr. The missing cache was caused by relying on interactive statusLine updates while workers run in headless safe mode, which does not invoke the renderer.
5. Both runners now consume verbose stream-json `rate_limit_event` telemetry. Actual authenticated headless calls returned five-hour/weekly utilization; overage windows are excluded. Missing statusLine fields cannot erase valid cached observations. A recent observation was Claude 59% five-hour / 75% weekly remaining; these are point-in-time values.
6. Real collection/default routing: actual quota collection, automatic Claude selection, implementation, unittest and both reviews **completed**.
   Evidence: `~/.codex/discussions/workflow-e8391208e5154b5ca1ae2647af28ce86/state.json`; per-call `usage-observed.json` records native telemetry.
7. Automatic switch: a separate usage_file supplied **synthetic Claude 10%**, marked `synthetic_threshold_test_not_live`, alongside observed Codex 72%. The runner selected Codex with reason `claude_remaining_le_20_codex_ge_40`. Real Codex implementation, actual unittest and both reviews **completed**. The synthetic value never replaced the global live cache.
   Evidence: `~/.codex/discussions/workflow-46eacc7d25fd490baa8e89a882be54fa/state.json`.

Initial end-to-end attempt stopped on Windows cp949 output encoding after implementation; progress logging was changed to ASCII-safe JSON and rerun successfully. Prior partial run was not silently treated as complete or rolled back.

Quota-driven switching and quota-error handoff were exercised with synthetic counters/errors; no actual account quota was deliberately exhausted. Existing desktop conversations were not resumed or messaged. Actual initiation from the Claude UI's slash-command picker remains untested; its installed entrypoint calls the same validated runner. Large repositories, real-project acceptance, production/device behavior and automatic crash-resume are not covered by these small fixture checks.

Historical run identifiers belong to the author's machine; private transcripts are not distributed. See package TESTING.md for portable installer validation.
