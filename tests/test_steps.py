# -*- coding: utf8 -*-
import datetime
import unittest
from unittest.mock import patch

import pytz

import main


class PickIncrementalStepTest(unittest.TestCase):
    def test_uses_huami_current_instead_of_lower_repo_record(self):
        # 仓库上次只记了 5000，但迈步/手表已经到 15000。
        # 当前整点窗口 8000-11000，不能再随机出一个更低的数盖回去。
        with patch("main.random.randint") as randint:
            step, baseline = main.pick_incremental_step(8000, 11000, 15000, 25000)
        randint.assert_not_called()
        self.assertEqual(baseline, 15000)
        self.assertEqual(step, 15001)

    def test_randomizes_above_current_when_window_still_has_room(self):
        with patch("main.random.randint", return_value=20000) as randint:
            step, baseline = main.pick_incremental_step(18000, 25000, 12000, 25000)
        randint.assert_called_once_with(18000, 25000)
        self.assertEqual(baseline, 12000)
        self.assertEqual(step, 20000)

    def test_starts_from_window_when_huami_is_zero(self):
        with patch("main.random.randint", return_value=9000) as randint:
            step, baseline = main.pick_incremental_step(8000, 11000, 0, 25000)
        randint.assert_called_once_with(8000, 11000)
        self.assertEqual(baseline, 0)
        self.assertEqual(step, 9000)

    def test_caps_at_abs_max(self):
        step, baseline = main.pick_incremental_step(18000, 25000, 25000, 25000)
        self.assertEqual(baseline, 25000)
        self.assertEqual(step, 25000)


class ResolveBaselineTest(unittest.TestCase):
    def setUp(self):
        main.step_state = {}
        main.time_bj = datetime.datetime(
            2026, 9, 5, 10, 0, tzinfo=pytz.timezone("Asia/Shanghai")
        )

    def test_prefers_huami_even_when_repo_has_last_step(self):
        key = main._step_state_key("demo")
        main.step_state[key] = {"last_step": 5000, "last_step_date": "2026-09-05"}
        baseline, source = main.resolve_baseline("demo", 18888)
        self.assertEqual(source, "huami")
        self.assertEqual(baseline, 18888)

    def test_falls_back_to_same_day_repo_record(self):
        key = main._step_state_key("demo")
        main.step_state[key] = {"last_step": 5000, "last_step_date": "2026-09-05"}
        baseline, source = main.resolve_baseline("demo", None)
        self.assertEqual(source, "repo")
        self.assertEqual(baseline, 5000)

    def test_ignores_yesterday_repo_record(self):
        key = main._step_state_key("demo")
        main.step_state[key] = {"last_step": 5000, "last_step_date": "2026-09-04"}
        baseline, source = main.resolve_baseline("demo", None)
        self.assertEqual(source, "repo")
        self.assertEqual(baseline, 0)


if __name__ == "__main__":
    unittest.main()
