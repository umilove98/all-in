/**
 * ALL-IN 엔진 타입 정의.
 * Python `cli/allin/` 의 dataclass/필드를 1:1 포팅.
 * JSON snake_case → TS camelCase 로 변환하되, extra/effect 내부 키는 원본 유지.
 */

export const CLASS_NAMES = ["berserker", "gambler", "warden"] as const;
export type ClassName = (typeof CLASS_NAMES)[number];

export type CardType = "hit" | "crit" | "fixed" | "utility";
export type CardCategory = "attack" | "defense" | "utility" | "signature";

/** 표시 계층용. type 을 사용자에게 노출할 때 쓰는 단순화된 분류. */
export type DisplayType = "attack" | "utility";

export interface Card {
  id: string;
  name: string;
  nameEn: string;
  type: CardType;
  category: CardCategory;
  /** 짧은 설명. 카드 앞면에 1~2줄로 노출. */
  desc: string;
  /** 상세 설명. 카드 hover 시 툴팁으로 노출. desc 가 요약이라면 descLong 이 풀 규칙 설명. */
  descLong: string;
  cost: number;
  maxBet: number;
  damage: number;
  baseAcc: number;
  baseCrit: number;
  critMult: number;
  betAcc: number;
  betCrit: number;
  betDamage: number;
  signature: boolean;
  /** 카드별 특수 효과. 키는 JSON 원본 그대로 (예: self_damage_on_miss, hit_count, jackpot) */
  extra: Record<string, unknown>;
  /** 표시용 키워드 칩. 데이터 로딩 시 extra 에서 자동 추출. 게임 로직 영향 없음. */
  keywords: import("./keywords").KeywordChip[];
}

/** 사용자에게 보여질 단일 type 라벨. utility 만 분리, hit/crit/fixed 는 모두 attack. */
export function displayType(t: CardType): DisplayType {
  return t === "utility" ? "utility" : "attack";
}

export const BOON_CATEGORIES = [
  "steady",
  "aggressive",
  "risky",
  "utility",
] as const;
export type BoonCategory = (typeof BOON_CATEGORIES)[number];

export interface Boon {
  id: string;
  name: string;
  nameEn: string;
  emoji: string;
  category: BoonCategory;
  desc: string;
  /** 효과 파라미터. 키는 JSON 원본 그대로 (예: hp_bonus, damage_reduction, heal_per_turn) */
  effect: Record<string, number>;
  synergy: string[];
  counterAgainst: string[];
  note: string;
}

// ---- JSON 공통 ------------------------------------------------------------------

export interface CardMeta {
  version?: string;
  total_cards?: number;
  card_types?: Record<string, string>;
  categories?: string[];
  common_rules?: {
    signature_usage_per_game: number;
    signature_unlock_turn: number;
    signature_per_turn_limit: number;
    default_bet_max: number;
  };
}

export interface BoonMeta {
  version?: string;
  total_boons?: number;
  selection?: {
    default_options: number;
    /** 도박사 패시브: 부운 재추첨 가능 횟수 (v3 리롤권) */
    gambler_reroll_count: number;
    pick_count: number;
    pick_timer_seconds: number;
  };
  categories?: Record<string, string>;
}

// ---- 데미지 이벤트 (Player.take_damage 반환) -----------------------------------

export interface DamageEvent {
  requested: number;
  absorbedByShield: number;
  reducedByBoon: number;
  dealt: number;
  dodged: boolean;
}
