#!/usr/bin/env python3
"""Write tunable GitHub Actions variables from workflow inputs."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from util.params import bj_hours_to_utc, load_schema


def set_var(name: str, value: str) -> None:
    raw = "" if value is None else str(value).strip()
    if raw == "":
        return
    if raw.lower() == "none":
        raw = ""
    subprocess.check_call(["gh", "variable", "set", name, "--body", raw])
    print(f"updated {name}")


def main() -> None:
    if not os.environ.get("GH_TOKEN") and not os.environ.get("GITHUB_TOKEN"):
        raise SystemExit("缺少 PAT，无法写入仓库变量")
    extra = {}
    blob = (os.environ.get("PARAMS_JSON") or "").strip()
    if blob:
        extra = json.loads(blob)
        if not isinstance(extra, dict):
            raise SystemExit("PARAMS_JSON 必须是对象")

    for item in load_schema().get("tunable") or []:
        key = item.get("key")
        if not key:
            continue
        value = os.environ.get(key)
        if value is None or str(value).strip() == "":
            if key in extra:
                value = extra.get(key)
            elif item.get("variable") in extra:
                value = extra.get(item.get("variable"))
            else:
                value = ""
        value = "" if value is None else str(value).strip()
        if item.get("type") == "bj-hours":
            if value:
                target = item.get("variable") or "CRON_HOURS"
                set_var(target, bj_hours_to_utc(value))
                print(f"{target} from BJ {value}")
            continue
        set_var(key, value)


if __name__ == "__main__":
    main()
