/**
 * 카드 키워드 추출기 + 글로서리.
 *
 * 기존 카드 데이터(`extra` 필드 등) 를 사용자 친화적인 "키워드 칩" 으로 변환한다.
 * 카드 표면에는 칩만 노출하고, 사용자가 호버하면 글로서리에서 풀 설명을 보여줌.
 *
 * 이 파일은 데이터를 *해석* 만 하며 게임 로직은 건드리지 않는다 (card-exec.ts 와 분리).
 */

import { Card } from "./types";

/** 카드에 부착되는 키워드 칩 1개. desc 는 글로서리에서 가져옴. */
export interface KeywordChip {
  /** 글로서리 키 */
  key: KeywordKey;
  /** 칩에 표시할 짧은 라벨 (예: "흡혈 30%", "자해 5") */
  label: string;
}

export type KeywordKey =
  | "lifesteal"
  | "pierce"
  | "self_damage"
  | "self_damage_on_miss"
  | "multi_hit"
  | "execute"
  | "patience"
  | "punish"
  | "silence"
  | "bind"
  | "draw"
  | "search"
  | "shield"
  | "self_shield"
  | "heal"
  | "cleanse"
  | "rage"
  | "berserk"
  | "dodge"
  | "force_miss"
  | "poison"
  | "deck_peek"
  | "opponent_deck_peek"
  | "redraw"
  | "guarantee_crit"
  | "next_acc"
  | "next_crit"
  | "negate"
  | "jackpot"
  | "double_down"
  | "final_judgment"
  | "condition_low_hp"
  | "condition_below_opp"
  | "damage_range";

interface GlossaryEntry {
  /** 칩 표면의 짧은 이름 (라벨 prefix) */
  name: string;
  /** 호버/모달에 보여줄 풀 설명 */
  desc: string;
  /** 칩 색 분류 — UI 가 다르게 칠함 */
  flavor: "buff" | "debuff" | "self_cost" | "utility" | "special";
}

export const KEYWORD_GLOSSARY: Record<KeywordKey, GlossaryEntry> = {
  lifesteal: {
    name: "흡혈",
    desc: "명중에 성공하면 입힌 피해의 일정 비율을 자신 HP 로 회복.",
    flavor: "buff",
  },
  pierce: {
    name: "관통",
    desc: "상대 방어(실드) 를 무시하고 직접 HP 에 피해.",
    flavor: "buff",
  },
  self_damage: {
    name: "자해",
    desc: "발동 즉시 자신이 일정 HP 를 잃음.",
    flavor: "self_cost",
  },
  self_damage_on_miss: {
    name: "자해(빗맞)",
    desc: "공격이 빗나가면 자신이 일정 HP 를 잃음. 일부 카드는 베팅한 만큼.",
    flavor: "self_cost",
  },
  multi_hit: {
    name: "다중 명중",
    desc: "같은 데미지로 명중 판정을 여러 번 굴림. 각각 독립.",
    flavor: "buff",
  },
  execute: {
    name: "처형",
    desc: "상대 HP 가 임계값 이하면 명중률 또는 데미지에 보너스.",
    flavor: "buff",
  },
  patience: {
    name: "인내",
    desc: "그동안 자신이 받은 누적 피해에 비례해 데미지 결정 (상한 있음).",
    flavor: "special",
  },
  punish: {
    name: "응징",
    desc: "상대가 직전 턴 공격에 성공했으면 데미지 추가.",
    flavor: "buff",
  },
  silence: {
    name: "사일런스",
    desc: "상대 손패의 카드 1장을 1턴간 사용 불가로.",
    flavor: "debuff",
  },
  bind: {
    name: "결박",
    desc: "상대 다음 턴 베팅 상한을 강제로 낮춤.",
    flavor: "debuff",
  },
  draw: {
    name: "드로우",
    desc: "덱에서 카드를 추가로 뽑음.",
    flavor: "utility",
  },
  search: {
    name: "서치",
    desc: "덱에서 특정 카드를 찾아 손에 넣음.",
    flavor: "utility",
  },
  shield: {
    name: "방어",
    desc: "이번 턴 받는 데미지를 흡수하는 실드 획득.",
    flavor: "buff",
  },
  self_shield: {
    name: "자기 방어",
    desc: "공격과 동시에 자신에게 실드 부여.",
    flavor: "buff",
  },
  heal: {
    name: "회복",
    desc: "자신의 HP 를 회복.",
    flavor: "buff",
  },
  cleanse: {
    name: "정화",
    desc: "자신의 디버프(독·침묵·결박 등) 를 제거.",
    flavor: "buff",
  },
  rage: {
    name: "분노",
    desc: "분노 스택 +1. 다음 공격 카드의 데미지가 스택당 +8 증가.",
    flavor: "buff",
  },
  berserk: {
    name: "베르세르크",
    desc: "수 턴 동안 명중률·데미지 증가, 단 매 턴 자해.",
    flavor: "special",
  },
  dodge: {
    name: "회피",
    desc: "다음에 받을 공격을 일정 확률로 무효.",
    flavor: "buff",
  },
  force_miss: {
    name: "블러프",
    desc: "상대의 다음 공격을 일정 확률로 강제 빗나감.",
    flavor: "debuff",
  },
  poison: {
    name: "독",
    desc: "상대가 매 턴 일정 데미지 (방어 무시).",
    flavor: "debuff",
  },
  deck_peek: {
    name: "예지",
    desc: "내 덱 상단을 미리 확인.",
    flavor: "utility",
  },
  opponent_deck_peek: {
    name: "투시",
    desc: "상대 덱 상단을 확인.",
    flavor: "utility",
  },
  redraw: {
    name: "리드로우",
    desc: "손패를 모두 버리고 같은 수를 새로 뽑음.",
    flavor: "utility",
  },
  guarantee_crit: {
    name: "운명 조작",
    desc: "다음 사용 카드 1장의 크리를 확정.",
    flavor: "special",
  },
  next_acc: {
    name: "조준",
    desc: "다음 사용 카드 1장의 명중률 보너스.",
    flavor: "buff",
  },
  next_crit: {
    name: "집중",
    desc: "다음 사용 카드 1장의 크리율 보너스.",
    flavor: "buff",
  },
  negate: {
    name: "무효 선언",
    desc: "수 턴간 받는 모든 피해를 일정 비율로 감소.",
    flavor: "special",
  },
  jackpot: {
    name: "잭팟",
    desc: "1d10 주사위 결과로 효과 결정. 베팅이 굴림에 보너스.",
    flavor: "special",
  },
  double_down: {
    name: "더블 다운",
    desc: "직전 사용 카드를 베팅 0 으로 한 번 더 발동.",
    flavor: "special",
  },
  final_judgment: {
    name: "최후의 심판",
    desc: "데미지 = 이번 게임에서 자신이 베팅한 HP. 모든 효과 무시.",
    flavor: "special",
  },
  condition_low_hp: {
    name: "결사",
    desc: "내 HP 가 일정 이하일 때만 사용 가능.",
    flavor: "self_cost",
  },
  condition_below_opp: {
    name: "역전",
    desc: "내 HP 가 상대 HP 보다 낮을 때만 사용 가능.",
    flavor: "self_cost",
  },
  damage_range: {
    name: "변동 데미지",
    desc: "데미지가 범위 내에서 무작위로 결정.",
    flavor: "special",
  },
};

// --------------------------------------------------------------------------------
//  추출기 — 카드 raw 의 extra 필드를 키워드 칩 배열로 변환
// --------------------------------------------------------------------------------

/**
 * 카드의 효과(extra/flag) 를 사용자에게 보여줄 키워드 칩으로 변환.
 * 게임 로직에 영향 없음 — 표시 전용.
 */
export function extractKeywords(card: Card): KeywordChip[] {
  const chips: KeywordChip[] = [];
  const ex = card.extra;
  const push = (key: KeywordKey, suffix?: string) => {
    const g = KEYWORD_GLOSSARY[key];
    chips.push({ key, label: suffix ? `${g.name} ${suffix}` : g.name });
  };

  // ---- 공격 카드 키워드 ----
  if (typeof ex.lifesteal === "number") {
    push("lifesteal", `${Math.round(ex.lifesteal * 100)}%`);
  }
  if (ex.ignore_shield === true) push("pierce");
  if (typeof ex.self_damage === "number" && ex.self_damage > 0) {
    push("self_damage", `${ex.self_damage}`);
  }
  if (typeof ex.self_damage_on_miss === "number") {
    push("self_damage_on_miss", `${ex.self_damage_on_miss}`);
  } else if (ex.self_damage_on_miss === "bet_amount") {
    push("self_damage_on_miss", "= 베팅");
  }
  if (typeof ex.hit_count === "number" && ex.hit_count > 1) {
    push("multi_hit", `×${ex.hit_count}`);
  }
  if (
    typeof ex.execute_threshold === "number" ||
    typeof ex.execute_bonus_acc === "number"
  ) {
    const t = ex.execute_threshold as number | undefined;
    push("execute", t !== undefined ? `≤${t}` : undefined);
  }
  if (ex.patience) push("patience");
  if (typeof ex.punish_hit_prev === "number") {
    push("punish", `+${ex.punish_hit_prev}`);
  }
  if (typeof ex.silence_random === "number") push("silence");
  if (typeof ex.opponent_max_bet_next === "number") {
    push("bind", `≤${ex.opponent_max_bet_next}`);
  }
  if (Array.isArray(ex.damage_range)) {
    const [lo, hi] = ex.damage_range as [number, number];
    push("damage_range", `${lo}~${hi}`);
  }
  if (ex.final_judgment_self_only) push("final_judgment");
  if (ex.jackpot) push("jackpot");
  if (ex.repeat_last) push("double_down");
  const cond = ex.condition as
    | { self_hp_max?: number; self_hp_below_opp?: boolean }
    | undefined;
  if (cond?.self_hp_max !== undefined) {
    push("condition_low_hp", `HP ≤${cond.self_hp_max}`);
  }
  if (cond?.self_hp_below_opp) {
    push("condition_below_opp", "HP < 상대");
  }

  // ---- 유틸 카드 키워드 ----
  if (typeof ex.shield === "number" && ex.shield > 0) {
    push("shield", `+${ex.shield}`);
  }
  if (typeof ex.self_shield === "number" && ex.self_shield > 0) {
    push("self_shield", `+${ex.self_shield}`);
  }
  if (typeof ex.self_heal === "number" && ex.self_heal > 0) {
    push("heal", `+${ex.self_heal}`);
  }
  if (ex.cleanse === true) push("cleanse");
  if (typeof ex.rage_stack === "number" && ex.rage_stack > 0) {
    push("rage", `+${ex.rage_stack}`);
  }
  if (ex.berserk_mode) push("berserk");
  if (typeof ex.dodge_next === "number") push("dodge", `${ex.dodge_next}%`);
  if (typeof ex.force_miss_next === "number") {
    push("force_miss", `${ex.force_miss_next}%`);
  }
  if (ex.poison) {
    const p = ex.poison as { damage: number; turns: number };
    push("poison", `${p.damage}/${p.turns}T`);
  }
  if (typeof ex.deck_peek === "number") push("deck_peek", `${ex.deck_peek}`);
  if (typeof ex.opponent_deck_peek === "number") {
    push("opponent_deck_peek", `${ex.opponent_deck_peek}`);
  }
  if (ex.redraw_hand === true) push("redraw");
  if (ex.guarantee_next_crit === true) push("guarantee_crit");
  if (typeof ex.next_acc_bonus === "number") {
    push("next_acc", `+${ex.next_acc_bonus}%`);
  }
  if (typeof ex.next_crit_bonus === "number") {
    push("next_crit", `+${ex.next_crit_bonus}%`);
  }
  if (typeof ex.negate_ratio === "number") {
    const turns = (ex.negate_turns as number | undefined) ?? 1;
    push("negate", `×${ex.negate_ratio} (${turns}T)`);
  }
  if (typeof ex.draw === "number" && ex.draw > 0) {
    push("draw", `+${ex.draw}`);
  }
  if (ex.search_attack === true) push("search");

  return chips;
}
