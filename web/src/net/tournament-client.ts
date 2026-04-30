/**
 * 토너먼트 모드 클라이언트 — `/parties/tournament/{TID}` 에 연결.
 * 1:1 모드의 AllinClient 와 별개 채널.
 *
 * t_match_event 로 감싸서 오는 매치 내 ServerMsg 는 풀어서 1:1 핸들러로
 * 디스패치하도록 unwrap 함수 제공 — 기존 ending/duel/classPick 씬 재사용.
 */

import { PartySocket } from "partysocket";
import { ClientMsg, ServerMsg } from "./protocol";
import {
  TClientMsg,
  TServerMsg,
  wrapClientMsgForMatch,
} from "./tournament-protocol";

type Listener = (msg: TServerMsg) => void;

export class TournamentClient {
  private socket: PartySocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: "open" | "close" | "error") => void>();

  constructor(
    private readonly host: string,
    private readonly tournamentId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new PartySocket({
        host: this.host,
        party: "tournament",
        room: this.tournamentId,
      });
      this.socket = ws;
      ws.addEventListener("message", (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as TServerMsg;
          for (const l of this.listeners) l(msg);
        } catch (err) {
          console.error("bad t-msg:", e.data, err);
        }
      });
      ws.addEventListener("open", () => {
        for (const l of this.statusListeners) l("open");
        resolve();
      });
      ws.addEventListener("close", () => {
        for (const l of this.statusListeners) l("close");
      });
      ws.addEventListener("error", (err) => {
        for (const l of this.statusListeners) l("error");
        reject(err);
      });
    });
  }

  /** 핸드셰이크 — connect 직후 한 번. */
  hello(participantId: string, name: string) {
    this.send({ type: "t_hello", participantId, name });
  }

  /** 호스트가 토너먼트 시작. */
  startTournament() {
    this.send({ type: "t_start_tournament" });
  }

  /** 매치 시작 ready 토글. */
  toggleReady(matchId: string) {
    this.send({ type: "t_match_ready_toggle", matchId });
  }

  /** 매치 종료 후 메뉴 선택. */
  afterMatchChoice(choice: "spectate" | "leave") {
    this.send({ type: "t_after_match_choice", choice });
  }

  /** 토너먼트 방 떠나기. */
  leaveRoom() {
    this.send({ type: "t_leave_room" });
  }

  /**
   * 매치 내 1:1 메시지를 t_* 로 래핑해 전송.
   * 매치 진행 중인 matchId 를 함께 받음.
   */
  sendInMatch(matchId: string, msg: ClientMsg): void {
    const wrapped = wrapClientMsgForMatch(matchId, msg);
    if (wrapped) this.send(wrapped);
  }

  send(msg: TClientMsg) {
    if (!this.socket) throw new Error("not connected");
    this.socket.send(JSON.stringify(msg));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (s: "open" | "close" | "error") => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * t_match_event 의 inner ServerMsg 를 unwrap.
 * 그 외 t_* 메시지는 토너먼트 전용이라 caller 가 직접 처리.
 */
export function unwrapMatchEvent(msg: TServerMsg): {
  matchId: string;
  inner: ServerMsg;
} | null {
  if (msg.type === "t_match_event") {
    return { matchId: msg.matchId, inner: msg.event };
  }
  return null;
}
