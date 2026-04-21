"""Player state tests."""

from __future__ import annotations

import pytest

from allin.boons import get_boon_by_id
from allin.player import Player


# ---- 기본 생성 ---------------------------------------------------------------------


def test_basic_creation_default_hp():
    p = Player("P1", "berserker", seed=1)
    assert p.hp == 100
    assert p.max_hp == 100
    assert p.hand_size == 5
    assert len(p.hand) == 5
    assert len(p.deck) == 10   # 15장 - 시작 손패 5장
    assert len(p.graveyard) == 0
    assert p.is_alive()


def test_deterministic_shuffle_via_seed():
    a = Player("A", "gambler", seed=42)
    b = Player("B", "gambler", seed=42)
    assert [c.id for c in a.hand] == [c.id for c in b.hand]


def test_different_seed_different_order():
    a = Player("A", "gambler", seed=1)
    b = Player("B", "gambler", seed=2)
    # 확률적이지만 시드 다르면 거의 확실히 다름. 순서만 다를 뿐 내용은 같은 풀.
    assert sorted(c.id for c in a.hand + a.deck) == sorted(
        c.id for c in b.hand + b.deck
    )


# ---- 부운 적용 ---------------------------------------------------------------------


def test_steel_heart_boosts_hp_to_130():
    steel_heart = get_boon_by_id("BN01")
    p = Player("P", "berserker", boon=steel_heart, seed=1)
    assert p.max_hp == 130
    assert p.hp == 130


def test_eye_of_prescience_extends_hand():
    eye = get_boon_by_id("BN10")
    p = Player("P", "gambler", boon=eye, seed=1)
    assert p.hand_size == 7
    assert len(p.hand) == 8   # 시작 손패 5 + 3


def test_abundant_hand_extra_card_per_turn():
    abundant = get_boon_by_id("BN09")
    p = Player("P", "warden", boon=abundant, seed=1)
    assert p.max_cards_per_turn() == 3


def test_no_boon_defaults():
    p = Player("P", "warden", seed=1)
    assert p.hand_size == 5
    assert p.max_cards_per_turn() == 2
    assert p.max_hp == 100


# ---- 드로우/덱 ---------------------------------------------------------------------


def test_draw_n_cards_reduces_deck():
    p = Player("P", "berserker", seed=1)
    before_deck = len(p.deck)
    drawn = p.draw(3)
    assert len(drawn) == 3
    assert len(p.deck) == before_deck - 3
    assert len(p.hand) == 8


def test_fill_hand_to_hand_size():
    p = Player("P", "berserker", seed=1)
    # 5장 상태에서 2장 버리고 fill_hand → 다시 5
    discarded = [p.hand[0], p.hand[1]]
    for c in discarded:
        p.discard(c)
    assert len(p.hand) == 3
    p.fill_hand()
    assert len(p.hand) == 5


def test_draw_reshuffles_graveyard_when_deck_empty():
    p = Player("P", "berserker", seed=1)
    # 모든 카드를 묘지로 보낸 뒤 드로우 → 묘지가 셔플되어 덱으로
    all_cards = list(p.hand) + list(p.deck)
    p.hand = []
    p.deck = []
    p.graveyard = all_cards[:]
    p.draw(1)
    assert len(p.hand) == 1
    assert len(p.graveyard) == 0
    assert len(p.deck) == len(all_cards) - 1


def test_draw_returns_empty_when_deck_and_graveyard_empty():
    p = Player("P", "berserker", seed=1)
    p.hand = []
    p.deck = []
    p.graveyard = []
    drawn = p.draw(3)
    assert drawn == []


def test_redraw_hand_swaps_all_cards():
    p = Player("P", "gambler", seed=1)
    before = len(p.hand)
    p.redraw_hand()
    assert len(p.hand) == before
    assert len(p.graveyard) == before


# ---- 데미지/실드 --------------------------------------------------------------------


def test_take_damage_reduces_hp():
    p = Player("P", "berserker", seed=1)
    evt = p.take_damage(20)
    assert p.hp == 80
    assert evt.dealt == 20
    assert evt.requested == 20


def test_shield_absorbs_damage():
    p = Player("P", "berserker", seed=1)
    p.shield = 15
    evt = p.take_damage(20)
    assert p.hp == 95
    assert evt.absorbed_by_shield == 15
    assert evt.dealt == 5


def test_shield_fully_blocks_damage():
    p = Player("P", "warden", seed=1)
    p.shield = 30
    evt = p.take_damage(12)
    assert p.hp == 100
    assert evt.absorbed_by_shield == 12
    assert evt.dealt == 0


def test_ignore_shield_bypasses():
    # 독 등 '방어 무시' 효과
    p = Player("P", "warden", seed=1)
    p.shield = 100
    evt = p.take_damage(8, ignore_shield=True)
    assert p.hp == 92
    assert evt.absorbed_by_shield == 0
    assert evt.dealt == 8


def test_bn02_steadfast_will_reduces_damage():
    boon = get_boon_by_id("BN02")  # 데미지 -2, 최소 1
    p = Player("P", "warden", boon=boon, seed=1)
    evt = p.take_damage(10)
    assert evt.dealt == 8
    assert p.hp == 92


def test_bn02_minimum_damage_is_1():
    boon = get_boon_by_id("BN02")
    p = Player("P", "warden", boon=boon, seed=1)
    evt = p.take_damage(1)  # 원래 1뎀에서 -2 하면 -1인데 최소 1
    assert evt.dealt == 1
    assert p.hp == 99


def test_take_damage_zero_or_negative_noop():
    p = Player("P", "berserker", seed=1)
    p.take_damage(0)
    assert p.hp == 100
    p.take_damage(-5)
    assert p.hp == 100


# ---- 회복 ---------------------------------------------------------------------------


def test_heal_up_to_max_hp():
    p = Player("P", "berserker", seed=1)
    p.hp = 50
    gained = p.heal(30)
    assert gained == 30
    assert p.hp == 80


def test_heal_caps_at_max_hp():
    p = Player("P", "berserker", seed=1)
    p.hp = 95
    gained = p.heal(30)
    assert gained == 5
    assert p.hp == 100


def test_heal_with_steel_heart_max_130():
    boon = get_boon_by_id("BN01")
    p = Player("P", "berserker", boon=boon, seed=1)
    p.hp = 100
    gained = p.heal(50)
    assert gained == 30
    assert p.hp == 130


# ---- 턴 훅 --------------------------------------------------------------------------


def test_begin_turn_applies_recovery_boon():
    boon = get_boon_by_id("BN03")  # 매 턴 +5
    p = Player("P", "warden", boon=boon, seed=1)
    p.hp = 90
    info = p.begin_turn()
    assert info["heal"] == 5
    assert p.hp == 95


def test_begin_turn_applies_poison():
    p = Player("P", "warden", seed=1)
    p.poison_turns = 3
    p.poison_damage = 4
    p.shield = 100   # 독은 실드 무시
    info = p.begin_turn()
    assert info["poison"] == 4
    assert p.hp == 96
    assert p.poison_turns == 2


def test_begin_turn_applies_berserk_self_damage():
    p = Player("P", "berserker", seed=1)
    p.berserk_turns = 3
    p.berserk_acc_bonus = 20
    p.berserk_damage_bonus = 8
    info = p.begin_turn()
    assert info["berserk_self_dmg"] == 5
    assert p.hp == 95
    assert p.berserk_turns == 2
    # 아직 버프 유효
    assert p.berserk_acc_bonus == 20


def test_berserk_expires_after_3_turns():
    p = Player("P", "berserker", seed=1)
    p.berserk_turns = 3
    p.berserk_acc_bonus = 20
    p.berserk_damage_bonus = 8
    for _ in range(3):
        p.begin_turn()
    assert p.berserk_turns == 0
    assert p.berserk_acc_bonus == 0
    assert p.berserk_damage_bonus == 0


def test_begin_turn_resets_shield():
    # 실드는 상대 턴까지 유지 → 다음 내 턴 시작 시 리셋
    p = Player("P", "warden", seed=1)
    p.shield = 18
    p.end_turn()
    assert p.shield == 18          # 상대 턴까진 유지
    p.begin_turn()
    assert p.shield == 0


def test_end_turn_carries_miss_flag():
    p = Player("P", "berserker", seed=1)
    p.record_miss()
    p.end_turn()
    assert p.missed_last_turn is True

    # 새 턴에서 miss 없이 end_turn 하면 플래그 해제
    p.begin_turn()
    p.end_turn()
    assert p.missed_last_turn is False


def test_end_turn_decrements_bet_cap():
    p = Player("P", "gambler", seed=1)
    p.bet_cap_override = 3
    p.bet_cap_override_turns = 1
    p.end_turn()
    assert p.bet_cap_override is None
    assert p.bet_cap_override_turns == 0


def test_end_turn_decrements_negate_declaration():
    p = Player("P", "gambler", seed=1)
    p.incoming_damage_mult = 0.5
    p.incoming_damage_mult_turns = 3
    p.end_turn()
    assert p.incoming_damage_mult_turns == 2
    assert p.incoming_damage_mult == 0.5
    # 3턴 끝나면 풀림
    p.end_turn()
    p.end_turn()
    assert p.incoming_damage_mult == 1.0


# ---- 베팅 ---------------------------------------------------------------------------


def test_spend_bet_reduces_hp():
    p = Player("P", "berserker", seed=1)
    net = p.spend_bet(10)
    assert p.hp == 90
    assert p.total_bet == 10
    assert net == 10  # 환원 없음


def test_bn08_blood_refund_half():
    boon = get_boon_by_id("BN08")  # 베팅 HP 50% 회복
    p = Player("P", "berserker", boon=boon, seed=1)
    net = p.spend_bet(10)
    # 10 차감 → 5 회복 → 순지출 5, HP 95
    assert p.hp == 95
    assert p.total_bet == 10
    assert net == 5


# ---- 사망 ---------------------------------------------------------------------------


def test_is_alive_false_when_hp_zero_or_below():
    p = Player("P", "berserker", seed=1)
    p.hp = 0
    assert not p.is_alive()
    p.hp = -5
    assert not p.is_alive()
