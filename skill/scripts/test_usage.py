import unittest
import json
from pathlib import Path
import tempfile
from usage import claude_entry, codex_entry, parse_claude_stream, stream_entry, store_claude
from workflow import remaining


class UsageTests(unittest.TestCase):
    def test_headless_event_collects_real_windows_not_overage(self):
        event = {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "unifiedWindows": {
            "five_hour": {"utilization": 0.4, "resetsAt": 1500},
            "seven_day": {"utilization": 0.24, "resetsAt": 2000},
            "seven_day_overage_included": {"utilization": 0.99, "resetsAt": 2000}}}}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = json.dumps(event) + '\n' + json.dumps({"type": "result", "result": "OK"})
            result, entry = parse_claude_stream(output, root=root, now=1000)
            self.assertEqual(result["result"], "OK")
            self.assertEqual(remaining(entry, 1000), 60)
            self.assertEqual(len(entry["windows"]), 2)
            stored = (root / "claude.json").read_bytes()
            self.assertFalse(store_claude(claude_entry({}, 1010), root))
            self.assertEqual((root / "claude.json").read_bytes(), stored)

    def test_missing_or_untrusted_stream_content_never_invents_usage(self):
        for event in [{"type": "assistant", "rate_limit_info": {"utilization": 0.5}},
                      {"type": "rate_limit_event", "rate_limit_info": {"rateLimitType": "five_hour",
                       "status": "allowed", "resetsAt": 2000}}]:
            entry = stream_entry(event, 1000)
            self.assertTrue(entry is None or not entry["windows"])

    def test_headless_single_window_and_blocked_result(self):
        event = {"type": "rate_limit_event", "rate_limit_info": {
            "rateLimitType": "five_hour", "utilization": 1, "resetsAt": 2000, "status": "rejected"}}
        with tempfile.TemporaryDirectory() as tmp:
            result, entry = parse_claude_stream(json.dumps(event)+'\n'+json.dumps({
                "type": "result", "is_error": True, "api_error_status": 429}), Path(tmp), 1000)
            self.assertEqual(remaining(entry, 1000), 0)
            self.assertTrue(result["is_error"])

    def test_claude_separates_quota_from_context(self):
        data = {"context_window": {"remaining_percentage": 1}, "rate_limits": {
            "five_hour": {"used_percentage": 82, "resets_at": 1500},
            "seven_day": {"used_percentage": 30, "resets_at": 2000}}}
        entry = claude_entry(data, now=1000)
        self.assertEqual(remaining(entry, 1000), 18)
        self.assertIsNone(remaining(claude_entry({"context_window": {"remaining_percentage": 99}}, 1000), 1000))

    def test_codex_primary_secondary_and_missing(self):
        data = {"rateLimitsByLimitId": {"codex": {"primary": {"usedPercent": 10, "resetsAt": 1500},
                                                  "secondary": {"usedPercent": 70, "resetsAt": 2000}}}}
        self.assertEqual(remaining(codex_entry(data, 1000), 1000), 30)
        self.assertIsNone(remaining(codex_entry({}, 1000), 1000))

    def test_expired_or_malformed_is_unknown(self):
        entry = claude_entry({"rate_limits": {"five_hour": {"used_percentage": 80, "resets_at": 1100}}}, 1000)
        self.assertIsNone(remaining(entry, 1200))
        self.assertFalse(claude_entry({"rate_limits": {"five_hour": {"used_percentage": 300, "resets_at": 1500}}}, 1000)["windows"])


if __name__ == "__main__":
    unittest.main()
