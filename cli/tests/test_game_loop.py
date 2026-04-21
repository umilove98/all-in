"""Game 루프 테스트."""

from __future__ import annotations

import pytest

from allin.engine import (
    Game,
    MirrorMatchError,
    PassAgent,
    PlayAction,
    ScriptedAgent,
)
from allin.player import Player


def make_players(c1="berserker", c2="warden", seed=1):
    p1 = Player("P1", c1, seed=seed)
    p2 = Player("P2", c2, seed=seed + 100)
    return p1, p2


# ------------------------------------------------------------- 생성/미러전 금지


def test_mirror_match_rejected_on_construction():
    p1 = Player("P1", "gambler", seed=1)
    p2 = Player("P2", "gambler", seed=2)
    with pytest.raises(MirrorMatchError):
        Game(p1, p2)


def test_game_can_be_created_with_different_classes():
    p1, p2 = make_players()
    g = Game(p1, p2)
    assert g.p1 is p1 and g.p2 is p2
    assert g.current is p1
    assert g.turn == 0


# ------------------------------------------------------------- 15턴 시간초과


def test_pass_pass_reaches_turn_limit_draw():
    p1, p2 = make_players(seed=7)
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=7)
    result = g.run()
    assert result.turns == 15
    # 아무 공격도 안 했으므로 HP 동률 → 무승부. 단 턴 시작 독/베르세르크/회복은 양쪽 없음.
    assert result.reason == "turn_limit_draw"
    assert result.winner is None


def test_turn_limit_winner_by_hp():
    p1, p2 = make_players(seed=3)
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=3)
    p2.hp = 50   # p1 이 HP 우위
    result = g.run()
    assert result.reason == "turn_limit"
    assert result.winner is p1


# ------------------------------------------------------------- HP 0 승리


def test_hp_zero_ends_game_immediately():
    # P1 이 HP 1 인 P2 를 분쇄 일격으로 처치
    p1, p2 = make_players(seed=4)
    p2.hp = 1
    # P1 손패에 B1 있게 보장 (덱에 있으면 draw 로 올라옴)
    # 덱에서 찾아 손패 맨 앞으로 옮김
    b1 = next((c for c in p1.deck + p1.hand if c.id == "B1"), None)
    assert b1 is not None
    if b1 in p1.deck:
        p1.deck.remove(b1)
        p1.hand.append(b1)

    agent1 = ScriptedAgent([PlayAction(kind="play", card_id="B1", bet=10)])
    agent2 = PassAgent()
    g = Game(p1, p2, agent1, agent2, seed=4)
    result = g.run()
    assert result.winner is p1
    assert result.reason == "hp_zero"
    assert p2.hp <= 0


# ------------------------------------------------------------- 턴 교대


def test_players_alternate_turns():
    p1, p2 = make_players(seed=2)
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=2)
    # 1턴: p1, 2턴: p2, 3턴: p1, ...
    assert g.current is p1
    g.step()
    assert g.turn == 1
    assert g.current is p2
    g.step()
    assert g.turn == 2
    assert g.current is p1


# ------------------------------------------------------------- 턴 훅


def test_begin_turn_hook_fills_hand():
    # 턴 시작 시 손패가 5장이 됨
    p1, p2 = make_players(seed=2)
    # p1 손패 2장만 남기기
    while len(p1.hand) > 2:
        p1.graveyard.append(p1.hand.pop())
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=2)
    g.step()  # p1 턴
    assert len(p1.hand) == 5


def test_miss_during_turn_carries_into_missed_last_turn():
    # 광폭한 돌진 B2 (30% 명중) 을 베팅 0 으로 쓰면서 rng 를 miss 측으로 고정.
    import random as _r

    p1, p2 = make_players("berserker", "warden", seed=5)
    # B2 확보
    b2 = next(c for c in p1.deck + p1.hand if c.id == "B2")
    if b2 in p1.deck:
        p1.deck.remove(b2)
        p1.hand.append(b2)

    actions = [PlayAction(kind="play", card_id="B2", bet=0)]
    g = Game(p1, p2, ScriptedAgent(actions), PassAgent(), seed=5)
    # rng 를 miss 쪽으로 (100 반환 → 30% 에 실패)
    forced = _r.Random()
    forced.randint = lambda a, b: 100
    g.rng = forced
    g.step()  # p1 턴 동안 B2 miss → end_turn 시 missed_last_turn True
    assert p1.missed_last_turn is True


def test_poison_triggers_on_turn_start():
    p1, p2 = make_players("gambler", "warden", seed=6)
    p2.poison_turns = 3
    p2.poison_damage = 4
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=6)
    g.step()   # p1 턴
    g.step()   # p2 턴 → 독 발동
    assert p2.hp == 96
    assert p2.poison_turns == 2


# ------------------------------------------------------------- 컨트롤러 패시브


def test_warden_peek_logged_each_turn():
    p1, p2 = make_players("warden", "berserker", seed=11)
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=11)
    g.step()   # 워든 턴
    peeks = [e for e in g.log if e.get("type") == "peek"]
    assert len(peeks) >= 1
    assert peeks[0]["player"] == "P1"
    assert peeks[0]["peeked_card"] in {c.id for c in p2.hand}


# ------------------------------------------------------------- 결과 + 통계


def test_result_contains_stats():
    p1, p2 = make_players(seed=8)
    g = Game(p1, p2, PassAgent(), PassAgent(), seed=8)
    result = g.run()
    assert "total_bet" in result.p1_stats
    assert "final_hp" in result.p2_stats
    assert result.p1_final_hp == p1.hp
    assert result.p2_final_hp == p2.hp


def test_log_records_play_events():
    p1, p2 = make_players(seed=9)
    # 손패에 W1 있는지 보장
    w1 = next(c for c in p1.deck + p1.hand if c.id == "B1")
    if w1 in p1.deck:
        p1.deck.remove(w1)
        p1.hand.append(w1)
    agent1 = ScriptedAgent([PlayAction(kind="play", card_id="B1", bet=0)])
    g = Game(p1, p2, agent1, PassAgent(), seed=9)
    g.step()
    play_events = [e for e in g.log if e.get("type") == "play"]
    assert len(play_events) == 1
    assert play_events[0]["card"] == "B1"


# ------------------------------------------------------------- 최대 카드 수


def test_max_cards_per_turn_default_2():
    # 같은 직업 덱에는 각 카드가 1장씩이므로 서로 다른 공격 카드로 3번 시도.
    from allin.engine import Agent

    p1, p2 = make_players("berserker", "warden", seed=10)
    # 조건부(B13) 제외하고 공격 카드 3장 이상 손패에 보장
    while len([c for c in p1.hand if c.category == "attack" and c.id != "B13"]) < 3:
        extra = next(
            (c for c in p1.deck if c.category == "attack" and c.id != "B13"), None
        )
        if extra is None:
            break
        p1.deck.remove(extra)
        p1.hand.append(extra)

    class AttackFirstAgent:
        def choose_action(self, game, player):
            for c in player.hand:
                if c.category == "attack" and c.id != "B13":
                    return PlayAction(kind="play", card_id=c.id, bet=0)
            return PlayAction(kind="end")

    g = Game(p1, p2, AttackFirstAgent(), PassAgent(), seed=10)
    g.step()
    plays = [e for e in g.log if e.get("type") == "play"]
    assert len(plays) == 2   # max_cards_per_turn 으로 인해 3장 시도해도 2장만
