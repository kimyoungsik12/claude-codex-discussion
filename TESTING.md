# v2.1.0 remote bridge verification

- 33 automated tests plus TypeScript typecheck and packed npm installation passed locally on Windows. Bridge tests cover bearer authentication, provider/action isolation, loopback-only destinations, real caller-side file application/tests, cancellation and provider errors. The CI matrix runs the same suite on Windows, Ubuntu and macOS.
- Actual Windows provider -> Linux SSH repository test (2026-10-14): remote Codex skills/list discovered the installed skill. Local Claude model settings and quota were read through a reverse SSH tunnel, listening only on remote 127.0.0.1.
- A complete isolated workflow passed: local Claude Opus 5.5 designed, remote Codex reviewed, automatic quota routing selected remote Codex (Claude 17%, Codex 51% remaining), implementation was applied on Linux, actual Node assertions passed, and both reviewers approved. No real project files were edited.
- The successful run used a dedicated Codex CLI 0.162.1. Earlier attempts with the app's 0.154.0 returned service 503/429 errors; this does not establish a version incompatibility. The app-managed binary was not replaced. Opus 5.5 was an explicit smoke-test override; saved model preferences were preserved.
- Live opposite-provider bridging (local Codex serving a remote Claude coordinator) and macOS provider-host execution have not been authenticated end-to-end. Both providers share the bridge transport; automated tests cover the constraints, not all platform accounts.

The local connect process must remain running. It is not a startup service and does not automatically resume interrupted work. Logs can contain private selected source. CLI flag/health checks do not prove a model is available. Consensus does not guarantee production correctness.

Run: npm ci; npm run typecheck; npm test; npm run test:package.
