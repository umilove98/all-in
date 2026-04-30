/**
 * MatchEngine — 한 매치(2인 1:1) 의 게임 진행 상태머신.
 *
 * 기존 Room DO 에 박혀있던 매치 로직(coin_toss → pick_class → pick_boon →
 * battle → ended) 을 WebSocket/broadcast 의존 없이 추출한 순수 클래스.
 * Room 과 TournamentRoom 둘 다 이 클래스를 인스턴스화해 사용.
 *
 * 외부와의 통신은 생성 시 주입받는 `MatchEngineHooks` 콜백으로만.
 * 1:1 에서는 hooks 가 직접 broadcast 호출, 토너먼트에서는 t_match_event
 * 로 감싼 뒤 매치 참가자/관전자에게 라우팅.
 *
 * playerId 는 매치 안 플레이어 식별자. 1:1 에서는 connectionId, 토너먼트
 * 에서는 participantId. MatchEngine 입장에서는 그냥 문자열 키.
 */

import {
  CLASS_NAMES,
  ClassName,
  Game,
  InvalidPlayError,
  MAX_TURNS,
  Player,
  computeCritChance,
  computeHitAccuracy,
  createRng,
  executeCard,
  getAllBoons,
  getBoonById,
} from "../src/engine";
import {
  CardPlayedMsg,
  EndReason,
  PlayerPublic,
  PlayerStatsPublic,
} from "../src/net/protocol";
import { MatchPhase } from "../src/net/tournament-protocol";

interface MatchSlot {
  playerId: string;
  name: string;
  className: ClassName | null;
  boonId: string | null;
  boonOptions: string[];
  boonRerollsLeft: number;
  player: Player | null;
}

/** MatchEngine 이 외부 세계로 내보내는 이벤트들. */
export interface MatchEngineHooks {
  /** 매치 phase 가 바뀔 때마다 호출. broadcast 트리거(1:1 에서는 broadcastRoom). */
  onPhaseChange(phase: MatchPhase): void;
  /** 코인토스 결과. firstPickId = 선픽 playerId. broadcastAll. */
  onCoinToss(firstPickId: string): void;
  /** 직업 선택 옵션 (미러 금지로 비활성화 카드). 본인에게만 sendToId. */
  onClassOptions(playerId: string, disabled: ClassName[]): void;
  /** 부운 후보 (3장). 본인에게만 sendToId. */
  onBoonOptions(playerId: string, options: string[]): void;
  /** 손패 갱신. 본인에게만 sendToId. */
  onHand(playerId: string, hand: import("../src/engine").Card[], silenced: string[]): void;
  /** 카드 시전 결과. broadcastAll. */
  onCardPlayed(evt: CardPlayedMsg): void;
  /** 턴 전환. broadcastAll. */
  onTurnChanged(activeId: string, turn: number): void;
  /** 덱/묘지 열람 응답. 요청자에게만 sendToId. */
  onPile(
    playerId: string,
    payload: {
      side: "me" | "opp";
      kind: "deck" | "grave";
      cardIds: string[] | null;
    },
  ): void;
  /** 매치 종료. winnerId=null 이면 무승부. broadcastAll + 후처리 트리거. */
  onEnd(
    winnerId: string | null,
    reason: EndReason,
    p1Stats: PlayerStatsPublic,
    p2Stats: PlayerStatsPublic,
  ): void;
}

export class MatchEngine {
  private slots = new Map<string, MatchSlot>();
  /** 입장 순. 코인토스/공개 정보 순서 결정. */
  private slotOrder: string[] = [];
  private firstPickId: string | null = null;
  private game: Game | null = null;
  private cardsUsedThisTurn = 0;
  private _phase: MatchPhase = "coin_toss";
  private _winnerId: string | null = null;
  /** 외부 RNG 시드 — 테스트 결정성용. 미지정 시 Date.now() 기반. */
  private readonly rngSeedBase: number;

  constructor(
    p1Id: string,
    p2Id: string,
    names: { p1: string; p2: string },
    private readonly hooks: MatchEngineHooks,
    rngSeedBase?: number,
  ) {
    this.rngSeedBase = rngSeedBase ?? Date.now();
    this.addSlot(p1Id, names.p1);
    this.addSlot(p2Id, names.p2);
  }

  private addSlot(playerId: string, name: string) {
    if (this.slots.has(playerId)) return;
    this.slots.set(playerId, {
      playerId,
      name: name || `Player-${this.slots.size + 1}`,
      className: null,
      boonId: null,
      boonOptions: [],
      boonRerollsLeft: 0,
      player: null,
    });
    this.slotOrder.push(playerId);
  }

  // =========================================================
  // 외부 read 인터페이스
  // =========================================================

  get phase(): MatchPhase {
    return this._phase;
  }

  get winnerId(): string | null {
    return this._winnerId;
  }

  get firstPick(): string | null {
    return this.firstPickId;
  }

  /** 현재 활성(턴) 플레이어 ID. battle 단계에서만 유의미. */
  getActivePlayerId(): string | null {
    if (!this.game) return null;
    const active = this.game.current;
    for (const [id, slot] of this.slots) {
      if (slot.player === active) return id;
    }
    return null;
  }

  /** broadcastRoom 용 — 슬롯 순서대로 public 정보. */
  getPlayerPublics(): PlayerPublic[] {
    return this.slotOrder
      .map((id) => this.slots.get(id))
      .filter((s): s is MatchSlot => !!s)
      .map((s) => slotToPublic(s));
  }

  /** 게임의 현재 turn 번호 (battle 시작 후). */
  getTurn(): number {
    return this.game?.turn ?? 0;
  }

  // =========================================================
  // Phase 1: 코인토스
  // =========================================================

  startCoinToss(): void {
    const rng = createRng(this.rngSeedBase ^ this.slots.size);
    const idx = rng.randint(0, 1);
    this.firstPickId = this.slotOrder[idx]!;
    this._phase = "pick_class";

    this.hooks.onCoinToss(this.firstPickId);
    this.hooks.onPhaseChange("pick_class");
    this.hooks.onClassOptions(this.firstPickId, []);
  }

  // =========================================================
  // Phase 2: 직업 선택
  // =========================================================

  pickClass(playerId: string, className: ClassName): void {
    if (this._phase !== "pick_class") {
      throw new Error("지금은 직업 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(playerId);
    if (!slot) throw new Error("매치에 참가하지 않았습니다.");
    if (slot.className) throw new Error("이미 직업을 선택했습니다.");
    if (!CLASS_NAMES.includes(className)) {
      throw new Error(`알 수 없는 직업: ${className}`);
    }

    const isFirstPick = playerId === this.firstPickId;
    const other = this.getOtherSlot(playerId);

    if (!isFirstPick && !other?.className) {
      throw new Error("선픽이 먼저 선택해야 합니다.");
    }
    if (other?.className === className) {
      throw new Error("미러전 금지. 다른 직업을 선택하세요.");
    }

    slot.className = className;
    this.hooks.onPhaseChange(this._phase); // class 표시 갱신용

    if (isFirstPick) {
      const otherId = this.getOtherId(playerId);
      if (otherId) {
        const disabled: ClassName[] = [className];
        this.hooks.onClassOptions(otherId, disabled);
      }
    } else {
      this.startBoonPick();
    }
  }

  // =========================================================
  // Phase 3: 부운 픽
  // =========================================================

  private startBoonPick(): void {
    this._phase = "pick_boon";
    const rng = createRng(this.rngSeedBase ^ this.slots.size ^ 0x1f1f);
    const boons = getAllBoons();

    for (const slot of this.slots.values()) {
      const options = rng.sample(boons, 3).map((b) => b.id);
      slot.boonOptions = options;
      slot.boonRerollsLeft = slot.className === "gambler" ? 1 : 0;
      this.hooks.onBoonOptions(slot.playerId, options);
    }

    this.hooks.onPhaseChange("pick_boon");
  }

  rerollBoon(playerId: string): void {
    if (this._phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(playerId);
    if (!slot) throw new Error("매치에 참가하지 않았습니다.");
    if (slot.className !== "gambler") {
      throw new Error("리롤은 도박사 패시브입니다.");
    }
    if (slot.boonId) throw new Error("이미 행운아이템을 선택했습니다.");
    if (slot.boonRerollsLeft <= 0) {
      throw new Error("리롤 횟수가 남아있지 않습니다.");
    }
    slot.boonRerollsLeft -= 1;

    const rng = createRng(this.rngSeedBase ^ playerId.length ^ Date.now());
    const boons = getAllBoons();
    const options = rng.sample(boons, 3).map((b) => b.id);
    slot.boonOptions = options;

    this.hooks.onBoonOptions(playerId, options);
    this.hooks.onPhaseChange(this._phase); // 리롤 횟수 변동 broadcast 용
  }

  pickBoon(playerId: string, boonId: string): void {
    if (this._phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(playerId);
    if (!slot) throw new Error("매치에 참가하지 않았습니다.");
    if (slot.boonId) throw new Error("이미 행운아이템을 선택했습니다.");
    if (!slot.boonOptions.includes(boonId)) {
      throw new Error(`제시되지 않은 행운아이템: ${boonId}`);
    }
    try {
      getBoonById(boonId);
    } catch {
      throw new Error(`존재하지 않는 행운아이템: ${boonId}`);
    }

    slot.boonId = boonId;
    this.hooks.onPhaseChange(this._phase);

    const allPicked = [...this.slots.values()].every((s) => s.boonId);
    if (allPicked) {
      this.startBattle();
    }
  }

  // =========================================================
  // Phase 4: 전투 시작
  // =========================================================

  private startBattle(): void {
    if (!this.firstPickId) throw new Error("선픽이 결정되지 않았습니다.");
    const firstSlot = this.slots.get(this.firstPickId);
    const secondSlot = this.getOtherSlot(this.firstPickId);
    if (!firstSlot || !secondSlot) throw new Error("슬롯 부족.");
    if (!firstSlot.className || !secondSlot.className) {
      throw new Error("직업 미선택.");
    }
    if (!firstSlot.boonId || !secondSlot.boonId) {
      throw new Error("행운아이템 미선택.");
    }

    const rng = createRng(this.rngSeedBase ^ 0x9e3779b1);

    firstSlot.player = new Player({
      name: firstSlot.name,
      className: firstSlot.className,
      boon: getBoonById(firstSlot.boonId),
      seed: rng.randint(0, 2 ** 30),
    });
    secondSlot.player = new Player({
      name: secondSlot.name,
      className: secondSlot.className,
      boon: getBoonById(secondSlot.boonId),
      seed: rng.randint(0, 2 ** 30),
    });

    this.game = new Game(
      firstSlot.player,
      secondSlot.player,
      undefined,
      undefined,
      { seed: rng.randint(0, 2 ** 30) },
    );

    this._phase = "battle";
    this.hooks.onPhaseChange("battle");

    this.startTurn();
  }

  // =========================================================
  // Phase 5: 턴 진행
  // =========================================================

  private startTurn(): void {
    if (!this.game) return;
    this.game.turn += 1;
    const current = this.game.current;
    const opponent = this.game.opponentOf(current);

    current.beginTurn();
    current.fillHand();
    this.cardsUsedThisTurn = 0;

    // 컨트롤러(워든) 패시브 — 상대 손패 1장 침묵
    if (opponent.className === "warden" && current.hand.length > 0) {
      const candidates = current.hand.filter(
        (c) => !current.silencedCards.includes(c.id),
      );
      if (candidates.length > 0) {
        const silenced = this.game.rng.choice(candidates);
        current.silencedCards.push(silenced.id);
      }
    }

    if (this.checkBattleEnd()) return;

    this.sendHandsToAll();

    const activeId = this.getActivePlayerId();
    if (activeId) {
      this.hooks.onTurnChanged(activeId, this.game.turn);
    }
    this.hooks.onPhaseChange(this._phase);
  }

  playCard(playerId: string, cardId: string, bet: number): void {
    if (this._phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(playerId);
    if (!slot || !slot.player) throw new Error("참가하지 않았습니다.");
    if (this.game.current !== slot.player) {
      throw new Error("당신 턴이 아닙니다.");
    }
    if (this.cardsUsedThisTurn >= slot.player.maxCardsPerTurn()) {
      throw new Error("이번 턴 카드 사용 가능 횟수를 초과했습니다.");
    }

    const card = slot.player.hand.find((c) => c.id === cardId);
    if (!card) throw new Error(`손패에 ${cardId} 가 없습니다.`);

    const opponent = this.game.opponentOf(slot.player);

    // 룰렛 연출용 사전 스냅샷
    const clampedBet = Math.max(0, Math.min(bet, card.maxBet));
    const isCritCard = card.type === "crit";
    const hitAcc =
      isCritCard || card.type === "hit"
        ? computeHitAccuracy(card, slot.player, opponent, clampedBet)
        : undefined;
    const accUsed =
      hitAcc ?? (card.type === "fixed" ? 100 : undefined);
    const critChanceUsed = isCritCard
      ? slot.player.guaranteeNextCrit
        ? hitAcc
        : computeCritChance(card, slot.player, opponent, clampedBet)
      : undefined;

    let result;
    try {
      result = executeCard(card, slot.player, opponent, {
        bet,
        gameTurn: this.game.turn,
        rng: this.game.rng,
      });
    } catch (err) {
      if (err instanceof InvalidPlayError) {
        throw new Error(err.message);
      }
      throw err;
    }
    slot.player.discard(card);
    this.cardsUsedThisTurn += 1;

    this.hooks.onCardPlayed({
      type: "card_played",
      by: slot.playerId,
      cardId: card.id,
      cardName: card.name,
      bet: result.bet,
      success: result.success,
      critical: result.critical,
      damageToOpponent: result.damageToOpponent,
      damageToSelf: result.damageToSelf,
      heal: result.heal,
      shieldGained: result.shieldGained,
      notes: result.notes,
      jackpotRoll: result.jackpotRoll,
      accUsed,
      critChanceUsed,
      bluffChance: result.bluffChance,
      bluffTriggered: result.bluffTriggered,
      dodgeChance: result.dodgeChance,
      dodged: result.dodged,
    });

    this.sendHandsToAll();
    this.hooks.onPhaseChange(this._phase);

    if (this.checkBattleEnd()) return;
  }

  endTurn(playerId: string): void {
    if (this._phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(playerId);
    if (!slot || !slot.player) throw new Error("참가하지 않았습니다.");
    if (this.game.current !== slot.player) {
      throw new Error("당신 턴이 아닙니다.");
    }
    this.finishCurrentTurn();
  }

  private finishCurrentTurn(): void {
    if (!this.game) return;
    const current = this.game.current;
    current.endTurn();

    if (this.checkBattleEnd()) return;

    this.game.current = this.game.opponentOf(current);
    this.startTurn();
  }

  // =========================================================
  // 종료 판정
  // =========================================================

  private checkBattleEnd(): boolean {
    if (!this.game) return false;
    const { p1, p2 } = this.game;

    if (!p1.isAlive() && !p2.isAlive()) {
      this.endBattle(null, "mutual_hp_zero");
      return true;
    }
    if (!p1.isAlive()) {
      this.endBattle(p2, "hp_zero");
      return true;
    }
    if (!p2.isAlive()) {
      this.endBattle(p1, "hp_zero");
      return true;
    }
    if (this.game.turn >= MAX_TURNS) {
      if (p1.hp > p2.hp) this.endBattle(p1, "turn_limit");
      else if (p2.hp > p1.hp) this.endBattle(p2, "turn_limit");
      else this.endBattle(null, "turn_limit_draw");
      return true;
    }
    return false;
  }

  private endBattle(winner: Player | null, reason: EndReason): void {
    this._phase = "ended";
    this._winnerId = winner ? this.getPlayerIdOf(winner) : null;

    const [p1Slot, p2Slot] = this.slotOrder
      .map((id) => this.slots.get(id))
      .filter((s): s is MatchSlot => !!s);
    const p1 = p1Slot?.player;
    const p2 = p2Slot?.player;

    this.hooks.onPhaseChange("ended");
    this.hooks.onEnd(
      this._winnerId,
      reason,
      slotToStats(p1Slot!, p1!),
      slotToStats(p2Slot!, p2!),
    );
  }

  // =========================================================
  // 손패 / 덱 열람
  // =========================================================

  private sendHandsToAll(): void {
    for (const slot of this.slots.values()) {
      if (slot.player) {
        this.hooks.onHand(
          slot.playerId,
          slot.player.hand,
          [...slot.player.silencedCards],
        );
      }
    }
  }

  viewPile(
    playerId: string,
    side: "me" | "opp",
    kind: "deck" | "grave",
  ): void {
    if (this._phase !== "battle") return;
    const senderSlot = this.slots.get(playerId);
    if (!senderSlot?.player) return;

    if (side === "opp" && kind === "deck") {
      this.hooks.onPile(playerId, { side, kind, cardIds: null });
      return;
    }

    const targetSlot =
      side === "me" ? senderSlot : this.getOtherSlot(playerId);
    if (!targetSlot?.player) return;

    const source =
      kind === "deck" ? targetSlot.player.deck : targetSlot.player.graveyard;
    this.hooks.onPile(playerId, {
      side,
      kind,
      cardIds: source.map((c) => c.id),
    });
  }

  // =========================================================
  // 유틸
  // =========================================================

  private getOtherId(playerId: string): string | null {
    for (const id of this.slotOrder) {
      if (id !== playerId) return id;
    }
    return null;
  }

  private getOtherSlot(playerId: string): MatchSlot | null {
    const other = this.getOtherId(playerId);
    return other ? (this.slots.get(other) ?? null) : null;
  }

  private getPlayerIdOf(player: Player): string | null {
    for (const [id, slot] of this.slots) {
      if (slot.player === player) return id;
    }
    return null;
  }
}

// =========================================================
// 슬롯 → 외부 표현 변환
// =========================================================

function slotToPublic(slot: MatchSlot): PlayerPublic {
  const p = slot.player;
  return {
    connectionId: slot.playerId,
    name: slot.name,
    ready: true,
    className: slot.className,
    boonId: slot.boonId,
    boonRerollsLeft: slot.boonRerollsLeft,
    hp: p?.hp ?? 100,
    maxHp: p?.maxHp ?? 100,
    shield: p?.shield ?? 0,
    handCount: p?.hand.length ?? 0,
    deckCount: p?.deck.length ?? 0,
    graveyardCount: p?.graveyard.length ?? 0,
    maxCardsPerTurn: p?.maxCardsPerTurn() ?? 2,
    totalBet: p?.totalBet ?? 0,
    totalDamageTaken: p?.totalDamageTaken ?? 0,
    missedLastTurn: p?.missedLastTurn ?? false,
    hitLastTurn: p?.hitLastTurn ?? false,
    statuses: {
      poisonTurns: p?.poisonTurns ?? 0,
      poisonDamage: p?.poisonDamage ?? 0,
      rageStacks: p?.rageStacks ?? 0,
      berserkTurns: p?.berserkTurns ?? 0,
      berserkAccBonus: p?.berserkAccBonus ?? 0,
      berserkDamageBonus: p?.berserkDamageBonus ?? 0,
      incomingDamageMult: p?.incomingDamageMult ?? 1.0,
      incomingDamageMultTurns: p?.incomingDamageMultTurns ?? 0,
      betCapOverride: p?.betCapOverride ?? null,
      betCapOverrideTurns: p?.betCapOverrideTurns ?? 0,
      nextAccBonus: p?.nextAccBonus ?? 0,
      nextCritBonus: p?.nextCritBonus ?? 0,
      guaranteeNextCrit: p?.guaranteeNextCrit ?? false,
      dodgeNextPercent: p?.dodgeNextPercent ?? 0,
      nextAttackMissChance: p?.nextAttackMissChance ?? 0,
      silencedCardCount: p?.silencedCards.length ?? 0,
      sigUsedIds: p ? Array.from(p.sigUsedIds) : [],
      sigUsedThisTurn: p?.sigUsedThisTurn ?? false,
    },
  };
}

function slotToStats(slot: MatchSlot, p: Player): PlayerStatsPublic {
  return {
    connectionId: slot.playerId,
    name: slot.name,
    totalBet: p.totalBet,
    totalDamageDealt: p.totalDamageDealt,
    totalDamageTaken: p.totalDamageTaken,
    critCount: p.critCount,
    missCount: p.missCount,
    finalHp: p.hp,
  };
}
