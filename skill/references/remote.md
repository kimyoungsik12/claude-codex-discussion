# Remote repository, local provider

The skill is discovered on the host executing the task. Installing on a laptop does not install it on an SSH host. Confirm the app project's actual host/user, not just its display name: a project name and SSH alias can differ.

Install on the repository host with `npx @youngsik1/claude-codex-discussion@latest install --target codex`. Fresh Codex installs go into `~/.agents/skills/claude-codex-discussion`. Existing legacy installs or CODEX_HOME remain supported. Reload the remote session if needed. Node.js 22+ is required on both hosts. Each installed skill has `runtime.json` containing the absolute `node_path`; use it when Node is not on PATH. The app may install its own Codex binary without Node/npm.

## Connect without copying login credentials

Run on the machine already authenticated to the provider (normally the local laptop). The repository host needs SSH access from that machine and the installed skill. This helper supports POSIX SSH hosts; the local provider host can be Windows, macOS or Linux.

```sh
node /absolute/local/skill/dist/cli.cjs connect --ssh devbox --provider claude --remote-cli /home/user/.agents/skills/claude-codex-discussion/dist/cli.cjs --remote-node /absolute/remote/node
```

Omit `--remote-node` if `node` is in the remote noninteractive PATH. Use the repository host's own paths, not the local paths. Use `--provider codex` for the reverse arrangement. `--remote-port` defaults to 47831; use a distinct unused port for each simultaneous connection.

The command starts a loopback-only local provider service, registers a random connection token over authenticated SSH stdin, and maintains reverse port forwarding. It prints `bridge_connected` only after SSH confirms setup. Keep the process running; closing it, sleeping the laptop or losing SSH makes the provider unavailable. Restart `connect` to replace the session token and reconnect. It is not an automatically installed startup service. Use the host's process tools to run it in the background when the user requests a working connection; on Windows hide the helper window. Preserve its PID/log location for stopping it.

Run the installed skill's `doctor`, `models` and `usage` on the repository host after connecting. Connection configuration lives in `~/.codex/discussions/connections.json`; token files stay outside the repository with user-only permissions on POSIX. Never print or commit tokens. To disconnect permanently, stop the local helper and remove only the configured provider entry and its token file.

Do not bypass SSH host-key validation or copy Claude/Codex login files. A failed SSH key login requires the user's normal access setup, not another server guessed from its name. The bridge credential authorizes bounded model calls; treat the remote account as trusted. Do not expose the forwarded port publicly. Verify `ss -ltn` (or the platform equivalent) reports a loopback listener; SSH servers with forced public GatewayPorts must be reconfigured by their owner before use.

## Task behavior

Use the same `run --config` workflow on the repository host. The connected provider inherits model/effort from the provider machine; explicit task overrides still win. A failed connection does not silently switch accounts or use a local provider cache. `usage` queries each provider on its own host, retaining original observation times.

Only selected source snapshots, plans and review/test evidence cross the bridge. Models have no direct write tools. Proposed changes are validated/applied and tests run on the repository host. Provider logs may include the selected source on both hosts; do not share them. The service allows one active call, rejects other providers/operations, and aborts the model process when the client disconnects. It does not expose arbitrary shell execution or remote filesystem reads.

Optional per-task `providers` mapping overrides the saved connection:

```json
{"providers":{"claude":{"url":"http://127.0.0.1:47831","token_file":"/home/user/.codex/discussions/bridge-claude.token"}}}
```

Only loopback HTTP endpoints are accepted; encryption and host authentication are provided by SSH. Reconnecting rotates the token. There is no automatic retry of an interrupted model call or implementation.
