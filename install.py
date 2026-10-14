"""Portable local installer. No downloads, model calls, credentials or settings edits."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent
NAME = 'claude-codex-discussion'


def verify():
    manifest = json.loads((ROOT / 'manifest.json').read_text('utf-8'))
    for relative, digest in manifest.items():
        path = ROOT / relative
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Unsafe package path: ' + relative)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Package checksum mismatch: ' + relative)
    actual = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'skill').rglob('*')
              if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'}
    if actual != {p for p in manifest if p.startswith('skill/')}:
        raise ValueError('Unexpected or missing skill files')


def destinations(home, target):
    codex = Path(os.environ.get('CODEX_HOME', str(home / '.codex'))).expanduser()
    claude = Path(os.environ.get('CLAUDE_CONFIG_DIR', str(home / '.claude'))).expanduser()
    return [base / 'skills' / NAME for provider, base in [('codex', codex), ('claude', claude)]
            if target in ('both', provider)]


def install(home, target):
    verify()
    completed = []
    try:
        for dest in destinations(home, target):
            if dest.is_symlink() or (dest.exists() and not dest.is_dir()):
                raise ValueError('Destination must be a normal directory: ' + str(dest))
            dest.parent.mkdir(parents=True, exist_ok=True)
            stage = dest.parent / ('.pair-stage-' + uuid.uuid4().hex)
            shutil.copytree(ROOT / 'skill', stage,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            backup = None
            if dest.exists():
                backup = dest.parent.parent / 'skill-backups' / (NAME + '-' + uuid.uuid4().hex)
                backup.parent.mkdir(parents=True, exist_ok=True)
                dest.rename(backup)
            try:
                stage.rename(dest)
            except BaseException:
                if backup:
                    backup.rename(dest)
                raise
            completed.append((dest, backup))
            print('Installed: ' + str(dest))
            if backup:
                print('Previous version: ' + str(backup))
    except BaseException:
        for dest, backup in reversed(completed):
            failed = dest.parent.parent / 'skill-backups' / ('rolled-back-' + uuid.uuid4().hex)
            failed.parent.mkdir(parents=True, exist_ok=True)
            dest.rename(failed)
            if backup:
                backup.rename(dest)
        raise
    print('Restart your AI session to discover the skill. Settings and logins were not changed.')


def doctor():
    sys.path.insert(0, str(ROOT / 'skill/scripts'))
    from workflow import codex_command
    checks = [('claude', ['--safe-mode', '--restricted', '--output-format', '--json-schema']),
              ('codex', ['--ignore-user-config', '--ephemeral', '--output-schema'])]
    ok = True
    for name, required in checks:
        try:
            if name == 'codex':
                argv = codex_command()
            else:
                exe = shutil.which('claude.exe') or shutil.which('claude')
                if not exe:
                    raise ValueError('Claude CLI is not on PATH')
                argv = [exe]
            flags = ['exec', '--help'] if name == 'codex' else ['--help']
            result = subprocess.run(argv + flags, capture_output=True, text=True,
                                    encoding='utf-8', timeout=30,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            missing = [flag for flag in required if flag not in result.stdout]
            if result.returncode or missing:
                raise ValueError('CLI upgrade needed; missing flags: ' + ', '.join(missing))
            print(name + ': required CLI flags available')
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
            ok = False
            print(name + ': NOT READY: ' + str(exc))
    print('Login and model execution are NOT checked. Start claude and codex separately to sign in.')
    print('Setup links and troubleshooting: README.md')
    return 0 if ok else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'doctor', 'verify'], nargs='?', default='install')
    parser.add_argument('--target', choices=['both', 'claude', 'codex'], default='both')
    parser.add_argument('--home', type=Path, default=Path.home(), help='Alternate home for isolated installs')
    args = parser.parse_args()
    if sys.version_info < (3, 10):
        raise SystemExit('Python 3.10+ required; see README.md')
    if args.action == 'doctor':
        return doctor()
    if args.action == 'verify':
        verify()
        print('Package checksums verified (integrity, not publisher authentication).')
        return 0
    install(args.home.expanduser().resolve(), args.target)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Installation stopped: ' + str(exc), file=sys.stderr)
        sys.exit(1)
