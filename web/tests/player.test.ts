/**
 * Player 상태 테스트. Python `cli/tests/test_player.py` 33개 케이스 포팅.
 */

import { describe, it, expect } from "vitest";

import { Player, getBoonById } from "@/engine";

describe("basic creation", () => {
  it("default hp 100, hand 5, deck 10", () => {
    const p = new Player({ name: "P1", className: "berserker", seed: 1 });
    expect(p.hp).toBe(100);
    expect(p.maxHp).toBe(100);
    expect(p.handSize).toBe(5);
    expect(p.hand).toHaveLength(5);
    expect(p.deck).toHaveLength(10);
    expect(p.graveyard).toHaveLength(0);
    expect(p.isAlive()).toBe(true);
  });

  it("deterministic shuffle via seed", () => {
    const a = new Player({ name: "A", className: "gambler", seed: 42 });
    const b = new Player({ name: "B", className: "gambler", seed: 42 });
    expect(a.hand.map((c) => c.id)).toEqual(b.hand.map((c) => c.id));
  });

  it("different seed → different order (same pool)", () => {
    const a = new Player({ name: "A", className: "gambler", seed: 1 });
    const b = new Player({ name: "B", className: "gambler", seed: 2 });
    const aAll = [...a.hand, ...a.deck].map((c) => c.id).sort();
    const bAll = [...b.hand, ...b.deck].map((c) => c.id).sort();
    expect(aAll).toEqual(bAll);
  });
});

describe("boons", () => {
  it("steel heart boosts hp to 130", () => {
    const boon = getBoonById("BN01");
    const p = new Player({ name: "P", className: "berserker", boon, seed: 1 });
    expect(p.maxHp).toBe(130);
    expect(p.hp).toBe(130);
  });

  it("eye of prescience extends hand to 8 (hand_size 7)", () => {
    const boon = getBoonById("BN10");
    const p = new Player({ name: "P", className: "gambler", boon, seed: 1 });
    expect(p.handSize).toBe(7);
    expect(p.hand).toHaveLength(8);
  });

  it("abundant hand sets extra card per turn to 1", () => {
    const boon = getBoonById("BN09");
    const p = new Player({ name: "P", className: "warden", boon, seed: 1 });
    expect(p.maxCardsPerTurn()).toBe(3);
  });

  it("no boon defaults", () => {
    const p = new Player({ name: "P", className: "warden", seed: 1 });
    expect(p.handSize).toBe(5);
    expect(p.maxCardsPerTurn()).toBe(2);
    expect(p.maxHp).toBe(100);
  });
});

describe("draw / deck", () => {
  it("draw n reduces deck", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    const beforeDeck = p.deck.length;
    const drawn = p.draw(3);
    expect(drawn).toHaveLength(3);
    expect(p.deck.length).toBe(beforeDeck - 3);
    expect(p.hand).toHaveLength(8);
  });

  it("fill_hand back to hand_size", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    const d1 = p.hand[0]!;
    const d2 = p.hand[1]!;
    p.discard(d1);
    p.discard(d2);
    expect(p.hand).toHaveLength(3);
    p.fillHand();
    expect(p.hand).toHaveLength(5);
  });

  it("reshuffle graveyard when deck empty", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    const all = [...p.hand, ...p.deck];
    p.hand = [];
    p.deck = [];
    p.graveyard = [...all];
    p.draw(1);
    expect(p.hand).toHaveLength(1);
    expect(p.graveyard).toHaveLength(0);
    expect(p.deck.length).toBe(all.length - 1);
  });

  it("draw returns empty when deck and graveyard empty", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.hand = [];
    p.deck = [];
    p.graveyard = [];
    expect(p.draw(3)).toEqual([]);
  });

  it("redraw_hand swaps all cards", () => {
    const p = new Player({ name: "P", className: "gambler", seed: 1 });
    const before = p.hand.length;
    p.redrawHand();
    expect(p.hand).toHaveLength(before);
    expect(p.graveyard).toHaveLength(before);
  });
});

describe("damage / shield", () => {
  it("take damage reduces hp", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    const evt = p.takeDamage(20);
    expect(p.hp).toBe(80);
    expect(evt.dealt).toBe(20);
    expect(evt.requested).toBe(20);
  });

  it("shield absorbs damage", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.shield = 15;
    const evt = p.takeDamage(20);
    expect(p.hp).toBe(95);
    expect(evt.absorbedByShield).toBe(15);
    expect(evt.dealt).toBe(5);
  });

  it("shield fully blocks", () => {
    const p = new Player({ name: "P", className: "warden", seed: 1 });
    p.shield = 30;
    const evt = p.takeDamage(12);
    expect(p.hp).toBe(100);
    expect(evt.absorbedByShield).toBe(12);
    expect(evt.dealt).toBe(0);
  });

  it("ignoreShield bypasses", () => {
    const p = new Player({ name: "P", className: "warden", seed: 1 });
    p.shield = 100;
    const evt = p.takeDamage(8, { ignoreShield: true });
    expect(p.hp).toBe(92);
    expect(evt.absorbedByShield).toBe(0);
    expect(evt.dealt).toBe(8);
  });

  it("BN02 steadfast will reduces damage", () => {
    const boon = getBoonById("BN02");
    const p = new Player({ name: "P", className: "warden", boon, seed: 1 });
    const evt = p.takeDamage(10);
    expect(evt.dealt).toBe(8);
    expect(p.hp).toBe(92);
  });

  it("BN02 minimum damage is 1", () => {
    const boon = getBoonById("BN02");
    const p = new Player({ name: "P", className: "warden", boon, seed: 1 });
    const evt = p.takeDamage(1);
    expect(evt.dealt).toBe(1);
    expect(p.hp).toBe(99);
  });

  it("take damage 0 or negative is noop", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.takeDamage(0);
    expect(p.hp).toBe(100);
    p.takeDamage(-5);
    expect(p.hp).toBe(100);
  });
});

describe("heal", () => {
  it("heals up to max_hp", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.hp = 50;
    const gained = p.heal(30);
    expect(gained).toBe(30);
    expect(p.hp).toBe(80);
  });

  it("caps at max_hp", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.hp = 95;
    const gained = p.heal(30);
    expect(gained).toBe(5);
    expect(p.hp).toBe(100);
  });

  it("heals up to 130 with steel heart", () => {
    const boon = getBoonById("BN01");
    const p = new Player({ name: "P", className: "berserker", boon, seed: 1 });
    p.hp = 100;
    const gained = p.heal(50);
    expect(gained).toBe(30);
    expect(p.hp).toBe(130);
  });
});

describe("turn hooks", () => {
  it("beginTurn applies BN03 recovery", () => {
    const boon = getBoonById("BN03");
    const p = new Player({ name: "P", className: "warden", boon, seed: 1 });
    p.hp = 90;
    const info = p.beginTurn();
    expect(info.heal).toBe(5);
    expect(p.hp).toBe(95);
  });

  it("beginTurn applies poison (ignores shield)", () => {
    const p = new Player({ name: "P", className: "warden", seed: 1 });
    p.poisonTurns = 3;
    p.poisonDamage = 4;
    p.shield = 100;
    const info = p.beginTurn();
    expect(info.poison).toBe(4);
    expect(p.hp).toBe(96);
    expect(p.poisonTurns).toBe(2);
  });

  it("beginTurn applies berserk self damage", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.berserkTurns = 3;
    p.berserkAccBonus = 20;
    p.berserkDamageBonus = 8;
    const info = p.beginTurn();
    expect(info.berserkSelfDmg).toBe(5);
    expect(p.hp).toBe(95);
    expect(p.berserkTurns).toBe(2);
    expect(p.berserkAccBonus).toBe(20);
  });

  it("berserk expires after 3 turns", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.berserkTurns = 3;
    p.berserkAccBonus = 20;
    p.berserkDamageBonus = 8;
    for (let i = 0; i < 3; i++) p.beginTurn();
    expect(p.berserkTurns).toBe(0);
    expect(p.berserkAccBonus).toBe(0);
    expect(p.berserkDamageBonus).toBe(0);
  });

  it("beginTurn resets shield (next own turn)", () => {
    const p = new Player({ name: "P", className: "warden", seed: 1 });
    p.shield = 18;
    p.endTurn();
    expect(p.shield).toBe(18);
    p.beginTurn();
    expect(p.shield).toBe(0);
  });

  it("miss flag carries via end_turn", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.recordMiss();
    p.endTurn();
    expect(p.missedLastTurn).toBe(true);
    p.beginTurn();
    p.endTurn();
    expect(p.missedLastTurn).toBe(false);
  });

  it("end_turn decrements bet cap", () => {
    const p = new Player({ name: "P", className: "gambler", seed: 1 });
    p.betCapOverride = 3;
    p.betCapOverrideTurns = 1;
    p.endTurn();
    expect(p.betCapOverride).toBeNull();
    expect(p.betCapOverrideTurns).toBe(0);
  });

  it("end_turn decrements negate declaration", () => {
    const p = new Player({ name: "P", className: "gambler", seed: 1 });
    p.incomingDamageMult = 0.5;
    p.incomingDamageMultTurns = 3;
    p.endTurn();
    expect(p.incomingDamageMultTurns).toBe(2);
    expect(p.incomingDamageMult).toBe(0.5);
    p.endTurn();
    p.endTurn();
    expect(p.incomingDamageMult).toBe(1.0);
  });
});

describe("betting", () => {
  it("spend_bet reduces hp", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    const net = p.spendBet(10);
    expect(p.hp).toBe(90);
    expect(p.totalBet).toBe(10);
    expect(net).toBe(10);
  });

  it("BN08 blood refund half", () => {
    const boon = getBoonById("BN08");
    const p = new Player({ name: "P", className: "berserker", boon, seed: 1 });
    const net = p.spendBet(10);
    expect(p.hp).toBe(95);
    expect(p.totalBet).toBe(10);
    expect(net).toBe(5);
  });
});

describe("death", () => {
  it("is_alive false when hp zero or below", () => {
    const p = new Player({ name: "P", className: "berserker", seed: 1 });
    p.hp = 0;
    expect(p.isAlive()).toBe(false);
    p.hp = -5;
    expect(p.isAlive()).toBe(false);
  });
});
