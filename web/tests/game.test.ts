/**
 * Game 루프 테스트. Python `cli/tests/test_game_loop.py` 13개 케이스 포팅.
 */

import { describe, it, expect } from "vitest";

import {
  Game,
  MirrorMatchError,
  PassAgent,
  PlayAction,
  Player,
  ScriptedAgent,
  ClassName,
  fixedRandintRng,
} from "@/engine";

function makePlayers(
  c1: ClassName = "berserker",
  c2: ClassName = "warden",
  seed = 1,
) {
  const p1 = new Player({ name: "P1", className: c1, seed });
  const p2 = new Player({ name: "P2", className: c2, seed: seed + 100 });
  return [p1, p2] as const;
}

function ensureInHand(player: Player, cardId: string) {
  const inHand = player.hand.find((c) => c.id === cardId);
  if (inHand) return;
  const idx = player.deck.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error(`${cardId} not in deck`);
  const [card] = player.deck.splice(idx, 1);
  player.hand.push(card!);
}

// ------------------------------------------------------------- 생성

describe("Game construction", () => {
  it("rejects mirror match", () => {
    const p1 = new Player({ name: "P1", className: "gambler", seed: 1 });
    const p2 = new Player({ name: "P2", className: "gambler", seed: 2 });
    expect(() => new Game(p1, p2)).toThrow(MirrorMatchError);
  });

  it("creates with different classes", () => {
    const [p1, p2] = makePlayers();
    const g = new Game(p1, p2);
    expect(g.p1).toBe(p1);
    expect(g.p2).toBe(p2);
    expect(g.current).toBe(p1);
    expect(g.turn).toBe(0);
  });
});

// ------------------------------------------------------------- 15턴 시간초과

describe("Turn limit", () => {
  it("pass/pass reaches turn_limit_draw", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 7);
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 7 });
    const result = g.run();
    expect(result.turns).toBe(15);
    expect(result.reason).toBe("turn_limit_draw");
    expect(result.winner).toBeNull();
  });

  it("winner by HP at turn limit", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 3);
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 3 });
    p2.hp = 50;
    const result = g.run();
    expect(result.reason).toBe("turn_limit");
    expect(result.winner).toBe(p1);
  });
});

// ------------------------------------------------------------- HP 0 승리

describe("HP zero", () => {
  it("ends immediately", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 4);
    p2.hp = 1;
    ensureInHand(p1, "B1");
    const agent1 = new ScriptedAgent([{ kind: "play", cardId: "B1", bet: 10 }]);
    const g = new Game(p1, p2, agent1, new PassAgent(), { seed: 4 });
    const result = g.run();
    expect(result.winner).toBe(p1);
    expect(result.reason).toBe("hp_zero");
    expect(p2.hp).toBeLessThanOrEqual(0);
  });
});

// ------------------------------------------------------------- 턴 교대

describe("Turn alternation", () => {
  it("players alternate", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 2);
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 2 });
    expect(g.current).toBe(p1);
    g.step();
    expect(g.turn).toBe(1);
    expect(g.current).toBe(p2);
    g.step();
    expect(g.turn).toBe(2);
    expect(g.current).toBe(p1);
  });
});

// ------------------------------------------------------------- 턴 훅

describe("Turn hooks", () => {
  it("begin_turn fills hand", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 2);
    while (p1.hand.length > 2) {
      p1.graveyard.push(p1.hand.pop()!);
    }
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 2 });
    g.step();
    expect(p1.hand).toHaveLength(5);
  });

  it("miss during turn carries to missedLastTurn", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 5);
    ensureInHand(p1, "B2");
    const agent1 = new ScriptedAgent([{ kind: "play", cardId: "B2", bet: 0 }]);
    const g = new Game(p1, p2, agent1, new PassAgent(), { seed: 5 });
    // rng 를 miss 쪽으로 교체: randint 100 → 30%에 실패
    g.rng = fixedRandintRng(100);
    g.step();
    expect(p1.missedLastTurn).toBe(true);
  });

  it("poison triggers on turn start", () => {
    const [p1, p2] = makePlayers("gambler", "warden", 6);
    p2.poisonTurns = 3;
    p2.poisonDamage = 4;
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 6 });
    g.step(); // p1
    g.step(); // p2 → poison
    expect(p2.hp).toBe(96);
    expect(p2.poisonTurns).toBe(2);
  });
});

// ------------------------------------------------------------- 워든 패시브

describe("Warden silence passive", () => {
  it("silences one of opponent's cards at the start of opponent's turn", () => {
    // 선공(p1)=광전사 턴 시작 → 컨트롤러 상대(p2)의 패시브로 p1 카드 1장 봉인
    const [p1, p2] = makePlayers("berserker", "warden", 11);
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 11 });
    g.step();
    const silences = g.log.filter((e) => e.type === "passive_silence");
    expect(silences.length).toBeGreaterThanOrEqual(1);
    expect(silences[0]!.player).toBe("P2"); // 발동자 = 컨트롤러
    const p1CardIds = new Set(p1.hand.map((c) => c.id));
    expect(p1CardIds.has(silences[0]!.silenced_card as string)).toBe(true);
    // 침묵 효과는 turn 내에만 유효 — endTurn() 후 silencedCards 는 비워짐.
  });
});

// ------------------------------------------------------------- 결과 + 통계

describe("Result + stats", () => {
  it("contains stats", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 8);
    const g = new Game(p1, p2, new PassAgent(), new PassAgent(), { seed: 8 });
    const result = g.run();
    expect(result.p1Stats.totalBet).toBeTypeOf("number");
    expect(result.p2Stats.finalHp).toBe(p2.hp);
    expect(result.p1FinalHp).toBe(p1.hp);
  });

  it("log records play events", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 9);
    ensureInHand(p1, "B1");
    const agent1 = new ScriptedAgent([{ kind: "play", cardId: "B1", bet: 0 }]);
    const g = new Game(p1, p2, agent1, new PassAgent(), { seed: 9 });
    g.step();
    const plays = g.log.filter((e) => e.type === "play");
    expect(plays).toHaveLength(1);
    expect(plays[0]!.card).toBe("B1");
  });
});

// ------------------------------------------------------------- max cards

describe("Max cards per turn", () => {
  it("default 2 caps usage", () => {
    const [p1, p2] = makePlayers("berserker", "warden", 10);
    // 조건부 제외한 공격 카드 3장 손패에 보장
    while (
      p1.hand.filter((c) => c.category === "attack" && c.id !== "B13").length <
      3
    ) {
      const idx = p1.deck.findIndex(
        (c) => c.category === "attack" && c.id !== "B13",
      );
      if (idx < 0) break;
      const [card] = p1.deck.splice(idx, 1);
      p1.hand.push(card!);
    }

    class AttackFirstAgent {
      chooseAction(_game: Game, player: Player): PlayAction {
        for (const c of player.hand) {
          if (c.category === "attack" && c.id !== "B13") {
            return { kind: "play", cardId: c.id, bet: 0 };
          }
        }
        return { kind: "end" };
      }
    }

    const g = new Game(p1, p2, new AttackFirstAgent(), new PassAgent(), {
      seed: 10,
    });
    g.step();
    const plays = g.log.filter((e) => e.type === "play");
    expect(plays).toHaveLength(2);
  });
});
