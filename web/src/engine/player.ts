/**
 * Player state. Python `cli/allin/player.py` 1:1 포팅.
 * 상태 보관 + 덱/손패/실드/회복/턴 훅. 카드 효과 해석은 engine.ts.
 */

import { Boon, Card, ClassName, DamageEvent } from "./types";
import { getDeck } from "./data";
import { Rng, createRng } from "./rng";

export const DEFAULT_HP = 100;
export const DEFAULT_HAND_SIZE = 5;
export const DEFAULT_STARTING_HAND = 5;

export interface BeginTurnInfo {
  heal: number;
  poison: number;
  berserkSelfDmg: number;
}

export interface PlayerOptions {
  name: string;
  className: ClassName;
  boon?: Boon | null;
  seed?: number | null;
}

function effectNum(boon: Boon | null, key: string, fallback = 0): number {
  if (!boon) return fallback;
  const v = boon.effect[key];
  return typeof v === "number" ? v : fallback;
}

export class Player {
  readonly name: string;
  readonly className: ClassName;
  readonly boon: Boon | null;

  // 리소스
  maxHp: number;
  hp: number;
  handSize: number;

  // 덱/손패/묘지
  deck: Card[];
  hand: Card[] = [];
  graveyard: Card[] = [];

  // 턴 내 일시 효과
  shield = 0;

  // 다음-1회 효과
  nextAccBonus = 0;
  nextCritBonus = 0;
  guaranteeNextCrit = false;
  dodgeNextPercent = 0;
  nextAttackMissChance = 0;

  // 지속형
  rageStacks = 0;
  poisonTurns = 0;
  poisonDamage = 0;
  silencedCards: string[] = [];
  betCapOverride: number | null = null;
  betCapOverrideTurns = 0;

  // 특수 모드
  berserkTurns = 0;
  berserkAccBonus = 0;
  berserkDamageBonus = 0;

  incomingDamageMult = 1.0;
  incomingDamageMultTurns = 0;

  // 누적 통계
  totalBet = 0;
  totalDamageTaken = 0;
  totalDamageDealt = 0;
  critCount = 0;
  missCount = 0;

  // 추적
  lastCard: Card | null = null;
  missedLastTurn = false;
  private _missedThisTurn = false;
  sigUsedIds = new Set<string>();
  sigUsedThisTurn = false;

  extraCardPerTurn: number;
  lastPeek: Card | null = null; // 워든 패시브 노출

  private rng: Rng;

  constructor(options: PlayerOptions) {
    this.name = options.name;
    this.className = options.className;
    this.boon = options.boon ?? null;
    this.rng = createRng(options.seed ?? null);

    // HP
    this.maxHp = DEFAULT_HP + effectNum(this.boon, "hp_bonus");
    this.hp = this.maxHp;

    // 손패
    this.handSize = effectNum(this.boon, "hand_size", DEFAULT_HAND_SIZE);

    // 덱 셔플
    this.deck = getDeck(this.className);
    this.rng.shuffle(this.deck);

    // BN09
    this.extraCardPerTurn = effectNum(this.boon, "extra_card_per_turn");

    // 시작 손패
    const starting =
      DEFAULT_STARTING_HAND + effectNum(this.boon, "starting_hand_bonus");
    this.draw(starting);
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  // ---- 덱/손패 -----------------------------------------------------------
  draw(n = 1): Card[] {
    const drawn: Card[] = [];
    for (let i = 0; i < n; i++) {
      if (this.deck.length === 0) {
        if (this.graveyard.length === 0) break;
        this.deck = this.graveyard;
        this.graveyard = [];
        this.rng.shuffle(this.deck);
      }
      const card = this.deck.pop()!;
      this.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  fillHand(): Card[] {
    const need = Math.max(0, this.handSize - this.hand.length);
    return this.draw(need);
  }

  discard(card: Card): void {
    const idx = this.hand.indexOf(card);
    if (idx >= 0) this.hand.splice(idx, 1);
    this.graveyard.push(card);
  }

  redrawHand(): Card[] {
    const count = this.hand.length;
    this.graveyard.push(...this.hand);
    this.hand = [];
    return this.draw(count);
  }

  // ---- 피해/회복 ---------------------------------------------------------
  takeDamage(amount: number, opts?: { ignoreShield?: boolean }): DamageEvent {
    const evt: DamageEvent = {
      requested: amount,
      absorbedByShield: 0,
      reducedByBoon: 0,
      dealt: 0,
      dodged: false,
    };
    if (amount <= 0) return evt;
    const ignoreShield = opts?.ignoreShield ?? false;
    let dealt = amount;

    if (!ignoreShield && this.shield > 0) {
      const absorbed = Math.min(this.shield, dealt);
      evt.absorbedByShield = absorbed;
      dealt -= absorbed;
      this.shield -= absorbed; // 🐛 fix: 방어막이 흡수한 만큼 차감
    }

    const dr = effectNum(this.boon, "damage_reduction");
    if (dr > 0 && dealt > 0) {
      const minDmg = effectNum(this.boon, "min_damage", 1);
      const newDealt = Math.max(minDmg, dealt - dr);
      evt.reducedByBoon = dealt - newDealt;
      dealt = newDealt;
    }

    evt.dealt = dealt;
    this.hp -= dealt;
    this.totalDamageTaken += dealt;
    return evt;
  }

  heal(amount: number): number {
    if (amount <= 0 || !this.isAlive()) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  // ---- 턴 훅 --------------------------------------------------------------
  beginTurn(): BeginTurnInfo {
    const info: BeginTurnInfo = { heal: 0, poison: 0, berserkSelfDmg: 0 };

    // 실드 리셋 (상대 턴까지 유지되다가 내 턴 시작 시 0)
    this.shield = 0;

    // BN03 회복의 가호
    const hpt = effectNum(this.boon, "heal_per_turn");
    if (hpt > 0) {
      info.heal += this.heal(hpt);
    }

    // B15 베르세르크 자해
    if (this.berserkTurns > 0) {
      const selfDmg = 5;
      const before = this.hp;
      this.hp = Math.max(0, this.hp - selfDmg);
      info.berserkSelfDmg = before - this.hp;
      this.berserkTurns -= 1;
      if (this.berserkTurns === 0) {
        this.berserkAccBonus = 0;
        this.berserkDamageBonus = 0;
      }
    }

    // 독
    if (this.poisonTurns > 0) {
      const evt = this.takeDamage(this.poisonDamage, { ignoreShield: true });
      info.poison = evt.dealt;
      this.poisonTurns -= 1;
      if (this.poisonTurns === 0) this.poisonDamage = 0;
    }

    this._missedThisTurn = false;
    this.sigUsedThisTurn = false;

    return info;
  }

  endTurn(): void {
    this.missedLastTurn = this._missedThisTurn;

    if (this.betCapOverrideTurns > 0) {
      this.betCapOverrideTurns -= 1;
      if (this.betCapOverrideTurns === 0) this.betCapOverride = null;
    }

    if (this.incomingDamageMultTurns > 0) {
      this.incomingDamageMultTurns -= 1;
      if (this.incomingDamageMultTurns === 0) this.incomingDamageMult = 1.0;
    }

    this.silencedCards = [];
  }

  // ---- 유틸 ---------------------------------------------------------------
  recordMiss(): void {
    this.missCount += 1;
    this._missedThisTurn = true;
  }

  recordHit(damage: number, critical = false): void {
    this.totalDamageDealt += damage;
    if (critical) this.critCount += 1;
  }

  spendBet(amount: number): number {
    if (amount <= 0) return 0;
    this.hp -= amount;
    this.totalBet += amount;

    let refunded = 0;
    const ratio = effectNum(this.boon, "bet_refund_ratio");
    if (ratio > 0) {
      refunded = Math.floor(amount * ratio);
      this.heal(refunded);
    }
    return amount - refunded;
  }

  maxCardsPerTurn(): number {
    return 2 + this.extraCardPerTurn;
  }
}
