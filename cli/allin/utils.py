"""Shared utilities."""

from __future__ import annotations

import json
from pathlib import Path

# cli/allin/utils.py -> cli/allin -> cli -> all-in/
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"


def load_json(filename: str) -> dict:
    """Load a JSON file from the project `data/` directory."""
    path = DATA_DIR / filename
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
