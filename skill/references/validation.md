# v2.3.0 laptop SSH flow (2026-10-16)

- Installed the laptop SSH login hook once. Stopped the old connector, moved its saved connection out of the bridge registry and removed only Claude's remote bridge endpoint. No pairing/setup was performed between the ordinary SSH login and the remote Codex run.
- Ordinary OpenSSH login launched the hidden local helper and created a new connection. The remote command confirmed Claude executable was absent, started Codex CLI 0.162.1 (gpt-6.1-sol), and asked it to use the installed discussion skill.
- Remote Codex read SKILL.md, ran wait-bridge (ready), then the design workflow. Remote Codex proposed the design; local Claude reviewed over ssh_bridge; final state design_agreed, artifact 7b0aba26b88cdbd15529218fde98a75f7654dfe5296e9eec4b0c1b354da548d0. No implementation was requested or performed.
- Live record: workflow-0194e4df-3fe8-419e-9145-5ee80ad2ec82 on the test account. The Claude smoke call explicitly used claude-opus-5-5; personal model defaults were preserved.
- Earlier restricted test sessions correctly failed: network-disabled workspace sandbox could not reach loopback, and a sandbox allowing only the discussion log folder could not initialize the nested Codex app-server. Successful verification allowed network and the test user's ~/.codex runtime directory in that invocation only. Installer does not weaken sandbox or alter permission policy.
- Windows native LocalCommand quoting was exercised through real SSH; portable native-shell tests also cover paths with spaces. No authenticated macOS-to-server or reverse-provider account test is claimed by CI alone. New aliases need laptop hook refresh; custom LocalCommand, alternate SSH configs and multiple laptops on the same remote port remain documented boundaries.

# v2.2.1 current-task discovery verification

- Five new tests cover app host ID vs misleading project labels, endpoint port/account matching, conflicting context rejection, equivalent aliases vs different proxy routes, editor remote URIs/Unicode and SSH Include cycles.
- Local Windows: 45 passed, one POSIX-only provisioning test skipped; typecheck, packaged install and skill validation passed.
- Actual app project hostId resolved to 11_webserver. Independently, hostname/port/user matched the same alias through local ssh -G. Setup using app-derived context established the live bridge without a user-selected SSH alias. The context file was collected/written by the agent, not the user.
- Discovery reads only local configuration. It does not scan servers or infer identity from repository remotes. App metadata collection requires the invoking agent's tools; an isolated remote session still cannot launch a disconnected local provider PC.

# v2.2.0 verification (2026-10-16)

- Automatic `setup --ssh HOST --provider claude` discovered the remote Node and skill locations, installed both ends, registered Windows login startup, and established the authenticated reverse SSH tunnel on the existing Linux host. No remote paths were supplied.
- Fresh isolated Linux HOME with PATH=/usr/bin:/bin: setup downloaded checksum-verified private Node and installed the transferred skill without npm, root, or system package changes.
- `setup --provider claude` reused the single saved server. After intentionally terminating the SSH child, the supervisor reconnected and remote doctor reported the bridge reachable.
- Provider-specific config directory and executable paths are pinned for login startup. Credentials are not copied. Setup requires an already trusted SSH destination and locally installed/authenticated provider CLI; it does not discover arbitrary PCs or enter containers.
- Final local suite: 40 passed, one POSIX-only setup test skipped on Windows; typecheck passed. Windows/macOS/Ubuntu CI runs package installation, remote provision script where applicable, and actual private Node bootstrap.
- Historical development notes below describe earlier checkpoints, not the release status. Physical OS reboot/login and opposite-provider live account testing remain outside this verification.

# v2.1.0 remote bridge verification

- 33 automated tests plus TypeScript typecheck and packed npm installation passed locally on Windows. Bridge tests cover bearer authentication, provider/action isolation, loopback-only destinations, real caller-side file application/tests, cancellation and provider errors. The CI matrix runs the same suite on Windows, Ubuntu and macOS.
- Actual Windows provider -> Linux SSH repository test (2026-10-14): remote Codex skills/list discovered the installed skill. Local Claude model settings and quota were read through a reverse SSH tunnel, listening only on remote 127.0.0.1.
- A complete isolated workflow passed: local Claude Opus 5.5 designed, remote Codex reviewed, automatic quota routing selected remote Codex (Claude 17%, Codex 51% remaining), implementation was applied on Linux, actual Node assertions passed, and both reviewers approved. No real project files were edited.
- The successful run used a dedicated Codex CLI 0.162.1. Earlier attempts with the app's 0.154.0 returned service 503/429 errors; this does not establish a version incompatibility. The app-managed binary was not replaced. Opus 5.5 was an explicit smoke-test override; saved model preferences were preserved.
- Live opposite-provider bridging (local Codex serving a remote Claude coordinator) and macOS provider-host execution have not been authenticated end-to-end. Both providers share the bridge transport; automated tests cover the constraints, not all platform accounts.

The local connect process must remain running. It is not a startup service and does not automatically resume interrupted work. Logs can contain private selected source. CLI flag/health checks do not prove a model is available. Consensus does not guarantee production correctness.

Run: npm ci; npm run typecheck; npm test; npm run test:package.


## 2026-10-16: 2.2.0-dev.0 local installation (not published)

- Initial live diagnosis: SSH alias 11_webserver, account intflow, host INTFLOWTitanRTX1. Remote skill exists under /home/intflow/.agents/skills/claude-codex-discussion; saved connection exists but doctor returned ECONNREFUSED on 127.0.0.1:47831. Local bridge was not running.
- Implemented named connection supervisor, bounded 1..60 second reconnect backoff, login startup registration, stop/status commands, captured executable directories, bounded logs, OS-owned single-instance lock. Interrupted model calls and workflows are never replayed.
- Moved remote token registration after successful SSH forwarding. Actual second connection on occupied port failed without breaking the original authenticated bridge.
- Windows typecheck and all 36 tests passed; packed package installation verified both standalone skill runtimes. Three supervisor tests also passed on Ubuntu with Node 22.22.2.
- Actual Windows->Linux SSH tunnel process terminated intentionally. Supervisor recorded disconnected -> retry_wait -> connecting -> connected in approximately two seconds. Remote doctor passed afterward. Authenticated Claude request returned HTTP 200 and approved artifact reconnect-live-check-20261016.
- Windows Startup VBS entry registered and invoked directly after stopping the supervisor; connection resumed. This is launcher execution, not a physical reboot/login test.
- Claude test explicitly used claude-opus-5-5. Personal default model settings were not changed.
- macOS login and Ubuntu graphical login autostart have not been exercised on devices. Linux autostart requires a graphical desktop session. Reverse local-Codex/remote-Claude direction remains untested with live accounts.
- Current install is a development build. No npm publication, Git commit/push or production application edits were performed for this change.


## 2026-10-16: private Node bootstrap

- Added PowerShell 5.1/7 and POSIX sh entrypoints. Node 22+ is reused; otherwise pinned official Node 22.22.2 is downloaded into the user's runtime directory. All six Windows/macOS/Linux x64/arm64 archive SHA-256 values were checked against nodejs.org/dist/v22.22.2/SHASUMS256.txt.
- Windows x64: removed Node from the child PATH, downloaded/extracted/ran private Node. A fresh PowerShell 5.1 smoke test downloaded again into an isolated root, installed the skill using that runtime, verified CLI execution and runtime.json, then verified cached runtime reuse and existing-PATH reuse. PowerShell 7 was also used for the initial missing-Node test.
- Ubuntu x64 (11_webserver, intflow): PATH=/usr/bin:/bin had no Node; native shell bootstrap downloaded/extracted/ran private Node. Isolated skill install/runtime.json/CLI execution, cached reuse and existing-PATH reuse passed.
- Checksum-mismatch tests passed on Windows and Ubuntu; corrupted downloads were rejected before extraction and staging files removed. Full local suite: 37 passed; TypeScript check and packaged standalone installation passed.
- macOS x64/arm64 and Windows/Linux arm64 are implemented but not executed on hardware in this task. Added real bootstrap smoke to the Windows/macOS/Ubuntu CI matrix; that new workflow has not been pushed/run. Do not describe macOS as runtime-verified.
- No system packages, persistent PATH, login credentials or datahub container changes. Windows private runtime is under LOCALAPPDATA/claude-codex-discussion/runtime; POSIX under ~/.local/share/claude-codex-discussion/runtime.
- Development changes remain unpublished (2.2.0-dev.0); a standalone bootstrap without a bundled package installs published 2.1.0. Installation of provider CLIs and provider login remain separate.
