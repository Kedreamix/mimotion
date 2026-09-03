# -*- coding: utf8 -*-
import unittest

from util.params import collect_variable_updates


class UpdateParamsTest(unittest.TestCase):
    def test_params_json_cron_hours_bj_marks_apply_cron(self):
        updates, apply_cron = collect_variable_updates(
            {},
            {"CRON_HOURS_BJ": "8,10,12,14,16,22"},
        )
        self.assertTrue(apply_cron)
        self.assertIn(("CRON_HOURS", "0,2,4,6,8,14"), updates)

    def test_dedicated_cron_input_marks_apply_cron(self):
        updates, apply_cron = collect_variable_updates(
            {"CRON_HOURS_BJ": "8,22"},
            {},
        )
        self.assertTrue(apply_cron)
        self.assertEqual(updates, [("CRON_HOURS", "0,14")])

    def test_params_json_utc_cron_hours_marks_apply_cron(self):
        updates, apply_cron = collect_variable_updates(
            {},
            {"CRON_HOURS": "0,8"},
        )
        self.assertTrue(apply_cron)
        self.assertEqual(updates, [("CRON_HOURS", "0,8")])

    def test_step_only_json_does_not_apply_cron(self):
        updates, apply_cron = collect_variable_updates(
            {},
            {"MIN_STEP": "12000", "MAX_STEP": "20000"},
        )
        self.assertFalse(apply_cron)
        self.assertEqual(updates, [("MIN_STEP", "12000"), ("MAX_STEP", "20000")])
