import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "build_pages_data",
    ROOT / ".github" / "scripts" / "build_pages_data.py",
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class LatestRepoStepTests(unittest.TestCase):
    def test_reads_pretty_step_state(self):
        cron = """header
---STEP_STATE---
{
  "abc": {
    "last_step": 10576,
    "last_step_date": "2026-09-05"
  }
}
"""
        self.assertEqual(mod.latest_repo_step(cron), (10576, "2026-09-05"))

    def test_picks_newest_account_date(self):
        cron = """---STEP_STATE---
{"a":{"last_step":1,"last_step_date":"2026-09-04"},"b":{"last_step":9,"last_step_date":"2026-09-05"}}
"""
        self.assertEqual(mod.latest_repo_step(cron), (9, "2026-09-05"))

    def test_missing_state(self):
        self.assertEqual(mod.latest_repo_step("no marker"), (0, ""))
        self.assertEqual(mod.latest_repo_step("---STEP_STATE---\nnot-json"), (0, ""))


if __name__ == "__main__":
    unittest.main()
