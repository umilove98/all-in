/**
 * 서버/클라 공유 메시지 프로토콜.
 * PartyKit room = 1 Durable Object. 서버가 게임 상태 전체를 소유 (치팅 방지).
 */

import { Card, ClassName } from "@/engine";

export type Phase =
  | "lobby"
  | "coin_toss"
  | "pick_class"
  | "pick_boon"
  | "battle"
  | "ended";

export type EndReason =
  | "hp_zero"
  | "mutual_hp_zero"
  | "turn_limit"
  | "turn_limit_draw"
  | "safety_break";

/** 방 안에서 모두가 볼 수 있는 플레이어 공개 정보. */
export interface PlayerPublic {
  connectionId: string;
  name: string;
  ready: boolean;
  className: ClassName | null;
  boonId: string | null;
  /** 도박사 패시브: 리롤 남은 횟수 (본인에게만 의미, 전원 공개 OK) */
  boonRerollsLeft: number;
  hp: number;
  maxHp: number;
  shield: number;
  handCount: number;
  deckCount: number;
  graveyardCount: number;
  /** 이번 턴 사용 가능한 카드 수 (기본 2 + 부운 보너스). 드롭존 개수 결정용. */
  maxCardsPerTurn: number;
  /** 지속 상태 요약 — UI 표시용. chip 표기 + 명중률/피해량 프리뷰 계산에 사용. */
  statuses: {
    // 지속형 (턴 수 포함)
    poisonTurns: number;
    poisonDamage: number;
    rageStacks: number;
    berserkTurns: number;
    berserkAccBonus: number;
    berserkDamageBonus: number;
    incomingDamageMult: number;
    incomingDamageMultTurns: number;
    betCapOverride: number | null;
    betCapOverrideTurns: number;
    // 다음 1회 (사용 시 소멸)
    nextAccBonus: number;
    nextCritBonus: number;
    guaranteeNextCrit: boolean;
    dodgeNextPercent: number;
    nextAttackMissChance: number;
    // 봉인
    silencedCardCount: number;
    // 시그니처 사용 기록 (핸드 비활성화 판정용)
    sigUsedIds: string[];
    sigUsedThisTurn: boolean;
  };
}

// ======================================================================
//   Client → Server
// ======================================================================

export type ClientMsg =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "pick_class"; className: ClassName }
  | { type: "pick_boon"; boonId: string }
  | { type: "reroll_boon" } // 도박사 패시브 — 부운 3개 재추첨
  | { type: "play_card"; cardId: string; bet: number }
  | { type: "end_turn" }
  | { type: "rematch" }
  /** 덱/묘지 열람 요청. 응답은 "pile" 메시지. 전투 단계에서만 의미 있음. */
  | { type: "view_pile"; side: "me" | "opp"; kind: "deck" | "grave" };

// ======================================================================
//   Server → Client
// ======================================================================

export type ServerMsg =
  | { type: "connected"; connectionId: string; roomId: string }
  | { type: "error"; message: string }
  | {
      type: "room";
      phase: Phase;
      players: PlayerPublic[];
      firstPickId: string | null;
      activeId: string | null;
      turn: number;
    }
  // 픽 단계 이벤트
  | { type: "coin_toss"; firstPickId: string }
  | { type: "class_options"; disabled: ClassName[] } // 후픽에게 미러 금지 알림 (본인에게만)
  | { type: "boon_options"; options: string[] } // 본인에게만 보내는 부운 후보 (3~4개)
  // 전투 이벤트
  | {
      type: "hand";
      hand: Card[];
      /** 이번 턴 사용 불가인 카드 ID 목록 (컨트롤러 패시브 등) */
      silenced?: string[];
    } // 본인에게만
  | {
      type: "peek";
      cardId: string;
      cardName: string;
    } // 본인에게만 (기존: 컨트롤러 peek — deprecated, 남겨둠)
  | {
      type: "passive_silence";
      /** 컨트롤러 패시브로 침묵된 상대 카드 */
      cardId: string;
      cardName: string;
    } // 컨트롤러 본인에게만 — 상대 카드 하나 침묵시킴 알림
  | CardPlayedMsg
  /** view_pile 응답. cardIds=null → 숨김(상대 덱). 요청자 본인에게만. */
  | {
      type: "pile";
      side: "me" | "opp";
      kind: "deck" | "grave";
      cardIds: string[] | null;
    }
  | { type: "turn_changed"; activeId: string; turn: number }
  | {
      type: "ended";
      winnerId: string | null;
      reason: EndReason;
      p1Stats: PlayerStatsPublic;
      p2Stats: PlayerStatsPublic;
    };

export interface PlayerStatsPublic {
  connectionId: string;
  name: string;
  totalBet: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  critCount: number;
  missCount: number;
  finalHp: number;
}

export interface CardPlayedMsg {
  type: "card_played";
  by: string;
  cardId: string;
  cardName: string;
  bet: number;
  success: boolean;
  critical: boolean;
  damageToOpponent: number;
  damageToSelf: number;
  heal: number;
  shieldGained: number;
  notes: string[];
  jackpotRoll: number | null;
  /** hit 카드의 실제 판정에 쓰인 명중률(0~100). 버프/베팅/부운 전부 반영. 룰렛 표시용. */
  accUsed?: number;
  /** crit 카드의 실제 판정에 쓰인 치명률(0~100). 베팅/부운 반영. 룰렛 표시용. */
  critChanceUsed?: number;
}

// ======================================================================
//   공통
// ======================================================================

export const MAX_PLAYERS_PER_ROOM = 2;
export const PICK_TIMER_SEC = 15;
