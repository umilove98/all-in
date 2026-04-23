/**
 * Card execution engine. Python `cli/allin/engine.py` 1:1 포팅.
 * 45장 전체 효과, 베팅/실드/부운 상호작용, 시그니처 제약.
 */

import { Card, ClassName } from "./types";
import { Player } from "./player";
import { Rng, createRng } from "./rng";
import { InvalidPlayError, MirrorMatchError } from "./errors";

// ======================================================================
//   결과/예외
// ======================================================================

export interface CardResult {
  cardId: string;
  caster: string;
  bet: number;
  success: boolean; // hit/crit/fixed: 명중 성공, utility: 시전 성공
  critical: boolean;
  damageToOpponent: number;
  damageToSelf: number;
  heal: number;
  shieldGained: number;
  drawnCards: string[];
  notes: string[];
  subResults: Array<Record<string, unknown>>;
  doubleProc: boolean;
  jackpotRoll: number | null;
}

function newResult(cardId: string, caster: string, bet: number): CardResult {
  return {
    cardId,
    caster,
    bet,
    success: true,
    critical: false,
    damageToOpponent: 0,
    damageToSelf: 0,
    heal: 0,
    shieldGained: 0,
    drawnCards: [],
    notes: [],
    subResults: [],
    doubleProc: false,
    jackpotRoll: null,
  };
}

// ======================================================================
//   보조
// ======================================================================

const MIRROR_MSG = "미러전은 금지되어 있습니다 (docs/01-game-overview.md).";

export function validateClassMatchup(first: ClassName, second: ClassName): void {
  if (first === second) {
    throw new MirrorMatchError(`${MIRROR_MSG} (both=${first})`);
  }
}

export function computeBetCap(card: Card, caster: Player): number {
  let cap = card.maxBet;
  if (caster.betCapOverride !== null) {
    cap = Math.min(cap, caster.betCapOverride);
  }
  cap = Math.min(cap, Math.max(0, caster.hp - 1));
  return cap;
}

export function validateCardPlay(
  card: Card,
  caster: Player,
  gameTurn: number,
): void {
  if (card.signature) {
    if (caster.sigUsedIds.has(card.id)) {
      throw new InvalidPlayError(`${card.id}: 이미 사용한 시그니처`);
    }
    if (caster.sigUsedThisTurn) {
      throw new InvalidPlayError("같은 턴에 시그니처 1장만 사용 가능");
    }
    if (gameTurn < 3) {
      throw new InvalidPlayError(
        `시그니처는 3턴 이후부터 사용 가능 (현재 ${gameTurn}턴)`,
      );
    }
  }
  if (caster.silencedCards.includes(card.id)) {
    throw new InvalidPlayError(`${card.id}: 침묵 상태`);
  }
  const cond = card.extra.condition as
    | { self_hp_max?: number }
    | undefined;
  if (cond?.self_hp_max !== undefined && caster.hp > cond.self_hp_max) {
    throw new InvalidPlayError(
      `${card.id}: 내 HP가 ${cond.self_hp_max} 이하여야 함 (현재 ${caster.hp})`,
    );
  }
}

// ======================================================================
//   부운 효과 헬퍼
// ======================================================================

function boonEffectNum(
  caster: Player,
  key: string,
  fallback = 0,
): number {
  if (!caster.boon) return fallback;
  const v = caster.boon.effect[key];
  return typeof v === "number" ? v : fallback;
}

// ======================================================================
//   명중/크리 계산
// ======================================================================

export function computeHitAccuracy(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
): number {
  let acc = card.baseAcc + card.betAcc * bet;

  // B5 처형: 상대 HP ≤ execute_threshold 시 +execute_bonus_acc
  const exThreshold = card.extra.execute_threshold as number | undefined;
  const exBonus = (card.extra.execute_bonus_acc as number | undefined) ?? 0;
  if (exThreshold !== undefined && opponent.hp <= exThreshold) {
    acc += exBonus;
  }

  // 광전사 패시브: HP 베팅 1당 명중률 +2%
  if (caster.className === "berserker") {
    acc += 2 * bet;
  }

  // BN05 정밀의 눈
  acc += boonEffectNum(caster, "acc_bonus");
  // BN06 광기의 인장
  acc += boonEffectNum(caster, "bet_acc_bonus_per") * bet;
  // B6 함성
  acc += caster.nextAccBonus;
  // B15 베르세르크
  acc += caster.berserkAccBonus;

  return Math.max(0, Math.min(100, acc));
}

export function computeCritChance(card: Card, caster: Player, bet: number): number {
  let crit = card.baseCrit + card.betCrit * bet;
  crit += boonEffectNum(caster, "crit_bonus");
  crit += boonEffectNum(caster, "bet_crit_bonus_per") * bet;
  crit += caster.nextCritBonus;
  return Math.max(0, Math.min(100, crit));
}

function consumeRage(caster: Player): number {
  const bonus = caster.rageStacks * 8;
  caster.rageStacks = 0;
  return bonus;
}

// ======================================================================
//   데미지 적용
// ======================================================================

function applyDamageToOpponent(
  rawDamage: number,
  card: Card,
  _caster: Player,
  opponent: Player,
  _result: CardResult,
): number {
  if (rawDamage <= 0) return 0;
  const ignoreShield = Boolean(card.extra.ignore_shield);
  let dmg = rawDamage;
  if (opponent.incomingDamageMult !== 1.0) {
    dmg = Math.floor(dmg * opponent.incomingDamageMult);
  }
  const evt = opponent.takeDamage(dmg, { ignoreShield });
  return evt.dealt;
}

function applySelfDamage(
  caster: Player,
  amount: number,
  result: CardResult,
): void {
  if (amount <= 0) return;
  const before = caster.hp;
  caster.hp = Math.max(0, caster.hp - amount);
  result.damageToSelf += before - caster.hp;
}

// ======================================================================
//   공격 기본 데미지
// ======================================================================

function computeBaseAttackDamage(
  card: Card,
  caster: Player,
  opponent: Player,
): number {
  let dmg = card.damage;
  dmg += boonEffectNum(caster, "damage_bonus_all");
  dmg += caster.berserkDamageBonus;

  const punish = (card.extra.punish_missed_prev as number | undefined) ?? 0;
  if (punish && opponent.missedLastTurn) {
    dmg += punish;
  }
  const judgmentBonus = (card.extra.judgment_bonus as number | undefined) ?? 0;
  if (judgmentBonus && opponent.hp > caster.hp) {
    dmg += judgmentBonus;
  }
  return dmg;
}

function rollDoubleProc(caster: Player, rng: Rng, result: CardResult): void {
  const chance = boonEffectNum(caster, "double_proc_chance");
  if (chance > 0 && rng.randint(1, 100) <= chance) {
    result.doubleProc = true;
    result.notes.push("🎰 행운의 동전 발동! 효과 ×2");
  }
}

// ======================================================================
//   Hit
// ======================================================================

function rollHitWithModifiers(
  acc: number,
  caster: Player,
  opponent: Player,
  rng: Rng,
  result: CardResult,
): boolean {
  let hit = rng.randint(1, 100) <= acc;

  // G12 블러프 — 공격자의 next_attack_miss_chance 소모
  if (hit && caster.nextAttackMissChance > 0) {
    const chance = caster.nextAttackMissChance;
    caster.nextAttackMissChance = 0;
    if (rng.randint(1, 100) <= chance) {
      hit = false;
      result.notes.push(`블러프에 걸림 — ${chance}% 강제 miss`);
    }
  }

  // G9/W12 회피 — 방어자의 dodge_next_percent 소모
  if (hit && opponent.dodgeNextPercent > 0) {
    const chance = opponent.dodgeNextPercent;
    opponent.dodgeNextPercent = 0;
    if (rng.randint(1, 100) <= chance) {
      hit = false;
      result.notes.push(`${opponent.name} 회피 (${chance}%)`);
    }
  }
  return hit;
}

function executeHit(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
  result: CardResult,
  rng: Rng,
): void {
  const acc = computeHitAccuracy(card, caster, opponent, bet);
  caster.nextAccBonus = 0; // 사용 시 소모

  let baseDamage = computeBaseAttackDamage(card, caster, opponent);
  baseDamage += card.betDamage * bet;
  baseDamage += consumeRage(caster);

  const hitCount = (card.extra.hit_count as number | undefined) ?? 1;

  let totalDamage = 0;
  let successfulHits = 0;
  for (let i = 0; i < hitCount; i++) {
    const hit = rollHitWithModifiers(acc, caster, opponent, rng, result);
    if (hit) {
      successfulHits += 1;
      let dmg = baseDamage;
      if (result.doubleProc) dmg *= 2;
      const dealt = applyDamageToOpponent(dmg, card, caster, opponent, result);
      totalDamage += dealt;
      result.subResults.push({
        hit_index: i + 1,
        hit: true,
        damage: dealt,
      });
    } else {
      caster.recordMiss();
      result.subResults.push({ hit_index: i + 1, hit: false, damage: 0 });
    }
  }

  result.success = successfulHits > 0;
  result.damageToOpponent = totalDamage;
  if (result.success) {
    caster.recordHit(totalDamage, false);
  }

  // 흡혈 (B3)
  const lifesteal = (card.extra.lifesteal as number | undefined) ?? 0;
  if (lifesteal && successfulHits > 0) {
    const healed = caster.heal(Math.floor(totalDamage * lifesteal));
    result.heal += healed;
  }

  // 사용 시 자해 (B8)
  const selfDmg = (card.extra.self_damage as number | undefined) ?? 0;
  if (selfDmg) applySelfDamage(caster, selfDmg, result);

  // 빗나감 시 자해 (B2, G15 일부)
  const missSelf = card.extra.self_damage_on_miss as number | string | undefined;
  if (missSelf && !result.success) {
    if (missSelf === "bet_amount") {
      applySelfDamage(caster, bet, result);
    } else if (typeof missSelf === "number") {
      applySelfDamage(caster, missSelf, result);
    }
  }

  // 추가 드로우 (G7)
  const drawN = (card.extra.draw as number | undefined) ?? 0;
  if (drawN) {
    const drawn = caster.draw(drawN);
    result.drawnCards.push(...drawn.map((c) => c.id));
  }
}

// ======================================================================
//   Crit
// ======================================================================

function executeCrit(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
  result: CardResult,
  rng: Rng,
): void {
  // Crit 은 명중 자체는 100%. 블러프/회피만 체크.
  const hit = rollHitWithModifiers(100, caster, opponent, rng, result);

  let baseDamage = computeBaseAttackDamage(card, caster, opponent);
  baseDamage += card.betDamage * bet;
  baseDamage += consumeRage(caster);

  // G2 야바위: damage_range
  const range = card.extra.damage_range as [number, number] | undefined;
  if (range) {
    const [lo, hi] = range;
    baseDamage = rng.randint(lo, hi);
    // BN04/베르세르크/punish/judgment 재적용 (range 덮어쓰기 보정)
    baseDamage += boonEffectNum(caster, "damage_bonus_all");
    baseDamage += caster.berserkDamageBonus;
    const punish = (card.extra.punish_missed_prev as number | undefined) ?? 0;
    if (punish && opponent.missedLastTurn) baseDamage += punish;
    const jb = (card.extra.judgment_bonus as number | undefined) ?? 0;
    if (jb && opponent.hp > caster.hp) baseDamage += jb;
  }

  const critChance = computeCritChance(card, caster, bet);
  caster.nextCritBonus = 0; // 사용 시 소모

  let isCrit: boolean;
  if (caster.guaranteeNextCrit) {
    isCrit = true;
    caster.guaranteeNextCrit = false;
    result.notes.push("마크된 운명 — 크리 확정");
  } else {
    isCrit = rng.randint(1, 100) <= critChance;
  }

  if (!hit) {
    caster.recordMiss();
    result.success = false;
    return;
  }

  let dmg = Math.floor(isCrit ? baseDamage * card.critMult : baseDamage);
  if (result.doubleProc) dmg *= 2;

  const dealt = applyDamageToOpponent(dmg, card, caster, opponent, result);
  result.success = true;
  result.critical = isCrit;
  result.damageToOpponent = dealt;
  caster.recordHit(dealt, isCrit);

  // G15: 크리 실패 시 베팅만큼 자해
  const missSelf = card.extra.self_damage_on_miss as string | undefined;
  if (missSelf === "bet_amount" && !isCrit) {
    applySelfDamage(caster, bet, result);
  }
}

// ======================================================================
//   Fixed
// ======================================================================

function executeFixed(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
  result: CardResult,
  rng: Rng,
): void {
  let base = computeBaseAttackDamage(card, caster, opponent);
  base += card.betDamage * bet;
  base += consumeRage(caster);

  // W6 인내의 반격
  const patience = card.extra.patience as
    | { div?: number; cap?: number }
    | undefined;
  if (patience) {
    const div = patience.div ?? 3;
    const cap = patience.cap ?? 35;
    base = Math.min(cap, Math.floor(caster.totalDamageTaken / div));
  }

  // W15 최후의 심판
  if (card.extra.final_judgment) {
    base = opponent.totalBet;
  }

  let dmg = base * (result.doubleProc ? 2 : 1);

  const dealt = applyDamageToOpponent(dmg, card, caster, opponent, result);
  result.success = true;
  result.damageToOpponent = dealt;
  if (dealt > 0) caster.recordHit(dealt, false);

  // W7 방패 강타: 자기 방어 +8
  const selfShield = (card.extra.self_shield as number | undefined) ?? 0;
  if (selfShield) {
    caster.shield += selfShield;
    result.shieldGained += selfShield;
  }

  // W3 약점 포착: 상대 손패 랜덤 1장 침묵
  const silenceRandom =
    (card.extra.silence_random as number | undefined) ?? 0;
  if (silenceRandom && opponent.hand.length > 0) {
    const targets = rng.sample(
      opponent.hand,
      Math.min(silenceRandom, opponent.hand.length),
    );
    for (const t of targets) {
      opponent.silencedCards.push(t.id);
      result.notes.push(`${t.name} 침묵`);
    }
  }

  // W4 결박의 사슬
  const betCap = card.extra.opponent_max_bet_next as number | undefined;
  if (betCap !== undefined) {
    opponent.betCapOverride = betCap;
    opponent.betCapOverrideTurns = 1;
    result.notes.push(`${opponent.name} 다음 턴 베팅 상한 ${betCap}`);
  }
}

// ======================================================================
//   Utility dispatcher
// ======================================================================

function searchAttackCard(
  caster: Player,
  result: CardResult,
  rng: Rng,
): void {
  const attackIndices: number[] = [];
  for (let i = 0; i < caster.deck.length; i++) {
    if (caster.deck[i]!.category === "attack") attackIndices.push(i);
  }
  if (attackIndices.length === 0) {
    result.notes.push("공격 카드 없음 (서치 실패)");
    return;
  }
  const idx = rng.choice(attackIndices);
  const [card] = caster.deck.splice(idx, 1);
  caster.hand.push(card!);
  result.drawnCards.push(card!.id);
  result.notes.push(`서치: ${card!.name}`);
}

function lookupJackpotOutcome(
  resultsMap: Record<string, Record<string, number>>,
  roll: number,
): Record<string, number> | null {
  for (const [key, outcome] of Object.entries(resultsMap)) {
    if (key.includes("-")) {
      const [lo, hi] = key.split("-").map((n) => parseInt(n, 10));
      if (lo! <= roll && roll <= hi!) return outcome;
    } else if (parseInt(key, 10) === roll) {
      return outcome;
    }
  }
  return null;
}

function executeJackpot(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
  result: CardResult,
  rng: Rng,
): void {
  const jk = card.extra.jackpot as {
    dice: number;
    bet_bonus_div?: number;
    results: Record<string, Record<string, number>>;
  };
  const dice = jk.dice ?? 10;
  const betBonusDiv = jk.bet_bonus_div ?? 2;
  const resultsMap = jk.results;

  let roll = rng.randint(1, dice) + Math.floor(bet / betBonusDiv);
  roll = Math.min(dice, Math.max(1, roll));
  result.jackpotRoll = roll;

  const outcome = lookupJackpotOutcome(resultsMap, roll);
  if (!outcome) {
    result.notes.push(`잭팟 ${roll}: 효과 없음`);
    return;
  }

  const selfDmg = outcome.self_damage ?? 0;
  const dmg = outcome.damage ?? 0;

  if (selfDmg) {
    applySelfDamage(caster, selfDmg, result);
    result.notes.push(`잭팟 ${roll}: 자해 ${selfDmg}`);
    result.success = false;
  } else if (dmg) {
    const finalDmg = dmg * (result.doubleProc ? 2 : 1);
    const dealt = applyDamageToOpponent(
      finalDmg,
      card,
      caster,
      opponent,
      result,
    );
    result.damageToOpponent = dealt;
    result.success = true;
    caster.recordHit(dealt, false);
    result.notes.push(`잭팟 ${roll}: ${dealt}뎀`);
  }
}

function executeDoubleDown(
  caster: Player,
  opponent: Player,
  result: CardResult,
  rng: Rng,
  gameTurn: number,
): void {
  const prev = caster.lastCard;
  if (!prev) {
    result.notes.push("더블 다운 실패 — 직전 사용 카드 없음");
    result.success = false;
    return;
  }
  if (prev.id === "G5") {
    result.notes.push("더블 다운은 더블 다운 자체를 복제할 수 없음");
    result.success = false;
    return;
  }
  result.notes.push(`더블 다운 → ${prev.name} 재발동 (베팅 0)`);
  const sub = executeCard(prev, caster, opponent, {
    bet: 0,
    gameTurn,
    rng,
    _doubleDownRepeat: true,
  });
  result.subResults.push({
    repeat_of: prev.id,
    damage: sub.damageToOpponent,
    hit: sub.success,
    critical: sub.critical,
  });
  result.damageToOpponent += sub.damageToOpponent;
  result.heal += sub.heal;
  result.shieldGained += sub.shieldGained;
}

function cleanseSelf(caster: Player, result: CardResult): void {
  const notes: string[] = [];
  if (caster.poisonTurns > 0) {
    caster.poisonTurns = 0;
    caster.poisonDamage = 0;
    notes.push("독");
  }
  if (caster.silencedCards.length > 0) {
    caster.silencedCards = [];
    notes.push("침묵");
  }
  if (caster.betCapOverride !== null) {
    caster.betCapOverride = null;
    caster.betCapOverrideTurns = 0;
    notes.push("베팅 상한");
  }
  if (caster.nextAttackMissChance > 0) {
    caster.nextAttackMissChance = 0;
    notes.push("블러프");
  }
  if (caster.incomingDamageMult > 1) {
    caster.incomingDamageMult = 1.0;
    caster.incomingDamageMultTurns = 0;
    notes.push("피해 증폭");
  }
  if (notes.length > 0) {
    result.notes.push(`정화: ${notes.join(", ")}`);
  }
}

function executeUtility(
  card: Card,
  caster: Player,
  opponent: Player,
  bet: number,
  result: CardResult,
  rng: Rng,
  gameTurn: number,
): void {
  const cid = card.id;
  const ex = card.extra;

  switch (cid) {
    // ---- 광전사 ----
    case "B6": {
      caster.nextAccBonus = (ex.next_acc_bonus as number | undefined) ?? 25;
      result.notes.push(`다음 카드 명중 +${caster.nextAccBonus}%`);
      break;
    }
    case "B7":
    case "B9": {
      const gain = (ex.shield as number | undefined) ?? (cid === "B9" ? 15 : 12);
      caster.shield += gain;
      result.shieldGained += gain;
      break;
    }
    case "B10": {
      result.heal += caster.heal((ex.self_heal as number | undefined) ?? 18);
      break;
    }
    case "B11": {
      caster.rageStacks += (ex.rage_stack as number | undefined) ?? 1;
      result.notes.push(`분노 스택 ${caster.rageStacks}`);
      break;
    }
    case "B12": {
      searchAttackCard(caster, result, rng);
      const drawn = caster.draw((ex.draw as number | undefined) ?? 1);
      result.drawnCards.push(...drawn.map((c) => c.id));
      break;
    }
    case "B15": {
      const bm = ex.berserk_mode as {
        turns: number;
        acc_bonus: number;
        damage_bonus: number;
      };
      caster.berserkTurns = bm.turns;
      caster.berserkAccBonus = bm.acc_bonus;
      caster.berserkDamageBonus = bm.damage_bonus;
      result.notes.push(
        `베르세르크 ${bm.turns}턴 — 명중 +${bm.acc_bonus}%, 데미지 +${bm.damage_bonus}`,
      );
      break;
    }

    // ---- 도박사 ----
    case "G4": {
      executeJackpot(card, caster, opponent, bet, result, rng);
      break;
    }
    case "G5": {
      executeDoubleDown(caster, opponent, result, rng, gameTurn);
      break;
    }
    case "G9": {
      caster.dodgeNextPercent = (ex.dodge_next as number | undefined) ?? 50;
      result.notes.push(`다음 받는 공격 ${caster.dodgeNextPercent}% 회피`);
      break;
    }
    case "G10": {
      const newHand = caster.redrawHand();
      result.drawnCards.push(...newHand.map((c) => c.id));
      break;
    }
    case "G11": {
      const peekCount = (ex.deck_peek as number | undefined) ?? 3;
      const top = caster.deck.slice(-peekCount).reverse();
      result.notes.push(`덱 top: ${top.map((c) => c.id).join(", ")}`);
      caster.nextCritBonus =
        (ex.next_crit_bonus as number | undefined) ?? 20;
      break;
    }
    case "G12": {
      opponent.nextAttackMissChance =
        (ex.force_miss_next as number | undefined) ?? 50;
      result.notes.push(
        `${opponent.name} 다음 공격 ${opponent.nextAttackMissChance}% 강제 miss`,
      );
      break;
    }
    case "G13": {
      const p = ex.poison as { damage: number; turns: number };
      opponent.poisonTurns = p.turns;
      opponent.poisonDamage = p.damage;
      result.notes.push(
        `${opponent.name} 독 ${p.turns}턴 (${p.damage}/턴)`,
      );
      break;
    }
    case "G14": {
      caster.guaranteeNextCrit = true;
      result.notes.push("다음 카드 1장 크리 확정");
      break;
    }

    // ---- 컨트롤러 ----
    case "W9": {
      const gain = (ex.shield as number | undefined) ?? 18;
      caster.shield += gain;
      result.shieldGained += gain;
      break;
    }
    case "W10": {
      result.heal += caster.heal((ex.self_heal as number | undefined) ?? 20);
      break;
    }
    case "W11": {
      result.heal += caster.heal((ex.self_heal as number | undefined) ?? 8);
      cleanseSelf(caster, result);
      break;
    }
    case "W12": {
      const peekCount =
        (ex.opponent_deck_peek as number | undefined) ?? 3;
      const top = opponent.deck.slice(-peekCount).reverse();
      result.notes.push(
        `상대 덱 top: ${top.map((c) => c.id).join(", ")}`,
      );
      caster.dodgeNextPercent =
        (ex.dodge_next as number | undefined) ?? 30;
      break;
    }
    case "W13": {
      const drawn = caster.draw((ex.draw as number | undefined) ?? 2);
      result.drawnCards.push(...drawn.map((c) => c.id));
      break;
    }
    case "W14": {
      caster.incomingDamageMult =
        (ex.negate_ratio as number | undefined) ?? 0.5;
      caster.incomingDamageMultTurns =
        (ex.negate_turns as number | undefined) ?? 3;
      result.notes.push(
        `무효 선언 ${caster.incomingDamageMultTurns}턴 — 받는 데미지 × ${caster.incomingDamageMult}`,
      );
      break;
    }

    default:
      throw new Error(`Utility card ${cid} not handled`);
  }
}

// ======================================================================
//   최상위 dispatcher
// ======================================================================

export interface ExecuteCardOptions {
  bet?: number;
  gameTurn?: number;
  rng?: Rng;
  _doubleDownRepeat?: boolean;
}

export function executeCard(
  card: Card,
  caster: Player,
  opponent: Player,
  options: ExecuteCardOptions = {},
): CardResult {
  const rng = options.rng ?? createRng(null);
  const gameTurn = options.gameTurn ?? 1;
  const isRepeat = options._doubleDownRepeat ?? false;

  if (!isRepeat) {
    validateCardPlay(card, caster, gameTurn);
  }

  const cap = computeBetCap(card, caster);
  const bet = Math.max(0, Math.min(options.bet ?? 0, cap));

  const result = newResult(card.id, caster.name, bet);

  if (card.signature && !isRepeat) {
    caster.sigUsedIds.add(card.id);
    caster.sigUsedThisTurn = true;
  }

  if (bet > 0) {
    caster.spendBet(bet);
  }

  rollDoubleProc(caster, rng, result);

  switch (card.type) {
    case "hit":
      executeHit(card, caster, opponent, bet, result, rng);
      break;
    case "crit":
      executeCrit(card, caster, opponent, bet, result, rng);
      break;
    case "fixed":
      executeFixed(card, caster, opponent, bet, result, rng);
      break;
    case "utility":
      executeUtility(card, caster, opponent, bet, result, rng, gameTurn);
      break;
    default:
      throw new Error(`Unknown card type: ${card.type as string}`);
  }

  if (!isRepeat) {
    caster.lastCard = card;
  }

  return result;
}
