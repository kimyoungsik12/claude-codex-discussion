# AI installation guide (v2)

Install only when requested. Do not start project edits or model workflows as part of installation.

1. Verify Node.js 22+ and npm. Inspect metadata with `npm view @youngsik1/claude-codex-discussion@2.0.0`. This repository contains the source.
2. Run `npx --yes @youngsik1/claude-codex-discussion@2.0.0 install`. Default installs both assistants. Use `--target codex` or `--target claude` if requested.
3. Run `npx --yes @youngsik1/claude-codex-discussion@2.0.0 doctor` and `npx --yes @youngsik1/claude-codex-discussion@2.0.0 models`.
4. Missing CLI/login: direct the user to official Claude Code / Codex CLI installation and login. Never request passwords/tokens or copy credentials. Supported flags do not prove model availability. Update user CLIs only with authorization.
5. Report installed paths, backups and prerequisites. Open a new AI session. Do not install Python.

Windows, macOS and Ubuntu use identical commands; WSL is separate. Existing skills are backed up. Recognized v1 Python statusline links migrate to Node, preserving the saved renderer; other settings stay unchanged.

Source alternative: `npm ci`, `npm run typecheck`, `npm test`, then `node dist/cli.cjs install`.

If npm returns E404 while the new package is being processed, install the verified v2 release tarball instead:

```sh
npx --yes --package https://github.com/kimyoungsik12/claude-codex-discussion/releases/download/v2.0.0/youngsik1-claude-codex-discussion-2.0.0.tgz claude-codex-discussion install
```

The release tarball uses the same Node runtime. In Windows PowerShell, use `npx.cmd` if the PowerShell shim alters arguments. After installation, run `node "<installed-skill>/dist/cli.cjs" doctor`.
