import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import workflow as w


def answer(artifact="", plan="", issues=None, decision="approve", changes=None):
    return dict(artifact_id=artifact, plan=plan, issues=issues or [], decision=decision, changes=changes or [])


class FakeClient:
    def __init__(self, reject_first=False, fail_quota=False):
        self.calls = []
        self.reject_first = reject_first
        self.fail_quota = fail_quota

    def ask(self, provider, phase, payload):
        self.calls.append((provider, phase, payload))
        if phase == "design":
            return answer(plan="Implement increment(x) as x+1. Preserve tests.")
        if phase == "implementation":
            if self.fail_quota and provider == "claude":
                raise w.ProviderFailure("quota", quota=True)
            return answer(payload["artifact_id"], changes=[{"path": "sample.py", "content": "def increment(x): return x + 1\n"}])
        if phase == "design_review" and self.reject_first:
            self.reject_first = False
            return answer(payload["artifact_id"], issues=["Specify negative inputs"], decision="revise")
        return answer(payload["artifact_id"])


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        patcher = patch("usage.read_usage", return_value={})
        patcher.start()
        self.addCleanup(patcher.stop)

    def setup_run(self, root):
        repo, run = root / "repo", root / "run"
        repo.mkdir()
        run.mkdir()
        (repo / "sample.py").write_text("def increment(x): return x\n")
        config = {"repo": str(repo), "task": "Implement increment", "files": ["sample.py"],
                  "write_files": ["sample.py"], "implementation_authorized": True,
                  "mode": "implement", "tests": [["python", "-c", "assert True"]]}
        return repo, run, config

    def test_policy_pinning_unknown_stale_and_thresholds(self):
        now = 1000
        def quota(percent):
            return {"source": "test", "observed_at": now, "windows": [{"remaining_percent": percent}]}
        usage = {"claude": quota(10), "codex": quota(80)}
        self.assertEqual(w.choose_writer("auto", usage, now)[0], "codex")
        self.assertEqual(w.choose_writer("claude", usage, now)[0], "claude")
        self.assertEqual(w.choose_writer("auto", {}, now)[0], "claude")
        self.assertEqual(w.choose_writer("auto", usage, now + 601)[0], "claude")
        usage["codex"]["windows"].append({"remaining_percent": 5})
        self.assertEqual(w.choose_writer("auto", usage, now)[0], "claude")

    def test_end_to_end_feedback_and_two_reviews(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, run, config = self.setup_run(Path(tmp))
            client = FakeClient(reject_first=True)
            with patch("workflow.invoke", return_value=(0, "checks passed", "")):
                state = w.workflow(config, run, client)
            self.assertEqual(state["status"], "completed")
            self.assertIn("x + 1", (repo / "sample.py").read_text())
            reviews = [p for p, phase, _ in client.calls if phase == "code_review"]
            self.assertEqual(reviews, ["claude", "codex"])
            second_design = [data for _, phase, data in client.calls if phase == "design"][1]
            self.assertEqual(second_design["discussion"][0]["review"]["issues"], ["Specify negative inputs"])

    def test_reverse_designer_and_explicit_codex_writer(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, run, config = self.setup_run(Path(tmp))
            config.update(designer="claude", writer="codex")
            client = FakeClient()
            with patch("workflow.invoke", return_value=(0, "ok", "")):
                state = w.workflow(config, run, client)
            self.assertEqual(state["status"], "completed")
            self.assertEqual(client.calls[0][:2], ("claude", "design"))
            self.assertEqual(client.calls[1][:2], ("codex", "design_review"))
            self.assertEqual(client.calls[2][:2], ("codex", "implementation"))

    def test_quota_failure_handoff_only_auto_with_known_headroom(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, run, config = self.setup_run(Path(tmp))
            usage = Path(tmp) / "usage.json"
            usage.write_text(json.dumps({"codex": {"source": "test", "observed_at": w.time.time(),
                                                   "windows": [{"remaining_percent": 80}]}}))
            config["usage_file"] = str(usage)
            with patch("workflow.invoke", return_value=(0, "ok", "")):
                state = w.workflow(config, run, FakeClient(fail_quota=True))
            self.assertEqual(state["status"], "completed")
            self.assertTrue(any(e["kind"] == "writer_handoff" for e in state["events"]))

    def test_design_only_never_applies_and_failed_tests_never_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, run, config = self.setup_run(Path(tmp))
            before = (repo / "sample.py").read_bytes()
            config["mode"] = "design"
            state = w.workflow(config, run, FakeClient())
            self.assertEqual(state["status"], "design_agreed")
            self.assertEqual((repo / "sample.py").read_bytes(), before)
            config.update(mode="implement", max_implementation_rounds=1)
            with patch("workflow.invoke", return_value=(1, "failing assertion", "")):
                state = w.workflow(config, run, FakeClient())
            self.assertEqual(state["status"], "blocked")

    def test_scope_concurrency_and_approval_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, run, config = self.setup_run(Path(tmp))
            expected = w.collect(repo, ["sample.py"])
            with self.assertRaises(w.Halt):
                w.apply_changes(repo, [{"path": "../escape", "content": "bad"}], config["write_files"], expected, run, 1)
            (repo / "sample.py").write_text("human edit")
            with self.assertRaisesRegex(w.Halt, "Concurrent"):
                w.apply_changes(repo, [], config["write_files"], expected, run, 1)
            self.assertFalse(w.approved(answer("old"), "new"))


if __name__ == "__main__":
    unittest.main()
