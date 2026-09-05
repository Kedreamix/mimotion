# -*- coding: utf8 -*-
import base64
import json
import unittest
from unittest.mock import Mock, patch

from util.zepp_helper import (
    fetch_today_steps,
    get_band_summary,
    parse_summary_steps,
    steps_from_band_data,
)


class ParseSummaryTest(unittest.TestCase):
    def test_reads_stp_ttl_from_json_and_base64(self):
        payload = {"stp": {"ttl": 54188, "dis": 36000}}
        b64 = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        self.assertEqual(parse_summary_steps(b64), 54188)
        self.assertEqual(parse_summary_steps(json.dumps(payload)), 54188)
        self.assertEqual(parse_summary_steps(payload), 54188)
        self.assertEqual(parse_summary_steps('{"stp":{"ttl":888}}'), 888)

    def test_matches_beijing_date_and_empty_data(self):
        body = {
            "code": 1,
            "message": "success",
            "data": [
                {"date": "2026-09-03", "summary": json.dumps({"stp": {"ttl": 100}})},
                {
                    "date": "2026-09-04",
                    "summary": base64.b64encode(
                        json.dumps({"stp": {"ttl": 2222}}).encode("utf-8")
                    ).decode("ascii"),
                },
            ],
        }
        self.assertEqual(steps_from_band_data(body, "2026-09-04"), 2222)
        self.assertEqual(steps_from_band_data({"data": []}, "2026-09-04"), 0)


class FetchTodayStepsTest(unittest.TestCase):
    def _response(self, status, payload):
        resp = Mock()
        resp.status_code = status
        resp.text = json.dumps(payload)
        resp.json.return_value = payload
        return resp

    def test_retries_device_type_zero_after_android_phone_400(self):
        first = self._response(400, {"message": "bad device"})
        second = self._response(200, {
            "code": 1,
            "message": "success",
            "data": [{"date": "2026-09-05", "summary": json.dumps({"stp": {"ttl": 16666}})}],
        })
        with patch("util.zepp_helper.requests.get", side_effect=[first, second]) as get:
            steps = fetch_today_steps("token", "118", "2026-09-05")
        self.assertEqual(steps, 16666)
        self.assertEqual(get.call_count, 2)
        first_params = get.call_args_list[0].kwargs["params"]
        second_params = get.call_args_list[1].kwargs["params"]
        self.assertEqual(first_params["device_type"], "android_phone")
        self.assertEqual(first_params["query_type"], "summary")
        self.assertEqual(second_params["device_type"], "0")
        self.assertTrue(get.call_args_list[0].args[0].endswith("/v1/data/band_data.json"))

    def test_raises_when_both_summary_attempts_fail(self):
        bad = self._response(400, {"message": "nope"})
        with patch("util.zepp_helper.requests.get", return_value=bad):
            with self.assertRaises(Exception):
                get_band_summary("token", "118", "2026-09-05")


if __name__ == "__main__":
    unittest.main()
