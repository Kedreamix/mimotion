# -*- coding: utf8 -*-
"""Split runtime knobs (GitHub Variables) from secret CONFIG."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "docs" / "params.json"
FALLBACK_RUNTIME_KEYS = (
    "MIN_STEP",
    "MAX_STEP",
    "SLEEP_GAP",
    "USE_CONCURRENT",
    "PUSH_PLUS_HOUR",
    "PUSH_PLUS_MAX",
)


def load_schema() -> dict:
    if not SCHEMA_PATH.exists():
        return {"tunable": [], "secretConfig": []}
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def runtime_keys() -> tuple:
    schema = load_schema()
    keys = []
    for item in schema.get("tunable") or []:
        if item.get("type") == "bj-hours" or item.get("variable"):
            continue
        key = item.get("key")
        if key:
            keys.append(key)
    return tuple(keys) or FALLBACK_RUNTIME_KEYS


def overlay_config(config: dict, environ=None) -> tuple:
    """Let GitHub Variables override the same keys in CONFIG."""
    env = environ or os.environ
    applied = []
    merged = dict(config)

    blob = (env.get("REPO_VARS") or "").strip()
    if blob:
        try:
            extra = json.loads(blob)
        except json.JSONDecodeError:
            extra = None
        if isinstance(extra, dict):
            skip = {"CONFIG", "PAT", "AES_KEY", "GITHUB_TOKEN", "REPO_VARS", "USER", "PWD"}
            skip.update(item.get("key") for item in load_schema().get("secretConfig") or [] if item.get("key"))
            for key, value in extra.items():
                if key in skip or value is None:
                    continue
                text = str(value).strip()
                if text == "":
                    continue
                merged[str(key)] = text
                applied.append(str(key))

    for key in runtime_keys():
        raw = env.get(key)
        if raw is None:
            continue
        value = str(raw).strip()
        if value == "":
            continue
        merged[key] = value
        applied.append(key)
    return merged, list(dict.fromkeys(applied))


def bj_hours_to_utc(hours_text: str) -> str:
    hours = []
    for part in str(hours_text or "").split(","):
        part = part.strip()
        if part == "":
            continue
        hours.append((int(part) - 8) % 24)
    return ",".join(str(hour) for hour in sorted(set(hours)))


def utc_hours_to_bj(hours_text: str) -> str:
    hours = []
    for part in str(hours_text or "").split(","):
        part = part.strip()
        if part == "":
            continue
        hours.append((int(part) + 8) % 24)
    return ",".join(str(hour) for hour in sorted(set(hours)))
