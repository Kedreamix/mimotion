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
    runs_raw = fetch(f"{API}/actions/runs?per_page=20")
    payload = {
        "repo": f"{OWNER}/{REPO}",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cronText": cron_text,
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
