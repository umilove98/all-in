"""Card loader tests."""

from __future__ import annotations

import pytest

from allin.cards import (
    CLASS_NAMES,
    Card,
    get_all_cards,
    get_card_by_id,
    get_card_meta,
    get_deck,
)


def test_each_class_has_15_cards():
    for class_name in CLASS_NAMES:
        deck = get_deck(class_name)
        assert len(deck) == 15, f"{class_name} should have 15 cards, got {len(deck)}"


def test_total_45_cards():
    assert len(get_all_cards()) == 45


def test_unknown_class_raises():
    with pytest.raises(ValueError):
        get_deck("paladin")


def test_signatures_flagged_correctly():
    sig_ids = {"B14", "B15", "G14", "G15", "W14", "W15"}
    all_cards = get_all_cards()
    flagged = {c.id for c in all_cards if c.signature}
    assert flagged == sig_ids
    assert sum(1 for c in all_cards if c.signature) == 6


def test_all_signature_cards_have_signature_category():
    for card in get_all_cards():
        if card.signature:
            assert card.category == "signature", card.id


def test_card_types_are_valid():
    valid = {"hit", "crit", "fixed", "utility"}
    for c in get_all_cards():
        assert c.type in valid, f"{c.id} has invalid type {c.type}"


def test_card_categories_are_valid():
    valid = {"attack", "defense", "utility", "signature"}
    for c in get_all_cards():
        assert c.category in valid, f"{c.id} has invalid category {c.category}"


def test_all_card_ids_unique():
    ids = [c.id for c in get_all_cards()]
    assert len(ids) == len(set(ids))


# ---- 스펙 준수 (샘플 카드 필드 검증) ------------------------------------------------


def test_b1_crushing_blow_spec():
    # 분쇄 일격: hit, 18뎀, base 40%, bet +6%, 풀베팅 10 → 100%
    c = get_card_by_id("B1")
    assert c.name == "분쇄 일격"
    assert c.type == "hit"
    assert c.damage == 18
    assert c.base_acc == 40
    assert c.bet_acc == 6
    assert c.max_bet == 10
    assert c.signature is False


def test_b4_chain_slash_hit_count():
    # 연쇄 베기: 10뎀 × 3회 명중 판정
    c = get_card_by_id("B4")
    assert c.damage == 10
    assert c.extra["hit_count"] == 3


def test_b13_last_stand_condition():
    # 최후의 발악: 내 HP 30 이하 조건
    c = get_card_by_id("B13")
    assert c.extra["condition"] == {"self_hp_max": 30}


def test_b14_blood_madness_signature():
    # 피의 광기 시그니처: max_bet 15, base 0%, bet +6%
    c = get_card_by_id("B14")
    assert c.signature is True
    assert c.category == "signature"
    assert c.max_bet == 15
    assert c.base_acc == 0
    assert c.bet_acc == 6
    assert c.damage == 50


def test_g6_allin_bet_crit():
    # 올인 베팅: crit, 20뎀, base_crit 20, crit_mult 3.5, bet_crit +6
    c = get_card_by_id("G6")
    assert c.type == "crit"
    assert c.damage == 20
    assert c.base_crit == 20
    assert c.crit_mult == 3.5
    assert c.bet_crit == 6


def test_g4_jackpot_extra():
    # 잭팟: jackpot dict 내 1/2-5/6-9/10 결과
    c = get_card_by_id("G4")
    jackpot = c.extra["jackpot"]
    assert jackpot["dice"] == 10
    results = jackpot["results"]
    assert results["10"]["damage"] == 60
    assert results["1"]["self_damage"] == 25


def test_g15_allin_signature():
    c = get_card_by_id("G15")
    assert c.signature is True
    assert c.max_bet == 12
    assert c.crit_mult == 3.0
    assert c.extra["self_damage_on_miss"] == "bet_amount"


def test_w1_justice_strike_fixed():
    c = get_card_by_id("W1")
    assert c.type == "fixed"
    assert c.damage == 10
    assert c.bet_damage == 1
    assert c.max_bet == 10


def test_w5_judgment_bet_damage_2():
    c = get_card_by_id("W5")
    assert c.bet_damage == 2
    assert c.extra["judgment_bonus"] == 8


def test_w15_final_judgment_flag():
    c = get_card_by_id("W15")
    assert c.signature is True
    assert c.extra.get("final_judgment") is True


# ---- 구조 검증 ---------------------------------------------------------------------


def test_get_deck_returns_fresh_list():
    # 덱 리스트가 외부에서 변형되어도 내부 캐시는 보호되어야 함.
    d1 = get_deck("berserker")
    d1.clear()
    d2 = get_deck("berserker")
    assert len(d2) == 15


def test_card_meta_has_common_rules():
    meta = get_card_meta()
    rules = meta.get("common_rules", {})
    assert rules.get("signature_usage_per_game") == 1
    assert rules.get("signature_unlock_turn") == 3
    assert rules.get("signature_per_turn_limit") == 1
    assert rules.get("default_bet_max") == 10


def test_category_breakdown_per_class():
    # JSON category 기준 내역. 문서 텍스트에선 "공격 8장"이라 묶지만
    # JSON 은 광전사의 함성(B6)·고통 흡수(B7)·더블다운(G5)을 utility/defense로 분류.
    # 공통: 총 15장, 시그니처 2장, (공격+방어+유틸)=13장.
    for class_name in CLASS_NAMES:
        deck = get_deck(class_name)
        by_cat: dict[str, int] = {}
        for c in deck:
            by_cat[c.category] = by_cat.get(c.category, 0) + 1
        assert sum(by_cat.values()) == 15, f"{class_name} total={by_cat}"
        assert by_cat.get("signature", 0) == 2, f"{class_name} sig={by_cat}"
        non_sig = sum(v for k, v in by_cat.items() if k != "signature")
        assert non_sig == 13, f"{class_name} non_sig={by_cat}"
