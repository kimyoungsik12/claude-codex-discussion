#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Python 3.10+ required. See README.md.' >&2
  exit 1
fi
exec python3 -X utf8 install.py "$@"
