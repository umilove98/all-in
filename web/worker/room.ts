/**
 * Room Durable Object — 1:1 빠른 매치 방 1개.
 *
 * 게임 로직 자체는 `MatchEngine` 클래스로 추출되어 있고, Room 은
 *   - WebSocket 연결 관리 (slots/conns)
 *   - lobby 단계 join/leave
 *   - 2명 차면 MatchEngine 생성 + startCoinToss
 *   - MatchEngine hooks 콜백을 broadcast/sendToId 로 변환
 *   - rematch (engine 재생성)
 * 만 담당. 외부 메시지 형식은 변경 없이 1:1 클라이언트와 호환.
 */

import { DurableObject } from "cloudflare:workers";

import {
  CardPlayedMsg,
  ClientMsg,
  EndReason,
  MAX_PLAYERS_PER_ROOM,
  Phase,
  PlayerPublic,
  PlayerStatsPublic,
  ServerMsg,
} from "../src/net/protocol";
import type { Env } from "./index";
import { MatchEngine, MatchEngineHooks } from "./match-engine";

interface RoomSlot {
  connectionId: string;
  name: string;
}

export class Room extends DurableObject<Env> {
  private slots = new Map<string, RoomSlot>();
  private slotOrder: string[] = [];
  /** 매치 진행 중일 때만 non-null. lobby 단계에서는 null. */
  private engine: MatchEngine | null = null;
  /** "ended" 단계에서는 engine 을 유지(스탯 표시용) 하므로 별도 플래그. */
  private ended = false;
  /** 활성 WebSocket 맵 (connectionId → WebSocket). */
  private conns = new Map<string, WebSocket>();
  private roomId: string = "";

  // =========================================================
  // DO 진입점 — WebSocket upgrade
  // =========================================================

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
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
    if (this.engine !== null && !this.ended) {
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
        this.requireEngine().pickClass(senderId, msg.className);
        break;
      case "pick_boon":
        this.requireEngine().pickBoon(senderId, msg.boonId);
        break;
      case "reroll_boon":
        this.requireEngine().rerollBoon(senderId);
        break;
      case "play_card":
        this.requireEngine().playCard(senderId, msg.cardId, msg.bet);
        break;
      case "end_turn":
        this.requireEngine().endTurn(senderId);
        break;
      case "rematch":
        this.handleRematch(senderId);
        break;
      case "view_pile":
        if (this.engine && !this.ended) {
          this.engine.viewPile(senderId, msg.side, msg.kind);
        }
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

  private requireEngine(): MatchEngine {
    if (!this.engine || this.ended) {
      throw new Error("게임이 진행 중이 아닙니다.");
    }
    return this.engine;
  }

  // =========================================================
  // join / leave
  // =========================================================

  private handleJoin(senderId: string, name: string) {
    const trimmed = trimName(name);

    // 진행 중에는 이름 변경만 (실제로는 도달하지 않음 — connect 단계에서 거부)
    if (this.engine && !this.ended) {
      const slot = this.slots.get(senderId);
      if (slot && trimmed) slot.name = trimmed;
      this.broadcastRoom();
      return;
    }

    // ended 단계에서 새 join 은 거부 (현재 두 사람만 rematch)
    if (this.ended) {
      this.sendToId(senderId, {
        type: "error",
        message: "이전 매치가 진행 중입니다. 잠시 후 다시 시도하세요.",
      });
      return;
    }

    let slot = this.slots.get(senderId);
    if (slot) {
      if (trimmed) slot.name = trimmed;
      this.broadcastRoom();
      return;
    }
    if (this.slots.size >= MAX_PLAYERS_PER_ROOM) {
      this.sendToId(senderId, { type: "error", message: "방이 가득 찼습니다." });
      return;
    }
    slot = {
      connectionId: senderId,
      name: trimmed || `Player-${this.slots.size + 1}`,
    };
    this.slots.set(senderId, slot);
    this.slotOrder.push(senderId);
    this.broadcastRoom();

    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startMatch();
    }
  }

  private handleLeave(senderId: string) {
    if (!this.slots.has(senderId)) return;
    this.slots.delete(senderId);
    this.slotOrder = this.slotOrder.filter((id) => id !== senderId);

    // 진행 중/종료 상태 모두에서 engine 폐기 — 짝이 안 맞으므로 lobby 로 리셋
    if (this.engine) {
      this.engine = null;
      this.ended = false;
    }
    this.broadcastRoom();
  }

  // =========================================================
  // 매치 시작 / 재대전
  // =========================================================

  private startMatch() {
    const [p1Id, p2Id] = this.slotOrder;
    if (!p1Id || !p2Id) return;
    const p1 = this.slots.get(p1Id)!;
    const p2 = this.slots.get(p2Id)!;
    this.engine = new MatchEngine(
      p1Id,
      p2Id,
      { p1: p1.name, p2: p2.name },
      this.makeHooks(),
    );
    this.ended = false;
    this.engine.startCoinToss();
  }

  private handleRematch(_senderId: string) {
    if (!this.ended || !this.engine) {
      throw new Error("종료 상태에서만 재대전 가능");
    }
    this.engine = null;
    this.ended = false;
    this.broadcastRoom();
    if (this.slots.size === MAX_PLAYERS_PER_ROOM) {
      this.startMatch();
    }
  }

  // =========================================================
  // MatchEngine hooks → 1:1 broadcast 매핑
  // =========================================================

  private makeHooks(): MatchEngineHooks {
    return {
      onPhaseChange: () => {
        this.broadcastRoom();
      },
      onCoinToss: (firstPickId: string) => {
        this.broadcastAll({ type: "coin_toss", firstPickId });
        this.broadcastRoom();
      },
      onClassOptions: (playerId, disabled) => {
        this.sendToId(playerId, { type: "class_options", disabled });
      },
      onBoonOptions: (playerId, options) => {
        this.sendToId(playerId, { type: "boon_options", options });
      },
      onHand: (playerId, hand, silenced) => {
        this.sendToId(playerId, { type: "hand", hand, silenced });
      },
      onCardPlayed: (evt: CardPlayedMsg) => {
        this.broadcastAll(evt);
      },
      onTurnChanged: (activeId, turn) => {
        this.broadcastAll({ type: "turn_changed", activeId, turn });
      },
      onPile: (playerId, payload) => {
        this.sendToId(playerId, { type: "pile", ...payload });
      },
      onEnd: (
        winnerId,
        reason: EndReason,
        p1Stats: PlayerStatsPublic,
        p2Stats: PlayerStatsPublic,
      ) => {
        this.ended = true;
        this.broadcastAll({
          type: "ended",
          winnerId,
          reason,
          p1Stats,
          p2Stats,
        });
        this.broadcastRoom();
      },
    };
  }

  // =========================================================
  // 브로드캐스트
  // =========================================================

  private broadcastRoom() {
    let players: PlayerPublic[];
    let firstPickId: string | null = null;
    let activeId: string | null = null;
    let turn = 0;

    if (this.engine) {
      players = this.engine.getPlayerPublics();
      firstPickId = this.engine.firstPick;
      activeId = this.engine.getActivePlayerId();
      turn = this.engine.getTurn();
    } else {
      players = this.slotOrder
        .map((id) => this.slots.get(id))
        .filter((s): s is RoomSlot => !!s)
        .map((s) => emptyPublic(s));
    }

    this.broadcastAll({
      type: "room",
      phase: this.phaseFor(),
      players,
      firstPickId,
      activeId,
      turn,
    });
  }

  private phaseFor(): Phase {
    if (!this.engine) return "lobby";
    if (this.ended) return "ended";
    return this.engine.phase;
  }

  // =========================================================
  // 유틸
  // =========================================================

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

/** lobby 단계 — engine 없을 때 슬롯 → 빈 PlayerPublic */
function emptyPublic(slot: RoomSlot): PlayerPublic {
  return {
    connectionId: slot.connectionId,
    name: slot.name,
    ready: true,
    className: null,
    boonId: null,
    boonRerollsLeft: 0,
    hp: 100,
    maxHp: 100,
    shield: 0,
    handCount: 0,
    deckCount: 0,
    graveyardCount: 0,
    maxCardsPerTurn: 2,
    totalBet: 0,
    totalDamageTaken: 0,
    missedLastTurn: false,
    hitLastTurn: false,
    statuses: {
      poisonTurns: 0,
      poisonDamage: 0,
      rageStacks: 0,
      berserkTurns: 0,
      berserkAccBonus: 0,
      berserkDamageBonus: 0,
      incomingDamageMult: 1.0,
      incomingDamageMultTurns: 0,
      betCapOverride: null,
      betCapOverrideTurns: 0,
      nextAccBonus: 0,
      nextCritBonus: 0,
      guaranteeNextCrit: false,
      dodgeNextPercent: 0,
      nextAttackMissChance: 0,
      silencedCardCount: 0,
      sigUsedIds: [],
      sigUsedThisTurn: false,
    },
  };
}
