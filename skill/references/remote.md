# Remote repository, local provider

The skill is discovered on the host executing the task. Installing on a laptop does not install it on an SSH host. Confirm the app project's actual host/user, not just its display name: a project name and SSH alias can differ.

Install on the repository host with `npx @youngsik1/claude-codex-discussion@latest install --target codex`. Fresh Codex installs go into `~/.agents/skills/claude-codex-discussion`. Existing legacy installs or CODEX_HOME remain supported. Reload the remote session if needed. Node.js 22+ is required on both hosts. Each installed skill has `runtime.json` containing the absolute `node_path`; use it when Node is not on PATH. The app may install its own Codex binary without Node/npm.

## Automatic first connection (2.2)

Run `setup --ssh HOST --provider claude` on the authenticated local provider PC. One explicit SSH alias is the only initial connection input. With exactly one matching previously registered connection, `setup --provider claude` reuses it. Multiple or missing identities fail rather than guessing or probing every SSH host.

Setup transfers only the packaged skill/runtime over strict authenticated SSH, bootstraps private Node when needed, installs the remote peer skill, installs a durable local provider skill outside npx caches, registers login startup and waits for the tunnel. No remote-cli or remote-node paths are needed. It preserves provider credentials and model settings; provider CLI installation/login is a separate prerequisite. An existing same-named host/provider connection is stopped and restarted. Do this when no workflow is actively using that connection.

The remote-only assistant cannot discover an unknown laptop. Ask the local assistant to run setup once. The SSH target account must be authorized for user-directory installation; setup does not enter Docker containers or change system packages. For existing configured users, both sides use the installed version transferred from the invoking package rather than a different npm version.

## Connect without copying login credentials

Run on the machine already authenticated to the provider (normally the local laptop). The repository host needs SSH access from that machine and the installed skill. This helper supports POSIX SSH hosts; the local provider host can be Windows, macOS or Linux.

```sh
node /absolute/local/skill/dist/cli.cjs connect --ssh devbox --provider claude --remote-cli /home/user/.agents/skills/claude-codex-discussion/dist/cli.cjs --remote-node /absolute/remote/node
```

Omit `--remote-node` if `node` is in the remote noninteractive PATH. Use the repository host's own paths, not the local paths. Use `--provider codex` for the reverse arrangement. `--remote-port` defaults to 47831; use a distinct unused port for each simultaneous connection.

The command starts a loopback-only local provider service, registers a random connection token over authenticated SSH stdin, and maintains reverse port forwarding. It prints `bridge_connected` only after SSH confirms setup. Keep the process running; closing it, sleeping the laptop or losing SSH makes the provider unavailable. Restart `connect` to replace the session token and reconnect. The one-shot `connect` command does not install startup integration. For explicitly requested persistent connectivity, use `connect-enable` below. Use the host's process tools to run it in the background when the user requests a working connection; on Windows hide the helper window. Preserve its PID/log location for stopping it.

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

## Automatic login startup and reconnection (2.2)

On the local provider host, after verifying the SSH alias and remote paths:

```sh
node /absolute/installed/skill/dist/cli.cjs connect-enable --name devbox --ssh devbox --provider claude --remote-cli /home/user/.agents/skills/claude-codex-discussion/dist/cli.cjs --remote-node /absolute/remote/node
node /absolute/installed/skill/dist/cli.cjs connect-status --name devbox
node /absolute/installed/skill/dist/cli.cjs connect-disable --name devbox
```

`connect-enable` starts a hidden supervisor now and registers login startup: Windows Startup VBS, macOS LaunchAgent, or Linux desktop autostart. Linux headless SSH login is not a desktop login; start `connect-watch --config <connection.json>` under your existing process manager there. Paths are absolute and provider/SSH executable directories are captured. Use an installed skill path, not an ephemeral npx cache, for durable startup.

Only the connection is retried, with 1/2/4/.../60-second bounded backoff. No failed model call, edits, or workflow is automatically replayed. SSH keepalive detects a dead connection; network outages may take about 45 seconds to be detected, followed by backoff and SSH setup. Authentication or host-key failures remain failures; no credentials or host checks are bypassed. The machine must be awake and the user logged in. This does not install a boot-time system service or guarantee recovery if the supervisor itself is forcibly killed.

Per-connection configuration, bounded event logs and status are under `~/.codex/discussions/bridges/<name>/`. `connected` is the last transport event, not proof of provider authentication. Verify with remote `doctor` and a small real provider request. An OS-owned named-pipe (Windows) or loopback socket lock prevents multiple supervisors for the same SSH alias/provider; a conflicting lock port is reported rather than bypassed. Use one connection per remote account/provider; different aliases to the same account are not deduplicated. Port-forward setup must succeed before updating remote authentication, so a port collision cannot invalidate an existing connection.

`connect-disable` removes this named login entry and requests stop; the supervisor shuts its child down. It leaves remote provider routing configured but unavailable, rather than silently falling back to another account. Re-enable with the same arguments to resume. Do not change personal model settings during connectivity setup; test overrides should be stated explicitly.


## Current-task discovery: collect evidence before asking the user

The invoking AI must resolve the current remote task itself when its tools expose the information. Do not ask the user to translate a project name into an SSH alias.

1. In Codex desktop, inspect list_projects and, when needed, list_threads/read_thread to identify the CURRENT task's project/host. Pass the exact hostId `remote-ssh-discovered:ALIAS`. Project labels (dashboard, api-gateway) are not SSH aliases. Never select a different recent chat as the current task. Managed host IDs are opaque: obtain the actual endpoint from available connection metadata.
2. In CLI/editor sessions inspect VSCODE_REMOTE_AUTHORITY, remote workspace folders and existing connection records. Setup automatically reads PAIR_REMOTE_CONTEXT JSON, VSCODE_REMOTE_AUTHORITY and JSON .code-workspace SSH folders before saved connections. JSONC workspace comments require agent/editor inspection. Git remotes do not identify deployment hosts.
3. On a remote host, collect hostname, user, SSH_CONNECTION and cwd using read-only commands, then check the existing provider bridge with doctor. NAT means the SSH_CONNECTION server address/port can differ from the public endpoint. Do not mistake the SSH client IP for a reachable authenticated local service. If an authorized local execution channel exists, use it for setup; otherwise report that missing channel precisely. Never install a local-provider connector on the remote machine by mistake.
4. On the LOCAL provider PC write a temporary JSON outside the repository from verified metadata: {"hostId":"remote-ssh-discovered:ALIAS"} or {"hostname":"public-host","port":1122,"user":"intflow"}. Run `discover --context FILE` for read-only diagnosis or `setup --context FILE --provider claude` to connect immediately. The AI creates this file; the user does not. SSH -G expands the local configuration. Identical endpoint/account/proxy aliases resolve deterministically. Current conflicting context never falls back to an unrelated saved bridge.
5. With a unique identity, proceed without another confirmation, then check connect-status and remote doctor. When no current context exists, a single saved bridge remains a convenience fallback, not proof of the currently open project. Ambiguous identities require additional evidence, never an arbitrary connection. Do not present a menu of aliases before attempting these steps.

The CLI cannot read app-only metadata itself: the skill instructs the invoking AI to collect it with available tools. This does not add IP scanning, credential copying, host-key bypass or a way to start a disconnected local PC from an isolated remote session.
