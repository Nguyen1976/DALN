#!/usr/bin/env python3
"""
Fail if Nest backend no longer references the embedding-service HTTP contract.
Run from repo root:  python embedding-service/scripts/check_backend_contract.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = REPO_ROOT / "backend"

REQUIRED = [
    ("embed-and-save", ["user.service.ts", "embedding-notify.service.ts", "recommendation.service.ts"]),
    ("PYTHON_RECOMMEND_URL", ["python-recommendation.client.ts"]),
    ("/recommend/rank", ["python-recommendation.client.ts"]),
]


def main() -> int:
    if not BACKEND.is_dir():
        print(f"Expected backend at {BACKEND}", file=sys.stderr)
        return 2

    text_blocks: list[str] = []
    for path in BACKEND.rglob("*.ts"):
        if "node_modules" in path.parts or "dist" in path.parts:
            continue
        try:
            text_blocks.append(path.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    haystack = "\n".join(text_blocks)

    failed = False
    for needle, hints in REQUIRED:
        if needle not in haystack:
            print(f"MISSING contract reference: {needle!r} (expect in {hints})", file=sys.stderr)
            failed = True
        else:
            print(f"OK: found {needle!r}")

    if failed:
        print("\nUpdate backend or CONTRACT.md if the integration changed intentionally.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
