/**
 * 토너먼트 모드 메시지 프로토콜.
 * 1:1 모드와 분리된 별도 채널 (`/parties/tournament/{TID}`) 에서 사용.
 *
 * 주요 흐름:
 *   t_hello → t_lobby* → (host) t_start_tournament → t_bracket
 *     → 내 매치 status="ready" 면 양쪽 t_match_ready_toggle → t_match_started
 *     → 매치 진행 중에는 t_match_event 로 기존 ServerMsg 를 그대로 감싸 전달
 *     → t_match_ended → 다음 매치 ready / 결승 → t_bracket(phase="tournament_finished")
 */

import { ClassName } from "@/engine";
import { ClientMsg, EndReason, PlayerStatsPublic, ServerMsg } from "./protocol";

// ======================================================================
//   공통 상수 / 상태
// ======================================================================

/** 토너먼트 인원 한계. 2~16. */
export const MIN_TOURNAMENT_PLAYERS = 2;
export const MAX_TOURNAMENT_PLAYERS = 16;

export type TPhase =
  | "tournament_lobby"
  | "tournament_running"
  | "tournament_finished";

export type ParticipantStatus =
  | "alive"        // 생존, 다음 매치 대기/진행 중
  | "eliminated"   // 탈락 (관전 옵션 선택 안함)
  | "spectating"   // 탈락 후 관전 선택 (1차에서는 사용 X)
  | "disconnected"; // WebSocket 끊김

export type TMatchStatus =
  | "pending"      // 직전 라운드 미완료 → 상대 미정
  | "ready"        // 양쪽 결정 → "게임시작" 대기
  | "in_progress"  // 매치 진행 중
  | "finished"
  | "bye";         // 부전승 자동 진출

export type MatchPhase =
  | "coin_toss"
  | "pick_class"
  | "pick_boon"
  | "battle"
  | "ended";

// ======================================================================
//   공개 데이터 (브로드캐스트용)
// ======================================================================

export interface PublicParticipant {
  participantId: string;
  name: string;
  status: ParticipantStatus;
  /** 호스트 본인 표시용 */
  isHost: boolean;
  /** 현재 WebSocket 연결되어 있는지 (재접속 미구현 1차에서는 단순 status=disconnected 와 동일) */
  online: boolean;
}

export interface PublicMatch {
  matchId: string;
  round: number;
  /** 라운드 안 매치 인덱스. bracket[round][index] = this. */
  index: number;
  p1Id: string | null;
  p2Id: string | null;
  winnerId: string | null;
  status: TMatchStatus;
  readyP1: boolean;
  readyP2: boolean;
  /** 진행 중일 때 현재 매치 phase. 관전/UI 진행도 표시용. */
  matchPhase?: MatchPhase;
}

// ======================================================================
//   Client → Server
// ======================================================================

export type TClientMsg =
  /** 첫 연결 직후 보내는 핸드셰이크. participantId 가 새로운 사용자면 신규 등록,
   *  기존이면 재접속 (connectionId 갱신). 토너먼트가 lobby 상태가 아니면 신규 등록 거부. */
  | { type: "t_hello"; participantId: string; name: string }
  | { type: "t_leave_room" }
  /** 호스트 only. 1차에서는 인원 수 검증만 (≥2명). */
  | { type: "t_start_tournament" }
  /** 매치 양쪽이 모두 토글하면 매치 시작. 토글이라 한 번 더 누르면 취소. */
  | { type: "t_match_ready_toggle"; matchId: string }
  /** 매치 종료 후 패자/승자 메뉴 선택. 1차에서는 "leave" 만 동작 (관전 미구현). */
  | { type: "t_after_match_choice"; choice: "spectate" | "leave" }
  // ---- 매치 내 게임 메시지 (기존 ClientMsg 와 동형 + matchId) ----
  | { type: "t_pick_class"; matchId: string; className: ClassName }
  | { type: "t_pick_boon"; matchId: string; boonId: string }
  | { type: "t_reroll_boon"; matchId: string }
  | { type: "t_play_card"; matchId: string; cardId: string; bet: number }
  | { type: "t_end_turn"; matchId: string }
  | {
      type: "t_view_pile";
      matchId: string;
      side: "me" | "opp";
      kind: "deck" | "grave";
    };

// ======================================================================
//   Server → Client
// ======================================================================

export type TServerMsg =
  | {
      type: "t_hello_ok";
      participantId: string;
      isHost: boolean;
      tournamentId: string;
    }
  | { type: "t_error"; message: string }
  /** 토너먼트 시작 전 로비 broadcast. */
  | {
      type: "t_lobby";
      participants: PublicParticipant[];
      hostId: string | null;
      canStart: boolean;
    }
  /** 토너먼트 진행 상태. 매 변화마다 broadcast. */
  | {
      type: "t_bracket";
      phase: TPhase;
      bracket: PublicMatch[][];
      participants: PublicParticipant[];
      champion: string | null;
      /** 받는 클라이언트가 현재 참여(또는 직전에 끝난) 매치 ID. 라우팅 결정용. */
      myCurrentMatchId: string | null;
    }
  /** 매치 진입 알림 — 양쪽 모두 ready 누르면 발송. 매치 내 게임 시작. */
  | { type: "t_match_started"; matchId: string; firstPickId: string }
  /** 매치 내 이벤트는 기존 ServerMsg 를 그대로 감싸 전달. 클라는 풀어서 기존 핸들러로. */
  | { type: "t_match_event"; matchId: string; event: ServerMsg }
  /** 매치 종료 — 클라가 패자/탈락자 메뉴 띄우는 트리거. */
  | {
      type: "t_match_ended";
      matchId: string;
      winnerId: string | null;
      reason: EndReason;
      p1Stats: PlayerStatsPublic;
      p2Stats: PlayerStatsPublic;
      /** 받는 클라이언트가 이겼는지. 매치 참가자가 아니면 null. */
      youWon: boolean | null;
    };

// ======================================================================
//   1:1 ClientMsg → t_* 변환 헬퍼 (클라이언트 측에서 사용)
// ======================================================================

/**
 * 매치 내 1:1 게임 메시지를 토너먼트 t_* 메시지로 래핑.
 * 1:1 ClientMsg 의 join/leave/rematch 는 토너먼트에선 의미 없으므로 미지원.
 */
export function wrapClientMsgForMatch(
  matchId: string,
  msg: ClientMsg,
): TClientMsg | null {
  switch (msg.type) {
    case "pick_class":
      return { type: "t_pick_class", matchId, className: msg.className };
    case "pick_boon":
      return { type: "t_pick_boon", matchId, boonId: msg.boonId };
    case "reroll_boon":
      return { type: "t_reroll_boon", matchId };
    case "play_card":
      return {
        type: "t_play_card",
        matchId,
        cardId: msg.cardId,
        bet: msg.bet,
      };
    case "end_turn":
      return { type: "t_end_turn", matchId };
    case "view_pile":
      return {
        type: "t_view_pile",
        matchId,
        side: msg.side,
        kind: msg.kind,
      };
    case "join":
    case "leave":
    case "rematch":
      // 토너먼트에서는 별도 메시지 (t_hello / t_leave_room / 자동 진행) 로 처리
      return null;
  }
}
