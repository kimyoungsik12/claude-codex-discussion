"""Regenerate package checksums and ZIP from this clean distribution tree."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
EXCLUDE = {'__pycache__', '.ruff_cache', '.pytest_cache', '.git'}


def files():
    return sorted(p for p in ROOT.rglob('*') if p.is_file()
                  and not EXCLUDE.intersection(p.relative_to(ROOT).parts)
                  and p.suffix not in {'.pyc', '.zip'} and p.name != 'manifest.json')


if __name__ == '__main__':
    selected = files()
    # Git checkouts on every OS must match the release checksum bytes.
    for path in selected:
        raw = path.read_bytes()
        path.write_bytes(raw.replace(b'\r\n', b'\n'))
    manifest = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in selected}
    (ROOT / 'manifest.json').write_bytes((json.dumps(manifest, indent=2) + '\n').encode('utf-8'))
    archive = ROOT.parent / 'claude-codex-discussion-v1.0.1.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as out:
        for path in selected + [ROOT / 'manifest.json']:
            out.write(path, 'claude-codex-discussion/' + path.relative_to(ROOT).as_posix())
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(checksum + '  ' + archive.name + '\n', 'utf-8')
    print(str(archive))
