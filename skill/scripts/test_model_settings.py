import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from model_settings import selected_settings, apply_settings


class ModelSettingsTests(unittest.TestCase):
    def test_saved_defaults_and_explicit_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'config.toml').write_text('model="example-codex"\nmodel_reasoning_effort="medium"\n', 'utf-8')
            (root / 'settings.json').write_text('{"model":"opus[1m]","effortLevel":"high"}', 'utf-8')
            with patch.dict(os.environ, {'CODEX_HOME': tmp, 'CLAUDE_CONFIG_DIR': tmp}, clear=True):
                self.assertEqual(selected_settings('codex', {}), {'model': 'example-codex', 'effort': 'medium'})
                self.assertEqual(selected_settings('claude', {}), {'model': 'opus[1m]', 'effort': 'high'})
                value = selected_settings('codex', {'models': {'codex': 'override'}, 'efforts': {'codex': 'low'}})
                self.assertEqual(value, {'model': 'override', 'effort': 'low'})
                cmd = apply_settings(['node', 'codex.js', 'exec', '--ignore-user-config'], 'codex', value)
                self.assertEqual(cmd, ['node', 'codex.js', '--model', 'override', '-c',
                                       'model_reasoning_effort="low"', 'exec', '--ignore-user-config'])

    def test_profile_environment_and_missing_settings(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {'CODEX_HOME': tmp, 'CLAUDE_CONFIG_DIR': tmp}, clear=True):
                self.assertEqual(selected_settings('claude', {}), {'model': None, 'effort': None})
                (Path(tmp) / 'config.toml').write_text("model='base'\nprofile='fast'\n[profiles.fast]\nmodel='fast-model'\nmodel_reasoning_effort='low' # comment\n", 'utf-8')
                self.assertEqual(selected_settings('codex', {})['model'], 'fast-model')
                with patch.dict(os.environ, {'ANTHROPIC_MODEL': 'env-model', 'CLAUDE_CODE_EFFORT_LEVEL': 'high'}):
                    self.assertEqual(apply_settings(['claude', '--print'], 'claude', selected_settings('claude', {})),
                                     ['claude', '--model', 'env-model', '--effort', 'high', '--print'])
