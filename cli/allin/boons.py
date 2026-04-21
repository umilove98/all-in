"""Boon data loader. `D:\\all-in\\data\\boons.json` 을 읽어 Boon dataclass 로 변환."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from .utils import load_json

BOON_CATEGORIES = ("steady", "aggressive", "risky", "utility")


@dataclass
class Boon:
    id: str
    name: str
    name_en: str
    emoji: str
    category: str
    desc: str = ""
    effect: dict[str, Any] = field(default_factory=dict)
    synergy: list[str] = field(default_factory=list)
    counter_against: list[str] = field(default_factory=list)
    note: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Boon":
        return cls(
            id=d["id"],
            name=d["name"],
            name_en=d.get("name_en", ""),
            emoji=d.get("emoji", ""),
            category=d["category"],
            desc=d.get("desc", ""),
            effect=dict(d.get("effect", {})),
            synergy=list(d.get("synergy", [])),
            counter_against=list(d.get("counter_against", [])),
            note=d.get("note", ""),
        )


@lru_cache(maxsize=1)
def _load_raw() -> dict[str, Any]:
    return load_json("boons.json")


def get_boon_meta() -> dict[str, Any]:
    return _load_raw().get("meta", {})


@lru_cache(maxsize=1)
def _load_boons() -> list[Boon]:
    raw = _load_raw()
    return [Boon.from_dict(b) for b in raw.get("boons", [])]


def get_all_boons() -> list[Boon]:
    """부운 10종 전체 반환. 매 호출마다 새 리스트 반환."""
    return list(_load_boons())


@lru_cache(maxsize=1)
def _boon_index() -> dict[str, Boon]:
    return {b.id: b for b in _load_boons()}


def get_boon_by_id(boon_id: str) -> Boon:
    idx = _boon_index()
    if boon_id not in idx:
        raise KeyError(f"Boon not found: {boon_id}")
    return idx[boon_id]


def filter_by_category(category: str) -> list[Boon]:
    if category not in BOON_CATEGORIES:
        raise ValueError(
            f"Unknown category: {category!r}. Must be one of {BOON_CATEGORIES}"
        )
    return [b for b in _load_boons() if b.category == category]
