# -*- coding: utf8 -*-
import unittest

from util.params import bj_hours_to_utc, overlay_config, runtime_keys, utc_hours_to_bj


class ParamsTest(unittest.TestCase):
    def test_hour_roundtrip(self):
        utc = bj_hours_to_utc("8,10,12,14,16,22")
        self.assertEqual(utc, "0,2,4,6,8,14")
        self.assertEqual(utc_hours_to_bj(utc), "8,10,12,14,16,22")

    def test_overlay_ignores_empty_and_overrides(self):
        config = {"MIN_STEP": "18000", "MAX_STEP": "25000", "USER": "a"}
        merged, applied = overlay_config(config, {
            "MIN_STEP": "12000",
            "MAX_STEP": "  ",
            "SLEEP_GAP": "3",
        })
        self.assertEqual(merged["MIN_STEP"], "12000")
        self.assertEqual(merged["MAX_STEP"], "25000")
        self.assertEqual(merged["SLEEP_GAP"], "3")
        self.assertEqual(merged["USER"], "a")
        self.assertEqual(applied, ["MIN_STEP", "SLEEP_GAP"])

    def test_repo_vars_json_adds_future_keys(self):
        config = {"MIN_STEP": "18000"}
        merged, applied = overlay_config(config, {
            "REPO_VARS": '{"MIN_STEP":"10000","NEW_FLAG":"1"}',
            "MIN_STEP": "12000",
        })
        self.assertEqual(merged["MIN_STEP"], "12000")
        self.assertEqual(merged["NEW_FLAG"], "1")
        self.assertEqual(applied, ["MIN_STEP", "NEW_FLAG"])

    def test_hour_wraparound(self):
        self.assertEqual(bj_hours_to_utc("0,8"), "0,16")
        self.assertEqual(utc_hours_to_bj("16,0"), "0,8")

    def test_runtime_keys_skip_cron_hours(self):
        keys = runtime_keys()
        self.assertIn("MAX_STEP", keys)
        self.assertNotIn("CRON_HOURS_BJ", keys)
        self.assertNotIn("CRON_HOURS", keys)

    def test_overlay_does_not_touch_secrets(self):
        merged, applied = overlay_config(
            {"USER": "a", "PWD": "b", "MIN_STEP": "1"},
            {
                "USER": "hacked",
                "PWD": "hacked",
                "MIN_STEP": "9",
                "REPO_VARS": '{"USER":"hacked","PWD":"hacked","MIN_STEP":"9"}',
            },
        )
        self.assertEqual(merged["USER"], "a")
        self.assertEqual(merged["PWD"], "b")
        self.assertEqual(merged["MIN_STEP"], "9")
        self.assertEqual(applied, ["MIN_STEP"])


if __name__ == "__main__":
    unittest.main()
