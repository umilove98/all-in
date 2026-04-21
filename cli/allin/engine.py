"""Card execution engine + Game 루프.

엔진 호출 경로:
    execute_card(card, caster, opponent, bet=N, game_turn=T, rng=R) -> CardResult

Game 루프:
    Game(p1, p2, p1_agent, p2_agent).run() -> GameResult
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from .boons import Boon
from .cards import Card, get_deck
from .player import Player

MAX_TURNS = 15


class MirrorMatchError(ValueError):
    """같은 직업 간 대전은 금지 (docs/01-game-overview.md)."""


class InvalidPlayError(ValueError):
    """카드 사용 불가 (시그니처 제약, 조건 미충족, 침묵 등)."""


# ======================================================================
#   결과 객체
# ======================================================================


@dataclass
class CardResult:
    card_id: str
    caster: str
    bet: int
    success: bool = True  # hit/crit/fixed 는 명중 성공, utility 는 시전 성공
    critical: bool = False
    damage_to_opponent: int = 0
    damage_to_self: int = 0
    heal: int = 0
    shield_gained: int = 0
    drawn_cards: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    sub_results: list[dict[str, Any]] = field(default_factory=list)
    double_proc: bool = False  # BN07 행운의 동전 발동 여부
    jackpot_roll: Optional[int] = None


# ======================================================================
#   보조
# ======================================================================


CLASS_MATCHUP_ERROR = "미러전은 금지되어 있습니다 (docs/01-game-overview.md)."


def validate_class_matchup(first: str, second: str) -> None:
    if first == second:
        raise MirrorMatchError(CLASS_MATCHUP_ERROR + f" (both={first})")


def compute_bet_cap(card: Card, caster: Player) -> int:
    """카드 max_bet, 베팅 상한 디버프, HP 1 남기기 룰 을 종합한 실제 베팅 상한."""
    cap = card.max_bet
    if caster.bet_cap_override is not None:
        cap = min(cap, caster.bet_cap_override)
    cap = min(cap, max(0, caster.hp - 1))
    return cap


def validate_card_play(card: Card, caster: Player, game_turn: int) -> None:
    """사용 불가 시 InvalidPlayError 발생."""
    if card.signature:
        if card.id in caster.sig_used_ids:
            raise InvalidPlayError(f"{card.id}: 이미 사용한 시그니처")
        if caster.sig_used_this_turn:
            raise InvalidPlayError("같은 턴에 시그니처 1장만 사용 가능")
        if game_turn < 3:
            raise InvalidPlayError(
                f"시그니처는 3턴 이후부터 사용 가능 (현재 {game_turn}턴)"
            )
    if card.id in caster.silenced_cards:
        raise InvalidPlayError(f"{card.id}: 침묵 상태")
    cond = card.extra.get("condition")
    if cond:
        hp_max = cond.get("self_hp_max")
        if hp_max is not None and caster.hp > hp_max:
            raise InvalidPlayError(
                f"{card.id}: 내 HP가 {hp_max} 이하여야 함 (현재 {caster.hp})"
            )


# ======================================================================
#   명중/크리 계산
# ======================================================================


def _boon_effect(caster: Player, key: str, default: Any = 0) -> Any:
    if caster.boon is None:
        return default
    return caster.boon.effect.get(key, default)


def _compute_hit_accuracy(card: Card, caster: Player, opponent: Player, bet: int) -> int:
    acc = card.base_acc + card.bet_acc * bet
    # 조건부 명중 보너스 (B5 처형: 상대 HP≤30 시 +20%)
    ex_threshold = card.extra.get("execute_threshold")
    ex_bonus = card.extra.get("execute_bonus_acc", 0)
    if ex_threshold is not None and opponent.hp <= ex_threshold:
        acc += ex_bonus
    # 광전사 패시브: HP 베팅 1당 명중률 +2%
    if caster.class_name == "berserker":
        acc += 2 * bet
    # BN05 정밀의 눈: 모든 명중 +15%
    acc += _boon_effect(caster, "acc_bonus", 0)
    # BN06 광기의 인장: 베팅 1당 +1%
    acc += _boon_effect(caster, "bet_acc_bonus_per", 0) * bet
    # B6 광전사의 함성: 다음 카드 +25%
    acc += caster.next_acc_bonus
    # B15 베르세르크: 3턴 명중 +20%
    acc += caster.berserk_acc_bonus
    return max(0, min(100, acc))


def _compute_crit_chance(card: Card, caster: Player, bet: int) -> int:
    crit = card.base_crit + card.bet_crit * bet
    # BN05: 모든 크리 +10%
    crit += _boon_effect(caster, "crit_bonus", 0)
    # BN06: 베팅 1당 +1%
    crit += _boon_effect(caster, "bet_crit_bonus_per", 0) * bet
    # G11 미래 보기: 다음 카드 크리 +20%
    crit += caster.next_crit_bonus
    return max(0, min(100, crit))


# '다음 1장' 버프 소모 규칙:
#   - next_acc_bonus     : Hit 카드가 적용 시 소모
#   - next_crit_bonus    : Crit 카드가 적용 시 소모
#   - guarantee_next_crit: Crit 카드가 적용 시 소모
#   - next_attack_miss_chance: 공격 시 _roll_hit_with_modifiers 에서 소모
#   - dodge_next_percent : 상대 공격 시 _roll_hit_with_modifiers 에서 소모
#
# 이렇게 타입별로 나눈 이유:
#   B6 함성 쓰고 B10 회복(utility) 써도 다음 공격에 +25% 명중이 살아있어야 자연스러움.
#   즉 유틸리티 카드는 "다음 1장" 버프를 건드리지 않음.


def _consume_rage(caster: Player) -> int:
    """분노 스택 소모. 카드 데미지에 +8/스택 적용 후 스택 0."""
    bonus = caster.rage_stacks * 8
    caster.rage_stacks = 0
    return bonus


# ======================================================================
#   데미지 적용 헬퍼
# ======================================================================


def _apply_damage_to_opponent(
    raw_damage: int,
    card: Card,
    caster: Player,
    opponent: Player,
    result: CardResult,
) -> int:
    """최종 데미지를 상대에게 적용. 상대 실드/감쇠/무효선언 적용.

    `ignore_shield=True` 카드(G3 마크된 단검, 독)는 실드 건너뜀.
    """
    if raw_damage <= 0:
        return 0
    ignore_shield = bool(card.extra.get("ignore_shield", False))
    # W14 무효 선언: 내가 받는 데미지 ×0.5
    if opponent.incoming_damage_mult != 1.0:
        raw_damage = int(raw_damage * opponent.incoming_damage_mult)
    evt = opponent.take_damage(raw_damage, ignore_shield=ignore_shield)
    return evt.dealt


def _apply_self_damage(caster: Player, amount: int, result: CardResult) -> None:
    if amount <= 0:
        return
    # 자해는 본인 실드/감쇠 부운 무시. HP 직접 차감 (죽을 수 있음).
    before = caster.hp
    caster.hp = max(0, caster.hp - amount)
    result.damage_to_self += before - caster.hp


# ======================================================================
#   타입별 실행
# ======================================================================


def _roll_double_proc(caster: Player, rng: random.Random, result: CardResult) -> None:
    """BN07 행운의 동전: 30% 확률 효과 ×2. 카드 시작 시 1회 굴림."""
    chance = _boon_effect(caster, "double_proc_chance", 0)
    if chance > 0 and rng.randint(1, 100) <= chance:
        result.double_proc = True
        result.notes.append("🎰 행운의 동전 발동! 효과 ×2")


def _compute_base_attack_damage(card: Card, caster: Player, opponent: Player) -> int:
    """공격 카드의 base damage 계산. 분노/부운/조건부 보너스 포함, 크리/더블프록 제외."""
    dmg = card.damage
    # BN04 칼날의 축복: 모든 카드 데미지 +3
    dmg += _boon_effect(caster, "damage_bonus_all", 0)
    # B15 베르세르크: 공격 +8
    dmg += caster.berserk_damage_bonus
    # W2 처벌의 빛: 상대 직전 턴 miss 시 +8
    punish = card.extra.get("punish_missed_prev", 0)
    if punish and opponent.missed_last_turn:
        dmg += punish
    # W5 정의 집행: 상대 HP > 내 HP 시 +8
    judgment_bonus = card.extra.get("judgment_bonus", 0)
    if judgment_bonus and opponent.hp > caster.hp:
        dmg += judgment_bonus
    return dmg


def _execute_hit(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int,
    result: CardResult,
    rng: random.Random,
) -> None:
    acc = _compute_hit_accuracy(card, caster, opponent, bet)
    # 적용 직후 소모 (Hit 카드 시전자 관점)
    caster.next_acc_bonus = 0
    base_damage = _compute_base_attack_damage(card, caster, opponent)
    # fixed/hit 공통으로 bet_damage 필드도 적용 (hit 카드는 대부분 0이라 영향 X)
    base_damage += card.bet_damage * bet
    # 분노 스택 (공격 카드만) — 카드 단위 1회 소모
    base_damage += _consume_rage(caster)
    # 다회타
    hit_count = card.extra.get("hit_count", 1)

    total_damage = 0
    successful_hits = 0
    for i in range(hit_count):
        hit = _roll_hit_with_modifiers(acc, caster, opponent, rng, result)
        if hit:
            successful_hits += 1
            dmg = base_damage
            if result.double_proc:
                dmg *= 2
            dealt = _apply_damage_to_opponent(dmg, card, caster, opponent, result)
            total_damage += dealt
            result.sub_results.append(
                {"hit_index": i + 1, "hit": True, "damage": dealt}
            )
        else:
            caster.record_miss()
            result.sub_results.append({"hit_index": i + 1, "hit": False, "damage": 0})

    result.success = successful_hits > 0
    result.damage_to_opponent = total_damage
    if result.success:
        caster.record_hit(total_damage, critical=False)

    # 흡혈 (B3 피의 대가)
    lifesteal = card.extra.get("lifesteal", 0)
    if lifesteal and successful_hits > 0:
        healed = caster.heal(int(total_damage * lifesteal))
        result.heal += healed

    # 자해: 사용 시 자해 (B8 광기의 일격) — 명중과 무관하게 발동
    self_dmg = card.extra.get("self_damage", 0)
    if self_dmg:
        _apply_self_damage(caster, self_dmg, result)

    # 자해: 빗나감 시 (B2 광폭한 돌진, G15 올인 일부)
    miss_self = card.extra.get("self_damage_on_miss")
    if miss_self and not result.success:
        if miss_self == "bet_amount":
            _apply_self_damage(caster, bet, result)
        else:
            _apply_self_damage(caster, int(miss_self), result)

    # 추가 드로우 (G7 야바위꾼의 손)
    draw_n = card.extra.get("draw", 0)
    if draw_n:
        drawn = caster.draw(draw_n)
        result.drawn_cards.extend(c.id for c in drawn)


def _roll_hit_with_modifiers(
    acc: int,
    caster: Player,
    opponent: Player,
    rng: random.Random,
    result: CardResult,
) -> bool:
    """최종 명중 판정. 블러프/회피 포함."""
    hit = rng.randint(1, 100) <= acc
    # G12 블러프: 내 다음 공격 miss 강제 (시전자 기준, 공격할 때 체크)
    if hit and caster.next_attack_miss_chance > 0:
        chance = caster.next_attack_miss_chance
        caster.next_attack_miss_chance = 0
        if rng.randint(1, 100) <= chance:
            hit = False
            result.notes.append(f"블러프에 걸림 — {chance}% 강제 miss")
    # 회피 (공격 받는 쪽의 G9/W12)
    if hit and opponent.dodge_next_percent > 0:
        chance = opponent.dodge_next_percent
        opponent.dodge_next_percent = 0
        if rng.randint(1, 100) <= chance:
            hit = False
            result.notes.append(f"{opponent.name} 회피 ({chance}%)")
    return hit


def _execute_crit(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int,
    result: CardResult,
    rng: random.Random,
) -> None:
    # Crit 카드는 항상 맞음 (회피는 Hit 류에만 작용한다고 가정 — 디자인 문서 기준 명시 없음,
    # 단 G9/W12 "다음 받는 공격" 문구는 일반적 공격을 의미하므로 Crit 에도 적용).
    # 여기선 일관성을 위해 Hit/Crit 둘 다 회피 체크.
    acc = 100  # Crit 은 명중 자체는 항상 성공
    # 블러프/회피 적용
    hit = _roll_hit_with_modifiers(acc, caster, opponent, rng, result)

    base_damage = _compute_base_attack_damage(card, caster, opponent)
    base_damage += card.bet_damage * bet
    base_damage += _consume_rage(caster)

    # damage_range (G2 야바위: 8~22 랜덤)
    rng_range = card.extra.get("damage_range")
    if rng_range:
        lo, hi = rng_range
        base_damage = rng.randint(lo, hi)
        # 야바위는 damage 필드 기준이 아니라 랜덤값이 base. BN04 등은 나중에 더해야 하지만
        # 단순화를 위해 기본값을 덮어쓰고 별도 보정:
        base_damage += _boon_effect(caster, "damage_bonus_all", 0)
        base_damage += caster.berserk_damage_bonus
        # W2/W5 보너스는 의미상 공격 카드의 punish/judgment 필드가 있는 경우만
        if card.extra.get("punish_missed_prev") and opponent.missed_last_turn:
            base_damage += card.extra["punish_missed_prev"]
        if card.extra.get("judgment_bonus") and opponent.hp > caster.hp:
            base_damage += card.extra["judgment_bonus"]

    # 크리 판정
    crit_chance = _compute_crit_chance(card, caster, bet)
    # 적용 직후 소모 (Crit 카드 시전자 관점)
    caster.next_crit_bonus = 0
    if caster.guarantee_next_crit:
        is_crit = True
        caster.guarantee_next_crit = False
        result.notes.append("마크된 운명 — 크리 확정")
    else:
        is_crit = rng.randint(1, 100) <= crit_chance

    if not hit:
        # 블러프/회피로 빗나감 → 데미지 0
        caster.record_miss()
        result.success = False
        # G15 올인 시그니처의 "크리 실패 시 베팅만큼 자해" 는 크리 실패 조건이므로
        # 명중 실패(회피)도 데미지 0 + 자해 아님. 단 크리 실패랑은 별건.
        return

    dmg = base_damage * card.crit_mult if is_crit else base_damage
    dmg = int(dmg)
    if result.double_proc:
        dmg *= 2

    dealt = _apply_damage_to_opponent(dmg, card, caster, opponent, result)
    result.success = True
    result.critical = is_crit
    result.damage_to_opponent = dealt
    caster.record_hit(dealt, critical=is_crit)

    # G15 올인 시그니처: 크리 실패 시 베팅한 만큼 자해
    miss_self = card.extra.get("self_damage_on_miss")
    if miss_self == "bet_amount" and not is_crit:
        _apply_self_damage(caster, bet, result)


def _execute_fixed(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int,
    result: CardResult,
    rng: random.Random,
) -> None:
    base = _compute_base_attack_damage(card, caster, opponent)
    base += card.bet_damage * bet
    base += _consume_rage(caster)

    # W6 인내의 반격: 데미지 = 받은 총 뎀 / 3 (최대 35). 베팅 상관없이 덮어쓰기.
    patience = card.extra.get("patience")
    if patience:
        div = patience.get("div", 3)
        cap = patience.get("cap", 35)
        base = min(cap, caster.total_damage_taken // div)

    # W15 최후의 심판: 상대 총 베팅 HP = 데미지 (확정)
    if card.extra.get("final_judgment"):
        base = opponent.total_bet

    dmg = base * (2 if result.double_proc else 1)

    dealt = _apply_damage_to_opponent(dmg, card, caster, opponent, result)
    result.success = True
    result.damage_to_opponent = dealt
    if dealt > 0:
        caster.record_hit(dealt, critical=False)

    # W7 방패 강타: 자기 방어 +8
    self_shield = card.extra.get("self_shield")
    if self_shield:
        caster.shield += self_shield
        result.shield_gained += self_shield

    # W3 약점 포착: 상대 손패 1장 랜덤 침묵
    silence_random = card.extra.get("silence_random")
    if silence_random and opponent.hand:
        targets = rng.sample(opponent.hand, min(silence_random, len(opponent.hand)))
        for t in targets:
            opponent.silenced_cards.append(t.id)
            result.notes.append(f"{t.name} 침묵")

    # W4 결박의 사슬: 상대 다음 턴 베팅 상한 제한
    bet_cap = card.extra.get("opponent_max_bet_next")
    if bet_cap is not None:
        opponent.bet_cap_override = bet_cap
        opponent.bet_cap_override_turns = 1
        result.notes.append(f"{opponent.name} 다음 턴 베팅 상한 {bet_cap}")


# ======================================================================
#   Utility 카드 dispatcher
# ======================================================================


def _execute_utility(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int,
    result: CardResult,
    rng: random.Random,
    *,
    game_turn: int,
) -> None:
    cid = card.id

    # ---- 광전사 유틸 ----
    if cid == "B6":  # 광전사의 함성
        caster.next_acc_bonus = card.extra.get("next_acc_bonus", 25)
        result.notes.append(f"다음 카드 명중 +{caster.next_acc_bonus}%")
    elif cid == "B7":  # 고통 흡수
        gain = card.extra.get("shield", 12)
        caster.shield += gain
        result.shield_gained += gain
    elif cid == "B9":  # 강철 피부
        gain = card.extra.get("shield", 15)
        caster.shield += gain
        result.shield_gained += gain
    elif cid == "B10":  # 광기의 식사
        result.heal += caster.heal(card.extra.get("self_heal", 18))
    elif cid == "B11":  # 분노 폭발
        caster.rage_stacks += card.extra.get("rage_stack", 1)
        result.notes.append(f"분노 스택 {caster.rage_stacks}")
    elif cid == "B12":  # 도끼 갈기: 공격 카드 서치 + 1 드로우
        _search_attack_card(caster, result, rng)
        drawn = caster.draw(card.extra.get("draw", 1))
        result.drawn_cards.extend(c.id for c in drawn)
    elif cid == "B15":  # 베르세르크
        bm = card.extra["berserk_mode"]
        caster.berserk_turns = bm["turns"]
        caster.berserk_acc_bonus = bm["acc_bonus"]
        caster.berserk_damage_bonus = bm["damage_bonus"]
        result.notes.append(
            f"베르세르크 {bm['turns']}턴 — 명중 +{bm['acc_bonus']}%, 데미지 +{bm['damage_bonus']}"
        )

    # ---- 도박사 유틸 ----
    elif cid == "G4":  # 잭팟
        _execute_jackpot(card, caster, opponent, bet, result, rng)
    elif cid == "G5":  # 더블 다운
        _execute_double_down(caster, opponent, result, rng, game_turn=game_turn)
    elif cid == "G9":  # 회피의 기술
        caster.dodge_next_percent = card.extra.get("dodge_next", 50)
        result.notes.append(f"다음 받는 공격 {caster.dodge_next_percent}% 회피")
    elif cid == "G10":  # 손패 바꾸기
        new_hand = caster.redraw_hand()
        result.drawn_cards.extend(c.id for c in new_hand)
    elif cid == "G11":  # 미래 보기: 덱 top 3 확인 + 다음 크리 +20%
        peek_count = card.extra.get("deck_peek", 3)
        top = list(reversed(caster.deck[-peek_count:])) if caster.deck else []
        result.notes.append("덱 top: " + ", ".join(c.id for c in top))
        caster.next_crit_bonus = card.extra.get("next_crit_bonus", 20)
    elif cid == "G12":  # 블러프
        opponent.next_attack_miss_chance = card.extra.get("force_miss_next", 50)
        result.notes.append(
            f"{opponent.name} 다음 공격 {opponent.next_attack_miss_chance}% 강제 miss"
        )
    elif cid == "G13":  # 독 바르기
        p = card.extra["poison"]
        opponent.poison_turns = p["turns"]
        opponent.poison_damage = p["damage"]
        result.notes.append(f"{opponent.name} 독 {p['turns']}턴 ({p['damage']}/턴)")
    elif cid == "G14":  # 마크된 운명
        caster.guarantee_next_crit = True
        result.notes.append("다음 카드 1장 크리 확정")

    # ---- 컨트롤러 유틸 ----
    elif cid == "W9":  # 방패 벽
        gain = card.extra.get("shield", 18)
        caster.shield += gain
        result.shield_gained += gain
    elif cid == "W10":  # 신성한 보호
        result.heal += caster.heal(card.extra.get("self_heal", 20))
    elif cid == "W11":  # 정화: 8 HP + 자신 디버프 제거
        result.heal += caster.heal(card.extra.get("self_heal", 8))
        _cleanse_self(caster, result)
    elif cid == "W12":  # 예지
        peek_count = card.extra.get("opponent_deck_peek", 3)
        top = list(reversed(opponent.deck[-peek_count:])) if opponent.deck else []
        result.notes.append("상대 덱 top: " + ", ".join(c.id for c in top))
        caster.dodge_next_percent = card.extra.get("dodge_next", 30)
    elif cid == "W13":  # 전열 정비
        drawn = caster.draw(card.extra.get("draw", 2))
        result.drawn_cards.extend(c.id for c in drawn)
    elif cid == "W14":  # 무효 선언 (시그)
        caster.incoming_damage_mult = card.extra.get("negate_ratio", 0.5)
        caster.incoming_damage_mult_turns = card.extra.get("negate_turns", 3)
        result.notes.append(
            f"무효 선언 {caster.incoming_damage_mult_turns}턴 — 받는 데미지 × {caster.incoming_damage_mult}"
        )

    else:
        raise NotImplementedError(f"Utility card {cid} not handled")


# ======================================================================
#   특수 유틸
# ======================================================================


def _search_attack_card(caster: Player, result: CardResult, rng: random.Random) -> None:
    """B12 도끼 갈기: 덱에서 공격 카드 1장 서치 (손패로)."""
    attack_indices = [i for i, c in enumerate(caster.deck) if c.category == "attack"]
    if not attack_indices:
        result.notes.append("공격 카드 없음 (서치 실패)")
        return
    idx = rng.choice(attack_indices)
    card = caster.deck.pop(idx)
    caster.hand.append(card)
    result.drawn_cards.append(card.id)
    result.notes.append(f"서치: {card.name}")


def _execute_jackpot(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int,
    result: CardResult,
    rng: random.Random,
) -> None:
    """G4 잭팟: 1d10 + 베팅 2당 +1 보정. 결과 구간별 효과."""
    jk = card.extra["jackpot"]
    dice = jk.get("dice", 10)
    bet_bonus_div = jk.get("bet_bonus_div", 2)
    results_map = jk["results"]

    roll = rng.randint(1, dice) + (bet // bet_bonus_div)
    roll = min(dice, max(1, roll))
    result.jackpot_roll = roll

    outcome = _lookup_jackpot_outcome(results_map, roll)
    if outcome is None:
        result.notes.append(f"잭팟 {roll}: 효과 없음")
        return

    self_dmg = outcome.get("self_damage", 0)
    dmg = outcome.get("damage", 0)

    if self_dmg:
        _apply_self_damage(caster, self_dmg, result)
        result.notes.append(f"잭팟 {roll}: 자해 {self_dmg}")
        result.success = False
    elif dmg:
        final_dmg = dmg * (2 if result.double_proc else 1)
        dealt = _apply_damage_to_opponent(final_dmg, card, caster, opponent, result)
        result.damage_to_opponent = dealt
        result.success = True
        caster.record_hit(dealt, critical=False)
        result.notes.append(f"잭팟 {roll}: {dealt}뎀")


def _lookup_jackpot_outcome(results_map: dict, roll: int) -> Optional[dict]:
    """'1', '2-5', '6-9', '10' 같은 키를 roll 값으로 매칭."""
    for key, outcome in results_map.items():
        if "-" in key:
            lo, hi = key.split("-")
            if int(lo) <= roll <= int(hi):
                return outcome
        else:
            if int(key) == roll:
                return outcome
    return None


def _execute_double_down(
    caster: Player,
    opponent: Player,
    result: CardResult,
    rng: random.Random,
    *,
    game_turn: int,
) -> None:
    """G5 더블 다운: 직전 사용 카드 1회 더 발동 (베팅 0)."""
    prev = caster.last_card
    if prev is None:
        result.notes.append("더블 다운 실패 — 직전 사용 카드 없음")
        result.success = False
        return
    if prev.id == "G5":
        result.notes.append("더블 다운은 더블 다운 자체를 복제할 수 없음")
        result.success = False
        return
    result.notes.append(f"더블 다운 → {prev.name} 재발동 (베팅 0)")
    sub = execute_card(
        prev,
        caster,
        opponent,
        bet=0,
        game_turn=game_turn,
        rng=rng,
        _is_double_down_repeat=True,
    )
    result.sub_results.append(
        {
            "repeat_of": prev.id,
            "damage": sub.damage_to_opponent,
            "hit": sub.success,
            "critical": sub.critical,
        }
    )
    result.damage_to_opponent += sub.damage_to_opponent
    result.heal += sub.heal
    result.shield_gained += sub.shield_gained


def _cleanse_self(caster: Player, result: CardResult) -> None:
    """W11 정화: 독, 침묵, 베팅 상한 등 디버프 제거."""
    notes = []
    if caster.poison_turns > 0:
        caster.poison_turns = 0
        caster.poison_damage = 0
        notes.append("독")
    if caster.silenced_cards:
        caster.silenced_cards = []
        notes.append("침묵")
    if caster.bet_cap_override is not None:
        caster.bet_cap_override = None
        caster.bet_cap_override_turns = 0
        notes.append("베팅 상한")
    if notes:
        result.notes.append("정화: " + ", ".join(notes))


# ======================================================================
#   최상위 dispatcher
# ======================================================================


def execute_card(
    card: Card,
    caster: Player,
    opponent: Player,
    bet: int = 0,
    *,
    game_turn: int = 1,
    rng: Optional[random.Random] = None,
    _is_double_down_repeat: bool = False,
) -> CardResult:
    """단일 카드 실행 진입점.

    - 베팅 즉시 차감 (HP 1 남기기 룰 + bet_cap 적용)
    - 카드 타입별 핸들러 호출
    - 시그니처 사용 기록

    `_is_double_down_repeat=True` 는 G5 내부 재귀 호출 플래그 — 시그니처 기록 건너뜀.
    """
    rng = rng or random.Random()

    if not _is_double_down_repeat:
        validate_card_play(card, caster, game_turn)

    # 베팅 상한 적용
    cap = compute_bet_cap(card, caster)
    bet = max(0, min(bet, cap))

    result = CardResult(card_id=card.id, caster=caster.name, bet=bet)

    # 시그니처 마킹 (재귀 호출은 제외)
    if card.signature and not _is_double_down_repeat:
        caster.sig_used_ids.add(card.id)
        caster.sig_used_this_turn = True

    # 베팅 HP 차감 (+ BN08 환원)
    if bet > 0:
        caster.spend_bet(bet)

    # BN07 행운의 동전 굴림 (카드당 1회)
    _roll_double_proc(caster, rng, result)

    # 타입별 분기
    if card.type == "hit":
        _execute_hit(card, caster, opponent, bet, result, rng)
    elif card.type == "crit":
        _execute_crit(card, caster, opponent, bet, result, rng)
    elif card.type == "fixed":
        _execute_fixed(card, caster, opponent, bet, result, rng)
    elif card.type == "utility":
        _execute_utility(card, caster, opponent, bet, result, rng, game_turn=game_turn)
    else:
        raise ValueError(f"Unknown card type: {card.type}")

    # 사용 카드 기록 (G5 / 로깅용)
    if not _is_double_down_repeat:
        caster.last_card = card

    return result


# ======================================================================
#   Game 루프 (Task 5)
# ======================================================================


@dataclass
class PlayAction:
    """Agent 가 반환할 액션. `kind` 에 따라 필드 해석 달라짐."""

    kind: str  # "play" | "end"
    card_id: Optional[str] = None
    bet: int = 0


class Agent(Protocol):
    """카드 선택 에이전트 프로토콜. 사람/AI/네트워크 모두 구현 가능."""

    def choose_action(self, game: "Game", player: Player) -> PlayAction:  # pragma: no cover
        ...


class PassAgent:
    """테스트/디폴트용: 바로 턴 종료."""

    def choose_action(self, game: "Game", player: Player) -> PlayAction:
        return PlayAction(kind="end")


class ScriptedAgent:
    """테스트용: 미리 정해둔 액션 시퀀스를 순서대로 반환. 끝나면 pass."""

    def __init__(self, actions: list[PlayAction]):
        self._actions = list(actions)
        self._i = 0

    def choose_action(self, game: "Game", player: Player) -> PlayAction:
        if self._i >= len(self._actions):
            return PlayAction(kind="end")
        a = self._actions[self._i]
        self._i += 1
        return a


@dataclass
class GameResult:
    winner: Optional[Player]
    turns: int
    reason: str  # "hp_zero" | "mutual_hp_zero" | "turn_limit" | "turn_limit_draw"
    p1_final_hp: int
    p2_final_hp: int
    p1_stats: dict[str, int]
    p2_stats: dict[str, int]
    log: list[dict[str, Any]]


def _snapshot_stats(p: Player) -> dict[str, int]:
    return {
        "total_bet": p.total_bet,
        "total_damage_dealt": p.total_damage_dealt,
        "total_damage_taken": p.total_damage_taken,
        "crit_count": p.crit_count,
        "miss_count": p.miss_count,
        "final_hp": p.hp,
    }


class Game:
    """1판 게임. 양 플레이어에 Agent 를 붙이고 `run()` 으로 종료까지 진행.

    턴 규칙:
        - 각 플레이어 '행동 턴' 을 1회 = 1 turn 카운트 증가
        - 15턴 도달 시 시간 초과 → HP 높은 쪽 승리 (동률 무승부)
        - 어느 쪽이든 HP 0 이하 → 즉시 종료
        - 미러전(같은 직업) 은 생성 시 거부

    Agent 인터페이스:
        choose_action(game, player) -> PlayAction
        - kind="play" 면 card_id 를 손패에서 찾아 execute_card 호출
        - kind="end"  면 턴 종료
        - 규칙 위반(없는 카드, 시그니처 제약 등) 은 엔진이 InvalidPlayError 로 방어
    """

    def __init__(
        self,
        p1: Player,
        p2: Player,
        p1_agent: Optional[Agent] = None,
        p2_agent: Optional[Agent] = None,
        *,
        seed: Optional[int] = None,
    ) -> None:
        validate_class_matchup(p1.class_name, p2.class_name)
        self.p1 = p1
        self.p2 = p2
        self.agents: dict[int, Agent] = {
            id(p1): p1_agent or PassAgent(),
            id(p2): p2_agent or PassAgent(),
        }
        self.rng = random.Random(seed)
        self.turn = 0
        self.current: Player = p1  # 선픽 = p1 으로 가정
        self.log: list[dict[str, Any]] = []
        self._winner: Optional[Player] = None
        self._end_reason: Optional[str] = None

    # ----------------------------------------- 조회
    def opponent_of(self, player: Player) -> Player:
        return self.p2 if player is self.p1 else self.p1

    def is_over(self) -> bool:
        return self._end_reason is not None

    # ----------------------------------------- 턴 진행
    def step(self) -> None:
        """한 턴 진행 (한 플레이어 행동)."""
        if self.is_over():
            return

        self.turn += 1
        current = self.current
        opp = self.opponent_of(current)

        # 1) 턴 시작 훅: 회복/독/베르세르크/실드 리셋
        begin_info = current.begin_turn()
        if any(begin_info.values()):
            self.log.append(
                {
                    "type": "turn_start",
                    "turn": self.turn,
                    "player": current.name,
                    **begin_info,
                }
            )

        # 2) 손패 보충
        current.fill_hand()

        # 3) 컨트롤러 패시브: 상대 손패 1장 공개
        if current.class_name == "warden" and opp.hand:
            peeked = self.rng.choice(opp.hand)
            self.log.append(
                {
                    "type": "peek",
                    "turn": self.turn,
                    "player": current.name,
                    "peeked_card": peeked.id,
                    "peeked_name": peeked.name,
                }
            )
            # Agent 가 활용할 수 있게 최신 peek 을 game 에 노출
            current.last_peek = peeked  # type: ignore[attr-defined]

        # 4) 즉사 체크 (턴 시작 독/자해로 죽은 경우)
        if self._check_end():
            return

        # 5) 카드 사용 루프
        max_cards = current.max_cards_per_turn()
        cards_used = 0
        agent = self.agents[id(current)]
        while cards_used < max_cards:
            if not current.is_alive() or not opp.is_alive():
                break
            action = agent.choose_action(self, current)
            if action.kind == "end":
                break
            if action.kind != "play":
                raise ValueError(f"Unknown action kind: {action.kind}")

            card = _find_card_in_hand(current, action.card_id)
            if card is None:
                raise InvalidPlayError(
                    f"{action.card_id} 는 {current.name} 의 손패에 없음"
                )

            # execute_card 는 validate_card_play 를 내부에서 호출 → 위반 시 예외
            result = execute_card(
                card,
                current,
                opp,
                bet=action.bet,
                game_turn=self.turn,
                rng=self.rng,
            )
            current.discard(card)
            cards_used += 1

            self.log.append(
                {
                    "type": "play",
                    "turn": self.turn,
                    "player": current.name,
                    "card": card.id,
                    "card_name": card.name,
                    "bet": result.bet,
                    "success": result.success,
                    "critical": result.critical,
                    "damage_out": result.damage_to_opponent,
                    "damage_self": result.damage_to_self,
                    "heal": result.heal,
                    "shield_gained": result.shield_gained,
                    "drawn": list(result.drawn_cards),
                    "notes": list(result.notes),
                    "jackpot_roll": result.jackpot_roll,
                }
            )

            if self._check_end():
                return

        # 6) 턴 종료 훅
        current.end_turn()

        # 7) 승패 재체크 (턴 종료 경계 + 15턴)
        if self._check_end():
            return

        # 8) 턴 교대
        self.current = opp

    def run(self) -> GameResult:
        """종료 조건까지 진행."""
        safety_limit = MAX_TURNS * 2 + 4
        iterations = 0
        while not self.is_over():
            self.step()
            iterations += 1
            if iterations > safety_limit:
                # 이론상 도달 불가 — 무한 루프 방어
                self._end_reason = "safety_break"
                break
        return GameResult(
            winner=self._winner,
            turns=self.turn,
            reason=self._end_reason or "unknown",
            p1_final_hp=self.p1.hp,
            p2_final_hp=self.p2.hp,
            p1_stats=_snapshot_stats(self.p1),
            p2_stats=_snapshot_stats(self.p2),
            log=list(self.log),
        )

    # ----------------------------------------- 종료 판정
    def _check_end(self) -> bool:
        p1_alive = self.p1.is_alive()
        p2_alive = self.p2.is_alive()
        if not p1_alive and not p2_alive:
            self._winner = None
            self._end_reason = "mutual_hp_zero"
            return True
        if not p1_alive:
            self._winner = self.p2
            self._end_reason = "hp_zero"
            return True
        if not p2_alive:
            self._winner = self.p1
            self._end_reason = "hp_zero"
            return True
        if self.turn >= MAX_TURNS:
            if self.p1.hp > self.p2.hp:
                self._winner = self.p1
                self._end_reason = "turn_limit"
            elif self.p2.hp > self.p1.hp:
                self._winner = self.p2
                self._end_reason = "turn_limit"
            else:
                self._winner = None
                self._end_reason = "turn_limit_draw"
            return True
        return False


def _find_card_in_hand(player: Player, card_id: Optional[str]) -> Optional[Card]:
    if card_id is None:
        return None
    for c in player.hand:
        if c.id == card_id:
            return c
    return None
