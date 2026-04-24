"""Engine tests. 45장 카드 효과 + 시그니처 제약 + 미러전 금지.

규칙: 각 테스트는 결정론(rng 고정)으로 돌리고, 랜덤성이 핵심인 카드(G2 야바위, G4 잭팟)는
여러 고정 seed 로 경우별 검증.
"""

from __future__ import annotations

import random

import pytest

from allin.boons import get_boon_by_id
from allin.cards import get_card_by_id
from allin.engine import (
    CardResult,
    InvalidPlayError,
    MirrorMatchError,
    compute_bet_cap,
    execute_card,
    validate_card_play,
    validate_class_matchup,
)
from allin.player import Player


def make_players(c1="berserker", c2="warden", seed=1):
    """Helper: 두 플레이어. seed 고정으로 덱 셔플 결정론."""
    p1 = Player("P1", c1, seed=seed)
    p2 = Player("P2", c2, seed=seed + 100)
    return p1, p2


def always_hit_rng():
    """rng.randint(1,100) 호출이 항상 1을 반환 → 명중/크리/회피 전부 성공측."""
    r = random.Random()
    r.randint = lambda a, b: a  # 항상 하한
    return r


def always_miss_rng():
    """rng.randint(1,100) 호출이 항상 100을 반환 → 명중/크리는 실패, 회피/블러프 역시 실패(100%는 성공)."""
    r = random.Random()
    r.randint = lambda a, b: b  # 항상 상한
    return r


# ======================================================================
#   미러전 금지
# ======================================================================


def test_mirror_match_rejected():
    with pytest.raises(MirrorMatchError):
        validate_class_matchup("berserker", "berserker")


def test_non_mirror_allowed():
    for a in ("berserker", "gambler", "warden"):
        for b in ("berserker", "gambler", "warden"):
            if a != b:
                validate_class_matchup(a, b)


# ======================================================================
#   시그니처 제약
# ======================================================================


def test_signature_unlock_turn_3():
    p, op = make_players()
    sig = get_card_by_id("B14")
    with pytest.raises(InvalidPlayError):
        validate_card_play(sig, p, game_turn=2)
    validate_card_play(sig, p, game_turn=3)


def test_signature_once_per_game():
    p, op = make_players()
    sig = get_card_by_id("B15")
    execute_card(sig, p, op, bet=0, game_turn=3, rng=always_hit_rng())
    p.sig_used_this_turn = False  # 다른 턴 가정
    with pytest.raises(InvalidPlayError):
        validate_card_play(sig, p, game_turn=5)


def test_signature_only_one_per_turn():
    p, op = make_players(c1="berserker", c2="warden")
    sig1 = get_card_by_id("B15")
    execute_card(sig1, p, op, bet=0, game_turn=3, rng=always_hit_rng())
    sig2 = get_card_by_id("B14")
    with pytest.raises(InvalidPlayError):
        validate_card_play(sig2, p, game_turn=3)


def test_silenced_card_rejected():
    p, op = make_players()
    p.silenced_cards.append("B1")
    with pytest.raises(InvalidPlayError):
        validate_card_play(get_card_by_id("B1"), p, game_turn=2)


def test_condition_card_rejected_when_hp_high():
    p, op = make_players()
    last_stand = get_card_by_id("B13")  # self_hp_max 30
    p.hp = 50
    with pytest.raises(InvalidPlayError):
        validate_card_play(last_stand, p, game_turn=1)


def test_condition_card_allowed_when_hp_low():
    p, op = make_players()
    last_stand = get_card_by_id("B13")
    p.hp = 25
    validate_card_play(last_stand, p, game_turn=1)


# ======================================================================
#   베팅 상한
# ======================================================================


def test_bet_cap_hp_minus_1():
    p, op = make_players()
    p.hp = 5
    cap = compute_bet_cap(get_card_by_id("B1"), p)
    assert cap == 4


def test_bet_cap_restriction_shield_chain():
    p, op = make_players()
    p.bet_cap_override = 3
    assert compute_bet_cap(get_card_by_id("B1"), p) == 3


def test_bet_cap_card_limit():
    p, op = make_players()
    cap = compute_bet_cap(get_card_by_id("B14"), p)  # max_bet 15
    assert cap == 15


def test_bet_exceeds_cap_is_clamped():
    p, op = make_players()
    p.hp = 100
    op.hp = 100
    card = get_card_by_id("B1")
    result = execute_card(card, p, op, bet=999, game_turn=1, rng=always_hit_rng())
    assert result.bet == 10  # max_bet 10으로 제한


# ======================================================================
#   광전사 카드 (B1 ~ B15)
# ======================================================================


def test_b1_crushing_blow_full_bet_100_percent_hit():
    # B1: dmg 50, base_acc 80, bet_acc 1. bet 10 → acc 80+10+20(passive) = 110 → 100.
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B1")
    result = execute_card(card, p, op, bet=10, game_turn=1, rng=always_miss_rng())
    assert result.success
    assert result.bet == 10
    assert p.hp == 90
    assert op.hp == 50  # 50뎀


def test_b1_crushing_blow_no_bet_80_percent():
    p, op = make_players("berserker", "warden", seed=99)
    card = get_card_by_id("B1")
    # base 80%. always_miss_rng → 100 > 80 → miss.
    result = execute_card(card, p, op, bet=0, game_turn=1, rng=always_miss_rng())
    assert not result.success
    assert op.hp == 100


def test_b2_frenzied_charge_miss_self_damage():
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B2")  # base 70%, bet 0. miss 시 자해 8.
    result = execute_card(card, p, op, bet=0, game_turn=1, rng=always_miss_rng())
    assert not result.success
    assert result.damage_to_self == 8
    assert p.hp == 92


def test_b3_blood_price_lifesteal():
    p, op = make_players("berserker", "warden")
    p.hp = 50
    card = get_card_by_id("B3")  # dmg 45, base 75, bet 1, lifesteal 0.3
    # bet 10: acc 75+10+20 = 100. 45뎀 × 0.3 = 13 회복.
    result = execute_card(card, p, op, bet=10, game_turn=1, rng=always_hit_rng())
    assert result.success
    assert result.heal == 13
    # 50 - 10(bet) + 13(lifesteal) = 53
    assert p.hp == 53


def test_b4_chain_slash_hit_3_times():
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B4")  # 18뎀 × 3
    result = execute_card(card, p, op, bet=10, game_turn=1, rng=always_hit_rng())
    assert result.success
    assert len(result.sub_results) == 3
    assert all(sr["hit"] for sr in result.sub_results)
    assert result.damage_to_opponent == 54  # 18 × 3


def test_b5_execute_bonus_acc_when_hp_low():
    p, op = make_players("berserker", "warden")
    op.hp = 20  # 30 이하
    card = get_card_by_id("B5")  # dmg 55, base 60, bet 1, +25 acc when hp≤30
    # bet 5: acc 60+5+25+10(passive) = 100. 55뎀.
    r = random.Random()
    r.randint = lambda a, b: 50
    result = execute_card(card, p, op, bet=5, game_turn=1, rng=r)
    assert result.success
    assert result.damage_to_opponent == 55


def test_b6_berserker_roar_next_card_acc_bonus():
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B6")
    execute_card(card, p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.next_acc_bonus == 25


def test_b6_bonus_consumed_after_one_card():
    p, op = make_players("berserker", "warden")
    execute_card(get_card_by_id("B6"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    # 다음 카드 사용
    execute_card(get_card_by_id("B1"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.next_acc_bonus == 0


def test_b7_pain_absorb_grants_shield():
    p, op = make_players("berserker", "warden")
    execute_card(get_card_by_id("B7"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.shield == 12


def test_b8_maniac_strike_self_damage():
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B8")  # 자해 8
    result = execute_card(card, p, op, bet=0, game_turn=1, rng=always_miss_rng())
    # miss 여도 self_damage 8 적용
    assert result.damage_to_self == 8
    assert p.hp == 92


def test_b9_iron_skin_shield_15():
    p, op = make_players("berserker", "warden")
    execute_card(get_card_by_id("B9"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.shield == 15


def test_b10_feast_heals():
    p, op = make_players("berserker", "warden")
    p.hp = 50
    execute_card(get_card_by_id("B10"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.hp == 68


def test_b11_rage_stack_adds_damage():
    p, op = make_players("berserker", "warden")
    execute_card(get_card_by_id("B11"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.rage_stacks == 1
    result = execute_card(get_card_by_id("B1"), p, op, bet=10, game_turn=1, rng=always_hit_rng())
    # B1 50뎀 + 8 (rage) = 58
    assert result.damage_to_opponent == 58
    assert p.rage_stacks == 0


def test_b12_axe_sharpen_search_attack():
    p, op = make_players("berserker", "warden")
    before_deck = len(p.deck)
    before_hand = len(p.hand)
    result = execute_card(get_card_by_id("B12"), p, op, bet=0, game_turn=1, rng=random.Random(1))
    # 서치 1장 + 드로우 1장 = +2 카드 on hand
    assert len(p.hand) == before_hand + 2
    assert len(p.deck) == before_deck - 2
    # 서치는 공격 카드여야 함
    searched = [c for c in p.hand if c.id in result.drawn_cards and c.category == "attack"]
    assert len(searched) >= 1


def test_b13_last_stand_only_with_low_hp():
    p, op = make_players("berserker", "warden")
    p.hp = 25
    result = execute_card(
        get_card_by_id("B13"), p, op, bet=0, game_turn=1, rng=always_hit_rng()
    )
    assert result.success
    assert result.damage_to_opponent == 75  # B13 dmg 75


def test_b14_blood_madness_signature():
    p, op = make_players("berserker", "warden")
    card = get_card_by_id("B14")
    # base 30 + bet 15 × 4 = 90 + 광전사 2×15 = 120 → 100. 60뎀.
    result = execute_card(card, p, op, bet=15, game_turn=3, rng=always_miss_rng())
    assert result.success
    assert result.damage_to_opponent == 60
    assert p.hp == 85  # 15 베팅
    assert card.id in p.sig_used_ids


def test_b14_without_bet_low_acc():
    p, op = make_players("berserker", "warden")
    # base 30 + bet 0 = 30. always_miss → 100 > 30 → miss
    result = execute_card(
        get_card_by_id("B14"), p, op, bet=0, game_turn=3, rng=always_miss_rng()
    )
    assert not result.success


def test_b15_berserk_mode():
    p, op = make_players("berserker", "warden")
    execute_card(get_card_by_id("B15"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert p.berserk_turns == 3
    assert p.berserk_acc_bonus == 20
    assert p.berserk_damage_bonus == 8


# ======================================================================
#   도박사 카드 (G1 ~ G15)
# ======================================================================


def test_g1_card_throw_crit():
    # G1 (crit): dmg 25, base_acc 70, crit_mult 2. crit chance = 70/10 = 7%.
    # always_hit (returns 1): hit roll 1<=70 hit, crit roll 1<=7 crit. dmg 25*2 = 50.
    p, op = make_players("gambler", "warden")
    card = get_card_by_id("G1")
    result = execute_card(card, p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.success
    assert result.critical
    assert result.damage_to_opponent == 50


def test_g1_hit_no_crit():
    # rng=50: hit roll 50<=70 hit. crit roll 50>7 no crit. dmg 25.
    p, op = make_players("gambler", "warden")
    r = random.Random()
    r.randint = lambda a, b: 50
    result = execute_card(get_card_by_id("G1"), p, op, bet=0, game_turn=1, rng=r)
    assert result.success
    assert not result.critical
    assert result.damage_to_opponent == 25


def test_g2_shell_game_damage_range():
    # G2: damage_range [20,35], base_acc 60, crit_mult 2. always_hit:
    # hit roll 1<=60, crit roll 1<=6, range randint(20,35) returns 20. dmg 20*2=40.
    p, op = make_players("gambler", "warden")
    card = get_card_by_id("G2")
    result = execute_card(card, p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.success
    assert result.critical
    assert result.damage_to_opponent == 40


def test_g3_marked_dagger_ignores_shield():
    # G3: dmg 30, acc 60, crit_mult 2, ignore_shield. rng=50: hit, no crit, 30뎀 관통.
    p, op = make_players("gambler", "warden")
    op.shield = 100
    r = random.Random()
    r.randint = lambda a, b: 50
    result = execute_card(get_card_by_id("G3"), p, op, bet=0, game_turn=1, rng=r)
    assert result.damage_to_opponent == 30


def test_g4_jackpot_60_dmg_on_10():
    p, op = make_players("gambler", "warden")
    r = random.Random()
    # 1d10 → 10. bet 0. outcome: damage 60
    r.randint = lambda a, b: 10
    result = execute_card(get_card_by_id("G4"), p, op, bet=0, game_turn=1, rng=r)
    assert result.jackpot_roll == 10
    assert result.damage_to_opponent == 60


def test_g4_jackpot_self_damage_on_1():
    p, op = make_players("gambler", "warden")
    r = random.Random()
    r.randint = lambda a, b: 1
    result = execute_card(get_card_by_id("G4"), p, op, bet=0, game_turn=1, rng=r)
    assert result.jackpot_roll == 1
    assert result.damage_to_self == 25


def test_g4_jackpot_bet_bonus_boosts_roll():
    p, op = make_players("gambler", "warden")
    r = random.Random()
    # 굴림 1, bet 10 → 1 + 5 = 6 (6-9 범위 → 35뎀)
    r.randint = lambda a, b: 1
    result = execute_card(get_card_by_id("G4"), p, op, bet=10, game_turn=1, rng=r)
    assert result.jackpot_roll == 6
    assert result.damage_to_opponent == 35


def test_g5_double_down_repeats_last_card():
    # G5 가 G1 을 베팅 0으로 재발동. G1 crit (dmg 25 ×2 = 50).
    p, op = make_players("gambler", "warden")
    card_first = get_card_by_id("G1")
    execute_card(card_first, p, op, bet=0, game_turn=1, rng=always_hit_rng())
    result = execute_card(get_card_by_id("G5"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 50
    assert result.sub_results[0]["repeat_of"] == "G1"


def test_g5_double_down_fails_without_prev():
    p, op = make_players("gambler", "warden")
    result = execute_card(get_card_by_id("G5"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert not result.success


def test_g6_allin_bet_crit_multiplier():
    # G6: dmg 20, base_acc 50, bet_crit 3, crit_mult 2. always_hit at bet 0:
    # acc 50, crit chance = 5 (acc/10). hit roll 1<=50, crit roll 1<=5 crit. 20*2 = 40.
    p, op = make_players("gambler", "warden")
    result = execute_card(get_card_by_id("G6"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.critical
    assert result.damage_to_opponent == 40


def test_g7_tricksters_hand_basic():
    # G7 은 이제 crit 타입 (draw 효과 제거됨). dmg 20, acc 80.
    p, op = make_players("gambler", "warden")
    result = execute_card(get_card_by_id("G7"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.success


def test_g8_marked_card_crit_mult_2():
    # G8: dmg 35, mult 2. always_hit: 35*2 = 70.
    p, op = make_players("gambler", "warden")
    result = execute_card(get_card_by_id("G8"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.critical
    assert result.damage_to_opponent == 70


def test_g9_evasion_sets_dodge():
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G9"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.dodge_next_percent == 50


def test_g9_dodge_blocks_incoming_attack():
    # 회피 버프가 걸린 적에게 공격 시 회피 발동.
    p, op = make_players("gambler", "warden")
    p.dodge_next_percent = 100  # 반드시 회피
    r = random.Random()
    r.randint = lambda a, b: 1
    card = get_card_by_id("W1")  # fixed, 항상 명중
    result = execute_card(card, op, p, bet=0, game_turn=1, rng=r)
    # 명중은 100% 이지만 회피로 데미지 0
    assert not result.success
    assert result.dodged
    assert result.damage_to_opponent == 0


def test_g10_redraw_hand_replaces_hand():
    p, op = make_players("gambler", "warden")
    before = len(p.hand)
    execute_card(get_card_by_id("G10"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert len(p.hand) == before


def test_g11_foresight_sets_crit_bonus():
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G11"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.next_crit_bonus == 20


def test_g12_bluff_sets_next_attack_miss():
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G12"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert op.next_attack_miss_chance == 50


def test_g12_bluff_forces_miss_on_attacker():
    # 블러프는 hit/crit/fixed 모두 영향. always_hit (rng=1) → 1<=50 발동.
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G12"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    r = random.Random()
    r.randint = lambda a, b: 1
    # W1 (fixed) 시전 — 블러프 발동되면 강제 miss
    result = execute_card(get_card_by_id("W1"), op, p, bet=0, game_turn=1, rng=r)
    assert not result.success
    assert result.bluff_triggered
    assert op.next_attack_miss_chance == 0  # 소모


def test_g13_poison_applies():
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G13"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert op.poison_turns == 3
    assert op.poison_damage == 4


def test_g14_marked_fate_guarantees_crit():
    p, op = make_players("gambler", "warden")
    execute_card(get_card_by_id("G14"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert p.guarantee_next_crit
    # G1: hit 80%->70+something. always_hit ensures hit. crit guaranteed.
    result = execute_card(get_card_by_id("G1"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert result.critical
    assert not p.guarantee_next_crit


def test_g15_allin_signature_self_damage_on_crit_fail():
    # G15: dmg 25, base_acc 50, bet_acc 5, base_crit 45, crit_mult 3, max_bet 12.
    # bet 12: acc 50+60 = 110 → 100. crit = 100/10 + 45 = 55. rng 100 → hit but no crit.
    p, op = make_players("gambler", "warden")
    r = random.Random()
    r.randint = lambda a, b: 100
    result = execute_card(get_card_by_id("G15"), p, op, bet=12, game_turn=3, rng=r)
    assert not result.critical
    assert result.success  # hit landed even without crit
    # 자해 = bet amount = 12
    assert result.damage_to_self == 12


def test_g15_allin_signature_crit_hit():
    # always_hit at bet 0: acc 50, crit = 5 + 45 = 50. rng 1 → hit & crit. dmg 25*3 = 75.
    p, op = make_players("gambler", "warden")
    result = execute_card(get_card_by_id("G15"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert result.critical
    assert result.damage_to_opponent == 75
    assert result.damage_to_self == 0


# ======================================================================
#   컨트롤러 카드 (W1 ~ W15)
# ======================================================================


def test_w1_justice_strike_fixed_damage():
    p, op = make_players("warden", "berserker")
    result = execute_card(get_card_by_id("W1"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 10


def test_w1_full_bet_20_damage():
    p, op = make_players("warden", "berserker")
    result = execute_card(get_card_by_id("W1"), p, op, bet=10, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 20


def test_w2_punishing_light_bonus_vs_hit_prev():
    # W2: 직전 턴 상대 공격 성공 시 +8.
    p, op = make_players("warden", "berserker")
    op.hit_last_turn = True
    result = execute_card(get_card_by_id("W2"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 20  # 12 + 8


def test_w2_no_bonus_when_no_hit_prev():
    p, op = make_players("warden", "berserker")
    op.hit_last_turn = False
    result = execute_card(get_card_by_id("W2"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 12


def test_w3_weakness_silences_random_card():
    p, op = make_players("warden", "berserker")
    r = random.Random(1)
    result = execute_card(get_card_by_id("W3"), p, op, bet=0, game_turn=1, rng=r)
    assert len(op.silenced_cards) == 1
    assert result.damage_to_opponent == 6


def test_w4_binding_chains_sets_opponent_bet_cap():
    p, op = make_players("warden", "berserker")
    execute_card(get_card_by_id("W4"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert op.bet_cap_override == 3
    assert op.bet_cap_override_turns == 1


def test_w5_judgment_usable_when_self_hp_lower():
    # W5: 내 HP < 상대 HP 일 때만 사용 가능. 데미지는 14 (조건만 변경)
    p, op = make_players("warden", "berserker")
    p.hp = 50
    op.hp = 100
    result = execute_card(get_card_by_id("W5"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 14


def test_w5_judgment_blocked_when_self_hp_higher():
    p, op = make_players("warden", "berserker")
    p.hp = 100
    op.hp = 50
    with pytest.raises(InvalidPlayError):
        execute_card(get_card_by_id("W5"), p, op, bet=0, game_turn=1, rng=always_hit_rng())


def test_w6_patience_retort_uses_total_damage_taken():
    # W6: 받은 누적 피해 × 30%. 30 × 0.3 = 9.
    p, op = make_players("warden", "berserker")
    p.total_damage_taken = 30
    result = execute_card(get_card_by_id("W6"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 9


def test_w6_patience_retort_no_cap():
    # W6: 상한 제거. 200 × 0.3 = 60.
    p, op = make_players("warden", "berserker")
    p.total_damage_taken = 200
    result = execute_card(get_card_by_id("W6"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 60


def test_w7_shield_bash_adds_shield():
    p, op = make_players("warden", "berserker")
    result = execute_card(get_card_by_id("W7"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 6
    assert p.shield == 8


def test_w8_holy_arrow_fixed_with_self_heal():
    # W8 은 이제 fixed: dmg 10, 강화 0, self_heal 10. 항상 명중.
    p, op = make_players("warden", "berserker")
    p.hp = 50
    result = execute_card(get_card_by_id("W8"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert result.success
    assert result.damage_to_opponent == 10
    assert result.heal == 10
    assert p.hp == 60


def test_w9_shield_wall_grants_18():
    p, op = make_players("warden", "berserker")
    execute_card(get_card_by_id("W9"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.shield == 18


def test_w10_holy_aegis_heals_20():
    p, op = make_players("warden", "berserker")
    p.hp = 50
    execute_card(get_card_by_id("W10"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.hp == 70


def test_w11_cleanse_removes_debuffs():
    p, op = make_players("warden", "berserker")
    p.hp = 50
    p.poison_turns = 3
    p.poison_damage = 4
    p.silenced_cards.append("W1")
    p.bet_cap_override = 3
    p.bet_cap_override_turns = 1
    execute_card(get_card_by_id("W11"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.hp == 58
    assert p.poison_turns == 0
    assert p.silenced_cards == []
    assert p.bet_cap_override is None


def test_w12_prescience_dodge_50():
    # W12 변경: peek 제거, dodge 50%
    p, op = make_players("warden", "berserker")
    execute_card(get_card_by_id("W12"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert p.dodge_next_percent == 50


def test_w13_regroup_draws_2():
    p, op = make_players("warden", "berserker")
    before = len(p.hand)
    execute_card(get_card_by_id("W13"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    assert len(p.hand) == before + 2


def test_w14_null_declaration_reduces_incoming():
    p, op = make_players("warden", "berserker")
    execute_card(get_card_by_id("W14"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert p.incoming_damage_mult == 0.5
    assert p.incoming_damage_mult_turns == 3
    # B1 50뎀 × 0.5 = 25
    result = execute_card(get_card_by_id("B1"), op, p, bet=10, game_turn=3, rng=always_miss_rng())
    assert result.damage_to_opponent == 25


def test_w15_final_judgment_self_bet_only_bypass_all():
    # W15: 자신 베팅만 사용. 적 실드/감쇠/회피 모두 무시.
    p, op = make_players("warden", "berserker")
    p.total_bet = 8
    op.total_bet = 30
    op.shield = 100  # 무시되어야 함
    op.dodge_next_percent = 100  # 무시되어야 함 (dodge 룰렛 안 굴림)
    op.incoming_damage_mult = 0.5  # 무시되어야 함
    result = execute_card(get_card_by_id("W15"), p, op, bet=0, game_turn=3, rng=always_hit_rng())
    assert result.damage_to_opponent == 8  # 자신 베팅만


# ======================================================================
#   부운 전역 효과
# ======================================================================


def test_bn04_blade_blessing_adds_3_to_all_damage():
    boon = get_boon_by_id("BN04")
    p = Player("P1", "berserker", boon=boon, seed=1)
    op = Player("P2", "warden", seed=2)
    # B1 50 + 3 = 53
    result = execute_card(get_card_by_id("B1"), p, op, bet=10, game_turn=1, rng=always_hit_rng())
    assert result.damage_to_opponent == 53


def test_bn05_precision_eye_acc_bonus():
    boon = get_boon_by_id("BN05")
    p = Player("P1", "berserker", boon=boon, seed=1)
    op = Player("P2", "warden", seed=2)
    # base 40% + 15% (BN05) = 55%. rng=50 → hit.
    r = random.Random()
    r.randint = lambda a, b: 50
    result = execute_card(get_card_by_id("B1"), p, op, bet=0, game_turn=1, rng=r)
    assert result.success


def test_bn05_does_not_affect_fixed():
    boon = get_boon_by_id("BN05")
    p = Player("P1", "warden", boon=boon, seed=1)
    op = Player("P2", "berserker", seed=2)
    result = execute_card(get_card_by_id("W1"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    # Fixed 는 acc/crit 영향 안 받음. damage 그대로 10.
    assert result.damage_to_opponent == 10


def test_bn06_per_bet_acc_crit():
    boon = get_boon_by_id("BN06")
    p = Player("P1", "berserker", boon=boon, seed=1)
    op = Player("P2", "warden", seed=2)
    # B1 40% + 6*5(bet=5) + 2*5(광전사 passive) + 1*5(BN06) = 40+30+10+5 = 85%
    r = random.Random()
    r.randint = lambda a, b: 85
    result = execute_card(get_card_by_id("B1"), p, op, bet=5, game_turn=1, rng=r)
    assert result.success


def test_bn07_lucky_coin_doubles_damage():
    boon = get_boon_by_id("BN07")
    p = Player("P1", "berserker", boon=boon, seed=1)
    op = Player("P2", "warden", seed=2)
    r = random.Random()
    r.randint = lambda a, b: 1
    # B1 50 × 2 (double proc) = 100
    result = execute_card(get_card_by_id("B1"), p, op, bet=10, game_turn=1, rng=r)
    assert result.double_proc
    assert result.damage_to_opponent == 100


# ======================================================================
#   Warden 패시브 (손패 공개) — Task 5 범위. 여기선 생략.
# ======================================================================


# ======================================================================
#   교차: 실드 + 공격, G3 방어 무시, W14 mult
# ======================================================================


def test_attack_reduced_by_opponent_shield():
    p, op = make_players("warden", "berserker")
    op.shield = 5
    result = execute_card(get_card_by_id("W1"), p, op, bet=0, game_turn=1, rng=always_hit_rng())
    # 10뎀 - 5실드 = 5 데미지
    assert result.damage_to_opponent == 5


def test_marked_dagger_bypasses_shield_and_bn02():
    # G3: dmg 30, ignore_shield. BN02 -2 적용.
    boon = get_boon_by_id("BN02")
    p = Player("P1", "gambler", seed=1)
    op = Player("P2", "warden", boon=boon, seed=2)
    op.shield = 100
    r = random.Random()
    r.randint = lambda a, b: 50  # hit but no crit
    result = execute_card(get_card_by_id("G3"), p, op, bet=0, game_turn=1, rng=r)
    # 30 - 2 = 28
    assert result.damage_to_opponent == 28
