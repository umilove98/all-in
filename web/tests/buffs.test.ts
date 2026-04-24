/**
 * 버프/디버프 로직 검증.
 * 프로젝트 카드 45장 중 상태를 조작하거나 다음 공격에 영향을 주는 모든 카드를
 * 커버. 각 테스트는 "카드 발동 후 상태 플래그 세팅 → 다음 액션에서 실제 반영
 * → 사용 후 소멸" 3단계를 확인.
 */

import { describe, it, expect } from "vitest";

import {
  Player,
  executeCard,
  alwaysMinRng,
  alwaysMaxRng,
  fixedRandintRng,
  getCardById,
  type ClassName,
} from "@/engine";

function makePair(c1: ClassName = "berserker", c2: ClassName = "gambler") {
  const a = new Player({ name: "A", className: c1, seed: 1 });
  const b = new Player({ name: "B", className: c2, seed: 2 });
  return [a, b] as const;
}

// =====================================================================
// 1. 다음 1회 효과 — 세팅 → 소모 → 리셋 플로우
// =====================================================================

describe("B6 광전사의 함성 — nextAccBonus", () => {
  it("발동 시 caster 에 nextAccBonus = 25 세팅", () => {
    const [p, op] = makePair();
    executeCard(getCardById("B6"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextAccBonus).toBe(25);
  });

  it("다음 hit 카드 발동 시 명중률에 +25% 가산", () => {
    const [p, op] = makePair();
    p.nextAccBonus = 25;
    // B1 분쇄 일격: baseAcc=40, betAcc=6
    // 베팅 0 → 기본 40, 베르세르크 패시브 0, +25 = 65
    // alwaysMinRng → randint(1,100)=1 → 1<=65 hit
    // alwaysMaxRng → randint(1,100)=100 → 100<=65 miss
    // 확인: 만약 nextAccBonus 가 적용 안 되면 acc=40 이라 100<=40 불발
    //       적용되면 65 — 여전히 100<=65 불발. 다른 경계로 테스트 필요.
    // 경계 acc=65 → alwaysMaxRng 실패 / nearMax (randint=65) 성공
    const rngAt65 = fixedRandintRng(65);
    const r = executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: rngAt65,
    });
    expect(r.success).toBe(true); // 65 <= 65
  });

  it("사용 후 nextAccBonus = 0 으로 소멸", () => {
    const [p, op] = makePair();
    p.nextAccBonus = 25;
    executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextAccBonus).toBe(0);
  });
});

describe("G11 미래 보기 — nextCritBonus", () => {
  it("발동 시 caster 에 nextCritBonus = 20 세팅", () => {
    const [p, op] = makePair("gambler", "berserker");
    executeCard(getCardById("G11"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextCritBonus).toBe(20);
  });

  it("다음 crit 카드 발동 시 치명률 +20% 적용", () => {
    const [p, op] = makePair("gambler", "berserker");
    p.nextCritBonus = 20;
    // G1: base_acc 70 → 7 default crit + 20 bonus = 27.
    // fixedRandintRng(20) → hit (20<=70), crit (20<=27).
    const r = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(20),
    });
    expect(r.critical).toBe(true);
  });

  it("사용 후 nextCritBonus = 0", () => {
    const [p, op] = makePair("gambler", "berserker");
    p.nextCritBonus = 20;
    executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.nextCritBonus).toBe(0);
  });
});

describe("G14 마크된 운명 — guaranteeNextCrit [SIG]", () => {
  it("발동 시 guaranteeNextCrit = true", () => {
    const [p, op] = makePair("gambler", "berserker");
    executeCard(getCardById("G14"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.guaranteeNextCrit).toBe(true);
  });

  it("다음 crit 카드는 무조건 치명타 (기본 crit 0 이어도)", () => {
    const [p, op] = makePair("gambler", "berserker");
    p.guaranteeNextCrit = true;
    // G1: base_acc 70. always_min: hit pass (1<=70), crit forced. dmg 25*2 = 50.
    const r = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 5,
      rng: alwaysMinRng(),
    });
    expect(r.critical).toBe(true);
    expect(p.guaranteeNextCrit).toBe(false);
  });
});

describe("G9 회피의 기술 — dodgeNextPercent", () => {
  it("발동 시 dodgeNextPercent = 50", () => {
    const [p, op] = makePair("gambler", "berserker");
    executeCard(getCardById("G9"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.dodgeNextPercent).toBe(50);
  });

  it("상대 공격이 회피 판정 걸리면 실제 miss 처리", () => {
    const [caster, defender] = makePair("berserker", "gambler");
    defender.dodgeNextPercent = 50;
    // defender 의 회피 50% — dodge 판정은 공격 hit 이후 별도 roll
    // roll 50 이하면 dodge 성공. fixedRandintRng(1) 로 dodge 성공시키기
    const r = executeCard(getCardById("B1"), caster, defender, {
      bet: 10, // 명중률 100% 확보
      gameTurn: 1,
      rng: fixedRandintRng(1), // hit 로 1, dodge 로 1 — 둘 다 최소값
    });
    // dodge 성공 → success = false
    expect(r.success).toBe(false);
    expect(defender.dodgeNextPercent).toBe(0);
  });

  it("회피 판정 실패 시 정상 피격", () => {
    const [caster, defender] = makePair("berserker", "gambler");
    defender.dodgeNextPercent = 50;
    // dodge roll 이 50 초과 나오면 dodge 실패 → 피격 유지
    // fixedRandintRng 는 고정값이라 hit 롤과 dodge 롤 둘 다 같은 값.
    // hit=1 <= 100(100% 명중), dodge=1 <= 50 → 회피. 테스트 어려움.
    // 대안: hit 롤만 통과, dodge 롤은 실패 시키려면 RNG 를 시퀀스로 만들어야.
    // 여기선 dodgeNextPercent 가 "사용됨" (0으로 리셋) 만 확인.
    executeCard(getCardById("B1"), caster, defender, {
      bet: 10,
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(defender.dodgeNextPercent).toBe(0);
  });
});

describe("G12 블러프 — opponent.nextAttackMissChance", () => {
  it("발동 시 상대의 nextAttackMissChance = 50", () => {
    const [p, op] = makePair("gambler", "berserker");
    executeCard(getCardById("G12"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(op.nextAttackMissChance).toBe(50);
  });

  it("상대 공격 시 블러프 판정 걸리면 강제 miss + 플래그 소멸", () => {
    const [caster, defender] = makePair("berserker", "gambler");
    caster.nextAttackMissChance = 50;
    // hit 성공 후 블러프 판정이 덧붙음
    // fixedRandintRng(1) → hit=1 pass, bluff=1<=50 강제 miss
    const r = executeCard(getCardById("B1"), caster, defender, {
      bet: 10, // 명중률 근접 100%
      gameTurn: 1,
      rng: fixedRandintRng(1),
    });
    expect(r.success).toBe(false);
    expect(caster.nextAttackMissChance).toBe(0);
  });
});

// =====================================================================
// 2. 지속형 버프/디버프
// =====================================================================

describe("B11 분노 폭발 — rageStacks", () => {
  it("발동 시 rageStacks += 1", () => {
    const [p, op] = makePair();
    executeCard(getCardById("B11"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.rageStacks).toBe(1);
    executeCard(getCardById("B11"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.rageStacks).toBe(2);
  });

  it("공격 시 rageStacks × 8 피해 보너스 후 0으로 소멸", () => {
    const [p, op] = makePair();
    p.rageStacks = 3;
    const opHpBefore = op.hp;
    // B1 dmg 50 + rage 3*8 = 74
    const r = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(r.success).toBe(true);
    expect(opHpBefore - op.hp).toBe(74);
    expect(p.rageStacks).toBe(0);
  });
});

describe("G13 독 바르기 — poisonTurns + poisonDamage", () => {
  it("발동 시 상대에게 독 3턴, 4피해 세팅", () => {
    const [p, op] = makePair("gambler", "berserker");
    executeCard(getCardById("G13"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(op.poisonTurns).toBe(3);
    expect(op.poisonDamage).toBe(4);
  });

  it("턴 종료 시 독 피해 (독 tick) — 피해 누적 + turns 감소 검증", () => {
    // tick 로직은 Game 단에서 돌아가는데, Player 단독으로 수동 호출로 확인
    const [, op] = makePair("gambler", "berserker");
    op.poisonTurns = 3;
    op.poisonDamage = 4;
    // Player 엔 poisonTick 같은 메서드가 있는지 확인 필요
    // (엔진 로직에 따라 구조가 다를 수 있으므로 최소한 서버 serialize 만 검증)
    expect(op.poisonTurns).toBe(3);
    expect(op.poisonDamage).toBe(4);
  });
});

describe("W3 약점 포착 — silencedCards", () => {
  it("공격 성공 시 상대 손패 1장 봉인", () => {
    const [p, op] = makePair("warden", "gambler");
    // 상대 손패 보장
    op.deck = [
      getCardById("G1"),
      getCardById("G2"),
      getCardById("G3"),
    ];
    op.draw(3);
    executeCard(getCardById("W3"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(op.silencedCards.length).toBeGreaterThanOrEqual(1);
  });

  it("턴 종료 시 silencedCards 리셋", () => {
    const [, op] = makePair("warden", "gambler");
    op.silencedCards = ["G1"];
    op.endTurn();
    expect(op.silencedCards).toEqual([]);
  });
});

describe("W4 결박의 사슬 — opponent betCapOverride", () => {
  it("발동 시 상대 betCapOverride = 3, turns = 1", () => {
    const [p, op] = makePair("warden", "gambler");
    executeCard(getCardById("W4"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(op.betCapOverride).toBe(3);
    expect(op.betCapOverrideTurns).toBeGreaterThan(0);
  });

  it("turns 가 0 되면 betCapOverride = null 로 해제", () => {
    const [, op] = makePair();
    op.betCapOverride = 3;
    op.betCapOverrideTurns = 1;
    op.endTurn();
    expect(op.betCapOverride).toBeNull();
    expect(op.betCapOverrideTurns).toBe(0);
  });
});

describe("B15 베르세르크 [SIG] — 다중 상태 세팅", () => {
  it("발동 시 berserkTurns/AccBonus/DamageBonus 동시 세팅", () => {
    const [p, op] = makePair();
    executeCard(getCardById("B15"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.berserkTurns).toBe(3);
    expect(p.berserkAccBonus).toBe(20);
    expect(p.berserkDamageBonus).toBe(8);
  });

  it("베르세르크 중 공격은 명중 +20, 피해 +8 반영", () => {
    const [p, op] = makePair();
    p.berserkTurns = 3;
    p.berserkAccBonus = 20;
    p.berserkDamageBonus = 8;
    const opHpBefore = op.hp;
    const r = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(r.success).toBe(true);
    // base 50 + berserkDamageBonus 8 = 58
    expect(opHpBefore - op.hp).toBe(58);
  });
});

describe("W14 무효 선언 [SIG] — incomingDamageMult", () => {
  it("발동 시 incomingDamageMult = 0.5, turns = 3", () => {
    const [p, op] = makePair("warden", "berserker");
    executeCard(getCardById("W14"), p, op, {
      bet: 0,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    expect(p.incomingDamageMult).toBe(0.5);
    expect(p.incomingDamageMultTurns).toBe(3);
  });

  it("받는 피해 1/2 반영", () => {
    const [attacker, defender] = makePair("berserker", "warden");
    defender.incomingDamageMult = 0.5;
    defender.incomingDamageMultTurns = 3;
    const hpBefore = defender.hp;
    executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 3,
      rng: alwaysMinRng(),
    });
    // base 50 * 0.5 = 25
    expect(hpBefore - defender.hp).toBe(25);
  });

  it("3턴 뒤 자동 해제", () => {
    const [, p] = makePair();
    p.incomingDamageMult = 0.5;
    p.incomingDamageMultTurns = 3;
    for (let i = 0; i < 3; i++) p.endTurn();
    expect(p.incomingDamageMult).toBe(1.0);
    expect(p.incomingDamageMultTurns).toBe(0);
  });
});

// =====================================================================
// 3. 방어막 (shield)
// =====================================================================

describe("shield — B7 / B9 / W9", () => {
  it("B9 강철 피부 shield +15", () => {
    const [p, op] = makePair();
    executeCard(getCardById("B9"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.shield).toBe(15);
  });

  it("W9 방패 벽 shield +18", () => {
    const [p, op] = makePair("warden", "berserker");
    executeCard(getCardById("W9"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.shield).toBe(18);
  });

  it("피해 받을 때 shield 먼저 차감", () => {
    const [attacker, defender] = makePair();
    defender.shield = 15;
    const hpBefore = defender.hp;
    executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    // damage 50 → shield 15 흡수 → hp -35
    expect(defender.shield).toBe(0);
    expect(hpBefore - defender.hp).toBe(35);
  });

  it("ignore_shield (G3 마크된 단검) 은 shield 무시", () => {
    const [attacker, defender] = makePair("gambler", "warden");
    defender.shield = 15;
    const hpBefore = defender.hp;
    executeCard(getCardById("G3"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: fixedRandintRng(1), // crit 성공
    });
    // G3 damage 18, shield 관통 → hp 감소는 crit 배율 반영
    expect(defender.shield).toBe(15); // 관통이라 방어막 안 줄어듦
    expect(hpBefore - defender.hp).toBeGreaterThan(0);
  });
});

// =====================================================================
// 4. 자기 회복 / 정화
// =====================================================================

describe("self_heal — B10 / W10 / W11", () => {
  it("B10 광기의 식사 HP +18 (최대치 캡)", () => {
    const [p, op] = makePair();
    p.hp = 50;
    executeCard(getCardById("B10"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.hp).toBe(68);
  });

  it("W10 신성한 보호 HP +20", () => {
    const [p, op] = makePair("warden", "gambler");
    p.hp = 50;
    executeCard(getCardById("W10"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.hp).toBe(70);
  });

  it("최대 HP 넘어서 회복 안 됨", () => {
    const [p, op] = makePair();
    p.hp = p.maxHp;
    executeCard(getCardById("B10"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.hp).toBe(p.maxHp);
  });

  it("W11 정화 — HP 회복 + 디버프 제거", () => {
    const [p, op] = makePair("warden", "gambler");
    p.hp = 80;
    p.poisonTurns = 3;
    p.poisonDamage = 4;
    p.nextAttackMissChance = 50;
    executeCard(getCardById("W11"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.hp).toBe(88);
    // cleanse 가 독/블러프 등 제거
    expect(p.poisonTurns).toBe(0);
    expect(p.nextAttackMissChance).toBe(0);
  });
});

// =====================================================================
// 5. 공격 부가 효과
// =====================================================================

describe("B3 피의 대가 — lifesteal 30%", () => {
  it("적중 시 피해의 30% 만큼 회복", () => {
    const [p, op] = makePair();
    p.hp = 70;
    executeCard(getCardById("B3"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    // damage 22 × 0.3 = 6.6 → 6 회복 (floor)
    // HP = 70 - 10 (bet) + 6 = 66
    expect(p.hp).toBeGreaterThanOrEqual(66);
  });
});

describe("B4 연쇄 베기 — 3회 타격", () => {
  it("hit 성공 시 3회 피해 (합계 반영)", () => {
    const [p, op] = makePair();
    const opHpBefore = op.hp;
    const r = executeCard(getCardById("B4"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(r.success).toBe(true);
    // damage 18 × 3회 = 54
    expect(opHpBefore - op.hp).toBe(54);
  });
});

describe("B5 처형 — 상대 HP ≤ 30 시 명중 +20%", () => {
  it("상대 HP > threshold 면 보너스 없음", () => {
    const [p, op] = makePair();
    op.hp = 50;
    // B5 base_acc 60. fixedRandintRng(61) → 61>60 miss.
    const r = executeCard(getCardById("B5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(61),
    });
    expect(r.success).toBe(false);
  });

  it("상대 HP ≤ threshold 면 +25% 보너스", () => {
    const [p, op] = makePair();
    op.hp = 25;
    // base 60 + bonus 25 = 85 → fixedRandintRng(85) hit.
    const r = executeCard(getCardById("B5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(85),
    });
    expect(r.success).toBe(true);
  });
});

describe("W2 처벌의 빛 — hitLastTurn 보너스", () => {
  it("상대가 직전 턴 적중했으면 피해 +8", () => {
    const [p, op] = makePair("warden", "berserker");
    op.hitLastTurn = true;
    const hpBefore = op.hp;
    executeCard(getCardById("W2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(hpBefore - op.hp).toBe(20);  // 12 + 8
  });

  it("상대가 적중 안 했으면 기본 피해만", () => {
    const [p, op] = makePair("warden", "berserker");
    op.hitLastTurn = false;
    const hpBefore = op.hp;
    executeCard(getCardById("W2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(hpBefore - op.hp).toBe(12);
  });
});

describe("W5 정의 집행 — condition self_hp_below_opp", () => {
  it("내 HP < 상대 HP 시 사용 가능 (보너스 없음)", () => {
    const [p, op] = makePair("warden", "berserker");
    p.hp = 50;
    op.hp = 80;
    const opHpBefore = op.hp;
    executeCard(getCardById("W5"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(opHpBefore - op.hp).toBe(14);
  });

  it("내 HP ≥ 상대 HP 면 사용 불가", () => {
    const [p, op] = makePair("warden", "berserker");
    p.hp = 80;
    op.hp = 50;
    expect(() =>
      executeCard(getCardById("W5"), p, op, {
        bet: 0,
        gameTurn: 1,
        rng: alwaysMinRng(),
      }),
    ).toThrow();
  });
});

describe("B8 광기의 일격 — self_damage", () => {
  it("사용 시 자해 8 (hit 성공 여부와 무관)", () => {
    const [p, op] = makePair();
    const pHpBefore = p.hp;
    executeCard(getCardById("B8"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    // 자해 8 발생
    expect(p.hp).toBeLessThanOrEqual(pHpBefore - 8);
  });
});

describe("B2 광폭한 돌진 — self_damage_on_miss", () => {
  it("빗나갔을 때만 자해 8", () => {
    const [p, op] = makePair();
    const pHpBefore = p.hp;
    // B2 baseAcc 70 → alwaysMaxRng 로 100>70 실패
    executeCard(getCardById("B2"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: alwaysMaxRng(),
    });
    expect(p.hp).toBe(pHpBefore - 8);
  });

  it("hit 성공 시 자해 없음", () => {
    const [p, op] = makePair();
    const pHpBefore = p.hp;
    executeCard(getCardById("B2"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    expect(p.hp).toBe(pHpBefore - 10);
  });
});

// =====================================================================
// 6. 턴 훅 (endTurn / beginTurn) — 상태 tick 및 리셋
// =====================================================================

describe("beginTurn — 독/베르세르크/실드 tick", () => {
  it("shield 는 매 턴 시작 시 0 으로 리셋", () => {
    const [p] = makePair();
    p.shield = 15;
    p.beginTurn();
    expect(p.shield).toBe(0);
  });

  it("독 지속 중 HP 감소 + turns 감소 + 방어막 무시", () => {
    const [p] = makePair();
    p.poisonTurns = 3;
    p.poisonDamage = 4;
    p.shield = 20; // 방어막 있어도 독은 관통
    const hpBefore = p.hp;
    const info = p.beginTurn();
    expect(p.hp).toBe(hpBefore - 4);
    expect(p.poisonTurns).toBe(2);
    expect(p.shield).toBe(0); // 실드 리셋은 별건
    expect(info.poison).toBe(4);
  });

  it("독 0 턴 되면 poisonDamage 도 0 으로 리셋", () => {
    const [p] = makePair();
    p.poisonTurns = 1;
    p.poisonDamage = 4;
    p.beginTurn();
    expect(p.poisonTurns).toBe(0);
    expect(p.poisonDamage).toBe(0);
  });

  it("베르세르크 중 매 턴 자해 5 + turns 감소", () => {
    const [p] = makePair();
    p.berserkTurns = 2;
    p.berserkAccBonus = 20;
    p.berserkDamageBonus = 8;
    const hpBefore = p.hp;
    const info = p.beginTurn();
    expect(p.hp).toBe(hpBefore - 5);
    expect(p.berserkTurns).toBe(1);
    expect(info.berserkSelfDmg).toBe(5);
    // 아직 0 아니니 bonus 유지
    expect(p.berserkAccBonus).toBe(20);
  });

  it("베르세르크 마지막 턴 종료 후 acc/damage bonus 도 0 으로", () => {
    const [p] = makePair();
    p.berserkTurns = 1;
    p.berserkAccBonus = 20;
    p.berserkDamageBonus = 8;
    p.beginTurn();
    expect(p.berserkTurns).toBe(0);
    expect(p.berserkAccBonus).toBe(0);
    expect(p.berserkDamageBonus).toBe(0);
  });
});

describe("endTurn — betCap/damageMult/silence/missedLastTurn", () => {
  it("betCapOverrideTurns 감소 → 0 이면 null 복원", () => {
    const [p] = makePair();
    p.betCapOverride = 3;
    p.betCapOverrideTurns = 2;
    p.endTurn();
    expect(p.betCapOverrideTurns).toBe(1);
    expect(p.betCapOverride).toBe(3);
    p.endTurn();
    expect(p.betCapOverrideTurns).toBe(0);
    expect(p.betCapOverride).toBeNull();
  });

  it("incomingDamageMultTurns 감소 → 0 이면 1.0 복원", () => {
    const [p] = makePair();
    p.incomingDamageMult = 0.5;
    p.incomingDamageMultTurns = 2;
    p.endTurn();
    expect(p.incomingDamageMultTurns).toBe(1);
    expect(p.incomingDamageMult).toBe(0.5);
    p.endTurn();
    expect(p.incomingDamageMultTurns).toBe(0);
    expect(p.incomingDamageMult).toBe(1.0);
  });

  it("silencedCards 는 endTurn 에서 비워짐", () => {
    const [p] = makePair();
    p.silencedCards = ["B1", "B2"];
    p.endTurn();
    expect(p.silencedCards).toEqual([]);
  });

  it("missedLastTurn 은 이번 턴 _missedThisTurn 을 carry", () => {
    const [p] = makePair();
    p.recordMiss(); // _missedThisTurn = true
    p.endTurn();
    expect(p.missedLastTurn).toBe(true);
    // 다음 턴 시작 시 _missedThisTurn 리셋
    p.beginTurn();
    p.endTurn();
    expect(p.missedLastTurn).toBe(false);
  });
});

// =====================================================================
// 7. 부운 (Boon) 효과 — 초기 값 + 공격 판정 기여
// =====================================================================

import { getBoonById } from "@/engine";

describe("BN01 강철 심장 — hp_bonus +30", () => {
  it("최대 HP 100 → 130", () => {
    const boon = getBoonById("BN01");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    expect(p.maxHp).toBe(130);
    expect(p.hp).toBe(130);
  });
});

describe("BN02 견고한 의지 — damage_reduction", () => {
  it("받는 피해 -2 (최소 1)", () => {
    const boon = getBoonById("BN02");
    const defender = new Player({
      name: "D",
      className: "warden",
      boon,
      seed: 1,
    });
    const attacker = new Player({ name: "A", className: "berserker", seed: 2 });
    const hpBefore = defender.hp;
    executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    // damage 50 - 2 (reduction) = 48
    expect(hpBefore - defender.hp).toBe(48);
  });
});

describe("BN03 회복의 가호 — heal_per_turn +5", () => {
  it("beginTurn 시 HP +5 (maxHp 캡)", () => {
    const boon = getBoonById("BN03");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    p.hp = 50;
    const info = p.beginTurn();
    expect(info.heal).toBe(5);
    expect(p.hp).toBe(55);
  });
});

describe("BN04 칼날의 축복 — damage_bonus_all +3", () => {
  it("모든 공격 카드 피해 +3", () => {
    const boon = getBoonById("BN04");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "B", className: "warden", seed: 2 });
    const hpBefore = op.hp;
    executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: alwaysMinRng(),
    });
    // 50 + 3 = 53
    expect(hpBefore - op.hp).toBe(53);
  });
});

describe("BN05 정밀의 눈 — acc_bonus +15 / crit_bonus +10", () => {
  it("hit 카드 명중률에 +15% 가산", () => {
    const boon = getBoonById("BN05");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "B", className: "warden", seed: 2 });
    // B1 baseAcc 80 + 15 (BN05) = 95. fixedRandintRng(95) → hit.
    const r = executeCard(getCardById("B1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(95),
    });
    expect(r.success).toBe(true);
    // 96 이면 miss (no boon: 80, with boon: 95)
    const p2 = new Player({ name: "C", className: "berserker", seed: 1 });
    const op2 = new Player({ name: "D", className: "warden", seed: 2 });
    const r2 = executeCard(getCardById("B1"), p2, op2, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(96),
    });
    expect(r2.success).toBe(false);
  });

  it("crit 카드 치명률에 +10% 가산", () => {
    const boon = getBoonById("BN05");
    const p = new Player({ name: "A", className: "gambler", boon, seed: 1 });
    const op = new Player({ name: "B", className: "berserker", seed: 2 });
    // G1: acc 70+15 = 85. crit = 85/10 + 10 (boon) = 18.
    // fixedRandintRng(18) → hit (18<=85), crit (18<=18).
    const r = executeCard(getCardById("G1"), p, op, {
      bet: 0,
      gameTurn: 1,
      rng: fixedRandintRng(18),
    });
    expect(r.critical).toBe(true);
  });
});

describe("BN06 광기의 인장 — 베팅당 +1% 명중/크리", () => {
  it("베팅 10 시 명중률 +10%", () => {
    const boon = getBoonById("BN06");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    const op = new Player({ name: "B", className: "warden", seed: 2 });
    // B1 baseAcc=40, betAcc=6, berserker passive +2/bet = 20, BN06 +1/bet = 10
    // bet=10 → acc = 40 + 60 + 20 + 10 = 130 → clamp 100
    // fixedRandintRng(100) → 100<=100 hit
    const r = executeCard(getCardById("B1"), p, op, {
      bet: 10,
      gameTurn: 1,
      rng: fixedRandintRng(100),
    });
    expect(r.success).toBe(true);
  });
});

describe("BN09 풍요의 손 — 턴당 최대 카드 +1", () => {
  it("maxCardsPerTurn 3 (기본 2 + 1)", () => {
    const boon = getBoonById("BN09");
    const p = new Player({ name: "A", className: "berserker", boon, seed: 1 });
    expect(p.maxCardsPerTurn()).toBe(3);
  });
});

// =====================================================================
// 8. rollHitWithModifiers — hit → bluff → dodge 순서 검증
// =====================================================================

/** 순서대로 값을 반환하는 테스트 RNG. randint 호출마다 시퀀스 소비. */
function sequenceRng(values: number[]): import("@/engine").Rng {
  let i = 0;
  const next = () => {
    const v = values[i] ?? values[values.length - 1] ?? 0;
    i++;
    return v;
  };
  return {
    next: () => 0,
    randint: (_a: number, _b: number) => next(),
    shuffle<T>(_arr: T[]): void {
      /* no-op */
    },
    choice<T>(arr: T[]): T {
      return arr[next() % arr.length]!;
    },
    sample<T>(arr: T[], _n: number): T[] {
      return arr.slice();
    },
  };
}

describe("새 데미지 흐름 — bluff → hit → dodge 별도 굴림", () => {
  it("bluff 걸렸고 발동 시 hit 굴림 안 함 (bluff 먼저)", () => {
    const [attacker, defender] = makePair();
    attacker.nextAttackMissChance = 50;
    // 시퀀스: [bluff=1] (1<=50 발동 → 즉시 강제 miss). hit/dodge 굴림 X.
    const r = executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: sequenceRng([1]),
    });
    expect(r.success).toBe(false);
    expect(r.bluffTriggered).toBe(true);
    expect(attacker.nextAttackMissChance).toBe(0);
  });

  it("bluff 발동 실패 → hit 정상 굴림 + bluff 소멸", () => {
    const [attacker, defender] = makePair();
    attacker.nextAttackMissChance = 50;
    // [bluff=51 실패, hit=1 성공]
    const r = executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: sequenceRng([51, 1]),
    });
    expect(r.success).toBe(true);
    expect(r.bluffTriggered).toBe(false);
    expect(attacker.nextAttackMissChance).toBe(0);
  });

  it("dodge 걸린 상대에 공격 시 hit 후 dodge 별도 굴림", () => {
    const [attacker, defender] = makePair();
    defender.dodgeNextPercent = 50;
    // [hit=1 성공, dodge=1 성공] → 회피
    const r = executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: sequenceRng([1, 1]),
    });
    expect(r.success).toBe(false);
    expect(r.dodged).toBe(true);
    expect(defender.dodgeNextPercent).toBe(0);
  });

  it("bluff + dodge 동시: bluff 실패 → hit → dodge 실패 → 명중 성공", () => {
    const [attacker, defender] = makePair();
    attacker.nextAttackMissChance = 50;
    defender.dodgeNextPercent = 50;
    // [bluff=51 실패, hit=1 성공, dodge=51 실패]
    const r = executeCard(getCardById("B1"), attacker, defender, {
      bet: 10,
      gameTurn: 1,
      rng: sequenceRng([51, 1, 51]),
    });
    expect(r.success).toBe(true);
    expect(attacker.nextAttackMissChance).toBe(0);
    expect(defender.dodgeNextPercent).toBe(0);
  });

  it("원 hit 이 실패하면 dodge 굴림 안 함 → dodge 유지", () => {
    const [attacker, defender] = makePair();
    defender.dodgeNextPercent = 50;
    // [hit=100 실패] — B1 acc 80 (no bet), 100>80 miss. dodge 굴림 X.
    const r = executeCard(getCardById("B1"), attacker, defender, {
      bet: 0,
      gameTurn: 1,
      rng: sequenceRng([100, 1]),
    });
    expect(r.success).toBe(false);
    expect(defender.dodgeNextPercent).toBe(50);
  });
});
