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


def public_param_names() -> set:
    """Schema-declared variable names that may appear on the public dashboard."""
    names = set(runtime_keys())
    for item in load_schema().get("tunable") or []:
        if item.get("variable"):
            names.add(item["variable"])
        elif item.get("key"):
            names.add(item["key"])
    names.discard("CRON_HOURS_BJ")
    return names


def collect_public_params(environ=None) -> dict:
    """Only schema-declared tunable fields. Never dump arbitrary repo variables."""
    env = environ or os.environ
    allow = public_param_names()
    params = {name: "" for name in sorted(allow)}
    blob = (env.get("REPO_VARS") or "").strip()
    if blob:
        try:
            parsed = json.loads(blob)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            for key, value in parsed.items():
                if key in allow:
                    params[key] = "" if value is None else str(value)
    for key in allow:
        raw = env.get(key)
        if raw is not None and str(raw).strip() != "":
            params[key] = str(raw)
    return params


def overlay_config(config: dict, environ=None) -> tuple:
    """Let GitHub Variables override the same keys in CONFIG."""
    env = environ or os.environ
    applied = []
    merged = dict(config)
    allow = public_param_names()

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
                if key in skip or key not in allow or value is None:
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


def collect_variable_updates(env=None, extra=None):
    """Resolve nonempty schema fields from dedicated inputs or params_json."""
    env = env or {}
    extra = extra or {}
    updates = []
    apply_cron = False
    for item in load_schema().get("tunable") or []:
        key = item.get("key")
        if not key:
            continue
        if item.get("type") == "bj-hours":
            target = item.get("variable") or "CRON_HOURS"
            bj = env.get(key)
            if bj is None or str(bj).strip() == "":
                bj = extra.get(key)
            bj = "" if bj is None else str(bj).strip()
            utc_direct = extra.get(target)
            utc_direct = "" if utc_direct is None else str(utc_direct).strip()
            if bj:
                updates.append((target, bj_hours_to_utc(bj)))
                apply_cron = True
            elif utc_direct:
                updates.append((target, utc_direct))
                apply_cron = True
            continue
        value = env.get(key)
        if value is None or str(value).strip() == "":
            if key in extra:
                value = extra.get(key)
            elif item.get("variable") in extra:
                value = extra.get(item.get("variable"))
            else:
                value = ""
        value = "" if value is None else str(value).strip()
        if value:
            updates.append((key, value))
    return updates, apply_cron
