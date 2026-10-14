import os
from pathlib import Path
import tempfile
import unittest
import shutil
from unittest.mock import patch

import install


class InstallTests(unittest.TestCase):
    def test_corrupt_package_rejected_before_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            package = (Path(tmp) / 'package').resolve()
            shutil.copytree(install.ROOT, package,
                            ignore=shutil.ignore_patterns('__pycache__', '.ruff_cache'))
            (package / 'skill/SKILL.md').write_text('damaged', 'utf-8')
            with patch.object(install, 'ROOT', package), patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                    install.install(Path(tmp) / 'user', 'both')
            self.assertFalse((Path(tmp) / 'user').exists())

    def test_fresh_update_and_settings_preserved(self):
        with tempfile.TemporaryDirectory(prefix='pair home ') as tmp:
            home = Path(tmp)
            with patch.dict(os.environ, {}, clear=True):
                install.install(home, 'both')
                for base in ('.claude', '.codex'):
                    dest = home / base / 'skills' / install.NAME
                    self.assertTrue((dest / 'scripts/workflow.py').is_file())
                    (home / base / 'settings.json').write_text('{"keep":true}', 'utf-8')
                    (dest / 'local-note.txt').write_text('old install', 'utf-8')
                install.install(home, 'both')
                for base in ('.claude', '.codex'):
                    self.assertEqual((home / base / 'settings.json').read_text(), '{"keep":true}')
                    backups = list((home / base / 'skill-backups').glob('*/local-note.txt'))
                    self.assertEqual(len(backups), 1)
                    self.assertEqual(backups[0].read_text(), 'old install')

    def test_custom_locations_and_single_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.dict(os.environ, {'CODEX_HOME': str(root / 'custom codex'),
                                         'CLAUDE_CONFIG_DIR': str(root / 'custom claude')}):
                install.install(root, 'codex')
            self.assertTrue((root / 'custom codex/skills' / install.NAME / 'SKILL.md').exists())
            self.assertFalse((root / 'custom claude').exists())

    def test_invalid_second_destination_restores_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.dict(os.environ, {}, clear=True):
                install.install(root, 'codex')
                dest = root / '.codex/skills' / install.NAME
                (dest / 'old.txt').write_text('preserve')
                bad = root / '.claude/skills' / install.NAME
                bad.parent.mkdir(parents=True)
                bad.write_text('not a folder')
                with self.assertRaises(ValueError):
                    install.install(root, 'both')
                self.assertEqual((dest / 'old.txt').read_text(), 'preserve')


if __name__ == '__main__':
    unittest.main()
