/**
 * TournamentRoom Durable Object — N(2~16)인 단일 토너먼트 1개.
 *
 * 책임:
 *   - WebSocket 연결 관리 (connectionId ↔ participantId 매핑)
 *   - 참가자 등록 (lobby 단계) / 재접속 (participantId 일치 시)
 *   - 호스트 토너먼트 시작 (브래킷 생성 + 부전승 propagate)
 *   - 매치별 ready 토글 → 양쪽 ready 시 MatchEngine 생성/시작
 *   - MatchEngine 콜백을 t_match_event 로 감싸 매치 참가자에게 라우팅
 *   - 매치 종료 시 winner propagate + 다음 라운드 ready 전환 + bracket broadcast
 *   - 결승 종료 시 phase="tournament_finished" + champion 설정
 *
 * 1차 미구현:
 *   - 관전 (postMatch 에서 leave 만)
 *   - 진행 중 매치 재접속 복원 (lobby/bracket 단계 복원만, 매치 진행 중 끊김은 사실상 정지)
 *   - DO storage 영속화 (메모리 only — DO 휘발 시 토너먼트 종료)
 */

import { DurableObject } from "cloudflare:workers";

import { ClassName } from "../src/engine";
import { CardPlayedMsg, EndReason, ServerMsg } from "../src/net/protocol";
import {
  MAX_TOURNAMENT_PLAYERS,
  MIN_TOURNAMENT_PLAYERS,
  ParticipantStatus,
  PublicMatch,
  PublicParticipant,
  TClientMsg,
  TPhase,
  TServerMsg,
} from "../src/net/tournament-protocol";
import type { Env } from "./index";
import {
  InternalMatch,
  buildInitialBracket,
  findCurrentMatchOf,
  getChampion,
  propagateInitialByes,
  propagateWinner,
} from "./bracket";
import { MatchEngine, MatchEngineHooks } from "./match-engine";

interface Participant {
  participantId: string;
  name: string;
  connectionId: string | null;
  status: ParticipantStatus;
  joinedAt: number;
}

interface ActiveMatch {
  matchId: string;
  engine: MatchEngine;
  matchPhase: PublicMatch["matchPhase"];
}

export class TournamentRoom extends DurableObject<Env> {
  private tournamentId: string = "";
  private hostParticipantId: string | null = null;
  private phase: TPhase = "tournament_lobby";
  private participants = new Map<string, Participant>(); // participantId → ...
  private joinOrder: string[] = []; // participantId
  private bracket: InternalMatch[][] = [];
  private champion: string | null = null;
  private activeMatches = new Map<string, ActiveMatch>(); // matchId → ...

  /** WebSocket connectionId 관리 */
  private conns = new Map<string, WebSocket>();
  /** connectionId → participantId. t_hello 에서 매핑. */
  private connToParticipant = new Map<string, string>();

  // =========================================================
  // DO 진입점 — WebSocket upgrade
  // =========================================================

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const url = new URL(request.url);
    const match = /^\/parties\/[^/]+\/([^/]+)\/?$/.exec(url.pathname);
    if (match && !this.tournamentId) {
      this.tournamentId = match[1]!.toUpperCase();
    }

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
        this.handleDisconnect(connectionId);
      }
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    // t_hello 가 와야 participantId 확정 → 그 전엔 broadcast 대상 아님
    return new Response(null, { status: 101, webSocket: client });
  }

  // =========================================================
  // 메시지 디스패치
  // =========================================================

  private handleIncoming(senderConnId: string, message: string) {
    let msg: TClientMsg;
    try {
      msg = JSON.parse(message) as TClientMsg;
    } catch {
      this.sendToConn(senderConnId, {
        type: "t_error",
        message: "JSON 파싱 실패",
      });
      return;
    }
    try {
      this.dispatch(msg, senderConnId);
    } catch (err) {
      this.sendToConn(senderConnId, {
        type: "t_error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private dispatch(msg: TClientMsg, senderConnId: string) {
    if (msg.type === "t_hello") {
      this.handleHello(senderConnId, msg.participantId, msg.name);
      return;
    }
    // 그 외 메시지는 t_hello 가 선행돼야 함
    const participantId = this.connToParticipant.get(senderConnId);
    if (!participantId) {
      throw new Error("핸드셰이크(t_hello) 가 필요합니다.");
    }
    switch (msg.type) {
      case "t_leave_room":
        this.handleLeave(senderConnId, participantId);
        break;
      case "t_start_tournament":
        this.handleStartTournament(participantId);
        break;
      case "t_match_ready_toggle":
        this.handleReadyToggle(participantId, msg.matchId);
        break;
      case "t_after_match_choice":
        this.handleAfterMatchChoice(senderConnId, participantId, msg.choice);
        break;
      case "t_pick_class":
        this.routeToEngine(msg.matchId, (e) =>
          e.pickClass(participantId, msg.className as ClassName),
        );
        break;
      case "t_pick_boon":
        this.routeToEngine(msg.matchId, (e) =>
          e.pickBoon(participantId, msg.boonId),
        );
        break;
      case "t_reroll_boon":
        this.routeToEngine(msg.matchId, (e) =>
          e.rerollBoon(participantId),
        );
        break;
      case "t_play_card":
        this.routeToEngine(msg.matchId, (e) =>
          e.playCard(participantId, msg.cardId, msg.bet),
        );
        break;
      case "t_end_turn":
        this.routeToEngine(msg.matchId, (e) => e.endTurn(participantId));
        break;
      case "t_view_pile":
        this.routeToEngine(msg.matchId, (e) =>
          e.viewPile(participantId, msg.side, msg.kind),
        );
        break;
      default: {
        // @ts-expect-error exhaustive
        const t = msg.type as string;
        this.sendToConn(senderConnId, {
          type: "t_error",
          message: `알 수 없는 메시지 타입: ${t}`,
        });
      }
    }
  }

  private routeToEngine(
    matchId: string,
    fn: (engine: MatchEngine) => void,
  ): void {
    const active = this.activeMatches.get(matchId);
    if (!active) {
      throw new Error(`매치가 진행 중이 아닙니다: ${matchId}`);
    }
    fn(active.engine);
  }

  // =========================================================
  // 핸드셰이크: 신규 등록 또는 재접속
  // =========================================================

  private handleHello(
    senderConnId: string,
    participantId: string,
    name: string,
  ) {
    const trimmed = trimName(name);
    let participant = this.participants.get(participantId);

    if (participant) {
      // 재접속
      participant.connectionId = senderConnId;
      participant.status =
        participant.status === "disconnected" ? "alive" : participant.status;
      if (trimmed) participant.name = trimmed;
    } else {
      // 신규 등록 — lobby 단계에서만
      if (this.phase !== "tournament_lobby") {
        this.sendToConn(senderConnId, {
          type: "t_error",
          message: "이미 토너먼트가 진행 중입니다. 새 참가자는 받을 수 없습니다.",
        });
        this.closeConn(senderConnId);
        return;
      }
      if (this.participants.size >= MAX_TOURNAMENT_PLAYERS) {
        this.sendToConn(senderConnId, {
          type: "t_error",
          message: `토너먼트 정원(${MAX_TOURNAMENT_PLAYERS}) 초과.`,
        });
        this.closeConn(senderConnId);
        return;
      }
      participant = {
        participantId,
        name: trimmed || `Player-${this.participants.size + 1}`,
        connectionId: senderConnId,
        status: "alive",
        joinedAt: Date.now(),
      };
      this.participants.set(participantId, participant);
      this.joinOrder.push(participantId);
      // 첫 참가자가 호스트
      if (!this.hostParticipantId) this.hostParticipantId = participantId;
    }
    this.connToParticipant.set(senderConnId, participantId);

    this.sendToConn(senderConnId, {
      type: "t_hello_ok",
      participantId,
      isHost: this.hostParticipantId === participantId,
      tournamentId: this.tournamentId,
    });

    if (this.phase === "tournament_lobby") {
      this.broadcastLobby();
    } else {
      // 진행 중/종료 상태에서 재접속 — 본인에게 현재 bracket 전송 + 전체 broadcast
      this.broadcastBracket();
    }
  }

  private handleLeave(senderConnId: string, participantId: string) {
    const participant = this.participants.get(participantId);
    if (!participant) return;

    if (this.phase === "tournament_lobby") {
      // 로비 단계 — 완전 제거
      this.participants.delete(participantId);
      this.joinOrder = this.joinOrder.filter((id) => id !== participantId);
      if (this.hostParticipantId === participantId) {
        this.hostParticipantId = this.joinOrder[0] ?? null;
      }
    } else {
      // 진행 중 — 일단 disconnected 표시만 (1차에서는 매치 강제 종료 X)
      participant.status = "eliminated";
      participant.connectionId = null;
    }
    this.connToParticipant.delete(senderConnId);
    this.closeConn(senderConnId);

    if (this.phase === "tournament_lobby") this.broadcastLobby();
    else this.broadcastBracket();
  }

  private handleDisconnect(senderConnId: string) {
    const participantId = this.connToParticipant.get(senderConnId);
    if (!participantId) return;
    this.connToParticipant.delete(senderConnId);

    const participant = this.participants.get(participantId);
    if (!participant) return;

    if (this.phase === "tournament_lobby") {
      // 로비에서 끊기면 그냥 제거
      this.participants.delete(participantId);
      this.joinOrder = this.joinOrder.filter((id) => id !== participantId);
      if (this.hostParticipantId === participantId) {
        this.hostParticipantId = this.joinOrder[0] ?? null;
      }
      this.broadcastLobby();
    } else {
      // 진행 중에 끊기면 disconnected 로만 표시 — 다시 접속 가능
      participant.connectionId = null;
      if (participant.status === "alive") {
        participant.status = "disconnected";
      }
      this.broadcastBracket();
    }
  }

  // =========================================================
  // 토너먼트 시작
  // =========================================================

  private handleStartTournament(participantId: string) {
    if (this.phase !== "tournament_lobby") {
      throw new Error("이미 토너먼트가 시작되었습니다.");
    }
    if (this.hostParticipantId !== participantId) {
      throw new Error("호스트만 토너먼트를 시작할 수 있습니다.");
    }
    if (this.participants.size < MIN_TOURNAMENT_PLAYERS) {
      throw new Error(
        `최소 ${MIN_TOURNAMENT_PLAYERS} 명이 필요합니다 (현재 ${this.participants.size}).`,
      );
    }

    const seed = (Date.now() ^ this.tournamentId.length ^ 0xa5) >>> 0;
    this.bracket = buildInitialBracket(this.joinOrder, seed);
    propagateInitialByes(this.bracket);
    this.phase = "tournament_running";
    this.broadcastBracket();
  }

  // =========================================================
  // 매치 ready 토글 → 시작
  // =========================================================

  private handleReadyToggle(participantId: string, matchId: string) {
    const match = this.findMatch(matchId);
    if (!match) throw new Error(`매치를 찾을 수 없습니다: ${matchId}`);
    if (match.status !== "ready") {
      throw new Error("매치 준비 단계가 아닙니다.");
    }
    if (match.p1Id === participantId) {
      match.readyP1 = !match.readyP1;
    } else if (match.p2Id === participantId) {
      match.readyP2 = !match.readyP2;
    } else {
      throw new Error("이 매치 참가자가 아닙니다.");
    }

    if (match.readyP1 && match.readyP2) {
      this.startMatch(match);
    } else {
      this.broadcastBracket();
    }
  }

  private startMatch(match: InternalMatch) {
    if (!match.p1Id || !match.p2Id) {
      throw new Error("매치 참가자가 누락되었습니다.");
    }
    const p1 = this.participants.get(match.p1Id);
    const p2 = this.participants.get(match.p2Id);
    if (!p1 || !p2) throw new Error("참가자 정보 누락.");

    match.status = "in_progress";

    const active: ActiveMatch = {
      matchId: match.matchId,
      engine: undefined as unknown as MatchEngine, // 직후 채움
      matchPhase: "coin_toss",
    };
    const hooks = this.makeHooks(match, active);
    active.engine = new MatchEngine(
      match.p1Id,
      match.p2Id,
      { p1: p1.name, p2: p2.name },
      hooks,
    );
    this.activeMatches.set(match.matchId, active);

    // 매치 양쪽에게 시작 알림
    active.engine.startCoinToss();
    const firstPickId = active.engine.firstPick;
    if (firstPickId) {
      this.sendToMatchParticipants(match, {
        type: "t_match_started",
        matchId: match.matchId,
        firstPickId,
      });
    }

    this.broadcastBracket();
  }

  // =========================================================
  // MatchEngine hooks → t_match_event 라우팅
  // =========================================================

  private makeHooks(
    match: InternalMatch,
    active: ActiveMatch,
  ): MatchEngineHooks {
    const wrap = (event: ServerMsg): TServerMsg => ({
      type: "t_match_event",
      matchId: match.matchId,
      event,
    });

    return {
      onPhaseChange: (phase) => {
        active.matchPhase = phase;
        this.broadcastBracket();
      },
      onCoinToss: (firstPickId) => {
        this.sendToMatchParticipants(match, wrap({ type: "coin_toss", firstPickId }));
        // 매치 room broadcast — 매치 참가자에게 player public 정보
        this.sendMatchRoom(match, active);
      },
      onClassOptions: (playerId, disabled) => {
        this.sendToParticipant(
          playerId,
          wrap({ type: "class_options", disabled }),
        );
      },
      onBoonOptions: (playerId, options) => {
        this.sendToParticipant(
          playerId,
          wrap({ type: "boon_options", options }),
        );
      },
      onHand: (playerId, hand, silenced) => {
        this.sendToParticipant(
          playerId,
          wrap({ type: "hand", hand, silenced }),
        );
      },
      onCardPlayed: (evt: CardPlayedMsg) => {
        this.sendToMatchParticipants(match, wrap(evt));
        this.sendMatchRoom(match, active);
      },
      onTurnChanged: (activeId, turn) => {
        this.sendToMatchParticipants(
          match,
          wrap({ type: "turn_changed", activeId, turn }),
        );
      },
      onPile: (playerId, payload) => {
        this.sendToParticipant(playerId, wrap({ type: "pile", ...payload }));
      },
      onEnd: (winnerId, reason: EndReason, p1Stats, p2Stats) => {
        // 매치 양쪽에게 1:1 ended 도 전달 (기존 ending 씬 호환)
        this.sendToMatchParticipants(
          match,
          wrap({ type: "ended", winnerId, reason, p1Stats, p2Stats }),
        );
        this.finishMatch(match, winnerId, reason, p1Stats, p2Stats);
      },
    };
  }

  /** matchEngine 의 room state 브로드캐스트를 매치 참가자에게만 보냄. */
  private sendMatchRoom(match: InternalMatch, active: ActiveMatch) {
    const players = active.engine.getPlayerPublics();
    const roomMsg: ServerMsg = {
      type: "room",
      phase: active.engine.phase as ServerMsg & { type: "room" } extends {
        phase: infer P;
      }
        ? P
        : never,
      players,
      firstPickId: active.engine.firstPick,
      activeId: active.engine.getActivePlayerId(),
      turn: active.engine.getTurn(),
    };
    this.sendToMatchParticipants(match, {
      type: "t_match_event",
      matchId: match.matchId,
      event: roomMsg,
    });
  }

  // =========================================================
  // 매치 종료 + 다음 라운드 propagation
  // =========================================================

  private finishMatch(
    match: InternalMatch,
    winnerId: string | null,
    reason: EndReason,
    p1Stats: { connectionId: string; name: string; totalBet: number; totalDamageDealt: number; totalDamageTaken: number; critCount: number; missCount: number; finalHp: number },
    p2Stats: { connectionId: string; name: string; totalBet: number; totalDamageDealt: number; totalDamageTaken: number; critCount: number; missCount: number; finalHp: number },
  ) {
    match.status = "finished";
    match.winnerId = winnerId;
    this.activeMatches.delete(match.matchId);

    // 패자 status="eliminated"
    const loserId =
      winnerId === null
        ? null
        : winnerId === match.p1Id
          ? match.p2Id
          : match.p1Id;
    if (loserId) {
      const loser = this.participants.get(loserId);
      if (loser && loser.status === "alive") loser.status = "eliminated";
    }
    // 무승부(mutual_hp_zero/turn_limit_draw) 시 양쪽 다 탈락 — 1차에서는 단순 처리
    if (winnerId === null) {
      [match.p1Id, match.p2Id].forEach((id) => {
        if (!id) return;
        const p = this.participants.get(id);
        if (p && p.status === "alive") p.status = "eliminated";
      });
    }

    // 다음 라운드 propagate
    if (winnerId) {
      propagateWinner(this.bracket, match.round, match.index, winnerId);
    }

    // 매치 종료 알림
    [match.p1Id, match.p2Id].forEach((id) => {
      if (!id) return;
      const youWon = winnerId === id;
      this.sendToParticipant(id, {
        type: "t_match_ended",
        matchId: match.matchId,
        winnerId,
        reason,
        p1Stats,
        p2Stats,
        youWon,
      });
    });

    // 챔피언/종료 판정
    const champ = getChampion(this.bracket);
    if (champ) {
      this.champion = champ;
      this.phase = "tournament_finished";
    }

    this.broadcastBracket();
  }

  // =========================================================
  // 매치 종료 후 메뉴 (관전 / 나가기)
  // =========================================================

  private handleAfterMatchChoice(
    senderConnId: string,
    participantId: string,
    choice: "spectate" | "leave",
  ) {
    if (choice === "leave") {
      this.handleLeave(senderConnId, participantId);
      return;
    }
    // spectate: 1차 미구현 — 일단 status 만 spectating 으로 표시
    const p = this.participants.get(participantId);
    if (p && p.status === "eliminated") {
      p.status = "spectating";
      this.broadcastBracket();
    }
  }

  // =========================================================
  // broadcast 헬퍼
  // =========================================================

  private broadcastLobby() {
    const participants = this.publicParticipants();
    const canStart = this.participants.size >= MIN_TOURNAMENT_PLAYERS;
    const msg: TServerMsg = {
      type: "t_lobby",
      participants,
      hostId: this.hostParticipantId,
      canStart,
    };
    this.broadcastAll(msg);
  }

  private broadcastBracket() {
    const participants = this.publicParticipants();
    const publicBracket = this.publicBracket();

    // 각 연결마다 myCurrentMatchId 를 다르게 채워서 보냄
    for (const [connId, ws] of this.conns) {
      const participantId = this.connToParticipant.get(connId);
      const myMatchId = participantId
        ? (findCurrentMatchOf(this.bracket, participantId)?.matchId ?? null)
        : null;
      const msg: TServerMsg = {
        type: "t_bracket",
        phase: this.phase,
        bracket: publicBracket,
        participants,
        champion: this.champion,
        myCurrentMatchId: myMatchId,
      };
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  }

  private publicParticipants(): PublicParticipant[] {
    return this.joinOrder
      .map((id) => this.participants.get(id))
      .filter((p): p is Participant => !!p)
      .map((p) => ({
        participantId: p.participantId,
        name: p.name,
        status: p.status,
        isHost: this.hostParticipantId === p.participantId,
        online: p.connectionId !== null,
      }));
  }

  private publicBracket(): PublicMatch[][] {
    return this.bracket.map((round) =>
      round.map((m) => {
        const active = this.activeMatches.get(m.matchId);
        const out: PublicMatch = {
          matchId: m.matchId,
          round: m.round,
          index: m.index,
          p1Id: m.p1Id,
          p2Id: m.p2Id,
          winnerId: m.winnerId,
          status: m.status,
          readyP1: m.readyP1,
          readyP2: m.readyP2,
        };
        if (active) out.matchPhase = active.matchPhase;
        return out;
      }),
    );
  }

  private findMatch(matchId: string): InternalMatch | null {
    for (const round of this.bracket) {
      for (const m of round) {
        if (m.matchId === matchId) return m;
      }
    }
    return null;
  }

  // =========================================================
  // 메시지 송신
  // =========================================================

  private sendToConn(connId: string, msg: TServerMsg) {
    const ws = this.conns.get(connId);
    if (!ws) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  private sendToParticipant(participantId: string, msg: TServerMsg) {
    const p = this.participants.get(participantId);
    if (!p?.connectionId) return;
    this.sendToConn(p.connectionId, msg);
  }

  private sendToMatchParticipants(match: InternalMatch, msg: TServerMsg) {
    if (match.p1Id) this.sendToParticipant(match.p1Id, msg);
    if (match.p2Id) this.sendToParticipant(match.p2Id, msg);
  }

  private broadcastAll(msg: TServerMsg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.conns.values()) {
      try {
        ws.send(payload);
      } catch {
        /* ignore */
      }
    }
  }

  private closeConn(connId: string) {
    const ws = this.conns.get(connId);
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    this.conns.delete(connId);
  }
}

function trimName(name: string | undefined): string {
  return (name ?? "").trim().slice(0, 16);
}
