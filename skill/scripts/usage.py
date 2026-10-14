"""Official Codex rate-limit RPC and Claude statusLine telemetry; never reads auth tokens."""
import argparse
import json
import math
import os
from pathlib import Path
import queue
import shlex
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path.home() / ".codex" / "discussions" / "usage"


def stream_entry(event, now=None):
    """Normalize real CLI telemetry, never the assistant's text or token/cost counters."""
    now = time.time() if now is None else now
    info = event.get("rate_limit_info")
    if event.get("type") != "rate_limit_event" or not isinstance(info, dict):
        return None
    raw_windows = info.get("unifiedWindows")
    if not isinstance(raw_windows, dict):
        name = info.get("rateLimitType")
        raw_windows = {name: info} if isinstance(name, str) else {}
    windows = []
    for name, item in raw_windows.items():
        if not isinstance(item, dict) or "overage" in name:
            continue
        utilization, reset = item.get("utilization"), item.get("resetsAt")
        if (type(utilization) not in (int, float) or not math.isfinite(utilization)
                or not 0 <= utilization <= 1 or type(reset) not in (int, float)
                or not math.isfinite(reset) or reset <= now):
            continue
        windows.append({"name": name, "remaining_percent": round(100 * (1 - utilization), 6),
                        "resets_at": reset})
    return {"source": "claude_cli_rate_limit_event", "observed_at": now, "windows": windows,
            "status": info.get("status"), "session_id": event.get("session_id")}


def store_claude(entry, root=None):
    root = ROOT if root is None else root
    # A renderer update with missing telemetry must not erase a valid headless observation.
    if not entry or not entry["windows"]:
        return False
    atomic_json(root / "claude.json", entry)
    return True


def parse_claude_stream(output, root=None, now=None):
    result, latest = None, None
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        entry = stream_entry(event, now)
        if entry and store_claude(entry, root):
            latest = entry
        if event.get("type") == "result":
            result = event
    return result, latest


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def claude_entry(data, now=None):
    now = time.time() if now is None else now
    windows = []
    for name, item in (data.get("rate_limits") or {}).items():
        if not isinstance(item, dict):
            continue
        used = item.get("used_percentage")
        reset = item.get("resets_at")
        if isinstance(used, (int, float)) and 0 <= used <= 100 and isinstance(reset, (int, float)) and reset > now:
            windows.append({"name": name, "remaining_percent": 100 - used, "resets_at": reset})
    return {"source": "claude_statusline", "observed_at": now, "windows": windows}


def codex_entry(data, now=None):
    now = time.time() if now is None else now
    groups = data.get("rateLimitsByLimitId") or {"codex": data.get("rateLimits")}
    windows = []
    # All available metered buckets: conservative, never select a supposedly free alternative bucket.
    for bucket, group in groups.items():
        if not isinstance(group, dict):
            continue
        for name in ("primary", "secondary"):
            item = group.get(name)
            if not isinstance(item, dict):
                continue
            used, reset = item.get("usedPercent"), item.get("resetsAt")
            if isinstance(used, (int, float)) and 0 <= used <= 100 and isinstance(reset, (int, float)) and reset > now:
                windows.append({"name": bucket + "/" + name, "remaining_percent": 100 - used, "resets_at": reset})
        if group.get("rateLimitReachedType") or group.get("spendControlReached"):
            windows.append({"name": bucket + "/reached", "remaining_percent": 0, "resets_at": now + 600})
    return {"source": "codex_account_rateLimits_read", "observed_at": now, "windows": windows}


def fetch_codex(timeout=20):
    from workflow import codex_command
    proc = subprocess.Popen(codex_command() + ["app-server"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, encoding="utf-8",
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    messages = queue.Queue()
    def reader():
        for line in proc.stdout:
            try:
                messages.put(json.loads(line))
            except ValueError:
                continue
        messages.put(None)
    threading.Thread(target=reader, daemon=True).start()
    def send(data):
        proc.stdin.write(json.dumps(data) + "\n")
        proc.stdin.flush()
    def response(expected):
        deadline = time.monotonic() + timeout
        while True:
            item = messages.get(timeout=max(0.01, deadline - time.monotonic()))
            if item is None:
                raise RuntimeError("Codex usage RPC ended")
            if item.get("id") == expected:
                if "error" in item:
                    raise RuntimeError("Codex usage RPC unavailable")
                return item["result"]
            if time.monotonic() >= deadline:
                raise RuntimeError("Codex usage RPC timed out")
    try:
        send({"id": 1, "method": "initialize", "params": {"clientInfo": {
            "name": "claude_codex_discussion", "title": "AI Pair Usage", "version": "2.0.0"}}})
        response(1)
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "account/rateLimits/read"})
        result = codex_entry(response(2))
        atomic_json(ROOT / "codex.json", result)
        return result
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def read_usage(refresh=True):
    entries = {}
    for provider in ("claude", "codex"):
        try:
            entries[provider] = json.loads((ROOT / f"{provider}.json").read_text("utf-8"))
        except (OSError, ValueError):
            pass
    if refresh:
        try:
            entries["codex"] = fetch_codex()
        except (OSError, ValueError, RuntimeError, queue.Empty):
            # Existing cache keeps its original observation time; caller rejects stale counters.
            pass
    return entries


def statusline():
    raw = sys.stdin.buffer.read()
    try:
        entry = claude_entry(json.loads(raw))
        store_claude(entry)
        atomic_json(ROOT / "statusline-health.json", {"last_invoked_at": time.time(),
                    "window_count": len(entry["windows"]), "error": None})
    except (OSError, ValueError, TypeError) as exc:
        # Do not log raw stdin: it can include paths and unrelated session metadata.
        try:
            atomic_json(ROOT / "statusline-health.json", {"last_invoked_at": time.time(),
                        "error": type(exc).__name__})
        except OSError:
            pass
    try:
        saved = json.loads((ROOT / "statusline-original.json").read_text("utf-8"))
        argv = saved.get("argv")
        if argv:
            result = subprocess.run(argv, input=raw, capture_output=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            sys.stdout.buffer.write(result.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass


def install():
    settings = Path.home() / ".claude" / "settings.json"
    raw = settings.read_bytes() if settings.exists() else b"{}"
    data = json.loads(raw.decode("utf-8-sig"))
    script = Path(__file__).resolve().as_posix()
    command = f'"{Path(sys.executable).as_posix()}" "{script}" statusline'
    prior = data.get("statusLine")
    if isinstance(prior, dict) and prior.get("command") == command:
        print("usage statusline already installed")
        return
    prior_command = (prior or {}).get("command", "")
    # Existing plain executable commands are preserved as argv, not interpreted as a shell script.
    if any(c in prior_command for c in "|&;<>`\n") or "$" in prior_command:
        raise ValueError("Complex existing statusline: preserve manually; auto installation stopped")
    argv = shlex.split(prior_command) if prior_command else []
    ROOT.mkdir(parents=True, exist_ok=True)
    backup = ROOT / ("settings-before-" + uuid.uuid4().hex + ".json")
    backup.write_bytes(raw)
    atomic_json(ROOT / "statusline-original.json", {"statusLine": prior, "argv": argv})
    if settings.exists() and settings.read_bytes() != raw:
        raise ValueError("Claude settings changed concurrently")
    data["statusLine"] = {**(prior or {}), "type": "command", "command": command}
    atomic_json(settings, data)
    print(json.dumps({"installed": True, "backup": str(backup), "preserved_previous_statusline": bool(prior)}))


def uninstall():
    settings = Path.home() / ".claude" / "settings.json"
    data = json.loads(settings.read_text("utf-8-sig"))
    if Path(__file__).resolve().as_posix() not in data.get("statusLine", {}).get("command", ""):
        raise ValueError("Statusline was changed by another editor; not overwriting")
    prior = json.loads((ROOT / "statusline-original.json").read_text("utf-8"))["statusLine"]
    if prior is None:
        data.pop("statusLine", None)
    else:
        data["statusLine"] = prior
    atomic_json(settings, data)
    print("Original statusline restored; other settings preserved")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["statusline", "install", "uninstall", "read"])
    action = parser.parse_args().action
    if action == "statusline":
        statusline()
    elif action == "install":
        install()
    elif action == "uninstall":
        uninstall()
    else:
        print(json.dumps(read_usage(), ensure_ascii=False))
