/**
 * PartyKit 서버. 방 = 1 Durable Object 인스턴스.
 * 상태 머신: lobby → coin_toss → pick_class → pick_boon → battle → ended.
 *
 * W6: 방 생성/참가/레쥬.
 * W7: coin_toss → pick_class → pick_boon → battle 시작.
 * W8: 턴 진행 (play_card / end_turn).
 */

import type * as Party from "partykit/server";

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
  ClientMsg,
  EndReason,
  MAX_PLAYERS_PER_ROOM,
  Phase,
  PlayerPublic,
  PlayerStatsPublic,
  ServerMsg,
} from "../src/net/protocol";

interface PlayerSlot {
  connectionId: string;
  name: string;
  className: ClassName | null;
  boonId: string | null;
  boonOptions: string[]; // 본인에게 제시된 부운 후보
  boonRerollsLeft: number; // 도박사 패시브 — 리롤 남은 횟수
  player: Player | null;
}

export default class AllinServer implements Party.Server {
  private phase: Phase = "lobby";
  private slots = new Map<string, PlayerSlot>();
  private slotOrder: string[] = [];
  private firstPickId: string | null = null;
  private game: Game | null = null;
  private cardsUsedThisTurn = 0;
  private winnerId: string | null = null;

  constructor(readonly room: Party.Room) {}

  // =========================================================
  // 연결 관리
  // =========================================================

  onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    if (this.slots.size >= MAX_PLAYERS_PER_ROOM) {
      this.sendTo(conn, {
        type: "error",
        message: "방이 가득 찼습니다 (2/2).",
      });
      conn.close();
      return;
    }
    if (this.phase !== "lobby") {
      this.sendTo(conn, {
        type: "error",
        message: "이미 게임이 진행 중입니다.",
      });
      conn.close();
      return;
    }
    this.sendTo(conn, {
      type: "connected",
      connectionId: conn.id,
      roomId: this.room.id,
    });
    this.broadcastRoom();
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      this.sendTo(sender, { type: "error", message: "JSON 파싱 실패" });
      return;
    }

    try {
      this.dispatch(msg, sender);
    } catch (err) {
      this.sendTo(sender, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onClose(conn: Party.Connection) {
    this.handleLeave(conn);
  }

  private dispatch(msg: ClientMsg, sender: Party.Connection) {
    switch (msg.type) {
      case "join":
        this.handleJoin(sender, msg.name);
        break;
      case "leave":
        this.handleLeave(sender);
        break;
      case "pick_class":
        this.handlePickClass(sender, msg.className);
        break;
      case "pick_boon":
        this.handlePickBoon(sender, msg.boonId);
        break;
      case "reroll_boon":
        this.handleRerollBoon(sender);
        break;
      case "play_card":
        this.handlePlayCard(sender, msg.cardId, msg.bet);
        break;
      case "end_turn":
        this.handleEndTurn(sender);
        break;
      case "rematch":
        this.handleRematch(sender);
        break;
      case "view_pile":
        this.handleViewPile(sender, msg.side, msg.kind);
        break;
      default: {
        // @ts-expect-error exhaustive
        const t = msg.type as string;
        this.sendTo(sender, {
          type: "error",
          message: `알 수 없는 메시지 타입: ${t}`,
        });
      }
    }
  }

  // =========================================================
  // 핸들러: join / leave
  // =========================================================

  private handleJoin(conn: Party.Connection, name: string) {
    let slot = this.slots.get(conn.id);
    if (slot) {
      slot.name = trimName(name);
      this.broadcastRoom();
      return;
    }
    if (this.slots.size >= MAX_PLAYERS_PER_ROOM) {
      this.sendTo(conn, { type: "error", message: "방이 가득 찼습니다." });
      return;
    }
    slot = {
      connectionId: conn.id,
      name: trimName(name) || `Player-${this.slots.size + 1}`,
      className: null,
      boonId: null,
      boonOptions: [],
      boonRerollsLeft: 0,
      player: null,
    };
    this.slots.set(conn.id, slot);
    this.slotOrder.push(conn.id);
    this.broadcastRoom();

    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startCoinToss();
    }
  }

  private handleLeave(conn: Party.Connection) {
    if (!this.slots.has(conn.id)) return;
    this.slots.delete(conn.id);
    this.slotOrder = this.slotOrder.filter((id) => id !== conn.id);

    if (this.phase !== "lobby") {
      this.resetRoom();
    }
    this.broadcastRoom();
  }

  private resetRoom() {
    this.phase = "lobby";
    this.firstPickId = null;
    this.game = null;
    this.cardsUsedThisTurn = 0;
    this.winnerId = null;
    for (const slot of this.slots.values()) {
      slot.className = null;
      slot.boonId = null;
      slot.boonOptions = [];
      slot.boonRerollsLeft = 0;
      slot.player = null;
    }
  }

  // =========================================================
  // 매치 시퀀스: 코인토스
  // =========================================================

  private startCoinToss() {
    const rng = createRng(Date.now() ^ this.slots.size);
    const idx = rng.randint(0, 1);
    this.firstPickId = this.slotOrder[idx]!;
    this.phase = "pick_class";

    this.room.broadcast(
      json<ServerMsg>({
        type: "coin_toss",
        firstPickId: this.firstPickId,
      }),
    );
    this.broadcastRoom();

    // 선픽에게 클래스 옵션 전송 (후픽은 선픽 이후에 받음)
    this.sendClassOptions(this.firstPickId);
  }

  private sendClassOptions(connectionId: string) {
    const other = this.getOtherSlot(connectionId);
    const disabled = other?.className ? [other.className] : [];
    this.sendToId(connectionId, {
      type: "class_options",
      disabled,
    });
  }

  private handlePickClass(sender: Party.Connection, className: ClassName) {
    if (this.phase !== "pick_class") {
      throw new Error("지금은 직업 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(sender.id);
    if (!slot) throw new Error("방에 참가하지 않았습니다.");
    if (slot.className) throw new Error("이미 직업을 선택했습니다.");
    if (!CLASS_NAMES.includes(className)) {
      throw new Error(`알 수 없는 직업: ${className}`);
    }

    const isFirstPick = sender.id === this.firstPickId;
    const other = this.getOtherSlot(sender.id);

    if (!isFirstPick && !other?.className) {
      throw new Error("선픽이 먼저 선택해야 합니다.");
    }
    if (other?.className === className) {
      throw new Error("미러전 금지. 다른 직업을 선택하세요.");
    }

    slot.className = className;
    this.broadcastRoom();

    if (isFirstPick) {
      // 후픽에게 (선픽 결과 반영된) 옵션 전송
      const otherId = this.getOtherId(sender.id);
      if (otherId) this.sendClassOptions(otherId);
    } else {
      this.startBoonPick();
    }
  }

  // =========================================================
  // 매치 시퀀스: 부운 픽
  // =========================================================

  private startBoonPick() {
    this.phase = "pick_boon";
    const rng = createRng(Date.now() ^ this.slots.size);
    const boons = getAllBoons();

    for (const slot of this.slots.values()) {
      // 모든 직업 동일하게 3개 제시. 도박사는 추가로 리롤 1회.
      const options = rng.sample(boons, 3).map((b) => b.id);
      slot.boonOptions = options;
      slot.boonRerollsLeft = slot.className === "gambler" ? 1 : 0;
      this.sendToId(slot.connectionId, {
        type: "boon_options",
        options,
      });
    }

    this.broadcastRoom();
  }

  private handleRerollBoon(sender: Party.Connection) {
    if (this.phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(sender.id);
    if (!slot) throw new Error("방에 참가하지 않았습니다.");
    if (slot.className !== "gambler") {
      throw new Error("리롤은 도박사 패시브입니다.");
    }
    if (slot.boonId) throw new Error("이미 행운아이템을 선택했습니다.");
    if (slot.boonRerollsLeft <= 0) {
      throw new Error("리롤 횟수가 남아있지 않습니다.");
    }
    slot.boonRerollsLeft -= 1;

    const rng = createRng(Date.now() ^ sender.id.length);
    const boons = getAllBoons();
    const options = rng.sample(boons, 3).map((b) => b.id);
    slot.boonOptions = options;

    this.sendToId(slot.connectionId, {
      type: "boon_options",
      options,
    });
    this.broadcastRoom();
  }

  private handlePickBoon(sender: Party.Connection, boonId: string) {
    if (this.phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(sender.id);
    if (!slot) throw new Error("방에 참가하지 않았습니다.");
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
    this.broadcastRoom();

    const allPicked = [...this.slots.values()].every((s) => s.boonId);
    if (allPicked) {
      this.startBattle();
    }
  }

  // =========================================================
  // 매치 시퀀스: 전투 시작
  // =========================================================

  private startBattle() {
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

    const rng = createRng(Date.now());

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

    // Game 인스턴스는 상태 보관/turn 관리용. step()/run() 은 호출하지 않음.
    // 서버가 클라의 play_card/end_turn 메시지를 받아 수동으로 진행 (W8).
    this.game = new Game(firstSlot.player, secondSlot.player, undefined, undefined, {
      seed: rng.randint(0, 2 ** 30),
    });

    this.phase = "battle";
    this.broadcastRoom();

    // 첫 턴 시작 훅
    this.startTurn();
  }

  // =========================================================
  // 전투: 턴 진행
  // =========================================================

  private startTurn() {
    if (!this.game) return;
    this.game.turn += 1;
    const current = this.game.current;
    const opponent = this.game.opponentOf(current);

    // 턴 시작 훅
    current.beginTurn();
    current.fillHand();
    this.cardsUsedThisTurn = 0;

    // 컨트롤러(워든) 패시브 — 상대 턴 시작마다 상대 손패 중 랜덤 1장 침묵.
    // W3 등으로 이미 침묵된 카드는 후보에서 제외 → 항상 새 카드 1장 추가 침묵.
    if (opponent.className === "warden" && current.hand.length > 0) {
      const candidates = current.hand.filter(
        (c) => !current.silencedCards.includes(c.id),
      );
      if (candidates.length > 0) {
        const silenced = this.game.rng.choice(candidates);
        current.silencedCards.push(silenced.id);
      }
    }

    // 독/베르세르크로 죽었을 가능성
    if (this.checkBattleEnd()) return;

    // hand 본인에게 전송
    this.sendHandsToAll();

    // 턴 전환 브로드캐스트
    const activeId = this.getActiveConnectionId();
    if (activeId) {
      this.room.broadcast(
        json<ServerMsg>({
          type: "turn_changed",
          activeId,
          turn: this.game.turn,
        }),
      );
    }
    this.broadcastRoom();
  }

  private handlePlayCard(
    sender: Party.Connection,
    cardId: string,
    bet: number,
  ) {
    if (this.phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(sender.id);
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

    // 룰렛 연출용 — 버프/부운/베팅 반영된 실제 판정 수치를 executeCard 호출
    // 전에 스냅샷. 소모성 버프(nextAccBonus 등)가 executeCard 중 0 으로 리셋되므로
    // 반드시 사전 계산.
    const clampedBet = Math.max(0, Math.min(bet, card.maxBet));
    const accUsed =
      card.type === "hit" || card.type === "crit"
        ? computeHitAccuracy(card, slot.player, opponent, clampedBet)
        : card.type === "fixed"
          ? 100
          : undefined;
    const critChanceUsed =
      card.type === "crit"
        ? computeCritChance(card, slot.player, opponent, clampedBet)
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

    // 결과 브로드캐스트
    this.room.broadcast(
      json<ServerMsg>({
        type: "card_played",
        by: slot.connectionId,
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
      }),
    );

    // 손패/상태 갱신
    this.sendHandsToAll();
    this.broadcastRoom();

    if (this.checkBattleEnd()) return;
    // 카드 사용 상한 도달해도 자동 종료하지 않음 — 명시적 end_turn 만 인정.
  }

  private handleEndTurn(sender: Party.Connection) {
    if (this.phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(sender.id);
    if (!slot || !slot.player) throw new Error("참가하지 않았습니다.");
    if (this.game.current !== slot.player) {
      throw new Error("당신 턴이 아닙니다.");
    }
    this.finishCurrentTurn();
  }

  private finishCurrentTurn() {
    if (!this.game) return;
    const current = this.game.current;
    current.endTurn();

    if (this.checkBattleEnd()) return;

    // 턴 교대
    this.game.current = this.game.opponentOf(current);
    this.startTurn();
  }

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

  private endBattle(winner: Player | null, reason: EndReason) {
    this.phase = "ended";
    this.winnerId = winner ? this.getConnectionIdOf(winner) : null;

    const [p1Slot, p2Slot] = this.slotOrder
      .map((id) => this.slots.get(id))
      .filter((s): s is PlayerSlot => !!s);
    const p1 = p1Slot?.player;
    const p2 = p2Slot?.player;

    this.room.broadcast(
      json<ServerMsg>({
        type: "ended",
        winnerId: this.winnerId,
        reason,
        p1Stats: toStats(p1Slot!, p1!),
        p2Stats: toStats(p2Slot!, p2!),
      }),
    );
    this.broadcastRoom();
  }

  private handleRematch(_sender: Party.Connection) {
    // 단순화: 누구라도 rematch 요청 시 방 리셋. 로비로 돌아감.
    // 실제 양쪽 동의 로직은 W14 (종료 화면) 에서.
    if (this.phase !== "ended") {
      throw new Error("종료 상태에서만 재대전 가능");
    }
    this.resetRoom();
    this.broadcastRoom();
    // 2명 슬롯 그대로면 다시 coin_toss
    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startCoinToss();
    }
  }

  /**
   * 요청자에게 덱/묘지 카드 목록을 보낸다. 프라이버시:
   *  - 내 덱/묘지, 상대 묘지 → 카드 ID 목록
   *  - 상대 덱 → null (숨김)
   * 전투 단계 밖에선 무시.
   */
  private handleViewPile(
    sender: Party.Connection,
    side: "me" | "opp",
    kind: "deck" | "grave",
  ) {
    if (this.phase !== "battle") return;
    const senderSlot = this.slots.get(sender.id);
    if (!senderSlot?.player) return;

    if (side === "opp" && kind === "deck") {
      this.sendToId(sender.id, {
        type: "pile",
        side,
        kind,
        cardIds: null,
      });
      return;
    }

    const targetSlot =
      side === "me" ? senderSlot : this.getOtherSlot(sender.id);
    if (!targetSlot?.player) return;

    const source =
      kind === "deck" ? targetSlot.player.deck : targetSlot.player.graveyard;
    this.sendToId(sender.id, {
      type: "pile",
      side,
      kind,
      cardIds: source.map((c) => c.id),
    });
  }

  // =========================================================
  // 손패 전송
  // =========================================================

  private sendHandsToAll() {
    for (const slot of this.slots.values()) {
      if (slot.player) {
        this.sendToId(slot.connectionId, {
          type: "hand",
          hand: slot.player.hand,
          silenced: [...slot.player.silencedCards],
        });
      }
    }
  }

  private getConnectionIdOf(player: Player): string | null {
    for (const [id, slot] of this.slots) {
      if (slot.player === player) return id;
    }
    return null;
  }

  // =========================================================
  // 브로드캐스트
  // =========================================================

  private broadcastRoom() {
    const players: PlayerPublic[] = this.slotOrder
      .map((id) => this.slots.get(id))
      .filter((s): s is PlayerSlot => !!s)
      .map((s) => this.toPublic(s));

    this.room.broadcast(
      json<ServerMsg>({
        type: "room",
        phase: this.phase,
        players,
        firstPickId: this.firstPickId,
        activeId: this.game ? this.getActiveConnectionId() : null,
        turn: this.game?.turn ?? 0,
      }),
    );
  }

  private toPublic(slot: PlayerSlot): PlayerPublic {
    const p = slot.player;
    return {
      connectionId: slot.connectionId,
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

  private getActiveConnectionId(): string | null {
    if (!this.game) return null;
    const active = this.game.current;
    for (const [id, slot] of this.slots) {
      if (slot.player === active) return id;
    }
    return null;
  }

  // =========================================================
  // 유틸
  // =========================================================

  private getOtherId(connectionId: string): string | null {
    for (const id of this.slotOrder) {
      if (id !== connectionId) return id;
    }
    return null;
  }

  private getOtherSlot(connectionId: string): PlayerSlot | null {
    const other = this.getOtherId(connectionId);
    return other ? (this.slots.get(other) ?? null) : null;
  }

  private sendTo(conn: Party.Connection, msg: ServerMsg) {
    conn.send(json(msg));
  }

  private sendToId(connectionId: string, msg: ServerMsg) {
    const conn = this.room.getConnection(connectionId);
    if (conn) conn.send(json(msg));
  }
}

function trimName(name: string | undefined): string {
  return (name ?? "").trim().slice(0, 16);
}

function json<T>(obj: T): string {
  return JSON.stringify(obj);
}

function toStats(slot: PlayerSlot, p: Player): PlayerStatsPublic {
  return {
    connectionId: slot.connectionId,
    name: slot.name,
    totalBet: p.totalBet,
    totalDamageDealt: p.totalDamageDealt,
    totalDamageTaken: p.totalDamageTaken,
    critCount: p.critCount,
    missCount: p.missCount,
    finalHp: p.hp,
  };
}

AllinServer satisfies Party.Worker;
