/**
 * 엔진 테스트. Python `cli/tests/test_engine.py` 78개 케이스 포팅.
 */

import { describe, it, expect } from "vitest";

import {
  InvalidPlayError,
  MirrorMatchError,
  Player,
  computeBetCap,
  executeCard,
  fixedRandintRng,
  alwaysMaxRng,
  alwaysMinRng,
  getBoonById,
  getCardById,
  validateCardPlay,
  validateClassMatchup,
  ClassName,
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

// ============================================================ 미러전

describe("mirror matchup", () => {
  it("rejected for same class", () => {
    expect(() => validateClassMatchup("berserker", "berserker")).toThrow(
      MirrorMatchError,
    );
  });

  it("allowed for different classes", () => {
    const classes: ClassName[] = ["berserker", "gambler", "warden"];
    for (const a of classes) {
      for (const b of classes) {
        if (a !== b) validateClassMatchup(a, b);
      }
    }
  });
});

// ============================================================ 시그니처 제약

describe("signature constraints", () => {
  it("unlock turn 3", () => {
    const [p] = makePlayers();
    const sig = getCardById("B14");
    expect(() => validateCardPlay(sig, p, 2)).toThrow(InvalidPlayError);
    validateCardPlay(sig, p, 3);
  });

  it("once per game", () => {
    const [p, op] = makePlayers();
    const sig = getCardById("B15");
    executeCard(sig, p, op, { bet: 0, gameTurn: 3, rng: alwaysMinRng() });
    p.sigUsedThisTurn = false; // 가정: 다른 턴
    expect(() => validateCardPlay(sig, p, 5)).toThrow(InvalidPlayError);
  });

  it("only one per turn", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B15"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(() =>
      validateCardPlay(getCardById("B14"), p, 3),
    ).toThrow(InvalidPlayError);
  });

  it("silenced card rejected", () => {
    const [p] = makePlayers();
    p.silencedCards.push("B1");
    expect(() => validateCardPlay(getCardById("B1"), p, 2)).toThrow(
      InvalidPlayError,
    );
  });

  it("condition card rejected when hp high", () => {
    const [p] = makePlayers();
    const lastStand = getCardById("B13");
    p.hp = 50;
    expect(() => validateCardPlay(lastStand, p, 1)).toThrow(InvalidPlayError);
  });

  it("condition card allowed when hp low", () => {
    const [p] = makePlayers();
    const lastStand = getCardById("B13");
    p.hp = 25;
    validateCardPlay(lastStand, p, 1);
  });
});

// ============================================================ 베팅 상한

describe("bet cap", () => {
  it("hp minus 1", () => {
    const [p] = makePlayers();
    p.hp = 5;
    expect(computeBetCap(getCardById("B1"), p)).toBe(4);
  });

  it("override (bet_cap_override)", () => {
    const [p] = makePlayers();
    p.betCapOverride = 3;
    expect(computeBetCap(getCardById("B1"), p)).toBe(3);
  });

  it("card max_bet", () => {
    const [p] = makePlayers();
    expect(computeBetCap(getCardById("B14"), p)).toBe(15);
  });

  it("exceeds cap is clamped", () => {
    const [p, op] = makePlayers();
    const card = getCardById("B1");
    const result = executeCard(card, p, op, {
      bet: 999,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.bet).toBe(10);
  });
});

// ============================================================ 광전사

describe("Berserker cards", () => {
  it("B1 crushing blow full bet 100%", () => {
    // B1: dmg 50, base_acc 80, bet_acc 1. bet 10 → 80+10+20 = 100.
    const [p, op] = makePlayers();
    const card = getCardById("B1");
    const result = executeCard(card, p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMaxRng(),
    });
    expect(result.success).toBe(true);
    expect(result.bet).toBe(10);
    expect(p.hp).toBe(90);
    expect(op.hp).toBe(50);
  });

  it("B1 no bet 80% → miss with max rng", () => {
    const [p, op] = makePlayers();
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMaxRng(),
    });
    expect(result.success).toBe(false);
    expect(op.hp).toBe(100);
  });

  it("B2 frenzied charge miss → self damage 8", () => {
    const [p, op] = makePlayers();
    const result = executeCard(getCardById("B2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMaxRng(),
    });
    expect(result.success).toBe(false);
    expect(result.damageToSelf).toBe(8);
    expect(p.hp).toBe(92);
  });

  it("B3 blood price lifesteal", () => {
    // B3: dmg 45, lifesteal 0.3. 45*0.3 = 13.5 → 13.
    const [p, op] = makePlayers();
    p.hp = 50;
    const result = executeCard(getCardById("B3"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(true);
    expect(result.heal).toBe(13);
    expect(p.hp).toBe(53);
  });

  it("B4 chain slash hits 3 times", () => {
    const [p, op] = makePlayers();
    const result = executeCard(getCardById("B4"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(true);
    expect(result.subResults).toHaveLength(3);
    expect(result.subResults.every((s) => s.hit === true)).toBe(true);
    expect(result.damageToOpponent).toBe(54);  // 18 × 3
  });

  it("B5 execute bonus acc when hp low", () => {
    const [p, op] = makePlayers();
    op.hp = 20;
    const card = getCardById("B5");
    const result = executeCard(card, p, op, {
      bet: 5,
      gameTurn: 1,
      rng: fixedRandintRng(50),
    });
    expect(result.success).toBe(true);
    expect(result.damageToOpponent).toBe(55);
  });

  it("B6 berserker's roar sets next_acc_bonus 25", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B6"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextAccBonus).toBe(25);
  });

  it("B6 bonus consumed after one hit card", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B6"), p, op, { rng: alwaysMinRng() });
    executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextAccBonus).toBe(0);
  });

  it("B7 pain absorb grants shield 12", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B7"), p, op, { rng: alwaysMinRng() });
    expect(p.shield).toBe(12);
  });

  it("B8 maniac strike self damage 8", () => {
    const [p, op] = makePlayers();
    const result = executeCard(getCardById("B8"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMaxRng(),
    });
    expect(result.damageToSelf).toBe(8);
    expect(p.hp).toBe(92);
  });

  it("B9 iron skin shield 15", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B9"), p, op, { rng: alwaysMinRng() });
    expect(p.shield).toBe(15);
  });

  it("B10 feast heals 18", () => {
    const [p, op] = makePlayers();
    p.hp = 50;
    executeCard(getCardById("B10"), p, op, { rng: alwaysMinRng() });
    expect(p.hp).toBe(68);
  });

  it("B11 rage stack adds damage", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B11"), p, op, { rng: alwaysMinRng() });
    expect(p.rageStacks).toBe(1);
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(58);  // 50 + 8
    expect(p.rageStacks).toBe(0);
  });

  it("B12 axe sharpen search attack", () => {
    const [p, op] = makePlayers();
    const beforeDeck = p.deck.length;
    const beforeHand = p.hand.length;
    const result = executeCard(getCardById("B12"), p, op, {
      rng: fixedRandintRng(0),
    });
    expect(p.hand.length).toBe(beforeHand + 2);
    expect(p.deck.length).toBe(beforeDeck - 2);
    const searched = p.hand.filter(
      (c) => result.drawnCards.includes(c.id) && c.category === "attack",
    );
    expect(searched.length).toBeGreaterThanOrEqual(1);
  });

  it("B13 last stand with low hp", () => {
    const [p, op] = makePlayers();
    p.hp = 25;
    const result = executeCard(getCardById("B13"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(true);
    expect(result.damageToOpponent).toBe(75);
  });

  it("B14 blood madness full bet 30+60+30 → hit", () => {
    const [p, op] = makePlayers();
    const card = getCardById("B14");
    const result = executeCard(card, p, op, {
      bet: 15,
      gameTurn: 3,
      rng: alwaysMaxRng(),
    });
    expect(result.success).toBe(true);
    expect(result.damageToOpponent).toBe(60);
    expect(p.hp).toBe(85);
    expect(p.sigUsedIds.has(card.id)).toBe(true);
  });

  it("B14 without bet 30% acc, miss with max rng", () => {
    const [p, op] = makePlayers();
    const result = executeCard(getCardById("B14"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMaxRng(),
    });
    expect(result.success).toBe(false);
  });

  it("B15 berserk mode", () => {
    const [p, op] = makePlayers();
    executeCard(getCardById("B15"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.berserkTurns).toBe(3);
    expect(p.berserkAccBonus).toBe(20);
    expect(p.berserkDamageBonus).toBe(8);
  });
});

// ============================================================ 도박사

describe("Gambler cards", () => {
  it("G1 card throw crit (rng=1)", () => {
    // G1: dmg 25, base_acc 70, crit_mult 2. crit chance = 7. always_min: hit & crit. 50.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.critical).toBe(true);
    expect(result.damageToOpponent).toBe(50);
  });

  it("G1 hit no crit (rng=50)", () => {
    // rng=50: hit (50<=70), no crit (50>7). dmg 25.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(50),
    });
    expect(result.success).toBe(true);
    expect(result.critical).toBe(false);
    expect(result.damageToOpponent).toBe(25);
  });

  it("G2 shell game damage range (min)", () => {
    // G2 range [20,35]. always_min: hit, crit, randint(20,35) = 20. 20*2 = 40.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.critical).toBe(true);
    expect(result.damageToOpponent).toBe(40);
  });

  it("G3 marked dagger ignores shield", () => {
    // G3: dmg 30, ignore_shield. rng=50: hit, no crit, 30 dmg through shield.
    const [p, op] = makePlayers("gambler", "warden");
    op.shield = 100;
    const result = executeCard(getCardById("G3"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(50),
    });
    expect(result.damageToOpponent).toBe(30);
  });

  it("G4 jackpot 60 dmg on roll 10", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G4"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(10),
    });
    expect(result.jackpotRoll).toBe(10);
    expect(result.damageToOpponent).toBe(60);
  });

  it("G4 jackpot self damage on roll 1", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G4"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.jackpotRoll).toBe(1);
    expect(result.damageToSelf).toBe(25);
  });

  it("G4 jackpot bet bonus boosts roll", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G4"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.jackpotRoll).toBe(6);
    expect(result.damageToOpponent).toBe(35);
  });

  it("G5 double down repeats last card", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const critRng = fixedRandintRng(1);
    executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: critRng,
    });
    const result = executeCard(getCardById("G5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: critRng,
    });
    expect(result.damageToOpponent).toBe(50);  // G1 crit: 25*2
    expect(result.subResults[0]!.repeat_of).toBe("G1");
  });

  it("G5 double down fails without prev", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(false);
  });

  it("G6 all-in bet crit multiplier 2.0 → 40", () => {
    // G6: dmg 20, mult 2. always_min: hit & crit. 20*2 = 40.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G6"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.critical).toBe(true);
    expect(result.damageToOpponent).toBe(40);
  });

  it("G7 trickster's hand basic crit", () => {
    // G7 은 이제 crit 타입 (draw 효과 제거). dmg 20, acc 80.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G7"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(true);
  });

  it("G8 marked card crit mult 2.0 → 70", () => {
    // G8: dmg 35, mult 2. always_min: 35*2 = 70.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G8"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.damageToOpponent).toBe(70);
  });

  it("G9 evasion sets dodge", () => {
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G9"), p, op, { rng: alwaysMinRng() });
    expect(p.dodgeNextPercent).toBe(50);
  });

  it("G9 dodge blocks incoming attack", () => {
    // p(gambler) 가 회피 버프, op(warden) 의 W1 fixed 공격을 회피.
    const [p, op] = makePlayers("gambler", "warden");
    p.dodgeNextPercent = 100;
    const result = executeCard(getCardById("W1"), op, p, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.success).toBe(false);
    expect(result.dodged).toBe(true);
  });

  it("G10 redraw replaces hand", () => {
    const [p, op] = makePlayers("gambler", "warden");
    const before = p.hand.length;
    executeCard(getCardById("G10"), p, op, { rng: alwaysMinRng() });
    expect(p.hand.length).toBe(before);
  });

  it("G11 foresight sets crit bonus 20", () => {
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G11"), p, op, { rng: alwaysMinRng() });
    expect(p.nextCritBonus).toBe(20);
  });

  it("G12 bluff sets forces miss on opponent", () => {
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G12"), p, op, { rng: alwaysMinRng() });
    expect(op.nextAttackMissChance).toBe(50);
  });

  it("G12 bluff forces miss on attacker", () => {
    // 블러프는 hit/crit/fixed 모두 적용. always_min: 1<=50 발동.
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G12"), p, op, { rng: alwaysMinRng() });
    const result = executeCard(getCardById("W1"), op, p, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.success).toBe(false);
    expect(result.bluffTriggered).toBe(true);
    expect(op.nextAttackMissChance).toBe(0);
  });

  it("G13 poison applies", () => {
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G13"), p, op, { rng: alwaysMinRng() });
    expect(op.poisonTurns).toBe(3);
    expect(op.poisonDamage).toBe(4);
  });

  it("G14 marked fate guarantees crit", () => {
    const [p, op] = makePlayers("gambler", "warden");
    executeCard(getCardById("G14"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.guaranteeNextCrit).toBe(true);
    // G1 acc 70. rng=50 → hit (50<=70). crit guaranteed regardless of crit roll.
    const result = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: fixedRandintRng(50),
    });
    expect(result.critical).toBe(true);
    expect(p.guaranteeNextCrit).toBe(false);
  });

  it("G15 all-in crit fail at high bet → self damage = bet", () => {
    // bet 12: acc 100, crit 55. fixed(100): hit (100<=100) but no crit (100>55) → self damage 12.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G15"), p, op, {
      bet: 12,
      gameTurn: 3,
      rng: fixedRandintRng(100),
    });
    expect(result.critical).toBe(false);
    expect(result.damageToSelf).toBe(12);
  });

  it("G15 all-in no bet → crit (acc 50, crit 5+45=50) → 75 dmg", () => {
    // always_min: hit & crit. dmg 25*3 = 75.
    const [p, op] = makePlayers("gambler", "warden");
    const result = executeCard(getCardById("G15"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: fixedRandintRng(1),
    });
    expect(result.critical).toBe(true);
    expect(result.damageToOpponent).toBe(75);
    expect(result.damageToSelf).toBe(0);
  });
});

// ============================================================ 컨트롤러

describe("Warden cards", () => {
  it("W1 justice strike fixed 10", () => {
    const [p, op] = makePlayers("warden", "berserker");
    const result = executeCard(getCardById("W1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(10);
  });

  it("W1 full bet → 20", () => {
    const [p, op] = makePlayers("warden", "berserker");
    const result = executeCard(getCardById("W1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(20);
  });

  it("W2 punishing light bonus when hit prev", () => {
    const [p, op] = makePlayers("warden", "berserker");
    op.hitLastTurn = true;
    const result = executeCard(getCardById("W2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(20);  // 12 + 8
  });

  it("W2 no bonus when not hit prev", () => {
    const [p, op] = makePlayers("warden", "berserker");
    op.hitLastTurn = false;
    const result = executeCard(getCardById("W2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(12);
  });

  it("W3 weakness silences 1 random card", () => {
    const [p, op] = makePlayers("warden", "berserker");
    const result = executeCard(getCardById("W3"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(0),
    });
    expect(op.silencedCards).toHaveLength(1);
    expect(result.damageToOpponent).toBe(6);
  });

  it("W4 binding chains sets opponent bet cap", () => {
    const [p, op] = makePlayers("warden", "berserker");
    executeCard(getCardById("W4"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(op.betCapOverride).toBe(3);
    expect(op.betCapOverrideTurns).toBe(1);
  });

  it("W5 judgment usable when self hp < opp hp", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.hp = 50;
    op.hp = 100;
    const result = executeCard(getCardById("W5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(14);
  });

  it("W5 blocked when self hp >= opp hp", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.hp = 100;
    op.hp = 50;
    expect(() =>
      executeCard(getCardById("W5"), p, op, {
        bet: 0,
        gameTurn: 1,
        rng: alwaysMinRng(),
      }),
    ).toThrow();
  });

  it("W6 patience retort uses total_damage_taken × 0.3", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.totalDamageTaken = 30;
    const result = executeCard(getCardById("W6"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(9);  // 30 × 0.3
  });

  it("W6 patience no cap", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.totalDamageTaken = 200;
    const result = executeCard(getCardById("W6"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(60);  // 200 × 0.3
  });

  it("W7 shield bash adds shield", () => {
    const [p, op] = makePlayers("warden", "berserker");
    const result = executeCard(getCardById("W7"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(6);
    expect(p.shield).toBe(8);
  });

  it("W8 holy arrow fixed with self heal", () => {
    // W8 은 이제 fixed: dmg 10, 강화 0, self_heal 10. 항상 명중.
    const [p, op] = makePlayers("warden", "berserker");
    p.hp = 50;
    const result = executeCard(getCardById("W8"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.success).toBe(true);
    expect(result.damageToOpponent).toBe(10);
    expect(result.heal).toBe(10);
    expect(p.hp).toBe(60);
  });

  it("W9 shield wall 18", () => {
    const [p, op] = makePlayers("warden", "berserker");
    executeCard(getCardById("W9"), p, op, { rng: alwaysMinRng() });
    expect(p.shield).toBe(18);
  });

  it("W10 holy aegis heals 20", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.hp = 50;
    executeCard(getCardById("W10"), p, op, { rng: alwaysMinRng() });
    expect(p.hp).toBe(70);
  });

  it("W11 cleanse removes debuffs", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.hp = 50;
    p.poisonTurns = 3;
    p.poisonDamage = 4;
    p.silencedCards.push("W1");
    p.betCapOverride = 3;
    p.betCapOverrideTurns = 1;
    executeCard(getCardById("W11"), p, op, { rng: alwaysMinRng() });
    expect(p.hp).toBe(58);
    expect(p.poisonTurns).toBe(0);
    expect(p.silencedCards).toEqual([]);
    expect(p.betCapOverride).toBeNull();
  });

  it("W12 prescience dodge 50", () => {
    // 변경: peek 제거, dodge 30 → 50.
    const [p, op] = makePlayers("warden", "berserker");
    executeCard(getCardById("W12"), p, op, { rng: alwaysMinRng() });
    expect(p.dodgeNextPercent).toBe(50);
  });

  it("W13 regroup draws 2", () => {
    const [p, op] = makePlayers("warden", "berserker");
    const before = p.hand.length;
    executeCard(getCardById("W13"), p, op, { rng: alwaysMinRng() });
    expect(p.hand.length).toBe(before + 2);
  });

  it("W14 null declaration reduces incoming", () => {
    const [p, op] = makePlayers("warden", "berserker");
    executeCard(getCardById("W14"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.incomingDamageMult).toBe(0.5);
    expect(p.incomingDamageMultTurns).toBe(3);
    // B1 50뎀 × 0.5 = 25
    const result = executeCard(getCardById("B1"), op, p, {
      bet: 10,
      gameTurn: 3,
      rng: alwaysMaxRng(),
    });
    expect(result.damageToOpponent).toBe(25);
  });

  it("W15 final judgment = self total bet (bypass everything)", () => {
    const [p, op] = makePlayers("warden", "berserker");
    p.totalBet = 8;
    op.totalBet = 30;
    op.shield = 100;  // 무시되어야 함
    op.incomingDamageMult = 0.5;  // 무시되어야 함
    const result = executeCard(getCardById("W15"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(8);
  });
});

// ============================================================ 부운 전역

describe("Global boon effects", () => {
  it("BN04 blade blessing adds +3 to all damage", () => {
    const boon = getBoonById("BN04");
    const p = new Player({ name: "P1", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "P2", className: "warden", seed: 2 });
    // B1 50 + 3 = 53
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(53);
  });

  it("BN05 precision eye +15 acc", () => {
    const boon = getBoonById("BN05");
    const p = new Player({ name: "P1", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "P2", className: "warden", seed: 2 });
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(50),
    });
    expect(result.success).toBe(true);
  });

  it("BN05 does not affect fixed", () => {
    const boon = getBoonById("BN05");
    const p = new Player({ name: "P1", className: "warden", boon, seed: 1 });
    const op = new Player({ name: "P2", className: "berserker", seed: 2 });
    const result = executeCard(getCardById("W1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(10);
  });

  it("BN06 per bet +1 acc/crit", () => {
    const boon = getBoonById("BN06");
    const p = new Player({ name: "P1", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "P2", className: "warden", seed: 2 });
    // B1 40 + 6*5 + 2*5(passive) + 1*5(BN06) = 85
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 5,
      gameTurn: 1,
      rng: fixedRandintRng(85),
    });
    expect(result.success).toBe(true);
  });

  it("BN07 lucky coin doubles damage", () => {
    const boon = getBoonById("BN07");
    const p = new Player({ name: "P1", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "P2", className: "warden", seed: 2 });
    // B1 50 × 2 = 100
    const result = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(result.doubleProc).toBe(true);
    expect(result.damageToOpponent).toBe(100);
  });
});

// ============================================================ 교차

describe("Shield interactions", () => {
  it("attack reduced by opponent shield", () => {
    const [p, op] = makePlayers("warden", "berserker");
    op.shield = 5;
    const result = executeCard(getCardById("W1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(result.damageToOpponent).toBe(5);
  });

  it("marked dagger bypasses shield, still hit by BN02", () => {
    // G3: dmg 30, ignore_shield. BN02 -2 적용. rng=50 → hit, no crit.
    const boon = getBoonById("BN02");
    const p = new Player({ name: "P1", className: "gambler", seed: 1 });
    const op = new Player({ name: "P2", className: "warden", boon, seed: 2 });
    op.shield = 100;
    const result = executeCard(getCardById("G3"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(50),
    });
    expect(result.damageToOpponent).toBe(28);
  });
});
