/**
 * Room Durable Object — party/server.ts 를 Cloudflare Workers DO 네이티브 API로
 * 포팅한 버전. 게임 로직은 완전히 동일, WebSocket/방 관리 API만 교체.
 *
 * 상태 머신: lobby → coin_toss → pick_class → pick_boon → battle → ended.
 */

import { DurableObject } from "cloudflare:workers";

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
import type { Env } from "./index";

interface PlayerSlot {
  connectionId: string;
  name: string;
  className: ClassName | null;
  boonId: string | null;
  boonOptions: string[];
  boonRerollsLeft: number;
  player: Player | null;
}

export class Room extends DurableObject<Env> {
  private phase: Phase = "lobby";
  private slots = new Map<string, PlayerSlot>();
  private slotOrder: string[] = [];
  private firstPickId: string | null = null;
  private game: Game | null = null;
  private cardsUsedThisTurn = 0;
  private winnerId: string | null = null;
  /** 활성 WebSocket 맵 (connectionId → WebSocket). PartyKit 의 Party.Room 역할. */
  private conns = new Map<string, WebSocket>();
  private roomId: string = "";

  // =========================================================
  // DO 진입점 — WebSocket upgrade
  // =========================================================

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    // roomId 추출 (브로드캐스트/로깅용)
    const url = new URL(request.url);
    const match = /^\/parties\/[^/]+\/([^/]+)\/?$/.exec(url.pathname);
    if (match && !this.roomId) this.roomId = match[1]!.toUpperCase();

    const pair = new WebSocketPair();
    const client = pair[0]!;
    const server = pair[1]!;
    server.accept();

    const connectionId = crypto.randomUUID();
    this.conns.set(connectionId, server);

    server.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      this.handleIncoming(connectionId, data);
    });
    const cleanup = () => {
      if (this.conns.delete(connectionId)) {
        this.handleLeave(connectionId);
      }
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    this.handleConnect(connectionId);

    return new Response(null, { status: 101, webSocket: client });
  }

  // =========================================================
  // 연결 관리
  // =========================================================

  private handleConnect(connectionId: string) {
    if (this.slots.size >= MAX_PLAYERS_PER_ROOM) {
      this.sendToId(connectionId, {
        type: "error",
        message: "방이 가득 찼습니다 (2/2).",
      });
      this.closeConn(connectionId);
      return;
    }
    if (this.phase !== "lobby") {
      this.sendToId(connectionId, {
        type: "error",
        message: "이미 게임이 진행 중입니다.",
      });
      this.closeConn(connectionId);
      return;
    }
    this.sendToId(connectionId, {
      type: "connected",
      connectionId,
      roomId: this.roomId,
    });
    this.broadcastRoom();
  }

  private handleIncoming(senderId: string, message: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(message) as ClientMsg;
    } catch {
      this.sendToId(senderId, { type: "error", message: "JSON 파싱 실패" });
      return;
    }
    try {
      this.dispatch(msg, senderId);
    } catch (err) {
      this.sendToId(senderId, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private dispatch(msg: ClientMsg, senderId: string) {
    switch (msg.type) {
      case "join":
        this.handleJoin(senderId, msg.name);
        break;
      case "leave":
        this.handleLeave(senderId);
        break;
      case "pick_class":
        this.handlePickClass(senderId, msg.className);
        break;
      case "pick_boon":
        this.handlePickBoon(senderId, msg.boonId);
        break;
      case "reroll_boon":
        this.handleRerollBoon(senderId);
        break;
      case "play_card":
        this.handlePlayCard(senderId, msg.cardId, msg.bet);
        break;
      case "end_turn":
        this.handleEndTurn(senderId);
        break;
      case "rematch":
        this.handleRematch(senderId);
        break;
      case "view_pile":
        this.handleViewPile(senderId, msg.side, msg.kind);
        break;
      default: {
        // @ts-expect-error exhaustive
        const t = msg.type as string;
        this.sendToId(senderId, {
          type: "error",
          message: `알 수 없는 메시지 타입: ${t}`,
        });
      }
    }
  }

  // =========================================================
  // 핸들러: join / leave
  // =========================================================

  private handleJoin(senderId: string, name: string) {
    let slot = this.slots.get(senderId);
    if (slot) {
      slot.name = trimName(name);
      this.broadcastRoom();
      return;
    }
    if (this.slots.size >= MAX_PLAYERS_PER_ROOM) {
      this.sendToId(senderId, { type: "error", message: "방이 가득 찼습니다." });
      return;
    }
    slot = {
      connectionId: senderId,
      name: trimName(name) || `Player-${this.slots.size + 1}`,
      className: null,
      boonId: null,
      boonOptions: [],
      boonRerollsLeft: 0,
      player: null,
    };
    this.slots.set(senderId, slot);
    this.slotOrder.push(senderId);
    this.broadcastRoom();

    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startCoinToss();
    }
  }

  private handleLeave(senderId: string) {
    if (!this.slots.has(senderId)) return;
    this.slots.delete(senderId);
    this.slotOrder = this.slotOrder.filter((id) => id !== senderId);

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

    this.broadcastAll({
      type: "coin_toss",
      firstPickId: this.firstPickId,
    });
    this.broadcastRoom();

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

  private handlePickClass(senderId: string, className: ClassName) {
    if (this.phase !== "pick_class") {
      throw new Error("지금은 직업 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(senderId);
    if (!slot) throw new Error("방에 참가하지 않았습니다.");
    if (slot.className) throw new Error("이미 직업을 선택했습니다.");
    if (!CLASS_NAMES.includes(className)) {
      throw new Error(`알 수 없는 직업: ${className}`);
    }

    const isFirstPick = senderId === this.firstPickId;
    const other = this.getOtherSlot(senderId);

    if (!isFirstPick && !other?.className) {
      throw new Error("선픽이 먼저 선택해야 합니다.");
    }
    if (other?.className === className) {
      throw new Error("미러전 금지. 다른 직업을 선택하세요.");
    }

    slot.className = className;
    this.broadcastRoom();

    if (isFirstPick) {
      const otherId = this.getOtherId(senderId);
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

  private handleRerollBoon(senderId: string) {
    if (this.phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(senderId);
    if (!slot) throw new Error("방에 참가하지 않았습니다.");
    if (slot.className !== "gambler") {
      throw new Error("리롤은 도박사 패시브입니다.");
    }
    if (slot.boonId) throw new Error("이미 행운아이템을 선택했습니다.");
    if (slot.boonRerollsLeft <= 0) {
      throw new Error("리롤 횟수가 남아있지 않습니다.");
    }
    slot.boonRerollsLeft -= 1;

    const rng = createRng(Date.now() ^ senderId.length);
    const boons = getAllBoons();
    const options = rng.sample(boons, 3).map((b) => b.id);
    slot.boonOptions = options;

    this.sendToId(slot.connectionId, {
      type: "boon_options",
      options,
    });
    this.broadcastRoom();
  }

  private handlePickBoon(senderId: string, boonId: string) {
    if (this.phase !== "pick_boon") {
      throw new Error("지금은 행운아이템 선택 단계가 아닙니다.");
    }
    const slot = this.slots.get(senderId);
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

    this.game = new Game(
      firstSlot.player,
      secondSlot.player,
      undefined,
      undefined,
      { seed: rng.randint(0, 2 ** 30) },
    );

    this.phase = "battle";
    this.broadcastRoom();

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

    current.beginTurn();
    current.fillHand();
    this.cardsUsedThisTurn = 0;

    // 컨트롤러(워든) 패시브
    if (opponent.className === "warden" && current.hand.length > 0) {
      const silenced = this.game.rng.choice(current.hand);
      if (!current.silencedCards.includes(silenced.id)) {
        current.silencedCards.push(silenced.id);
      }
    }

    if (this.checkBattleEnd()) return;

    this.sendHandsToAll();

    const activeId = this.getActiveConnectionId();
    if (activeId) {
      this.broadcastAll({
        type: "turn_changed",
        activeId,
        turn: this.game.turn,
      });
    }
    this.broadcastRoom();
  }

  private handlePlayCard(senderId: string, cardId: string, bet: number) {
    if (this.phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(senderId);
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

    // 룰렛 연출용 — executeCard 전 스냅샷
    const clampedBet = Math.max(0, Math.min(bet, card.maxBet));
    const accUsed =
      card.type === "hit"
        ? computeHitAccuracy(card, slot.player, opponent, clampedBet)
        : undefined;
    const critChanceUsed =
      card.type === "crit"
        ? computeCritChance(card, slot.player, clampedBet)
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

    this.broadcastAll({
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
    });

    this.sendHandsToAll();
    this.broadcastRoom();

    if (this.checkBattleEnd()) return;
  }

  private handleEndTurn(senderId: string) {
    if (this.phase !== "battle" || !this.game) {
      throw new Error("지금은 전투 단계가 아닙니다.");
    }
    const slot = this.slots.get(senderId);
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

    this.broadcastAll({
      type: "ended",
      winnerId: this.winnerId,
      reason,
      p1Stats: toStats(p1Slot!, p1!),
      p2Stats: toStats(p2Slot!, p2!),
    });
    this.broadcastRoom();
  }

  private handleRematch(_senderId: string) {
    if (this.phase !== "ended") {
      throw new Error("종료 상태에서만 재대전 가능");
    }
    this.resetRoom();
    this.broadcastRoom();
    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startCoinToss();
    }
  }

  private handleViewPile(
    senderId: string,
    side: "me" | "opp",
    kind: "deck" | "grave",
  ) {
    if (this.phase !== "battle") return;
    const senderSlot = this.slots.get(senderId);
    if (!senderSlot?.player) return;

    if (side === "opp" && kind === "deck") {
      this.sendToId(senderId, {
        type: "pile",
        side,
        kind,
        cardIds: null,
      });
      return;
    }

    const targetSlot =
      side === "me" ? senderSlot : this.getOtherSlot(senderId);
    if (!targetSlot?.player) return;

    const source =
      kind === "deck" ? targetSlot.player.deck : targetSlot.player.graveyard;
    this.sendToId(senderId, {
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

    this.broadcastAll({
      type: "room",
      phase: this.phase,
      players,
      firstPickId: this.firstPickId,
      activeId: this.game ? this.getActiveConnectionId() : null,
      turn: this.game?.turn ?? 0,
    });
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

  private sendToId(connectionId: string, msg: ServerMsg) {
    const ws = this.conns.get(connectionId);
    if (ws) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* 이미 닫힌 소켓 — 무시 */
      }
    }
  }

  private broadcastAll(msg: ServerMsg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.conns.values()) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }

  private closeConn(connectionId: string) {
    const ws = this.conns.get(connectionId);
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    this.conns.delete(connectionId);
  }
}

function trimName(name: string | undefined): string {
  return (name ?? "").trim().slice(0, 16);
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
