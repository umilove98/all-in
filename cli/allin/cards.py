"""Card data loader. `D:\\all-in\\data\\cards.json` 을 읽어 Card dataclass 로 변환."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from .utils import load_json

CLASS_NAMES = ("berserker", "gambler", "warden")

# dataclass 에 명시적으로 담는 공통 필드.
# 그 외 카드별 특수 효과는 Card.extra dict 에 보관.
_CARD_COMMON_FIELDS = {
    "id",
    "name",
    "name_en",
    "type",
    "category",
    "desc",
    "cost",
    "max_bet",
    "damage",
    "base_acc",
    "base_crit",
    "crit_mult",
    "bet_acc",
    "bet_crit",
    "bet_damage",
    "signature",
}


@dataclass
class Card:
    id: str
    name: str
    name_en: str
    type: str  # 'hit' | 'crit' | 'fixed' | 'utility'
    category: str  # 'attack' | 'defense' | 'utility' | 'signature'
    desc: str = ""
    cost: int = 0
    max_bet: int = 0
    damage: int = 0
    base_acc: int = 0
    base_crit: int = 0
    crit_mult: float = 1.0
    bet_acc: int = 0
    bet_crit: int = 0
    bet_damage: int = 0
    signature: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Card":
        common = {k: d[k] for k in _CARD_COMMON_FIELDS if k in d}
        extra = {k: v for k, v in d.items() if k not in _CARD_COMMON_FIELDS}
        return cls(**common, extra=extra)

    def is_attack(self) -> bool:
        return self.category == "attack" or (
            self.category == "signature" and self.type in ("hit", "crit", "fixed")
        )


@lru_cache(maxsize=1)
def _load_raw() -> dict[str, Any]:
    return load_json("cards.json")


def get_card_meta() -> dict[str, Any]:
    """카드 데이터의 meta 섹션 반환 (version, 공통 룰 등)."""
    return _load_raw().get("meta", {})


@lru_cache(maxsize=1)
def _load_decks() -> dict[str, list[Card]]:
    raw = _load_raw()
    decks: dict[str, list[Card]] = {}
    for class_name in CLASS_NAMES:
        entries = raw.get(class_name, [])
        decks[class_name] = [Card.from_dict(e) for e in entries]
    return decks


def get_deck(class_name: str) -> list[Card]:
    """직업 이름으로 15장 고정 덱 반환. 매 호출마다 새 리스트 반환(원본 보존)."""
    if class_name not in CLASS_NAMES:
        raise ValueError(
            f"Unknown class: {class_name!r}. Must be one of {CLASS_NAMES}"
        )
    return list(_load_decks()[class_name])


def get_all_cards() -> list[Card]:
    """45장 전체 카드 반환."""
    decks = _load_decks()
    out: list[Card] = []
    for class_name in CLASS_NAMES:
        out.extend(decks[class_name])
    return out


@lru_cache(maxsize=1)
def _card_index() -> dict[str, Card]:
    return {c.id: c for c in get_all_cards()}


def get_card_by_id(card_id: str) -> Card:
    idx = _card_index()
    if card_id not in idx:
        raise KeyError(f"Card not found: {card_id}")
    return idx[card_id]
