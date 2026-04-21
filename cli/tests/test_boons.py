"""Boon loader tests."""

from __future__ import annotations

import pytest

from allin.boons import (
    BOON_CATEGORIES,
    filter_by_category,
    get_all_boons,
    get_boon_by_id,
    get_boon_meta,
)


def test_10_boons_loaded():
    assert len(get_all_boons()) == 10


def test_all_boon_ids_unique():
    ids = [b.id for b in get_all_boons()]
    assert len(ids) == len(set(ids))


def test_ids_are_bn01_to_bn10():
    ids = sorted(b.id for b in get_all_boons())
    assert ids == [f"BN{i:02d}" for i in range(1, 11)]


def test_categories_valid():
    for b in get_all_boons():
        assert b.category in BOON_CATEGORIES, f"{b.id}: {b.category}"


def test_filter_by_category_steady():
    steady = filter_by_category("steady")
    ids = {b.id for b in steady}
    assert ids == {"BN01", "BN02", "BN03"}


def test_filter_by_category_aggressive():
    agg = filter_by_category("aggressive")
    ids = {b.id for b in agg}
    assert ids == {"BN04", "BN05", "BN06"}


def test_filter_by_category_risky():
    risky = filter_by_category("risky")
    ids = {b.id for b in risky}
    assert ids == {"BN07", "BN08"}


def test_filter_by_category_utility():
    util = filter_by_category("utility")
    ids = {b.id for b in util}
    assert ids == {"BN09", "BN10"}


def test_filter_invalid_category_raises():
    with pytest.raises(ValueError):
        filter_by_category("cursed")


# ---- 스펙 준수 ---------------------------------------------------------------------


def test_bn01_steel_heart():
    b = get_boon_by_id("BN01")
    assert b.name == "강철 심장"
    assert b.effect.get("hp_bonus") == 30


def test_bn02_damage_reduction():
    b = get_boon_by_id("BN02")
    assert b.effect.get("damage_reduction") == 2
    assert b.effect.get("min_damage") == 1


def test_bn03_heal_per_turn():
    b = get_boon_by_id("BN03")
    assert b.effect.get("heal_per_turn") == 5


def test_bn04_damage_bonus_all():
    b = get_boon_by_id("BN04")
    assert b.effect.get("damage_bonus_all") == 3


def test_bn05_acc_crit_bonus():
    b = get_boon_by_id("BN05")
    assert b.effect.get("acc_bonus") == 15
    assert b.effect.get("crit_bonus") == 10


def test_bn06_per_bet_bonus():
    b = get_boon_by_id("BN06")
    assert b.effect.get("bet_acc_bonus_per") == 1
    assert b.effect.get("bet_crit_bonus_per") == 1


def test_bn07_double_proc():
    b = get_boon_by_id("BN07")
    assert b.effect.get("double_proc_chance") == 30


def test_bn08_bet_refund():
    b = get_boon_by_id("BN08")
    assert b.effect.get("bet_refund_ratio") == 0.5


def test_bn09_extra_card():
    b = get_boon_by_id("BN09")
    assert b.effect.get("extra_card_per_turn") == 1


def test_bn10_hand_bonus():
    b = get_boon_by_id("BN10")
    assert b.effect.get("starting_hand_bonus") == 3
    assert b.effect.get("hand_size") == 7


def test_unknown_boon_raises():
    with pytest.raises(KeyError):
        get_boon_by_id("BN99")


# ---- meta 검증 ---------------------------------------------------------------------


def test_meta_selection():
    meta = get_boon_meta()
    sel = meta.get("selection", {})
    assert sel.get("default_options") == 3
    # v3 (2026-04-17): 도박사 패시브가 "선택지 4개"에서 "리롤 1회"로 변경됨
    assert sel.get("gambler_reroll_count") == 1
    assert sel.get("pick_count") == 1
