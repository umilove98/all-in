/**
 * Cards/Boons 데이터 로더 테스트.
 * Python `cli/tests/test_cards.py` + `test_boons.py` 케이스 포팅.
 */

import { describe, it, expect } from "vitest";

import {
  BOON_CATEGORIES,
  CLASS_NAMES,
  filterBoonsByCategory,
  getAllBoons,
  getAllCards,
  getBoonById,
  getBoonMeta,
  getCardById,
  getCardMeta,
  getDeck,
} from "@/engine";

// ============================================================ 카드

describe("card loader", () => {
  it("each class has 15 cards", () => {
    for (const c of CLASS_NAMES) {
      expect(getDeck(c)).toHaveLength(15);
    }
  });

  it("total 45 cards", () => {
    expect(getAllCards()).toHaveLength(45);
  });

  it("unknown class throws", () => {
    // @ts-expect-error intentional invalid
    expect(() => getDeck("paladin")).toThrow();
  });

  it("signatures flagged correctly", () => {
    const expected = new Set(["B14", "B15", "G14", "G15", "W14", "W15"]);
    const flagged = new Set(
      getAllCards()
        .filter((c) => c.signature)
        .map((c) => c.id),
    );
    expect(flagged).toEqual(expected);
  });

  it("all signature cards have signature category", () => {
    for (const c of getAllCards()) {
      if (c.signature) expect(c.category).toBe("signature");
    }
  });

  it("card types are valid", () => {
    const valid = new Set(["hit", "crit", "fixed", "utility"]);
    for (const c of getAllCards()) {
      expect(valid.has(c.type)).toBe(true);
    }
  });

  it("card categories are valid", () => {
    const valid = new Set(["attack", "defense", "utility", "signature"]);
    for (const c of getAllCards()) {
      expect(valid.has(c.category)).toBe(true);
    }
  });

  it("all card ids unique", () => {
    const ids = getAllCards().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ---- 샘플 스펙 검증 ----

  it("B1 crushing blow spec", () => {
    const c = getCardById("B1");
    expect(c.name).toBe("분쇄 일격");
    expect(c.type).toBe("hit");
    expect(c.damage).toBe(50);
    expect(c.baseAcc).toBe(80);
    expect(c.betAcc).toBe(1);
    expect(c.maxBet).toBe(10);
    expect(c.signature).toBe(false);
  });

  it("B4 chain slash hit_count in extra", () => {
    const c = getCardById("B4");
    expect(c.damage).toBe(18);
    expect(c.extra.hit_count).toBe(3);
  });

  it("B13 last stand condition", () => {
    const c = getCardById("B13");
    expect(c.extra.condition).toEqual({ self_hp_max: 30 });
  });

  it("B14 blood madness signature", () => {
    const c = getCardById("B14");
    expect(c.signature).toBe(true);
    expect(c.category).toBe("signature");
    expect(c.maxBet).toBe(15);
    expect(c.baseAcc).toBe(30);
    expect(c.betAcc).toBe(4);
    expect(c.damage).toBe(60);
  });

  it("G6 all-in bet crit", () => {
    const c = getCardById("G6");
    expect(c.type).toBe("crit");
    expect(c.damage).toBe(20);
    expect(c.baseAcc).toBe(50);
    expect(c.betCrit).toBe(3);
    expect(c.critMult).toBe(2);
  });

  it("G4 jackpot extra", () => {
    const c = getCardById("G4");
    const jackpot = c.extra.jackpot as {
      dice: number;
      results: Record<string, { damage?: number; self_damage?: number }>;
    };
    expect(jackpot.dice).toBe(10);
    expect(jackpot.results["10"].damage).toBe(60);
    expect(jackpot.results["1"].self_damage).toBe(25);
  });

  it("G15 all-in signature", () => {
    const c = getCardById("G15");
    expect(c.signature).toBe(true);
    expect(c.maxBet).toBe(12);
    expect(c.critMult).toBe(3.0);
    expect(c.extra.self_damage_on_miss).toBe("bet_amount");
  });

  it("W1 justice strike fixed", () => {
    const c = getCardById("W1");
    expect(c.type).toBe("fixed");
    expect(c.damage).toBe(10);
    expect(c.betDamage).toBe(1);
    expect(c.maxBet).toBe(10);
  });

  it("W5 judgment condition self_hp_below_opp", () => {
    const c = getCardById("W5");
    expect(c.betDamage).toBe(2);
    expect(c.extra.condition).toEqual({ self_hp_below_opp: true });
  });

  it("W15 final judgment flag", () => {
    const c = getCardById("W15");
    expect(c.signature).toBe(true);
    expect(c.extra.final_judgment_self_only).toBe(true);
  });

  // ---- 구조 검증 ----

  it("getDeck returns fresh array", () => {
    const d1 = getDeck("berserker");
    d1.length = 0;
    const d2 = getDeck("berserker");
    expect(d2).toHaveLength(15);
  });

  it("card meta has common_rules", () => {
    const rules = getCardMeta().common_rules;
    expect(rules?.signature_usage_per_game).toBe(1);
    expect(rules?.signature_unlock_turn).toBe(3);
    expect(rules?.signature_per_turn_limit).toBe(1);
    expect(rules?.default_bet_max).toBe(10);
  });

  it("category breakdown per class (15/2 sig invariant)", () => {
    for (const c of CLASS_NAMES) {
      const deck = getDeck(c);
      const byCat: Record<string, number> = {};
      for (const card of deck) {
        byCat[card.category] = (byCat[card.category] ?? 0) + 1;
      }
      expect(Object.values(byCat).reduce((a, b) => a + b, 0)).toBe(15);
      expect(byCat.signature).toBe(2);
      const nonSig = 15 - byCat.signature;
      expect(nonSig).toBe(13);
    }
  });
});

// ============================================================ 부운

describe("boon loader", () => {
  it("10 boons loaded", () => {
    expect(getAllBoons()).toHaveLength(10);
  });

  it("all boon ids unique", () => {
    const ids = getAllBoons().map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ids are BN01..BN10", () => {
    const ids = getAllBoons()
      .map((b) => b.id)
      .sort();
    const expected = Array.from(
      { length: 10 },
      (_, i) => `BN${String(i + 1).padStart(2, "0")}`,
    );
    expect(ids).toEqual(expected);
  });

  it("categories valid", () => {
    const valid = new Set(BOON_CATEGORIES);
    for (const b of getAllBoons()) {
      expect(valid.has(b.category)).toBe(true);
    }
  });

  it("filter steady → BN01-03", () => {
    expect(
      new Set(filterBoonsByCategory("steady").map((b) => b.id)),
    ).toEqual(new Set(["BN01", "BN02", "BN03"]));
  });

  it("filter aggressive → BN04-06", () => {
    expect(
      new Set(filterBoonsByCategory("aggressive").map((b) => b.id)),
    ).toEqual(new Set(["BN04", "BN05", "BN06"]));
  });

  it("filter risky → BN07-08", () => {
    expect(new Set(filterBoonsByCategory("risky").map((b) => b.id))).toEqual(
      new Set(["BN07", "BN08"]),
    );
  });

  it("filter utility → BN09-10", () => {
    expect(new Set(filterBoonsByCategory("utility").map((b) => b.id))).toEqual(
      new Set(["BN09", "BN10"]),
    );
  });

  it("filter invalid category throws", () => {
    // @ts-expect-error intentional invalid
    expect(() => filterBoonsByCategory("cursed")).toThrow();
  });

  // ---- 샘플 스펙 ----

  it("BN01 steel heart", () => {
    const b = getBoonById("BN01");
    expect(b.name).toBe("강철 심장");
    expect(b.effect.hp_bonus).toBe(30);
  });

  it("BN02 damage reduction", () => {
    const b = getBoonById("BN02");
    expect(b.effect.damage_reduction).toBe(2);
    expect(b.effect.min_damage).toBe(1);
  });

  it("BN03 heal per turn", () => {
    const b = getBoonById("BN03");
    expect(b.effect.heal_per_turn).toBe(5);
  });

  it("BN04 damage bonus all", () => {
    const b = getBoonById("BN04");
    expect(b.effect.damage_bonus_all).toBe(3);
  });

  it("BN05 acc/crit bonus", () => {
    const b = getBoonById("BN05");
    expect(b.effect.acc_bonus).toBe(15);
    expect(b.effect.crit_bonus).toBe(10);
  });

  it("BN06 per bet bonus", () => {
    const b = getBoonById("BN06");
    expect(b.effect.bet_acc_bonus_per).toBe(1);
    expect(b.effect.bet_crit_bonus_per).toBe(1);
  });

  it("BN07 double proc", () => {
    const b = getBoonById("BN07");
    expect(b.effect.double_proc_chance).toBe(30);
  });

  it("BN08 bet refund", () => {
    const b = getBoonById("BN08");
    expect(b.effect.bet_refund_ratio).toBe(0.5);
  });

  it("BN09 extra card", () => {
    const b = getBoonById("BN09");
    expect(b.effect.extra_card_per_turn).toBe(1);
  });

  it("BN10 hand bonus", () => {
    const b = getBoonById("BN10");
    expect(b.effect.starting_hand_bonus).toBe(3);
    expect(b.effect.hand_size).toBe(7);
  });

  it("unknown boon throws", () => {
    expect(() => getBoonById("BN99")).toThrow();
  });

  it("meta selection", () => {
    const sel = getBoonMeta().selection;
    expect(sel?.default_options).toBe(3);
    expect(sel?.gambler_reroll_count).toBe(1);
    expect(sel?.pick_count).toBe(1);
  });
});
