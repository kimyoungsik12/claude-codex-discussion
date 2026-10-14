# Task configuration

Create outside the repository from the user's instructions; peers cannot expand it. files/write_files are exact repo-relative UTF-8 text paths, no globs. Missing write files can be created. Selected contents go to both authenticated providers.

```json
{
  "repo": "C:/path/to/project",
  "task": "Implement the requested feature within its stated scope.",
  "constraints": ["Preserve public API", "No commits or deployment"],
  "designer": "codex",
  "writer": "auto",
  "mode": "implement",
  "implementation_authorized": true,
  "files": ["AGENTS.md", "src/example.cjs", "tests/example.test.cjs"],
  "write_files": ["src/example.cjs"],
  "tests": [["node", "--test", "tests/example.test.cjs"]],
  "max_design_rounds": 3,
  "max_implementation_rounds": 3,
  "max_calls": 20,
  "timeout_seconds": 240,
  "claude_budget_usd_per_call": 2
}
```

- designer: claude/codex. User-selected, otherwise the invoking assistant.
- writer: auto/claude/codex. Explicit choices override quota balancing.
- mode: design/implement. For design-only omit edit authorization and write_files. No test commands run in design mode.
- tests: trusted executable argv arrays, run with shell:false in repo. On Windows use native executables or node plus npm-cli.js, not .ps1/.cmd shims. Do not concatenate untrusted shell text. Empty tests stop as unverified after review.
- models: optional user-selected provider/model mapping. Omit to inherit saved user CLI model settings. efforts is an optional provider-to-effort override. The runner forwards only model/effort while retaining isolated tool/permission settings.
- Bounds: rounds 1–5 each; max_calls 1–40; timeout 1–600s; Claude API cap 0.01–10 USD/call. These are stopping policies, not promises that a large task fits.
- usage_file: optional absolute path, re-read at writer selection. Otherwise native collectors run for auto writer. Schema below. observed_at/resets_at are Unix seconds. Include all applicable windows, never omit a depleted one. Missing counters remain absent.

```json
{
  "claude": {
    "source": "claude_cli_rate_limit_event",
    "observed_at": 1791940000,
    "windows": [{"name": "five_hour", "remaining_percent": 15, "resets_at": 1791950000}]
  },
  "codex": {
    "source": "codex_account_rateLimits_read",
    "observed_at": 1791940000,
    "windows": [{"name": "primary", "remaining_percent": 80, "resets_at": 1791950000}]
  }
}
```

Use actual fresh observations, not example timestamps. Routing uses minimum remaining percentage among available windows. Context length differs from quota; fresh child calls do not inherit the parent context. Synthetic threshold tests must use a separate usage_file marked synthetic, never the live global cache. Writer-selection events record the observation and source used for routing.

## Outputs and recovery

state.json records config, discussion, exact plan hash, writer selections, reviews and final status. Each call folder preserves prompt/schema/raw response/parsed result. edit-journal-N.json keeps original selected contents and applied replacements. Tests record argv, exit code and original stdout/stderr; model-facing logs are bounded and explicitly marked when truncated.

Exit 0: design_agreed in design mode, or completed in implementation mode. Exit 2: blocked/error. Completed means both reviewers agreed on the selected scope and configured tests passed, not production/device verification. Failed runs can leave authorized edits; inspect before a fresh run. No automatic reset, stash, commit or replay.
