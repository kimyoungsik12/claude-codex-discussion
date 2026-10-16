# AI installation guide (Node bootstrap added in 2.2)

## Laptop once, then ordinary SSH (2.3.0)

On the laptop with Claude already signed in, run once:

```sh
npx --yes @youngsik1/claude-codex-discussion@2.3.0 install-laptop --provider claude
```

Then SSH normally, start Codex on the server, and invoke the discussion skill. No per-server setup command or local terminal action is needed for registered aliases. The SSH login hook launches a hidden local helper; it provisions the remote skill/private Node and starts the authenticated bridge. Remote `wait-bridge` and `run` wait for readiness. Claude is never installed on the server. Only login/setup runs automatically; model work starts when the skill is invoked.

The hook applies to existing explicit aliases in the laptop's OpenSSH config; rerun install-laptop after adding aliases. It preserves existing user LocalCommand settings and reports skipped aliases. Alternate -F configs, custom LocalCommand/PermitLocalCommand=no, non-OpenSSH clients and changed host/user/port overrides may bypass it. Existing host-key/SSH and provider authentication must work non-interactively for the helper. Model sandbox must allow loopback bridge requests, the provider API and writes to its own CLI runtime directory (Codex typically ~/.codex); network-disabled Codex shells cannot use the bridge. No sandbox permissions are changed by installation.

The background connector can outlive SSH logout and reconnects transport only, never replays model work. `connect-disable --name NAME` stops a named connector; `uninstall-laptop` removes the owned SSH login hook (existing connectors are stopped separately). The SSH config is backed up before changes. Remote readiness waits up to eight minutes to cover first-time private Node installation; failures remain explicit. Multiple laptops targeting the same remote port are not automatically merged.


Install only when requested. Do not start project edits or model workflows as part of installation.

1. Check Node.js 22+ and npm. If Node is missing or older, use the native bootstrap below. Inspect metadata with `npm view @youngsik1/claude-codex-discussion@2.3.0`. This repository contains the source.
2. Run `npx --yes @youngsik1/claude-codex-discussion@2.3.0 install`. Default installs both assistants. Use `--target codex` or `--target claude` if requested.
3. Run `npx --yes @youngsik1/claude-codex-discussion@2.3.0 doctor` and `npx --yes @youngsik1/claude-codex-discussion@2.3.0 models`.
4. Missing CLI/login: direct the user to official Claude Code / Codex CLI installation and login. Never request passwords/tokens or copy credentials. Supported flags do not prove model availability. Update user CLIs only with authorization.
5. Report installed paths, backups and prerequisites. Open a new AI session. Do not install Python.

Windows, macOS and Ubuntu use identical commands; WSL is separate. Existing skills are backed up. Recognized v1 Python statusline links migrate to Node, preserving the saved renderer; other settings stay unchanged.

Source alternative: `npm ci`, `npm run typecheck`, `npm test`, then `node dist/cli.cjs install`.

If npm returns E404 while the new package is being processed, install the verified v2 release tarball instead:

```sh
npx --yes --package https://github.com/kimyoungsik12/claude-codex-discussion/releases/download/v2.3.0/youngsik1-claude-codex-discussion-2.3.0.tgz claude-codex-discussion install
```

The release tarball uses the same Node runtime. In Windows PowerShell, use `npx.cmd` if the PowerShell shim alters arguments. After installation, run `node "<installed-skill>/dist/cli.cjs" doctor`.

For SSH projects, install on the actual remote host/user too. If a provider is authenticated only on the local machine, follow skill/references/remote.md. Discover the actual project host instead of assuming the project display name is its SSH alias. Do not copy provider credentials.


## No usable Node.js: native user-folder bootstrap

Read the script before execution. In an extracted package or built checkout:

Windows (PowerShell 5.1 or 7):

```powershell
& ./bootstrap/install.ps1
```

macOS / Ubuntu:

```sh
sh ./bootstrap/install.sh
```

These entrypoints require neither Node nor Python. POSIX hosts need sh, tar, curl or wget, and sha256sum or shasum; the script reports missing tools rather than installing system packages. They reuse a working Node 22+ on PATH; otherwise they download pinned Node 22.22.2 from nodejs.org and verify an embedded SHA-256 from its official SHASUMS256.txt. They support x64 and arm64; do not use Linux glibc archives on Alpine/musl or unsupported older systems. Failed download/hash/execution checks stop installation.

Default private location: Windows `%LOCALAPPDATA%/claude-codex-discussion/runtime`, macOS/Ubuntu `~/.local/share/claude-codex-discussion/runtime`. No administrator privileges, apt/brew/global npm installation, login credentials, shell profile edits or persistent PATH changes. The installer records the absolute Node path in each skill's runtime.json. Use it for later runs when Node is not globally available.

`-RuntimeOnly` / `--runtime-only` installs or discovers only Node and prints its executable path. `-Private` / `--private` forces a private runtime, useful when system Node lacks npm. `-Root` / `--root` selects an absolute runtime directory. `-Target codex` / `--target codex` selects one assistant. `-PackageRoot` / `--package-root` points to a built package; a sibling dist/cli.cjs plus skill/SKILL.md package layout is used automatically. The flat installed-skill layout is not treated as a source package. A separately downloaded bootstrap without a bundled CLI installs the published 2.3.0 package, the released version.

For a Node-less host reached by an AI, transfer the reviewed native bootstrap script (and built package when using an unpublished version), then execute it there. Do not instruct a Node-less user to start with npx. Container user-home storage must be persistent if the installation should survive recreation; installation authorization still applies to that host.

Verification: `npm run test:bootstrap` performs real download/hash verification, runtime reuse, isolated skill installation and execution. CI runs this on Windows/macOS/Ubuntu. A configured CI job is not evidence of a completed run.


## One-command remote setup

On the local authenticated provider PC run `npx --yes @youngsik1/claude-codex-discussion@2.3.0 setup --ssh HOST --provider claude` (or codex). Infer HOST from the user's intended project and verified SSH mapping; never scan all hosts or guess identity. This installs the peer skill and private Node as needed on that SSH account and enables local login startup/reconnect. No remote paths are required. With one previously registered matching host, omit --ssh for repair. A remote-only session cannot start an unknown local PC; initiate setup from the local assistant once. No unattended model workflows start during setup.
