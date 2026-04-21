/**
 * 카드/부운 데이터 로더. `data/cards.json` 과 `data/boons.json` 을 단일 진실로 import.
 * 서버(PartyKit) 와 클라이언트(Vite) 양쪽에서 동일 함수 사용.
 */

import cardsJson from "@data/cards.json";
import boonsJson from "@data/boons.json";

import {
  BOON_CATEGORIES,
  Boon,
  BoonCategory,
  BoonMeta,
  CLASS_NAMES,
  Card,
  CardCategory,
  CardMeta,
  CardType,
  ClassName,
} from "./types";
import { extractKeywords } from "./keywords";

// ---- 내부: 카드 파서 ---------------------------------------------------------------

const CARD_COMMON_KEYS = new Set([
  "id",
  "name",
  "name_en",
  "type",
  "category",
  "desc",
  "desc_long",
  "cost",
  "max_bet",
  "damage",
  "base_acc",
  "base_crit",
  "crit_mult",
  "bet_acc",
  "bet_crit",
  "bet_damage",
  "signature",
]);

function parseCard(raw: Record<string, unknown>): Card {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!CARD_COMMON_KEYS.has(k)) extra[k] = v;
  }
  const card: Card = {
    id: raw.id as string,
    name: raw.name as string,
    nameEn: (raw.name_en as string) ?? "",
    type: raw.type as CardType,
    category: raw.category as CardCategory,
    desc: (raw.desc as string) ?? "",
    descLong: (raw.desc_long as string) ?? "",
    cost: (raw.cost as number) ?? 0,
    maxBet: (raw.max_bet as number) ?? 0,
    damage: (raw.damage as number) ?? 0,
    baseAcc: (raw.base_acc as number) ?? 0,
    baseCrit: (raw.base_crit as number) ?? 0,
    critMult: (raw.crit_mult as number) ?? 1.0,
    betAcc: (raw.bet_acc as number) ?? 0,
    betCrit: (raw.bet_crit as number) ?? 0,
    betDamage: (raw.bet_damage as number) ?? 0,
    signature: (raw.signature as boolean) ?? false,
    extra,
    keywords: [],
  };
  card.keywords = extractKeywords(card);
  return card;
}

function parseBoon(raw: Record<string, unknown>): Boon {
  return {
    id: raw.id as string,
    name: raw.name as string,
    nameEn: (raw.name_en as string) ?? "",
    emoji: (raw.emoji as string) ?? "",
    category: raw.category as BoonCategory,
    desc: (raw.desc as string) ?? "",
    effect: { ...((raw.effect as Record<string, number>) ?? {}) },
    synergy: [...((raw.synergy as string[]) ?? [])],
    counterAgainst: [...((raw.counter_against as string[]) ?? [])],
    note: (raw.note as string) ?? "",
  };
}

// ---- 메모이즈 빌드 ------------------------------------------------------------------

interface CardsFile {
  meta: CardMeta;
  berserker: Record<string, unknown>[];
  gambler: Record<string, unknown>[];
  warden: Record<string, unknown>[];
}

interface BoonsFile {
  meta: BoonMeta;
  boons: Record<string, unknown>[];
}

const CARDS_FILE = cardsJson as unknown as CardsFile;
const BOONS_FILE = boonsJson as unknown as BoonsFile;

const DECKS: Record<ClassName, Card[]> = {
  berserker: CARDS_FILE.berserker.map(parseCard),
  gambler: CARDS_FILE.gambler.map(parseCard),
  warden: CARDS_FILE.warden.map(parseCard),
};

const ALL_CARDS: Card[] = CLASS_NAMES.flatMap((c) => DECKS[c]);
const CARD_INDEX = new Map<string, Card>(ALL_CARDS.map((c) => [c.id, c]));

const ALL_BOONS: Boon[] = BOONS_FILE.boons.map(parseBoon);
const BOON_INDEX = new Map<string, Boon>(ALL_BOONS.map((b) => [b.id, b]));

// ---- Public API --------------------------------------------------------------------

/** 직업 이름으로 15장 고정 덱 반환. 매 호출마다 새 배열(원본 보존). */
export function getDeck(className: ClassName): Card[] {
  if (!CLASS_NAMES.includes(className)) {
    throw new Error(
      `Unknown class: ${className}. Must be one of ${CLASS_NAMES.join(", ")}`,
    );
  }
  return [...DECKS[className]];
}

/** 45장 전체. */
export function getAllCards(): Card[] {
  return [...ALL_CARDS];
}

export function getCardById(cardId: string): Card {
  const c = CARD_INDEX.get(cardId);
  if (!c) throw new Error(`Card not found: ${cardId}`);
  return c;
}

export function getCardMeta(): CardMeta {
  return CARDS_FILE.meta;
}

/** 부운 10종 전체. */
export function getAllBoons(): Boon[] {
  return [...ALL_BOONS];
}

export function getBoonById(boonId: string): Boon {
  const b = BOON_INDEX.get(boonId);
  if (!b) throw new Error(`Boon not found: ${boonId}`);
  return b;
}

export function getBoonMeta(): BoonMeta {
  return BOONS_FILE.meta;
}

export function filterBoonsByCategory(category: BoonCategory): Boon[] {
  if (!BOON_CATEGORIES.includes(category)) {
    throw new Error(
      `Unknown category: ${category}. Must be one of ${BOON_CATEGORIES.join(", ")}`,
    );
  }
  return ALL_BOONS.filter((b) => b.category === category);
}
