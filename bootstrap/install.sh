#!/bin/sh
# User-owned Node bootstrap. No sudo, shell profile changes or global installs.
set -eu
version=22.22.2
runtime_only=0
private=0
target=both
root=${AI_PAIR_RUNTIME_HOME:-"$HOME/.local/share/claude-codex-discussion/runtime"}
package_root=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --runtime-only) runtime_only=1; shift ;;
    --private) private=1; shift ;;
    --root) root=$2; shift 2 ;;
    --target) target=$2; shift 2 ;;
    --package-root) package_root=$2; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$root" in /*) ;; *) echo 'Runtime root must be absolute' >&2; exit 2;; esac
case "$target" in both|claude|codex) ;; *) echo 'Invalid target' >&2; exit 2;; esac
usable() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; }
node=''
if [ "$private" -eq 0 ] && command -v node >/dev/null 2>&1; then
  candidate=$(command -v node)
  if usable "$candidate"; then node=$candidate; fi
fi
if [ -z "$node" ]; then
  case "$(uname -s)" in Darwin) system=darwin;; Linux) system=linux;; *) echo 'Unsupported OS' >&2; exit 2;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64;; arm64|aarch64) arch=arm64;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
  case "$system-$arch" in
    darwin-arm64) checksum=db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000;;
    darwin-x64) checksum=12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba;;
    linux-arm64) checksum=b2f3a96f31486bfc365192ad65ced14833ad2a3c2e1bcefec4846902f264fa28;;
    linux-x64) checksum=978978a635eef872fa68beae09f0aad0bbbae6757e444da80b570964a97e62a3;;
  esac
  name=node-v$version-$system-$arch
  mkdir -p "$root"
  root=$(cd "$root" && pwd -P)
  node=$root/$name/bin/node
  if [ ! -x "$node" ]; then
    # mkdir serializes concurrent bootstrap invocations; never remove someone else's lock.
    lock=$root/.install-lock
    if ! mkdir "$lock" 2>/dev/null; then echo "Another installation is active (or interrupted): $lock" >&2; exit 2; fi
    stage=$(mktemp -d "$root/.stage.XXXXXX")
    trap 'rm -rf "$stage"; rmdir "$lock"' EXIT
    archive=$stage/node.tar.gz
    if command -v curl >/dev/null 2>&1; then
      curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 "https://nodejs.org/dist/v$version/$name.tar.gz" -o "$archive"
    elif command -v wget >/dev/null 2>&1; then
      wget --https-only --timeout=30 --tries=2 -O "$archive" "https://nodejs.org/dist/v$version/$name.tar.gz"
    else
      echo "Download requires curl or wget; no system packages were installed" >&2; exit 2
    fi
    if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$archive" | cut -d ' ' -f 1); elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1); else echo "SHA-256 verification requires sha256sum or shasum" >&2; exit 2; fi
    if [ "$actual" != "$checksum" ]; then echo 'Node SHA-256 mismatch; archive rejected' >&2; exit 2; fi
    tar -xzf "$archive" -C "$stage"
    if ! usable "$stage/$name/bin/node"; then echo 'Downloaded Node cannot run on this OS/libc' >&2; exit 2; fi
    if [ -e "$root/$name" ]; then echo 'Existing private runtime is incomplete; inspect it before replacing' >&2; exit 2; fi
    mv "$stage/$name" "$root/$name"
    rm -rf "$stage"; rmdir "$lock"; trap - EXIT
  fi
  if ! usable "$node"; then echo 'Private runtime is unusable; no system changes made' >&2; exit 2; fi
fi
# Executable path only on stdout; installers/downloaders use stderr.
printf '%s\n' "$node"
if [ "$runtime_only" -eq 1 ]; then exit 0; fi
PATH="$(dirname "$node"):$PATH"; export PATH
if [ -z "$package_root" ]; then
  bundled_root=$(cd "$(dirname "$0")/.." && pwd -P)
  if [ -f "$bundled_root/dist/cli.cjs" ] && [ -f "$bundled_root/skill/SKILL.md" ]; then package_root=$bundled_root; fi
fi
if [ -n "$package_root" ]; then
  [ -f "$package_root/dist/cli.cjs" ] || { echo 'Built package required' >&2; exit 2; }
  "$node" "$package_root/dist/cli.cjs" install --target "$target"
else
  command -v npx >/dev/null 2>&1 || { echo 'Node exists but npm/npx is missing; retry with --private' >&2; exit 2; }
  npx --yes @youngsik1/claude-codex-discussion@2.3.0 install --target "$target"
fi
