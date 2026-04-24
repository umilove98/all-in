"""Player state container. 턴 중/간 상태, 덱/손패/묘지, 상태효과, 누적 통계를 관리.

이 모듈은 '상태 보관 + 기본 조작'에 집중. 카드 효과 해석은 engine.py (Task 4+) 가 담당.
하지만 턴 시작/종료 훅(회복의 가호, 독, 베르세르크, shield 리셋 등)은 여기서 처리해야
엔진 코드가 과하게 복잡해지지 않으므로 함께 구현한다.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Optional

from .boons import Boon
from .cards import Card, get_deck

DEFAULT_HP = 100
DEFAULT_HAND_SIZE = 5
DEFAULT_STARTING_HAND = 5


@dataclass
class DamageEvent:
    """take_damage 결과를 설명용으로 노출. UI/로그에서 사용."""

    requested: int  # 원래 데미지 값
    absorbed_by_shield: int = 0
    reduced_by_boon: int = 0
    dealt: int = 0  # 실제 HP 차감량
    dodged: bool = False


class Player:
    def __init__(
        self,
        name: str,
        class_name: str,
        boon: Optional[Boon] = None,
        *,
        seed: Optional[int] = None,
    ) -> None:
        self.name = name
        self.class_name = class_name
        self.boon = boon
        self._rng = random.Random(seed)

        # ---- 리소스 ----
        hp_bonus = boon.effect.get("hp_bonus", 0) if boon else 0
        self.max_hp: int = DEFAULT_HP + hp_bonus
        self.hp: int = self.max_hp

        # ---- 덱/손패/묘지 ----
        self.hand_size: int = (
            boon.effect.get("hand_size", DEFAULT_HAND_SIZE) if boon else DEFAULT_HAND_SIZE
        )
        self.deck: list[Card] = get_deck(class_name)
        self._rng.shuffle(self.deck)
        self.hand: list[Card] = []
        self.graveyard: list[Card] = []

        # ---- 턴 내 일시 효과 (턴 종료 시 리셋) ----
        self.shield: int = 0                # B7/B9 "이번 턴 받는 데미지 -X"

        # ---- 다음 N회에만 적용되는 효과 ----
        self.next_acc_bonus: int = 0         # B6 광전사의 함성
        self.next_crit_bonus: int = 0        # G11 미래 보기
        self.guarantee_next_crit: bool = False  # G14 마크된 운명
        self.dodge_next_percent: int = 0     # G9/W12 "다음 받는 공격 X% 회피"
        self.next_attack_miss_chance: int = 0  # G12 블러프 → 내 다음 공격이 X% 빗나감 강제

        # ---- 지속형 상태 ----
        self.rage_stacks: int = 0            # B11 분노 스택 (다음 공격에 소모)
        self.poison_turns: int = 0
        self.poison_damage: int = 0
        self.silenced_cards: list[str] = []  # W3 약점 포착 (카드 id 1턴 봉인)
        self.bet_cap_override: Optional[int] = None   # W4 결박의 사슬: 다음 턴 베팅 상한
        self.bet_cap_override_turns: int = 0

        # ---- 직업/시그니처 특수 모드 ----
        self.berserk_turns: int = 0          # B15 베르세르크
        self.berserk_acc_bonus: int = 0
        self.berserk_damage_bonus: int = 0

        self.incoming_damage_mult: float = 1.0  # W14 무효 선언 (내가 받는 데미지 × mult)
        self.incoming_damage_mult_turns: int = 0

        # ---- 게임 전체 누적 통계 ----
        self.total_bet: int = 0
        self.total_damage_taken: int = 0
        self.total_damage_dealt: int = 0
        self.crit_count: int = 0
        self.miss_count: int = 0

        # ---- 기록/추적 ----
        self.last_card: Optional[Card] = None
        self.missed_last_turn: bool = False    # 가장 최근 턴 동안 miss 낸 적 있음
        self._missed_this_turn: bool = False
        self.hit_last_turn: bool = False       # 가장 최근 턴 동안 적중시킨 적 있음 (W2 조건)
        self._hit_this_turn: bool = False
        self.sig_used_ids: set[str] = set()
        self.sig_used_this_turn: bool = False

        # ---- 부운 기반 초기 설정 ----
        self.extra_card_per_turn: int = (
            boon.effect.get("extra_card_per_turn", 0) if boon else 0
        )

        # ---- 시작 손패 드로우 ----
        starting = DEFAULT_STARTING_HAND + (
            boon.effect.get("starting_hand_bonus", 0) if boon else 0
        )
        self.draw(starting)

    # ------------------------------------------------------------------ 기본 상태
    def is_alive(self) -> bool:
        return self.hp > 0

    # ------------------------------------------------------------------ 덱/손패
    def draw(self, n: int = 1) -> list[Card]:
        """덱에서 n장 뽑아 손패에 추가. 덱이 비면 묘지 셔플해서 복구."""
        drawn: list[Card] = []
        for _ in range(n):
            if not self.deck:
                if not self.graveyard:
                    break
                self.deck = self.graveyard
                self.graveyard = []
                self._rng.shuffle(self.deck)
            card = self.deck.pop()
            self.hand.append(card)
            drawn.append(card)
        return drawn

    def fill_hand(self) -> list[Card]:
        """손패를 hand_size 까지 보충."""
        need = max(0, self.hand_size - len(self.hand))
        return self.draw(need)

    def discard(self, card: Card) -> None:
        if card in self.hand:
            self.hand.remove(card)
        self.graveyard.append(card)

    def redraw_hand(self) -> list[Card]:
        """G10 손패 바꾸기: 전부 버리고 같은 수만큼 드로우."""
        count = len(self.hand)
        self.graveyard.extend(self.hand)
        self.hand = []
        return self.draw(count)

    # ------------------------------------------------------------------ 피해/회복
    def take_damage(self, amount: int, *, ignore_shield: bool = False) -> DamageEvent:
        """피해 적용. shield 감쇠 → 부운 감쇠 → HP 차감 순."""
        evt = DamageEvent(requested=amount)
        if amount <= 0:
            return evt

        dealt = amount

        if not ignore_shield and self.shield > 0:
            absorbed = min(self.shield, dealt)
            evt.absorbed_by_shield = absorbed
            dealt -= absorbed

        # BN02 견고한 의지: 받는 모든 데미지 -2 (최소 1)
        if self.boon and self.boon.effect.get("damage_reduction", 0) > 0 and dealt > 0:
            reduction = self.boon.effect["damage_reduction"]
            min_dmg = self.boon.effect.get("min_damage", 1)
            new_dealt = max(min_dmg, dealt - reduction)
            evt.reduced_by_boon = dealt - new_dealt
            dealt = new_dealt

        evt.dealt = dealt
        self.hp -= dealt
        self.total_damage_taken += dealt
        return evt

    def heal(self, amount: int) -> int:
        """HP 회복, max_hp 상한. 실제 회복량 반환."""
        if amount <= 0 or not self.is_alive():
            return 0
        before = self.hp
        self.hp = min(self.max_hp, self.hp + amount)
        return self.hp - before

    # ------------------------------------------------------------------ 턴 훅
    def begin_turn(self) -> dict:
        """턴 시작 시 자동 효과 적용. 엔진이 호출.

        반환값: {'heal': int, 'poison': int, 'berserk_self_dmg': int} — UI 로깅용.
        """
        info: dict[str, int] = {"heal": 0, "poison": 0, "berserk_self_dmg": 0}

        # 실드는 "이번 턴 받는 데미지 -X" 의미로 쓰이되,
        # 사용 턴 이후 상대 턴까지 유지되어야 방어 카드로서 역할을 함.
        # 따라서 리셋은 사용자 본인이 새 턴을 시작할 때 수행.
        self.shield = 0

        # BN03 회복의 가호: 매 턴 시작 +5
        if self.boon and self.boon.effect.get("heal_per_turn", 0) > 0:
            info["heal"] += self.heal(self.boon.effect["heal_per_turn"])

        # B15 베르세르크: 매 턴 자해 5
        if self.berserk_turns > 0:
            self_dmg = 5
            before = self.hp
            self.hp = max(0, self.hp - self_dmg)
            info["berserk_self_dmg"] = before - self.hp
            self.berserk_turns -= 1
            if self.berserk_turns == 0:
                self.berserk_acc_bonus = 0
                self.berserk_damage_bonus = 0

        # 독 데미지 (방어 무시)
        if self.poison_turns > 0:
            evt = self.take_damage(self.poison_damage, ignore_shield=True)
            info["poison"] = evt.dealt
            self.poison_turns -= 1
            if self.poison_turns == 0:
                self.poison_damage = 0

        # 턴 내 추적자 리셋
        self._missed_this_turn = False
        self._hit_this_turn = False
        self.sig_used_this_turn = False

        return info

    def end_turn(self) -> None:
        """턴 종료 시 정리. 지속 효과 카운터 감소 + 턴 플래그 이월.

        참고: 실드(`shield`) 는 상대 턴에도 방어해야 하므로 begin_turn 에서 리셋.
        """
        # 이번 턴 miss/hit 냈는지 플래그를 '직전 턴' 상태로 이월
        self.missed_last_turn = self._missed_this_turn
        self.hit_last_turn = self._hit_this_turn

        # 결박의 사슬 베팅 상한: 다음 턴 1회만 유효 → 한 턴 지나면 해제
        if self.bet_cap_override_turns > 0:
            self.bet_cap_override_turns -= 1
            if self.bet_cap_override_turns == 0:
                self.bet_cap_override = None

        # 무효 선언: 내가 받는 데미지 감쇠 턴 카운트 감소
        if self.incoming_damage_mult_turns > 0:
            self.incoming_damage_mult_turns -= 1
            if self.incoming_damage_mult_turns == 0:
                self.incoming_damage_mult = 1.0

        # 침묵 해제 (1턴)
        self.silenced_cards = []

    # ------------------------------------------------------------------ 유틸
    def record_miss(self) -> None:
        self.miss_count += 1
        self._missed_this_turn = True

    def record_hit(self, damage_dealt: int, critical: bool = False) -> None:
        self.total_damage_dealt += damage_dealt
        self._hit_this_turn = True
        if critical:
            self.crit_count += 1

    def spend_bet(self, amount: int) -> int:
        """베팅 HP 차감 + 피의 환원 부운 적용. 실제 순지출(차감-환원) 반환."""
        if amount <= 0:
            return 0
        # HP 1 남기기 룰: caller 가 강제할 것. 여기선 단순 차감.
        self.hp -= amount
        self.total_bet += amount

        # BN08 피의 환원: 베팅한 HP의 50% 즉시 회복
        refunded = 0
        if self.boon and self.boon.effect.get("bet_refund_ratio", 0) > 0:
            ratio = self.boon.effect["bet_refund_ratio"]
            refunded = int(amount * ratio)
            self.heal(refunded)

        return amount - refunded

    def max_cards_per_turn(self) -> int:
        return 2 + self.extra_card_per_turn

    # ------------------------------------------------------------------ 디버그
    def __repr__(self) -> str:
        return (
            f"Player(name={self.name!r}, class={self.class_name}, "
            f"hp={self.hp}/{self.max_hp}, hand={len(self.hand)}, "
            f"deck={len(self.deck)}, grave={len(self.graveyard)})"
        )
