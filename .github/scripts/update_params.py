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

from util.params import collect_variable_updates


def set_var(name: str, value: str) -> None:
    raw = "" if value is None else str(value).strip()
    if raw == "":
        return
    if raw.lower() == "none":
        raw = ""
    subprocess.check_call(["gh", "variable", "set", name, "--body", raw])
    print(f"updated {name}")


def write_output(name: str, value: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"{name}={value}\n")


def main() -> None:
    if not os.environ.get("GH_TOKEN") and not os.environ.get("GITHUB_TOKEN"):
        raise SystemExit("缺少 PAT，无法写入仓库变量")
    extra = {}
    blob = (os.environ.get("PARAMS_JSON") or "").strip()
    if blob:
        extra = json.loads(blob)
        if not isinstance(extra, dict):
            raise SystemExit("PARAMS_JSON 必须是对象")

    updates, apply_cron = collect_variable_updates(os.environ, extra)
    for name, value in updates:
        set_var(name, value)
        if name == "CRON_HOURS":
            print(f"{name} updated to {value}")
            apply_cron = True
    write_output("apply_cron", "true" if apply_cron else "false")


if __name__ == "__main__":
    main()
