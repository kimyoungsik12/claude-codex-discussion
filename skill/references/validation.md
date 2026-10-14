# v2.0.0 verification

Runtime: TypeScript bundled into a self-contained Node.js 22+ executable; Python is not required.

- Windows: 27 automated tests passed, plus TypeScript typecheck. Tests cover quota freshness/thresholds, pinned/reversed roles, explicit quota-error handoff, exact-hash agreement, concurrency, bounded execution, actual Node assertions, install rollback and v1 statusline migration.
- Real Windows workflow (2026-10-14): Claude Opus 5.5 (claude-opus-5-5), Codex gpt-6-astra with medium effort and Codex CLI 0.162.1 completed design, peer agreement, implementation, actual Node acceptance tests, and both reviews. Task was a small increment function, not a production application.
- Real quota collection: Claude five-hour/weekly stream events and Codex account/rateLimits/read. Observed Claude 46% minimum remaining and Codex 57%; default Claude selected. Low-quota switching was verified with synthetic test fixtures, not by exhausting a real account.
- Saved opus[1m] failed with model_not_found. Only the test config used the exact Opus 5.5 ID. Codex CLI 0.134.0 rejected gpt-6-astra; a temporary 0.162.1 install succeeded. Personal model settings were not changed.
- CI matrix runs the Node tests, typecheck and npm packaging on Windows, Ubuntu and macOS. Consult the linked CI run for the current result; actual authenticated model calls were tested on Windows only.

Run locally: npm ci, npm run typecheck, npm test, npm pack.

CLI help/doctor is not authentication or model-availability proof. Provider tests use controlled replies except the explicitly reported real smoke above. Agreement is not a guarantee of production correctness. Do not distribute local workflow logs containing private code.
