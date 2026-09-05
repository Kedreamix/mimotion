#!/usr/bin/env python3
"""Build a static snapshot for the GitHub Pages dashboard."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from util.params import collect_public_params

OWNER = os.environ.get("GITHUB_REPOSITORY_OWNER", "Kedreamix")
REPO = os.environ.get("GITHUB_REPOSITORY", f"{OWNER}/mimotion").split("/")[-1]
TOKEN = os.environ.get("GITHUB_TOKEN", "")
OUT = Path(os.environ.get("PAGES_DATA_PATH", "docs/data.json"))
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
STEP_STATE_MARKER = "---STEP_STATE---"


def latest_repo_step(cron_text: str) -> tuple[int, str]:
    if STEP_STATE_MARKER not in (cron_text or ""):
        return 0, ""
    raw = cron_text.split(STEP_STATE_MARKER, 1)[1].strip()
    try:
        state = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return 0, ""
    if not isinstance(state, dict):
        return 0, ""
    accounts = [item for item in state.values() if isinstance(item, dict)]
    accounts.sort(key=lambda item: str(item.get("last_step_date") or ""), reverse=True)
    if not accounts:
        return 0, ""
    last = accounts[0]
    try:
        step = int(last.get("last_step") or 0)
    except (TypeError, ValueError):
        step = 0
    return step, str(last.get("last_step_date") or "")


def fetch(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "mimotion-pages",
        **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    cron_path = Path("cron_change_time")
    cron_text = cron_path.read_text(encoding="utf-8") if cron_path.exists() else ""
    last_step, last_step_date = latest_repo_step(cron_text)
    runs_raw = fetch(f"{API}/actions/runs?per_page=20")
    payload = {
        "repo": f"{OWNER}/{REPO}",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cronText": cron_text,
        "lastStep": last_step,
        "lastStepDate": last_step_date,
        "params": collect_public_params(),
        "runs": [
            {
                "name": item.get("name"),
                "conclusion": item.get("conclusion"),
                "status": item.get("status"),
                "event": item.get("event"),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
                "run_number": item.get("run_number"),
                "html_url": item.get("html_url"),
            }
            for item in runs_raw.get("workflow_runs", [])
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT} ({len(payload['runs'])} runs)")


if __name__ == "__main__":
    main()
