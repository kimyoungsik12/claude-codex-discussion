import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import discuss


class DiscussionTests(unittest.TestCase):
    def test_snapshot_and_exclusions(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp).resolve()
            (repo / "example.py").write_bytes(b"x = 1\n")
            (repo / ".env").write_text("secret", encoding="utf-8")
            (repo / "binary.bin").write_bytes(b"\x00\xff")
            result = discuss.snapshot(repo, ["example.py"])
            self.assertEqual(result["example.py"]["text"], "x = 1\n")
            for bad in ["../escape", ".env", "binary.bin"]:
                with self.assertRaises(ValueError):
                    discuss.snapshot(repo, [bad])

    def test_round_history_cap_and_stale_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            repo = root / "repo"
            repo.mkdir()
            source = repo / "example.py"
            source.write_text("original", encoding="utf-8")
            message = root / "message.txt"
            message.write_text("review", encoding="utf-8")
            run = root / "run"
            argv = ["discuss.py", "--repo", str(repo), "--run-dir", str(run),
                    "--message-file", str(message), "--files", "example.py", "--max-rounds", "2"]
            received = []

            def reply(_command, prompt, _cwd, _timeout):
                received.append(json.loads(prompt))
                if len(received) == 2:
                    source.write_text("concurrent edit", encoding="utf-8")
                return 0, json.dumps({"type": "result", "result": "Independent reply", "is_error": False}), ""

            with patch("sys.argv", argv), patch("discuss.shutil.which", return_value="claude.exe"), \
                    patch("discuss.invoke", side_effect=reply):
                self.assertEqual(discuss.main(), 0)
                self.assertEqual(discuss.main(), 3)
                self.assertEqual(received[1]["history"][0]["claude"], "Independent reply")
                with self.assertRaisesRegex(ValueError, "Round limit"):
                    discuss.main()
            self.assertFalse((run / ".lock").exists())
            self.assertTrue(json.loads((run / "transcript.json").read_text())["rounds"][1]["stale"])

    def test_cli_failure_does_not_count_as_agreement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            repo = root / "repo"
            repo.mkdir()
            message = root / "message.txt"
            message.write_text("review", encoding="utf-8")
            run = root / "run"
            argv = ["discuss.py", "--repo", str(repo), "--run-dir", str(run),
                    "--message-file", str(message)]
            with patch("sys.argv", argv), patch("discuss.shutil.which", return_value="claude.exe"), \
                    patch("discuss.invoke", return_value=(None, "partial output", "timeout")):
                self.assertEqual(discuss.main(), 2)
            self.assertFalse((run / "transcript.json").exists())
            self.assertFalse((run / ".lock").exists())


if __name__ == "__main__":
    unittest.main()
