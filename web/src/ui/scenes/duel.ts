/**
 * Underground Duel Scene — 전투 화면.
 * design handoff (Underground Duel.html / GameField.jsx + Card.jsx) 1:1 포팅.
 * 클래스명/DOM 구조/레이아웃은 프로토타입과 동일하고, 내부 데이터는 전부
 * app.state (서버 state) 에서 파생된다. React 대신 DOM innerHTML + 포인터
 * 이벤트로 구현.
 */

import { App } from "../../app";
import {
  Card,
  KEYWORD_GLOSSARY,
  getBoonById,
  getCardById,
} from "../../engine";
import { CardPlayedMsg, PlayerPublic } from "../../net/protocol";
import { ensureStage } from "../sceneStage";

const ACTIVE_CLASS = "duel-active";

// =====================================================================
// 디자인 번들의 전역 상수 (data.js) 와 동일
// =====================================================================

const CARD_TYPE: Record<
  string,
  {
    label: string;
    glyph: string;
    color: string;
    ink: string;
    glow: string;
    stat: string;
  }
> = {
  hit: {
    label: "명중 · HIT",
    glyph: "✴",
    color: "#b22233",
    ink: "#3a0810",
    glow: "rgba(220, 70, 60, 0.55)",
    stat: "ACC",
  },
  crit: {
    label: "치명 · CRIT",
    glyph: "✦",
    color: "#b8882a",
    ink: "#2e1f08",
    glow: "rgba(230, 180, 60, 0.55)",
    stat: "CRIT",
  },
  fixed: {
    label: "확정 · FIXED",
    glyph: "■",
    color: "#3d6e5a",
    ink: "#0d2a22",
    glow: "rgba(90, 180, 140, 0.45)",
    stat: "FIXED",
  },
  utility: {
    label: "책략 · UTIL",
    glyph: "❖",
    color: "#6b4e82",
    ink: "#1d0f2a",
    glow: "rgba(180, 140, 220, 0.45)",
    stat: "UTIL",
  },
};

const CLASS_INFO: Record<
  "berserker" | "gambler" | "warden",
  { name: string; glyph: string; title: string; passive: string }
> = {
  berserker: {
    name: "광전사",
    glyph: "🔥",
    title: "광전사 · 광기의 각인",
    passive: "베팅 1당 추가 명중률 +2%",
  },
  gambler: {
    name: "도박사",
    glyph: "🎲",
    title: "도박사 · 운명의 총아",
    passive: "부운 리롤 1회",
  },
  warden: {
    name: "컨트롤러",
    glyph: "🛡",
    title: "감시자 · 감시의 눈",
    passive: "매 턴 상대 손패 1장 랜덤 봉인",
  },
};

/** 카드 프레임 색상 — owner 클래스 기준. 타입 글리프/라벨 텍스트 색은 CARD_TYPE
 *  유지하되 프레임(border/glow/accent)만 클래스 팔레트로 덮어쓴다. */
const CLASS_CARD_PALETTE: Record<
  "berserker" | "gambler" | "warden",
  { color: string; ink: string; glow: string }
> = {
  berserker: {
    color: "#c9a961", // 금/노랑
    ink: "#2a1f0a",
    glow: "rgba(201,169,97,0.55)",
  },
  gambler: {
    color: "#5b7ecc", // 파랑
    ink: "#0e1a30",
    glow: "rgba(91,126,204,0.55)",
  },
  warden: {
    color: "#9098a0", // 회색
    ink: "#1a1c20",
    glow: "rgba(144,152,160,0.50)",
  },
};

// =====================================================================
// 드래그/오버레이 로컬 상태 (re-render 간 유지)
// =====================================================================

interface DragState {
  card: Card;
  pointerId: number;
  ghostEl: HTMLElement;
  stage: HTMLElement;
  offsetX: number;
  offsetY: number;
  hoverSlotIdx: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
}

let dragState: DragState | null = null;

// 턴 타이머 — 60초. turn 이 바뀌면 리셋, 0 도달 시 내 턴이면 auto end_turn.
const TURN_TIMER_SECONDS = 60;
let turnTimerStartedAt: number | null = null;
let turnTimerIntervalId: number | null = null;
let lastSeenTurn = -1;

// Roulette 스핀 상태: card_played 이벤트를 받으면 다단계 stages 로 세팅.
// 각 단계마다 휠이 돌고 결과 reveal 후 다음 단계로.
//   - hit:   카드 명중 룰렛. 도박사 카드면 gold 크리 영역 동봉.
//   - bluff: 시전자에게 블러프 발동 시. red 영역 = 강제 miss.
//   - dodge: 적에게 회피 버프 있을 때. blue 영역 = 회피 성공(데미지 0).
type RouletteStageKind = "hit" | "bluff" | "dodge";
interface RouletteStage {
  kind: RouletteStageKind;
  /** 표시용 라벨 (예: "명중 판정", "회피 판정") */
  label: string;
  /** 휠 성공 영역 비율 (0~100) — 이 영역에 포인터 멈추면 success 처리 */
  successPct: number;
  /** hit 단계에서 도박사 카드일 때 gold 영역 비율 (0~100). 성공 영역 안의 일부. */
  critPct?: number;
  /** 서버가 정한 결과 (success=룰렛 성공 영역에 멈춤) */
  isSuccess: boolean;
  /** crit 결과 (hit 단계에서만 의미). gold 영역 안에 멈춘 것으로 표현 */
  isCrit: boolean;
  targetAngle: number;
  phase: "spinning" | "revealed";
}
interface RouletteSpin {
  evt: CardPlayedMsg;
  card: Card;
  stages: RouletteStage[];
  currentIdx: number;
  startedAt: number;
}
let roulette: RouletteSpin | null = null;
let lastRouletteEventKey = ""; // 중복 트리거 방지
let rouletteStageStartedAt = 0;  // 현재 단계 시작 시각 (단계 진행 타이머)
let rouletteAdvanceTimer: number | null = null;
const ROULETTE_SPIN_MS = 2200;
const ROULETTE_REVEAL_MS = 900;

// pending turn (card_played 간 slot 표시용) — 최근 사용된 카드의 정보
interface SlotContent {
  card: Card;
  result: "hit" | "crit" | "miss" | "cast";
  bet: number;
}
// 슬롯 배열은 maxCardsPerTurn 에 맞춰 동적 크기 — 풍요의 손(BN09) 같은 부운 반영
let selfSlots: Array<SlotContent | null> = [];
let oppSlots: Array<SlotContent | null> = [];
let slotTurn = -1; // 턴이 바뀌면 slots 초기화

function ensureSlotSize(
  arr: Array<SlotContent | null>,
  size: number,
): Array<SlotContent | null> {
  if (arr.length === size) return arr;
  const next: Array<SlotContent | null> = [];
  for (let i = 0; i < size; i++) next.push(arr[i] ?? null);
  return next;
}

/** 엔트리 포인트. */
export function renderDuelScene(
  root: HTMLElement,
  app: App,
  me: PlayerPublic,
  opp: PlayerPublic,
): void {
  const stage = ensureStage(root, ACTIVE_CLASS);
  const s = app.state;

  // 슬롯 크기 동기화 — maxCardsPerTurn 기준 (부운 효과 반영)
  selfSlots = ensureSlotSize(selfSlots, Math.max(1, me.maxCardsPerTurn));
  oppSlots = ensureSlotSize(oppSlots, Math.max(1, opp.maxCardsPerTurn));

  // Turn 바뀌면 slot 기록 + 타이머 리셋
  if (s.turn !== slotTurn) {
    for (let i = 0; i < selfSlots.length; i++) selfSlots[i] = null;
    for (let i = 0; i < oppSlots.length; i++) oppSlots[i] = null;
    slotTurn = s.turn;
  }
  if (s.turn !== lastSeenTurn && s.turn > 0) {
    lastSeenTurn = s.turn;
    startTurnTimer(app);
  }

  // 현재 처리 중인 card_played 이벤트로 roulette 세팅
  maybeStartRoulette(app);
  // 플레이 기록을 slot 에 반영
  reflectPlaysToSlots(app, me, opp);

  const isMyTurn = s.activeId === s.myId;
  const pendingCard = s.selectedCardId
    ? s.hand.find((c) => c.id === s.selectedCardId) ?? null
    : null;
  const sigUnlockTurn = 3;
  const sigLocked = s.turn < sigUnlockTurn;

  // 스테이지 구조: gameField 는 매 렌더마다 갱신되지만 rouletteMount 는
  // 유지돼서 휠 transform transition 이 끊기지 않는다.
  if (!stage.querySelector("#duelGameFieldHost")) {
    stage.innerHTML = `
      <div id="duelGameFieldHost"></div>
      <div id="duelRouletteMount"></div>
    `;
  }
  const host = stage.querySelector<HTMLElement>("#duelGameFieldHost")!;

  host.innerHTML = `
    <div class="gameField">
      <div class="bgRoom"></div>
      <div class="bgVignette"></div>
      <div class="bgSmoke"></div>
      <div class="candleLeft"></div>
      <div class="candleRight"></div>

      <div class="hudTop">
        <div class="hudTopLeft">
          ${playerCardHtml(opp, { flip: true, self: false })}
          ${hpBarHtml(opp, { flip: true })}
          ${statusBadgesHtml(opp)}
        </div>
        <div class="hudTopMid"></div>
        <div class="hudTopRight">
          ${deckPileHtml(opp.deckCount, "덱", "opp", "opp-deck")}
          ${deckPileHtml(opp.graveyardCount, "묘지", "pyre", "opp-grave")}
        </div>
      </div>

      <div class="oppHandRow">${oppHandHtml(opp.handCount, opp.className ?? "gambler")}</div>

      <div class="tableStage">
        <div class="battleRow battleRowOpp">
          ${oppSlots
            .map((slot, i) =>
              dropZoneHtml(
                slot,
                "opp",
                opp.className ?? undefined,
                `상대 슬롯 ${i + 1}`,
                i,
              ),
            )
            .join("")}
        </div>

        <div class="tableCenter">
          <div class="tableLeft">
            ${turnBannerHtml(s.turn, isMyTurn)}
          </div>
          <div class="tableMid">
            <div class="tableDivider">
              <span class="divGlyph">❦</span>
              <span class="divText">— DRAG CARD TO BATTLE</span>
              <span class="divGlyph">❦</span>
            </div>
          </div>
          <div class="tableRight">
            ${actionLogHtml(app)}
          </div>
        </div>

        <div class="battleRow battleRowSelf">
          ${selfSlots
            .map((slot, i) =>
              dropZoneHtml(
                slot,
                "self",
                me.className ?? undefined,
                `슬롯 ${i + 1} · 드래그`,
                i,
              ),
            )
            .join("")}
        </div>
      </div>

      <div class="hudBottom">
        <div class="hudBottomLeft">
          ${playerCardHtml(me, { flip: false, self: true, active: isMyTurn })}
          ${hpBarHtml(me, { flip: false })}
          ${statusBadgesHtml(me)}
        </div>
        <div class="hudBottomMid"></div>
        <div class="hudBottomRight">
          <button class="btn btnPrimary btnEndTurn" id="duelEndTurn" ${
            isMyTurn && !s.isAnimating && !pendingCard ? "" : "disabled"
          }>턴 종료</button>
          ${deckPileHtml(me.deckCount, "덱", "self", "me-deck")}
          ${deckPileHtml(me.graveyardCount, "묘지", "pyre", "me-grave")}
        </div>
      </div>

      ${handHtml(app, me, opp, sigLocked)}

      ${pendingCard ? betOverlayHtml(pendingCard, me, s.pendingBet) : ""}
      ${pileModalHtml(app)}
      ${zoomCardHtml(app)}
    </div>
  `;

  wire(host, app, me, opp, sigLocked);

  // 룰렛 오버레이 — stage 수명 동안 mount-once 유지
  syncRouletteMount(stage);
}

/**
 * #duelRouletteMount 의 내용을 roulette 상태와 동기화.
 * - 없음 → mount 비우고 CSS transform 초기화
 * - spinning 첫 진입 → 휠을 transform:0 으로 마운트 + rAF 로 targetAngle 트리거 (CSS transition 이 2.5s 회전 보여줌)
 * - revealed 전환 → reveal 텍스트만 DOM 직접 갱신 (휠은 그대로)
 */
function syncRouletteMount(stageEl: HTMLElement): void {
  const mount = stageEl.querySelector<HTMLElement>("#duelRouletteMount");
  if (!mount) return;

  if (!roulette) {
    if (mount.innerHTML !== "") mount.innerHTML = "";
    return;
  }

  // 단계 진행: spin 끝나면 reveal, reveal 일정 시간 지나면 다음 단계로 advance
  advanceStageIfReady();

  const stage = roulette.stages[roulette.currentIdx];
  if (!stage) {
    mount.innerHTML = "";
    return;
  }

  const existingBackdrop = mount.querySelector<HTMLElement>(".rouletteBackdrop");
  const dataIdx = existingBackdrop?.dataset.stageIdx;
  const currentIdxStr = String(roulette.currentIdx);
  const isNewStage = !existingBackdrop || dataIdx !== currentIdxStr;

  if (isNewStage) {
    mount.innerHTML = rouletteOverlayHtml(stage, roulette.currentIdx);
    const wheel = mount.querySelector<HTMLElement>(".rouletteWheel");
    if (wheel) {
      wheel.style.transform = "rotate(0deg)";
      const target = stage.targetAngle;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (roulette && wheel.isConnected) {
            wheel.style.transform = `rotate(${target}deg)`;
          }
        });
      });
    }
    return;
  }

  // reveal 진입 시 결과 텍스트 추가
  const metaMeta = existingBackdrop.querySelector<HTMLElement>(".rouletteMeta");
  if (metaMeta) {
    const alreadyHasReveal = metaMeta.querySelector(".rouletteReveal");
    if (stage.phase === "revealed" && !alreadyHasReveal) {
      metaMeta.insertAdjacentHTML("beforeend", rouletteRevealHtml(stage));
    }
  }
}

/** 시간 경과에 따라 단계 phase 전환. spin → revealed → 다음 단계. */
function advanceStageIfReady(): void {
  if (!roulette) return;
  const stage = roulette.stages[roulette.currentIdx];
  if (!stage) return;
  const elapsed = Date.now() - rouletteStageStartedAt;
  if (stage.phase === "spinning" && elapsed >= ROULETTE_SPIN_MS) {
    stage.phase = "revealed";
    return;
  }
  if (
    stage.phase === "revealed" &&
    elapsed >= ROULETTE_SPIN_MS + ROULETTE_REVEAL_MS &&
    roulette.currentIdx < roulette.stages.length - 1
  ) {
    roulette.currentIdx += 1;
    rouletteStageStartedAt = Date.now();
  }
}

// =====================================================================
// Roulette 상태 관리 — card_played 이벤트 기반
// =====================================================================

/**
 * 룰렛 상태 동기화 — currentEvent 가 있고 rolling phase 면 준비.
 * 실제 DOM 마운트/회전 트리거는 mountRouletteOverlay() 가 렌더 후에 담당.
 */
function maybeStartRoulette(app: App) {
  const evt = app.state.currentEvent;
  if (!evt || app.state.currentEventPhase !== "rolling") {
    if (!evt) {
      roulette = null;
      lastRouletteEventKey = "";
    } else if (app.state.currentEventPhase === "result" && roulette) {
      // 결과 phase: 마지막 단계 강제 reveal
      const last = roulette.stages[roulette.currentIdx];
      if (last) last.phase = "revealed";
    }
    return;
  }
  const key = `${evt.by}:${evt.cardId}:${evt.bet}:${app.state.turn}`;
  if (key === lastRouletteEventKey && roulette) return;
  lastRouletteEventKey = key;

  let card: Card;
  try {
    card = getCardById(evt.cardId);
  } catch {
    return;
  }

  // utility 카드는 룰렛 스킵 (잭팟 등 자체 효과는 별도 표기)
  if (card.type === "utility") {
    roulette = null;
    return;
  }

  const stages: RouletteStage[] = [];

  // ---- Stage 1: Bluff (시전자 강제 miss) ----
  const bluffChance =
    typeof evt.bluffChance === "number" ? evt.bluffChance : 0;
  if (bluffChance > 0) {
    const triggered = !!evt.bluffTriggered;
    stages.push(
      buildStage("bluff", "블러프 판정", bluffChance, triggered, false),
    );
  }

  // ---- Stage 2: Hit (acc 영역 + crit gold 영역) ----
  // 블러프 발동된 경우 hit 단계는 굴리지 않고 표시만 (정보)
  const accUsed = typeof evt.accUsed === "number" ? evt.accUsed : 100;
  const critChance =
    card.type === "crit" && typeof evt.critChanceUsed === "number"
      ? evt.critChanceUsed
      : undefined;
  const bluffWillTrigger =
    bluffChance > 0 && evt.bluffTriggered === true;
  const skipHitForBluff = bluffWillTrigger;
  const hitSuccess = !skipHitForBluff && evt.success === true
    || (!skipHitForBluff && evt.dodged === true) // 회피로 무효화돼도 hit 자체는 성공
    || (!skipHitForBluff && evt.critical === true);
  // Fixed 는 항상 100% acc, hit 룰렛 스킵 가능
  const showHitWheel = !skipHitForBluff && card.type !== "fixed" && accUsed < 100;
  if (showHitWheel) {
    const stage = buildStage(
      "hit",
      card.type === "crit" ? "명중 / 치명 판정" : "명중 판정",
      accUsed,
      hitSuccess,
      evt.critical === true,
    );
    if (typeof critChance === "number" && critChance > 0) {
      // gold 크리 영역 — acc 영역 안에 동봉 (success 영역의 일부)
      stage.critPct = Math.min(critChance, accUsed);
      // 크리 발동이면 gold 영역(0~critPct°) 내부에 멈추도록 targetAngle 조정
      if (evt.critical) {
        stage.targetAngle = randomTargetInRange(0, stage.critPct);
      } else if (hitSuccess) {
        // hit but not crit → gold 바깥, 성공 영역 안
        stage.targetAngle = randomTargetInRange(stage.critPct, accUsed);
      }
    }
    stages.push(stage);
  }

  // ---- Stage 3: Dodge (적의 회피 굴림) ----
  const dodgeChance =
    typeof evt.dodgeChance === "number" ? evt.dodgeChance : 0;
  if (dodgeChance > 0) {
    const dodged = !!evt.dodged;
    stages.push(
      buildStage("dodge", "회피 판정", dodgeChance, dodged, false),
    );
  }

  if (stages.length === 0) {
    roulette = null;
    return;
  }

  roulette = {
    evt,
    card,
    stages,
    currentIdx: 0,
    startedAt: Date.now(),
  };
  rouletteStageStartedAt = Date.now();
  scheduleRouletteAdvance(app);
}

/** 단계 전환 시각마다 app.render() 호출. spin → reveal → next stage 자동 진행. */
function scheduleRouletteAdvance(app: App): void {
  if (rouletteAdvanceTimer !== null) {
    window.clearTimeout(rouletteAdvanceTimer);
    rouletteAdvanceTimer = null;
  }
  if (!roulette) return;
  const stage = roulette.stages[roulette.currentIdx];
  if (!stage) return;

  // 다음 깨어날 시점: spin 끝 또는 reveal 끝 (마지막 단계 아니면 다음 단계로)
  const elapsed = Date.now() - rouletteStageStartedAt;
  const isLast = roulette.currentIdx >= roulette.stages.length - 1;
  let nextMs: number;
  if (stage.phase === "spinning") {
    nextMs = Math.max(50, ROULETTE_SPIN_MS - elapsed);
  } else {
    if (isLast) return;  // 마지막 단계면 server result phase 가 reveal 전환 처리
    nextMs = Math.max(50, ROULETTE_SPIN_MS + ROULETTE_REVEAL_MS - elapsed);
  }

  rouletteAdvanceTimer = window.setTimeout(() => {
    rouletteAdvanceTimer = null;
    if (!roulette) return;
    app.render();
    scheduleRouletteAdvance(app);
  }, nextMs);
}

/** 단일 stage 생성. successDeg 영역 안/밖 어느 곳에 멈출지 결정. */
function buildStage(
  kind: RouletteStageKind,
  label: string,
  successPct: number,
  isSuccess: boolean,
  isCrit: boolean,
): RouletteStage {
  const successDeg = (successPct / 100) * 360;
  let landDeg: number;
  if (isSuccess) {
    landDeg = randomTargetInRange(0, successDeg);
  } else {
    landDeg = randomTargetInRange(successDeg, 360);
  }
  const spins = 5;
  const targetAngle = spins * 360 + (360 - landDeg);
  return {
    kind,
    label,
    successPct,
    isSuccess,
    isCrit,
    targetAngle,
    phase: "spinning",
  };
}

function randomTargetInRange(fromDeg: number, toDeg: number): number {
  const margin = 6;
  const lo = Math.min(toDeg - 1, fromDeg + margin);
  const hi = Math.max(fromDeg + 1, toDeg - margin);
  if (hi <= lo) return (fromDeg + toDeg) / 2;
  return lo + Math.random() * (hi - lo);
}

function reflectPlaysToSlots(app: App, me: PlayerPublic, opp: PlayerPublic) {
  // app.state.plays 는 턴 스탬프가 찍힌 모든 플레이. 현재 턴만 slot 에 반영.
  type StampedPlay = CardPlayedMsg & { turn: number };
  const plays = app.state.plays as unknown as StampedPlay[];
  const mine: SlotContent[] = [];
  const theirs: SlotContent[] = [];
  for (const p of plays) {
    if (p.turn !== app.state.turn) continue;
    let card: Card;
    try {
      card = getCardById(p.cardId);
    } catch {
      continue;
    }
    const result: SlotContent["result"] = p.critical
      ? "crit"
      : p.success
        ? p.damageToOpponent > 0
          ? "hit"
          : "cast"
        : "miss";
    const content: SlotContent = { card, result, bet: p.bet };
    if (p.by === me.connectionId) mine.push(content);
    else if (p.by === opp.connectionId) theirs.push(content);
  }
  for (let i = 0; i < selfSlots.length; i++)
    selfSlots[i] = mine[i] ?? null;
  for (let i = 0; i < oppSlots.length; i++)
    oppSlots[i] = theirs[i] ?? null;
}

// =====================================================================
// Card.jsx 1:1 포팅
// =====================================================================

/** 카드 데미지/효과 실시간 계산용 컨텍스트. 카드에 표기되는 숫자를 현재
 *  상태(버프/누적 베팅/누적 피해/상대 miss 여부 등)에 맞춰 계산하기 위함. */
interface CardStatCtx {
  me?: PlayerPublic;
  opp?: PlayerPublic;
  boonEffect?: Record<string, number>;
}

function cardHtml(
  card: Card | null,
  opts: {
    size?: "hand" | "field" | "back";
    owner?: string;
    locked?: boolean;
    lockMsg?: string;
    selected?: boolean;
    dragging?: boolean;
    playable?: boolean;
    ctx?: CardStatCtx;
  } = {},
): string {
  const size = opts.size ?? "hand";
  if (size === "back") {
    return `
      <div class="card cardBack" data-owner="${escapeAttr(opts.owner ?? "")}">
        <div class="cardBackPattern"></div>
        <div class="cardBackSeal">✦</div>
      </div>
    `;
  }
  if (!card) return "";
  const typePal = CARD_TYPE[card.type] ?? CARD_TYPE.hit!;
  const ownerKey = opts.owner as "berserker" | "gambler" | "warden" | undefined;
  const classPal = ownerKey ? CLASS_CARD_PALETTE[ownerKey] : null;
  // 카드 프레임(테두리/글로우/accent)은 owner 클래스 기준.
  // 타입 글리프/라벨 텍스트는 카드 type 기준 색상 유지 (가독성).
  const framePal = classPal ?? {
    color: typePal.color,
    ink: typePal.ink,
    glow: typePal.glow,
  };
  const isSig = Boolean(card.signature);

  const cls = ["card", `cardSize-${size}`];
  if (opts.selected) cls.push("cardSelected");
  if (opts.locked) cls.push("cardLocked");
  if (isSig) cls.push("cardSignature");
  if (opts.dragging) cls.push("cardDragging");

  const style = `--cardGlow:${framePal.glow}; --cardInk:${framePal.ink}; --cardAccent:${framePal.color}`;

  return `
    <div class="${cls.join(" ")}" data-owner="${escapeAttr(opts.owner ?? "")}" style="${style}">
      <div class="cardFrame">
        <div class="cardBorder"></div>
        <div class="cardInner">
          ${cornerFilSvg(false, opts.locked)}
          ${cornerFilSvg(true, opts.locked)}

          <div class="cardTopBar">
            <span class="cardTypeGlyph" style="color:${typePal.color}">${typePal.glyph}</span>
            <span class="cardTypeLabel">${typePal.label}</span>
            <span class="cardIdTag">${escapeHtml(card.id)}</span>
          </div>

          <div class="cardName">${escapeHtml(card.name)}</div>
          ${card.nameEn ? `<div class="cardNameEn">— ${escapeHtml(card.nameEn)} —</div>` : ""}

          ${cardArtHtml(card, typePal, isSig)}

          ${primaryStatHtml(card, opts.ctx ?? {})}

          <div class="cardDesc">${escapeHtml(cardDescText(card))}</div>

          ${keywordChipsHtml(card)}

          <div class="cardBetBar">
            ${
              card.maxBet > 0
                ? `<span class="cardBetIcon">❤</span>
                   <span class="cardBetLabel">HP 베팅</span>
                   <span class="cardBetMax">최대 ${card.maxBet}</span>`
                : `<span class="cardBetIcon" style="opacity:0.35">❤</span>
                   <span class="cardBetLabel" style="opacity:0.55">베팅 불가</span>`
            }
          </div>
        </div>
      </div>

      ${
        opts.locked
          ? `
        <div class="cardLockOverlay">
          <div class="cardLockIcon">✕</div>
          <div class="cardLockMsg">${escapeHtml(opts.lockMsg || "사용 불가")}</div>
        </div>
      `
          : ""
      }

      ${isSig ? `<div class="cardSigGlow"></div>` : ""}
      ${opts.selected ? `<div class="cardSelectedGlow"></div>` : ""}
    </div>
  `;
}

function cornerFilSvg(flip: boolean, locked: boolean | undefined): string {
  const c = locked ? "#5a3a1a" : "#c9a961";
  const t = flip ? "scale(-1,-1)" : "none";
  return `
    <svg viewBox="0 0 40 40" class="cardCorner" style="transform:${t}">
      <path d="M 3 3 L 34 3 M 3 3 L 3 34 M 3 3 C 10 5 14 9 14 16 M 34 3 C 32 10 28 14 22 14 M 3 34 C 5 28 9 24 16 24"
        stroke="${c}" stroke-width="0.9" fill="none" opacity="0.9"></path>
      <circle cx="14" cy="14" r="1.6" fill="${c}" opacity="0.9"></circle>
    </svg>
  `;
}

function cardArtHtml(
  _card: Card,
  pal: typeof CARD_TYPE[string],
  isSig: boolean,
): string {
  return `
    <div class="cardArt" style="background:linear-gradient(135deg, ${pal.ink} 0%, #0a0605 100%)">
      <div class="cardArtStripes"></div>
      <div class="cardArtGlyph" style="color:${pal.glow}; text-shadow:0 0 24px ${pal.glow}">
        ${isSig ? "⚜" : pal.glyph}
      </div>
      ${isSig ? `<div class="cardSigBadge">SIGNATURE</div>` : ""}
    </div>
  `;
}

/** me 의 부운 effect 값 (없으면 0). */
function boonEffect(me: PlayerPublic | undefined, key: string): number {
  if (!me?.boonId) return 0;
  try {
    const b = getBoonById(me.boonId);
    const v = b.effect[key];
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

/** 공격 카드 현재 예상 데미지.
 *
 * - `value`: 카드에 실제 표기할 숫자 (현재 상태 반영)
 * - `hasTempBuff`: 일시적(턴 제한 또는 1회 소모) 버프로 인해 값이 바뀐 상태인지.
 *   true 면 카드에 붉은색/볼드로 강조해 "이번 회차 한정" 임을 시각화.
 *
 * 집계 규칙:
 *   - 카드 고유 설계(기본 데미지 + W2 응징/W5 심판 조건부): 항상 포함, 강조 X
 *   - 부운 패시브(BN04 등): 항상 포함, 강조 X (게임 내내 유효한 빌드 효과)
 *   - 일시 버프(베르세르크 / 분노 스택): 포함 + 강조 O */
function computeAttackDamage(
  card: Card,
  ctx: CardStatCtx,
): { value: number; hasTempBuff: boolean } {
  // 카드 설계값: base + 조건부 보너스
  let value = card.damage;
  // W2 처벌의 빛: 상대 직전 턴 적중 시 +
  const punishHit = card.extra.punish_hit_prev as number | undefined;
  if (punishHit && ctx.opp?.hitLastTurn) value += punishHit;

  // 부운 (패시브 — 게임 전체 유효)
  value += boonEffect(ctx.me, "damage_bonus_all");

  // 일시 버프
  const berserk = ctx.me?.statuses.berserkDamageBonus ?? 0;
  const rage = (ctx.me?.statuses.rageStacks ?? 0) * 8;
  value += berserk + rage;

  return { value, hasTempBuff: berserk > 0 || rage > 0 };
}

/** 명중률 현재값. 일시 버프 = nextAccBonus / berserkAccBonus. */
function computeAcc(
  card: Card,
  ctx: CardStatCtx,
): { value: number; hasTempBuff: boolean } {
  let value = card.baseAcc;
  value += boonEffect(ctx.me, "acc_bonus");
  const next = ctx.me?.statuses.nextAccBonus ?? 0;
  const berserk = ctx.me?.statuses.berserkAccBonus ?? 0;
  value += next + berserk;
  return {
    value: Math.max(0, Math.min(100, value)),
    hasTempBuff: next > 0 || berserk > 0,
  };
}

/** 치명률 현재값. 일시 버프 = nextCritBonus / guaranteeNextCrit. */
/**
 * 치명률 = floor(현재 명중률 / 10) + 카드 base/bet_crit + 부운 + 다음-1회 버프.
 * 명중률 변화에 따라 자동 상승 (서버 computeCritChance 와 일치).
 */
function computeCrit(
  card: Card,
  ctx: CardStatCtx,
  effectiveAcc: number,
  bet = 0,
): { value: number; hasTempBuff: boolean; guaranteed: boolean } {
  const guaranteed = ctx.me?.statuses.guaranteeNextCrit ?? false;
  if (guaranteed) return { value: 100, hasTempBuff: true, guaranteed: true };
  let value = Math.floor(effectiveAcc / 10);
  value += card.baseCrit + card.betCrit * bet;
  value += boonEffect(ctx.me, "crit_bonus");
  const next = ctx.me?.statuses.nextCritBonus ?? 0;
  value += next;
  return {
    value: Math.max(0, Math.min(100, value)),
    hasTempBuff: next > 0,
    guaranteed: false,
  };
}

function bigStatSpan(value: number | string, hasTempBuff: boolean): string {
  const cls = hasTempBuff ? "cardStatBig cardStatBuffed" : "cardStatBig";
  return `<span class="${cls}">${value}</span>`;
}

function midStatSpan(value: number | string, hasTempBuff: boolean): string {
  const cls = hasTempBuff ? "cardStatMid cardStatBuffed" : "cardStatMid";
  return `<span class="${cls}">${value}</span>`;
}

function primaryStatHtml(card: Card, ctx: CardStatCtx): string {
  if (card.type === "hit") {
    const d = computeAttackDamage(card, ctx);
    const a = computeAcc(card, ctx);
    return `
      <div class="cardPrimary">
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">공격력</span>
          ${bigStatSpan(d.value, d.hasTempBuff)}
        </div>
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">명중률</span>
          ${midStatSpan(`${a.value}%`, a.hasTempBuff)}
          ${card.betAcc > 0 ? `<span class="cardStatBet">+${card.betAcc}% / 베팅</span>` : ""}
        </div>
      </div>
    `;
  }
  if (card.type === "crit") {
    const range = card.extra.damage_range as [number, number] | undefined;
    let dmgMarkup: string;
    if (range) {
      const berserk = ctx.me?.statuses.berserkDamageBonus ?? 0;
      const rage = (ctx.me?.statuses.rageStacks ?? 0) * 8;
      const passive = boonEffect(ctx.me, "damage_bonus_all");
      const bonus = berserk + rage + passive;
      const lo = range[0] + bonus;
      const hi = range[1] + bonus;
      const tempBuff = berserk > 0 || rage > 0;
      dmgMarkup = bigStatSpan(`${lo}~${hi}`, tempBuff);
    } else {
      const d = computeAttackDamage(card, ctx);
      dmgMarkup = bigStatSpan(d.value, d.hasTempBuff);
    }
    const a = computeAcc(card, ctx);
    const c = computeCrit(card, ctx, a.value, 0);
    return `
      <div class="cardPrimary">
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">공격력</span>
          ${dmgMarkup}
          <span class="cardStatMult">×${card.critMult}</span>
        </div>
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">명중률</span>
          ${midStatSpan(`${a.value}%`, a.hasTempBuff)}
          ${card.betAcc > 0 ? `<span class="cardStatBet">+${card.betAcc}% / 베팅</span>` : ""}
        </div>
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">치명타</span>
          ${midStatSpan(c.guaranteed ? "100% 확정" : `${c.value}%`, c.hasTempBuff || a.hasTempBuff)}
          ${card.betCrit > 0 ? `<span class="cardStatBet">+${card.betCrit}% / 베팅</span>` : ""}
        </div>
      </div>
    `;
  }
  if (card.type === "fixed") {
    // W15 최후의 심판 — 자신이 베팅한 HP. 모든 효과 무시 고정 데미지.
    if (card.extra.final_judgment_self_only) {
      const live = ctx.me?.totalBet ?? 0;
      return `
        <div class="cardPrimary">
          <div class="cardPrimaryRow">
            <span class="cardStatLabel">확정 피해</span>
            <span class="cardStatBig">${live}</span>
          </div>
          <div class="cardPrimaryRow">
            <span class="cardStatLabel">효과</span>
            <span class="cardStatMid">모든 효과 무시</span>
          </div>
        </div>
      `;
    }
    // W6 인내의 반격 — 받은 피해 × ratio.
    if (card.extra.patience) {
      const pat = card.extra.patience as { ratio?: number };
      const ratio = pat.ratio ?? 0.3;
      const taken = ctx.me?.totalDamageTaken ?? 0;
      const live = Math.floor(taken * ratio);
      return `
        <div class="cardPrimary">
          <div class="cardPrimaryRow">
            <span class="cardStatLabel">반환 피해</span>
            <span class="cardStatBig">${live}</span>
          </div>
          <div class="cardPrimaryRow">
            <span class="cardStatLabel">비율</span>
            <span class="cardStatMid">${Math.round(ratio * 100)}%</span>
          </div>
        </div>
      `;
    }
    // 일반 fixed
    const d = computeAttackDamage(card, ctx);
    return `
      <div class="cardPrimary">
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">공격력</span>
          ${bigStatSpan(d.value, d.hasTempBuff)}
        </div>
        <div class="cardPrimaryRow">
          <span class="cardStatLabel">강화</span>
          <span class="cardStatMid">${card.betDamage} / 베팅</span>
        </div>
      </div>
    `;
  }
  const e = card.extra as Record<string, unknown>;
  let tag: string | null = null;
  if (typeof e.shield === "number") tag = `방어막 +${e.shield}`;
  else if (typeof e.self_heal === "number") tag = `회복 +${e.self_heal}`;
  else if (typeof e.next_acc_bonus === "number")
    tag = `다음 명중 +${e.next_acc_bonus}%`;
  else if (typeof e.next_crit_bonus === "number")
    tag = `다음 치명 +${e.next_crit_bonus}%`;
  else if (typeof e.draw === "number") tag = `카드 ${e.draw}장 드로우`;
  else if (typeof e.dodge_next === "number") tag = `회피 ${e.dodge_next}%`;
  else if (typeof e.force_miss_next === "number")
    tag = `강제 miss ${e.force_miss_next}%`;
  else if (e.poison) {
    const p = e.poison as { damage: number; turns: number };
    tag = `독 ${p.damage}×${p.turns}턴`;
  } else if (e.berserk_mode) {
    const bm = e.berserk_mode as { turns: number; acc_bonus: number; damage_bonus: number };
    tag = `베르세르크 ${bm.turns}턴 (명중+${bm.acc_bonus}%, 딜+${bm.damage_bonus})`;
  } else if (typeof e.negate_ratio === "number") {
    const turns = (e.negate_turns as number | undefined) ?? 3;
    tag = `받는 피해 ×${e.negate_ratio} · ${turns}턴`;
  } else if (typeof e.rage_stack === "number") tag = `분노 +${e.rage_stack}`;
  else if (e.cleanse) tag = "디버프 정화";
  else if (e.redraw_hand) tag = "손패 전체 리드로우";
  else if (e.guarantee_next_crit) tag = "다음 크리 확정";
  else if (typeof e.deck_peek === "number") tag = `내 덱 ${e.deck_peek}장 예지`;
  else if (typeof e.opponent_deck_peek === "number")
    tag = `상대 덱 ${e.opponent_deck_peek}장 투시`;
  else if (e.repeat_last) tag = "직전 카드 재발동";
  else if (e.search_attack) tag = "공격 카드 서치";
  else if (card.keywords.length > 0) tag = card.keywords[0]!.label;
  if (!tag) tag = "특수 효과";
  return `
    <div class="cardPrimary cardPrimaryUtil">
      <div class="cardStatLabel">효과</div>
      <div class="cardStatUtil">${escapeHtml(tag)}</div>
    </div>
  `;
}

function keywordChipsHtml(card: Card): string {
  // card.keywords(extractKeywords) 를 진실 원천으로 사용. glossary desc 를 title 로 붙여
  // 호버 시 풀 설명이 툴팁으로 뜨게 한다.
  const chips: string[] = [];
  const seen = new Set<string>();
  if (card.keywords && card.keywords.length) {
    for (const k of card.keywords) {
      const g = KEYWORD_GLOSSARY[k.key];
      if (!g) continue;
      const label = k.label || g.name;
      if (seen.has(label)) continue;
      seen.add(label);
      chips.push(
        `<span class="cardChip" data-flavor="${g.flavor}" title="${escapeAttr(g.desc)}">${escapeHtml(label)}</span>`,
      );
    }
  }
  if (chips.length === 0) return "";
  return `<div class="cardChips">${chips.join("")}</div>`;
}

/** 카드 desc 가 비어있을 때 키워드 글로서리를 조합해 자동 설명 생성. */
function cardDescText(card: Card): string {
  if (card.desc && card.desc.trim().length > 0) return card.desc;
  if (card.descLong && card.descLong.trim().length > 0) return card.descLong;
  if (!card.keywords || card.keywords.length === 0) return "";
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const k of card.keywords) {
    const g = KEYWORD_GLOSSARY[k.key];
    if (!g) continue;
    if (seen.has(k.key)) continue;
    seen.add(k.key);
    parts.push(g.desc);
    if (parts.length >= 3) break;
  }
  return parts.join(" ");
}

// =====================================================================
// PlayerCard / HPBar / StatusBadges
// =====================================================================

function playerCardHtml(
  player: PlayerPublic,
  opts: { flip?: boolean; self?: boolean; active?: boolean },
): string {
  const cls = player.className
    ? CLASS_INFO[player.className]
    : { name: "?", glyph: "◆", title: "?", passive: "?" };
  const cardCls = ["playerCard"];
  if (opts.flip) cardCls.push("flip");
  if (opts.active) cardCls.push("active");

  // 클래스/패시브는 툴팁으로만 노출 (본문 패널에선 이름만).
  return `
    <div class="${cardCls.join(" ")}">
      <div class="pcAvatar">
        <div class="pcAvatarRing"></div>
        <div class="pcAvatarGlyph">${cls.glyph}</div>
        <div class="pcPassiveTooltip">
          <div class="pcpHead">${escapeHtml(cls.title)}</div>
          <div class="pcpLabel">패시브</div>
          <div class="pcpDesc">${escapeHtml(cls.passive)}</div>
        </div>
      </div>
      <div class="pcBody">
        <div class="pcName">${escapeHtml(player.name)}</div>
      </div>
      <div class="pcBoons">
        ${[0, 1].map((i) => boonSlotHtml(i === 0 ? player.boonId : null)).join("")}
      </div>
    </div>
  `;
}

function boonSlotHtml(boonId: string | null): string {
  if (!boonId) return `<div class="boonSlot boonEmpty">◇</div>`;
  try {
    const b = getBoonById(boonId);
    return `
      <div class="boonSlot" title="${escapeAttr(b.name)}">
        <div class="boonEmoji">${b.emoji || "❦"}</div>
        <div class="boonTooltip">
          <div class="boonName">${escapeHtml(b.name)}</div>
          <div class="boonDesc">${escapeHtml(b.desc)}</div>
        </div>
      </div>
    `;
  } catch {
    return `<div class="boonSlot boonEmpty">◇</div>`;
  }
}

function hpBarHtml(
  player: PlayerPublic,
  opts: { flip?: boolean; compact?: boolean },
): string {
  const pct = Math.max(0, (player.hp / player.maxHp) * 100);
  const tone = pct > 70 ? "hp-hi" : pct > 35 ? "hp-mid" : "hp-lo";
  const cls = ["hpBar", tone];
  if (opts.flip) cls.push("flip");
  if (opts.compact) cls.push("compact");
  const shieldPct = Math.min(
    100,
    (player.shield / Math.max(1, player.maxHp)) * 100,
  );
  return `
    <div class="${cls.join(" ")}">
      <div class="hpIcon">❤</div>
      <div class="hpTrack">
        <div class="hpFill" style="width:${pct}%"></div>
        ${
          player.shield > 0
            ? `<div class="hpShieldFill" style="width:${shieldPct}%"></div>`
            : ""
        }
        ${
          player.shield > 0
            ? `<div class="hpShield"><span class="hpShieldIcon">❂</span><span>${player.shield}</span></div>`
            : ""
        }
        <div class="hpValue">${player.hp}<span class="hpMax">&nbsp;/&nbsp;${player.maxHp}</span></div>
      </div>
    </div>
  `;
}

interface StatusItem {
  key: string;
  glyph: string;
  label: string;
  tone: string;
  meta: {
    name: string;
    desc: string;
    type: "buff" | "debuff" | "boon";
    duration?: string; // "1회" | "N턴 남음" | "턴 종료 시 소멸" 등
  };
}

function buildStatusItems(player: PlayerPublic): StatusItem[] {
  const s = player.statuses;
  const items: StatusItem[] = [];

  // === 지속형 디버프/버프 ===
  if (s.poisonTurns > 0) {
    items.push({
      key: "poison",
      glyph: "☠",
      label: `독 ${s.poisonTurns}T`,
      tone: "poison",
      meta: {
        name: "독",
        desc: `매 턴 종료 시 ${s.poisonDamage} 피해 (방어막 무시).`,
        type: "debuff",
        duration: `${s.poisonTurns}턴 남음`,
      },
    });
  }
  if (s.rageStacks > 0) {
    items.push({
      key: "rage",
      glyph: "🔥",
      label: `분노 ×${s.rageStacks}`,
      tone: "rage",
      meta: {
        name: "분노 스택",
        desc: `다음 공격 피해량 +${s.rageStacks * 8} (스택 × 8). 공격 시 전량 소모.`,
        type: "buff",
        duration: "공격 시 소모",
      },
    });
  }
  if (s.berserkTurns > 0) {
    items.push({
      key: "berserk",
      glyph: "⚡",
      label: `광기 ${s.berserkTurns}T`,
      tone: "berserk",
      meta: {
        name: "베르세르크",
        desc: `명중률 +${s.berserkAccBonus}%, 공격 피해 +${s.berserkDamageBonus}. 매 턴 자해 5.`,
        type: "buff",
        duration: `${s.berserkTurns}턴 남음`,
      },
    });
  }
  if (s.incomingDamageMult > 1) {
    items.push({
      key: "dmgAmp",
      glyph: "↑",
      label: `피해 증폭 ×${s.incomingDamageMult.toFixed(1)}`,
      tone: "amp",
      meta: {
        name: "피해 증폭",
        desc: `받는 피해가 ${s.incomingDamageMult.toFixed(1)}배로 증폭된다.`,
        type: "debuff",
        duration:
          s.incomingDamageMultTurns > 0
            ? `${s.incomingDamageMultTurns}턴 남음`
            : undefined,
      },
    });
  }
  if (s.incomingDamageMult < 1) {
    // W14 무효 선언 등 — 피해 감쇄 버프
    items.push({
      key: "dmgNegate",
      glyph: "↓",
      label: `피해 감쇄 ×${s.incomingDamageMult.toFixed(1)}`,
      tone: "shield",
      meta: {
        name: "피해 감쇄",
        desc: `받는 피해가 ${Math.round((1 - s.incomingDamageMult) * 100)}% 차감된다.`,
        type: "buff",
        duration:
          s.incomingDamageMultTurns > 0
            ? `${s.incomingDamageMultTurns}턴 남음`
            : undefined,
      },
    });
  }
  if (s.betCapOverride != null) {
    items.push({
      key: "betCap",
      glyph: "⛓",
      label: `베팅≤${s.betCapOverride}`,
      tone: "bind",
      meta: {
        name: "베팅 제한",
        desc: `이번 턴 카드의 최대 베팅치가 ${s.betCapOverride} 로 제한된다.`,
        type: "debuff",
        duration:
          s.betCapOverrideTurns > 0
            ? `${s.betCapOverrideTurns}턴 남음`
            : "이번 턴",
      },
    });
  }
  if (s.silencedCardCount > 0) {
    items.push({
      key: "silence",
      glyph: "⊘",
      label: `봉인 ${s.silencedCardCount}장`,
      tone: "silence",
      meta: {
        name: "봉인",
        desc: `손패의 ${s.silencedCardCount}장이 이번 턴 사용 불가.`,
        type: "debuff",
        duration: "이번 턴",
      },
    });
  }

  // === 다음 1회 버프/디버프 ===
  if (s.nextAccBonus > 0) {
    items.push({
      key: "nextAcc",
      glyph: "◎",
      label: `다음 명중 +${s.nextAccBonus}%`,
      tone: "accbuf",
      meta: {
        name: "명중 보정",
        desc: `다음 공격 카드의 명중률에 +${s.nextAccBonus}% 가산된다.`,
        type: "buff",
        duration: "다음 공격 1회",
      },
    });
  }
  if (s.nextCritBonus > 0) {
    items.push({
      key: "nextCrit",
      glyph: "✦",
      label: `다음 치명 +${s.nextCritBonus}%`,
      tone: "critbuf",
      meta: {
        name: "치명 보정",
        desc: `다음 공격 카드의 치명률에 +${s.nextCritBonus}% 가산된다.`,
        type: "buff",
        duration: "다음 공격 1회",
      },
    });
  }
  if (s.guaranteeNextCrit) {
    items.push({
      key: "guaranteeCrit",
      glyph: "✧",
      label: "다음 크리 확정",
      tone: "critbuf",
      meta: {
        name: "확정 치명",
        desc: "다음 치명 판정은 무조건 성공한다.",
        type: "buff",
        duration: "다음 crit 1회",
      },
    });
  }
  if (s.dodgeNextPercent > 0) {
    items.push({
      key: "dodge",
      glyph: "〜",
      label: `회피 ${s.dodgeNextPercent}%`,
      tone: "dodge",
      meta: {
        name: "회피",
        desc: `다음에 받을 공격을 ${s.dodgeNextPercent}% 확률로 회피한다.`,
        type: "buff",
        duration: "다음 1회",
      },
    });
  }
  if (s.nextAttackMissChance > 0) {
    items.push({
      key: "forceMiss",
      glyph: "~",
      label: `강제 miss ${s.nextAttackMissChance}%`,
      tone: "bind",
      meta: {
        name: "블러프",
        desc: `다음 공격이 ${s.nextAttackMissChance}% 확률로 강제 빗나간다.`,
        type: "debuff",
        duration: "다음 공격 1회",
      },
    });
  }

  // === 방어막 ===
  if (player.shield > 0) {
    items.push({
      key: "shield",
      glyph: "❂",
      label: `방어막 ${player.shield}`,
      tone: "shield",
      meta: {
        name: "방어막",
        desc: `${player.shield} 피해를 흡수한다.`,
        type: "buff",
        duration: "소진 시 소멸",
      },
    });
  }

  // === 부운 패시브 ===
  if (player.boonId) {
    try {
      const b = getBoonById(player.boonId);
      items.push({
        key: `boon-${b.id}`,
        glyph: b.emoji || "❦",
        label: b.name,
        tone: "boon",
        meta: {
          name: b.name,
          desc: b.desc,
          type: "boon",
        },
      });
    } catch {
      /* ignore */
    }
  }

  return items;
}

function statusBadgesHtml(player: PlayerPublic): string {
  const items = buildStatusItems(player);
  if (items.length === 0) {
    return `<div class="statusEmpty">— 이상 없음 —</div>`;
  }
  return `
    <div class="statusBadges">
      ${items
        .map(
          (it) => `
        <div class="statBadge stat-${it.tone}" data-tip-type="${it.meta.type}">
          <span class="statGlyph">${it.glyph}</span>
          <span>${escapeHtml(it.label)}</span>
          <div class="statTip">
            <div class="statTipHead statTipHead-${it.meta.type}">
              <span class="statTipType">${tipTypeLabel(it.meta.type)}</span>
              ${it.meta.duration ? `<span class="statTipDuration">${escapeHtml(it.meta.duration)}</span>` : ""}
            </div>
            <div class="statTipName">${escapeHtml(it.meta.name)}</div>
            <div class="statTipDesc">${escapeHtml(it.meta.desc)}</div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function tipTypeLabel(t: "buff" | "debuff" | "boon"): string {
  if (t === "buff") return "이로운 효과";
  if (t === "debuff") return "해로운 효과";
  return "부운 패시브";
}

// =====================================================================
// Deck pile / OppHand / Turn banner
// =====================================================================

function deckPileHtml(
  count: number,
  label: string,
  variant: "self" | "opp" | "pyre",
  dataId: string,
): string {
  return `
    <div class="deckPile deckPileClickable" data-pile="${dataId}">
      <div class="deckStack ${variant}">
        ${[0, 1, 2, 3]
          .map(
            (i) =>
              `<div class="deckCard" style="transform:translate(${i * -0.8}px, ${i * -0.8}px)"></div>`,
          )
          .join("")}
        <div class="deckCount">${count}</div>
      </div>
      <div class="deckLabel">${escapeHtml(label)}</div>
    </div>
  `;
}

function oppHandHtml(count: number, owner: string): string {
  if (count <= 0) return `<div class="oppHand"></div>`;
  const cards: string[] = [];
  for (let i = 0; i < count; i++) {
    const c = (count - 1) / 2;
    const o = i - c;
    const spread = 54;
    const angleStep = 4;
    const arcDepth = 10;
    const y = o * o * 2.2 - arcDepth;
    cards.push(`
      <div class="oppHandCard" style="transform:translateX(${o * spread}px) translateY(${y}px) rotate(${o * angleStep}deg); z-index:${10 - Math.abs(o)}">
        ${cardHtml(null, { size: "back", owner })}
      </div>
    `);
  }
  return `<div class="oppHand">${cards.join("")}</div>`;
}

function turnBannerHtml(turn: number, active: boolean): string {
  const remaining = currentTurnRemaining();
  const dashLen = (remaining / TURN_TIMER_SECONDS) * 106.8;
  return `
    <div class="turnBanner ${active ? "active" : "inactive"}">
      <div class="turnBannerGlyph">❦</div>
      <div>
        <div class="turnBannerLabel">${active ? "당신의 턴" : "상대의 턴"}</div>
        <div class="turnBannerTurn">TURN ${turn}</div>
      </div>
      <div class="turnTimer" id="duelTurnTimer">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="17" fill="none" stroke="#3a2812" stroke-width="2"></circle>
          <circle id="duelTurnTimerFill" cx="20" cy="20" r="17" fill="none" stroke="#c9a961" stroke-width="2"
            stroke-dasharray="${dashLen} 106.8" transform="rotate(-90 20 20)" stroke-linecap="round"></circle>
        </svg>
        <div class="turnTimerText" id="duelTurnTimerText">${remaining}</div>
      </div>
    </div>
  `;
}

function currentTurnRemaining(): number {
  if (turnTimerStartedAt === null) return TURN_TIMER_SECONDS;
  const elapsed = (Date.now() - turnTimerStartedAt) / 1000;
  return Math.max(0, TURN_TIMER_SECONDS - Math.floor(elapsed));
}

function startTurnTimer(app: App): void {
  turnTimerStartedAt = Date.now();
  if (turnTimerIntervalId !== null) clearInterval(turnTimerIntervalId);

  const tick = () => {
    const remaining = currentTurnRemaining();
    const textEl = document.querySelector<HTMLElement>("#duelTurnTimerText");
    const fillEl = document.querySelector<SVGCircleElement>("#duelTurnTimerFill");
    if (textEl) textEl.textContent = String(remaining);
    if (fillEl) {
      const dashLen = (remaining / TURN_TIMER_SECONDS) * 106.8;
      fillEl.setAttribute("stroke-dasharray", `${dashLen} 106.8`);
    }
    if (remaining <= 0) {
      if (turnTimerIntervalId !== null) {
        clearInterval(turnTimerIntervalId);
        turnTimerIntervalId = null;
      }
      // 만료 시 내 턴이면 자동으로 end_turn 전송
      if (app.state.activeId === app.state.myId && app.state.phase === "battle") {
        app.state.client?.send({ type: "end_turn" });
      }
    }
  };
  tick();
  turnTimerIntervalId = window.setInterval(tick, 500);
}

/** 배틀 씬 벗어날 때 호출. board.ts 가 phase 전환 시점에 부른다. */
export function stopDuelTurnTimer(): void {
  if (turnTimerIntervalId !== null) {
    clearInterval(turnTimerIntervalId);
    turnTimerIntervalId = null;
  }
  turnTimerStartedAt = null;
  lastSeenTurn = -1;
}

/**
 * 듀얼 씬의 모든 모듈 레벨 상태 초기화. 게임 간 경계에서 호출해
 * 이전 게임 데이터가 다음 게임에 유출되지 않도록 한다.
 */
export function resetDuelState(): void {
  dragState = null;
  if (turnTimerIntervalId !== null) clearInterval(turnTimerIntervalId);
  turnTimerIntervalId = null;
  turnTimerStartedAt = null;
  lastSeenTurn = -1;
  roulette = null;
  lastRouletteEventKey = "";
  selfSlots = [];
  oppSlots = [];
  slotTurn = -1;
}

// =====================================================================
// DropZone / Hand
// =====================================================================

function dropZoneHtml(
  content: SlotContent | null,
  owner: "self" | "opp",
  ownerClass: string | undefined,
  label: string,
  idx: number,
): string {
  const cls = ["dropZone", `zone-${owner}`];
  if (!content) cls.push("empty");

  if (!content) {
    return `
      <div class="${cls.join(" ")}" data-zone="${owner}-${idx}">
        <div class="dropRune">⊹</div>
        <div class="dropLabel">${escapeHtml(label)}</div>
      </div>
    `;
  }

  const r = content.result;
  return `
    <div class="${cls.join(" ")}" data-zone="${owner}-${idx}">
      <div class="dropZoneCard" data-zoom-card="${escapeAttr(content.card.id)}">
        ${cardHtml(content.card, { size: "field", owner: ownerClass })}
      </div>
      ${r === "hit" ? `<div class="resultBadge resultHit">✔ 적중</div>` : ""}
      ${r === "crit" ? `<div class="resultBadge resultCrit">✦ 치명</div>` : ""}
      ${r === "miss" ? `<div class="resultBadge resultMiss">✕ 빗나감</div>` : ""}
      ${r === "cast" ? `<div class="resultBadge resultCast">❦ 발동</div>` : ""}
    </div>
  `;
}

function handHtml(
  app: App,
  me: PlayerPublic,
  opp: PlayerPublic,
  sigLocked: boolean,
): string {
  const hand = app.state.hand;
  const myClass = me.className ?? undefined;
  const silenced = new Set(app.state.silencedCardIds);
  const sigUsedIds = new Set(me.statuses.sigUsedIds);
  const sigUsedThisTurn = me.statuses.sigUsedThisTurn;
  const n = hand.length;
  const fanAngle = Math.min(8, 48 / Math.max(1, n));
  const xStep = Math.max(52, Math.min(72, 520 / n));
  const arcLift = 10;
  const ctx: CardStatCtx = { me, opp };

  const slots = hand
    .map((c, i) => {
      const center = (n - 1) / 2;
      const offset = i - center;
      const angle = offset * fanAngle;
      const y = Math.abs(offset) * Math.abs(offset) * arcLift * 0.8;
      const { locked, lockMsg } = evaluateCardLock(c, me, {
        silenced,
        sigLocked,
        sigUsedIds,
        sigUsedThisTurn,
        opp,
      });
      const dragging = dragState?.card.id === c.id && dragState?.moved;
      const transform = `translateX(${offset * xStep}px) translateY(${y}px) rotate(${angle}deg)`;
      return `
        <div
          class="handSlot ${dragging ? "drag" : ""}"
          data-card="${escapeAttr(c.id)}"
          style="transform:${transform}; z-index:${10 + i}; --hand-unrotate:${-angle}deg"
        >
          <div class="handSlotLift">
            ${cardHtml(c, { size: "hand", locked, lockMsg, owner: myClass, ctx })}
          </div>
        </div>
      `;
    })
    .join("");

  return `<div class="handContainer"><div class="handFan">${slots}</div></div>`;
}

/**
 * 카드 사용 가능 여부 판정 — 엔진의 validateCardPlay 와 동일한 규칙을 UI 단에서
 * 선행 체크. 불가능한 이유를 잠금 메시지로 반환.
 * 규칙 우선순위: 봉인 > 시그(3턴 이전/이번 턴 사용/1게임 1회) > HP 조건.
 */
function evaluateCardLock(
  card: Card,
  me: PlayerPublic,
  ctx: {
    silenced: Set<string>;
    sigLocked: boolean;
    sigUsedIds: Set<string>;
    sigUsedThisTurn: boolean;
    opp?: PlayerPublic;
  },
): { locked: boolean; lockMsg: string } {
  if (ctx.silenced.has(card.id)) {
    return { locked: true, lockMsg: "🔒 봉인됨" };
  }
  if (card.signature) {
    if (ctx.sigLocked) {
      return { locked: true, lockMsg: "3턴 이후 해금" };
    }
    if (ctx.sigUsedIds.has(card.id)) {
      return { locked: true, lockMsg: "1게임 1회 · 사용됨" };
    }
    if (ctx.sigUsedThisTurn) {
      return { locked: true, lockMsg: "이번 턴 시그니처 사용됨" };
    }
  }
  const cond = card.extra.condition as
    | { self_hp_max?: number; self_hp_below_opp?: boolean }
    | undefined;
  if (cond?.self_hp_max !== undefined && me.hp > cond.self_hp_max) {
    return {
      locked: true,
      lockMsg: `HP ${cond.self_hp_max} 이하 필요`,
    };
  }
  if (cond?.self_hp_below_opp && ctx.opp && me.hp >= ctx.opp.hp) {
    return {
      locked: true,
      lockMsg: "내 HP < 상대 HP 필요",
    };
  }
  return { locked: false, lockMsg: "" };
}

// =====================================================================
// Bet / Roulette / Pile / Zoom overlays
// =====================================================================

function betOverlayHtml(card: Card, me: PlayerPublic, bet: number): string {
  const pal = CARD_TYPE[card.type] ?? CARD_TYPE.hit!;
  const maxBet = Math.min(card.maxBet, Math.max(0, me.hp - 1));
  return `
    <div class="betOverlay" id="duelBetOverlay">
      <div class="betPanel">
        <div class="betHeader">
          <div class="betCardMini">
            <div class="betCardGlyph" style="color:${pal.color}">${pal.glyph}</div>
            <div>
              <div class="betCardName">${escapeHtml(card.name)}</div>
              <div class="betCardSub">${pal.label}</div>
            </div>
          </div>
          <button class="betClose" id="duelBetClose">✕</button>
        </div>
        ${
          card.maxBet > 0
            ? `
          <div class="betRow">
            <span class="betRowLabel">HP 베팅</span>
            <span class="betRowValue">
              <span class="betRowBig" id="duelBetBig">${bet}</span>
              <span class="betRowMax">/ ${maxBet}</span>
            </span>
          </div>
          <div class="betSliderWrap">
            <input type="range" min="0" max="${maxBet}" step="1" value="${bet}"
              class="betSlider" id="duelBetSlider"
              style="--fill:${maxBet > 0 ? (bet / maxBet) * 100 : 0}%" />
            <div class="betTicks" id="duelBetTicks">
              ${Array.from({ length: maxBet + 1 })
                .map((_, i) => `<span class="betTick${i <= bet ? " lit" : ""}"></span>`)
                .join("")}
            </div>
          </div>
          <div class="betPreview" id="duelBetPreview">
            ${betPreviewRowsHtml(card, bet, me)}
          </div>
        `
            : `<div class="betNoBet">이 카드는 베팅 없이 바로 발동됩니다.</div>`
        }
        <div class="betActions">
          <button class="btn btnGhost" id="duelBetCancel">취소</button>
          <button class="btn btnPrimary" id="duelBetConfirm">▲ 발동 · CAST</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 베팅 패널 프리뷰 — 현재 걸려있는 버프/패시브를 반영해서 계산.
 * 서버 computeHitAccuracy / computeCritChance 공식과 동일하게:
 *   acc  = baseAcc + betAcc*bet + (berserker ? 2*bet : 0) + nextAccBonus + berserkAccBonus
 *   crit = baseCrit + betCrit*bet + nextCritBonus
 *   damage = card.damage + betDamage*bet + rageStacks*8 + berserkDamageBonus
 * 부운 효과(BN05 +15% acc, BN06 베팅당 +1% 등) 는 서버 getBoonById 확인 없이 근사 불가
 * 하므로 이 프리뷰는 순수 상태 기반으로만 계산 (실제 판정은 서버가 부운까지 반영).
 */
function computeHitPreview(card: Card, bet: number, me: PlayerPublic): string {
  const s = me.statuses;

  // 명중률 산출 (hit/crit 공용)
  const computeAcc = (): number => {
    let acc = card.baseAcc + card.betAcc * bet;
    if (me.className === "berserker") acc += 2 * bet;
    acc += s.nextAccBonus;
    acc += s.berserkAccBonus;
    return Math.max(0, Math.min(100, acc));
  };

  if (card.type === "hit") {
    const acc = computeAcc();
    const buffed = s.nextAccBonus > 0 || s.berserkAccBonus > 0;
    return `명중률 ${acc.toFixed(0)}%${buffed ? " ⚘" : ""}`;
  }
  if (card.type === "crit") {
    const acc = computeAcc();
    let crit = Math.floor(acc / 10);
    crit += card.baseCrit + card.betCrit * bet;
    crit += s.nextCritBonus;
    crit = Math.max(0, Math.min(100, crit));
    const guaranteed = s.guaranteeNextCrit ? " · 확정 치명" : "";
    const accBuffed = s.nextAccBonus > 0 || s.berserkAccBonus > 0;
    const critBuffed = s.nextCritBonus > 0 || s.guaranteeNextCrit;
    return (
      `명중 ${acc.toFixed(0)}%${accBuffed ? " ⚘" : ""} · ` +
      `치명 ${crit.toFixed(0)}%${critBuffed ? " ⚘" : ""}${guaranteed}`
    );
  }
  if (card.type === "fixed") {
    if (card.extra.final_judgment_self_only) {
      return `확정 피해 ${me.totalBet} (모든 효과 무시)`;
    }
    if (card.extra.patience) {
      const pat = card.extra.patience as { ratio?: number };
      const ratio = pat.ratio ?? 0.3;
      return `반환 피해 ${Math.floor(me.totalDamageTaken * ratio)}`;
    }
    const dmg = card.damage + card.betDamage * bet;
    return `확정 피해 ${dmg}`;
  }
  return "즉시 발동";
}

/** 예상 피해량 — 분노/베르세르크 반영한 표시용 값. damage 타입 카드에만 의미. */
function computeDamagePreview(
  card: Card,
  bet: number,
  me: PlayerPublic,
): number {
  let dmg = card.damage + card.betDamage * bet;
  dmg += me.statuses.rageStacks * 8;
  dmg += me.statuses.berserkDamageBonus;
  return dmg;
}

/**
 * 베팅 패널의 "예상 / 즉시 차감" 표기 영역을 생성. 현재 걸린 버프를 반영한
 * 명중률/치명률/피해량을 동시에 노출. 슬라이더 변동에도 재사용 가능.
 */
function betPreviewRowsHtml(
  card: Card,
  bet: number,
  me: PlayerPublic,
): string {
  const s = me.statuses;
  const rows: string[] = [];

  // 확률 표시 — computeHitPreview 결과
  const hitMsg = computeHitPreview(card, bet, me);
  rows.push(`
    <div class="betPreviewRow">
      <span>예상</span>
      <span class="betPreviewStrong">${hitMsg}</span>
    </div>
  `);

  // 피해량 표시 — hit/crit/fixed 에만
  if (card.type !== "utility") {
    const dmg = computeDamagePreview(card, bet, me);
    const bonusNote: string[] = [];
    if (s.rageStacks > 0) bonusNote.push(`분노 +${s.rageStacks * 8}`);
    if (s.berserkDamageBonus > 0)
      bonusNote.push(`광기 +${s.berserkDamageBonus}`);
    const note = bonusNote.length > 0 ? ` (${bonusNote.join(" · ")})` : "";

    if (card.type === "crit") {
      const critDmg = Math.floor(dmg * card.critMult);
      rows.push(`
        <div class="betPreviewRow">
          <span>피해</span>
          <span class="betPreviewStrong">${dmg} / 크리 ${critDmg}${escapeHtml(note)}</span>
        </div>
      `);
    } else if (card.type === "hit" || card.type === "fixed") {
      rows.push(`
        <div class="betPreviewRow">
          <span>피해</span>
          <span class="betPreviewStrong">${dmg}${escapeHtml(note)}</span>
        </div>
      `);
    }
  }

  // 즉시 차감
  rows.push(`
    <div class="betPreviewRow">
      <span>즉시 차감</span>
      <span>-${bet} HP</span>
    </div>
  `);

  // 상대방에 걸린 버프 경고 — 회피/강제miss 가 있으면 명시
  // (me.statuses 는 내 버프, 상대 버프는 계산 시점에 별도 조회 — 여긴 생략)

  return rows.join("");
}

function rouletteOverlayHtml(stage: RouletteStage, idx: number): string {
  if (!roulette) return "";
  const { card, evt, stages } = roulette;
  const conic = buildStageConic(stage);
  const stageIndicator =
    stages.length > 1 ? `  (${idx + 1}/${stages.length})` : "";

  // 단계 종류별 성공 확률 라벨
  const successLabel =
    stage.kind === "bluff"
      ? "강제 miss 확률"
      : stage.kind === "dodge"
        ? "회피 확률"
        : "명중 확률";

  const critRow =
    stage.kind === "hit" && typeof stage.critPct === "number" && stage.critPct > 0
      ? `<div class="rouletteMetaRow"><span class="rmLabel">치명 확률</span><span class="rmValue rmCrit">${stage.critPct.toFixed(0)}%</span></div>`
      : "";

  return `
    <div class="rouletteBackdrop" data-stage-idx="${idx}" data-stage-kind="${stage.kind}">
      <div class="roulettePanel">
        <div class="rouletteHeader">
          <span class="rouletteLabel">${escapeHtml(stage.label)}${stageIndicator}</span>
          <span class="rouletteCardName">『${escapeHtml(card.name)}』</span>
        </div>
        <div class="rouletteStage">
          <div class="rouletteWheelOuter">
            <div class="rouletteWheel" style="background:conic-gradient(from 0deg, ${conic}); transform:rotate(0deg); transition: transform ${ROULETTE_SPIN_MS}ms cubic-bezier(.12, .62, .16, 1)">
              <div class="rouletteHub"></div>
            </div>
            <div class="roulettePointer"></div>
            <div class="rouletteRim"></div>
          </div>
        </div>
        <div class="rouletteMeta">
          <div class="rouletteMetaRow">
            <span class="rmLabel">${escapeHtml(successLabel)}</span>
            <span class="rmValue rm-${stage.kind}">${stage.successPct.toFixed(0)}%</span>
          </div>
          ${critRow}
          ${
            evt.bet > 0 && idx === 0
              ? `<div class="rouletteMetaRow"><span class="rmLabel">베팅</span><span class="rmValue">-${evt.bet} HP</span></div>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function rouletteRevealHtml(stage: RouletteStage): string {
  let text: string;
  let cls: string;
  if (stage.kind === "bluff") {
    if (stage.isSuccess) {
      text = "✕ 블러프 발동 · 강제 miss";
      cls = "revealLose";
    } else {
      text = "✔ 블러프 회피";
      cls = "revealWin";
    }
  } else if (stage.kind === "dodge") {
    if (stage.isSuccess) {
      text = "✈ 회피 성공";
      cls = "revealDodge";
    } else {
      text = "✕ 회피 실패";
      cls = "revealLose";
    }
  } else {
    // hit
    if (stage.isSuccess) {
      text = stage.isCrit ? "✦ 치명타!" : "✔ 적중";
      cls = stage.isCrit ? "revealCrit" : "revealWin";
    } else {
      text = "✕ 빗나감";
      cls = "revealLose";
    }
  }
  return `<div class="rouletteReveal ${cls}">${text}</div>`;
}

/** 단계 종류별 conic 배경: hit=green+gold, bluff=red, dodge=blue. */
function buildStageConic(stage: RouletteStage): string {
  const successDeg = (stage.successPct / 100) * 360;

  // 색 팔레트
  const GOLD = "#e8b63a";
  const GOLD_D = "#8a6617";
  const GREEN = "#3aa050";
  const GREEN_D = "#1e6030";
  const RED = "#c93544";
  const RED_D = "#7a1e28";
  const BLUE = "#3a74c9";
  const BLUE_D = "#1e467a";
  const GRAY = "#4a4550";
  const GRAY_D = "#2a2730";

  let primary: string;
  let primaryD: string;
  if (stage.kind === "dodge") {
    primary = BLUE;
    primaryD = BLUE_D;
  } else if (stage.kind === "bluff") {
    primary = RED;
    primaryD = RED_D;
  } else {
    primary = GREEN;
    primaryD = GREEN_D;
  }

  const parts: string[] = [];

  // hit 단계 gold 크리 영역 (성공 영역의 처음 부분)
  if (stage.kind === "hit" && stage.critPct && stage.critPct > 0) {
    const critDeg = (stage.critPct / 100) * 360;
    parts.push(...bands(0, critDeg, GOLD, GOLD_D, 4));
    if (critDeg < successDeg) {
      parts.push(...bands(critDeg, successDeg, primary, primaryD, 4));
    }
  } else if (successDeg > 0) {
    parts.push(
      ...bands(0, successDeg, primary, primaryD, Math.max(2, Math.round(stage.successPct / 10))),
    );
  }

  if (successDeg < 360) {
    parts.push(
      ...bands(
        successDeg,
        360,
        GRAY,
        GRAY_D,
        Math.max(2, Math.round((100 - stage.successPct) / 10)),
      ),
    );
  }
  return parts.join(", ");
}

function bands(
  fromDeg: number,
  toDeg: number,
  a: string,
  b: string,
  steps: number,
): string[] {
  const parts: string[] = [];
  const step = (toDeg - fromDeg) / Math.max(1, steps);
  for (let i = 0; i < steps; i++) {
    const s = fromDeg + i * step;
    const e = s + step;
    parts.push(`${i % 2 ? a : b} ${s}deg ${e}deg`);
  }
  return parts;
}

// =====================================================================
// Action log — 최근 카드 플레이 기록 (duel.state.plays 파생)
// =====================================================================

interface ActionLogEntry {
  by: string;
  cardName: string;
  turn: number;
  success: boolean;
  critical: boolean;
  damageToOpponent: number;
  damageToSelf: number;
  heal: number;
  shieldGained: number;
}

const ACTION_LOG_MAX_ENTRIES = 8;

function actionLogHtml(app: App): string {
  const s = app.state;
  const plays = s.plays as unknown as ActionLogEntry[];
  const recent = plays.slice(-ACTION_LOG_MAX_ENTRIES).reverse();

  const rows = recent.length
    ? recent
        .map((p) => {
          const isMine = p.by === s.myId;
          const player = s.players.find((x) => x.connectionId === p.by);
          const playerName = player?.name ?? "?";

          const results: string[] = [];
          if (p.damageToOpponent > 0) {
            results.push(
              p.critical
                ? `치명 ${p.damageToOpponent}뎀`
                : `${p.damageToOpponent}뎀`,
            );
          } else if (!p.success) {
            results.push("빗나감");
          }
          if (p.heal > 0) results.push(`회복 ${p.heal}`);
          if (p.shieldGained > 0) results.push(`방어막 +${p.shieldGained}`);
          if (p.damageToSelf > 0) results.push(`자해 ${p.damageToSelf}`);

          const tail = results.length ? ` · ${results.join(", ")}` : "";
          const cls = isMine ? "logEntry-self" : "logEntry-opp";
          return `
            <div class="logEntry ${cls}">
              <span class="logTurn">T${p.turn}</span>
              <span class="logText">${escapeHtml(playerName)} → ${escapeHtml(
                p.cardName,
              )}${escapeHtml(tail)}</span>
            </div>
          `;
        })
        .join("")
    : `
        <div class="logEntry logEntry-sys">
          <span class="logTurn">—</span>
          <span class="logText">아직 기록된 플레이 없음</span>
        </div>
      `;

  return `
    <div class="actionLog">
      <div class="actionLogHeader">
        <span class="actionLogIcon">❦</span>
        <span>BATTLE LOG</span>
      </div>
      <div class="actionLogBody">${rows}</div>
    </div>
  `;
}

function pileModalHtml(app: App): string {
  const ui = app.state.pileModal;
  if (!ui) return "";

  const s = app.state;
  const target =
    ui.side === "me"
      ? s.players.find((p) => p.connectionId === s.myId)
      : s.players.find((p) => p.connectionId !== s.myId);
  if (!target) return "";

  const count = ui.kind === "deck" ? target.deckCount : target.graveyardCount;
  const titleSide = ui.side === "me" ? "나의" : "상대의";
  const titleKind = ui.kind === "deck" ? "덱" : "묘지";
  const subtitleText = ui.cardIds === null
    ? `${escapeHtml(target.name)} · 봉인된 ${count}장`
    : `${escapeHtml(target.name)} · ${count}장`;

  return `
    <div class="pileModalBackdrop" id="duelPileBackdrop">
      <div class="pileModal" id="duelPileModal">
        <div class="pileModalHeader">
          <div>
            <div class="pileModalTitle">${titleSide} ${titleKind}</div>
            <div class="pileModalSub">${subtitleText}</div>
          </div>
          <button class="pileModalClose" id="duelPileClose">✕</button>
        </div>
        <div class="pileModalBody">
          ${pileModalBodyHtml(ui, count, target.className ?? undefined)}
        </div>
      </div>
    </div>
  `;
}

function pileModalBodyHtml(
  ui: NonNullable<App["state"]["pileModal"]>,
  count: number,
  ownerClass: string | undefined,
): string {
  if (ui.loading && ui.cardIds === null) {
    return `
      <div class="pileModalEmpty">— 의식이 진행 중 —</div>
    `;
  }
  if (ui.cardIds === null) {
    const backs: string[] = [];
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++)
      backs.push(
        `<div class="pileModalBack">${cardHtml(null, { size: "back" })}</div>`,
      );
    return `
      <div class="pileModalHidden">
        <div class="pileModalHiddenIcon">✦</div>
        <div class="pileModalHiddenTitle">봉인된 덱</div>
        <div class="pileModalHiddenDesc">
          상대 덱의 내용은 확인할 수 없습니다.<br/>남은 카드: <strong>${count}장</strong>
        </div>
        <div class="pileModalHiddenGrid">${backs.join("")}</div>
      </div>
    `;
  }
  if (ui.cardIds.length === 0) {
    return `<div class="pileModalEmpty">— 비어있음 —</div>`;
  }
  const cells = ui.cardIds
    .map((id) => {
      try {
        const card = getCardById(id);
        return `<div class="pileModalCard">${cardHtml(card, { size: "hand", owner: ownerClass })}</div>`;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return `<div class="pileModalGrid">${cells.join("")}</div>`;
}

function zoomCardHtml(app: App): string {
  const id = app.state.zoomCardId;
  if (!id) return "";
  try {
    const card = getCardById(id);
    // owner 추정: 내 손패/플레이에 있으면 내 class, 상대 플레이에 있으면 상대 class,
    // pileModal 오픈 중이면 그 target 의 class.
    const s = app.state;
    const me = s.players.find((p) => p.connectionId === s.myId);
    const opp = s.players.find((p) => p.connectionId !== s.myId);
    type StampedPlay = CardPlayedMsg & { turn: number };
    const plays = s.plays as unknown as StampedPlay[];
    let ownerClass: string | undefined = undefined;
    if (s.hand.some((c) => c.id === id)) ownerClass = me?.className ?? undefined;
    else if (plays.some((p) => p.cardId === id && p.by === opp?.connectionId))
      ownerClass = opp?.className ?? undefined;
    else if (plays.some((p) => p.cardId === id && p.by === me?.connectionId))
      ownerClass = me?.className ?? undefined;
    else if (s.pileModal) {
      const target = s.pileModal.side === "me" ? me : opp;
      ownerClass = target?.className ?? undefined;
    }
    // 줌 카드에도 실시간 데미지 반영 — 내 손패 기준으로 ctx 구성.
    // (상대 플레이된 카드를 확대하는 경우에도, 계산 주체를 "나"로 보는 게 직관적.)
    const ctx: CardStatCtx = { me, opp };
    return `
      <div class="zoomCardBackdrop" id="duelZoomBackdrop">
        <div class="zoomCardShell" id="duelZoomShell">
          <button class="zoomCardClose" id="duelZoomClose">✕</button>
          <div class="zoomCardInner">
            ${cardHtml(card, { size: "hand", owner: ownerClass, ctx })}
          </div>
          <div class="zoomCardHint">배경을 클릭하여 닫기 · ESC</div>
        </div>
      </div>
    `;
  } catch {
    return "";
  }
}

// =====================================================================
// Wiring — pointer events + overlay interactions
// =====================================================================

function wire(
  stage: HTMLElement,
  app: App,
  _me: PlayerPublic,
  _opp: PlayerPublic,
  sigLocked: boolean,
) {
  // End turn
  stage.querySelector<HTMLButtonElement>("#duelEndTurn")?.addEventListener(
    "click",
    () => {
      if (app.state.activeId !== app.state.myId) return;
      app.state.client?.send({ type: "end_turn" });
    },
  );

  // Deck/grave clicks → view_pile
  stage.querySelectorAll<HTMLElement>("[data-pile]").forEach((el) => {
    el.addEventListener("click", () => {
      const raw = el.getAttribute("data-pile")!;
      const [whose, kind] = raw.split("-") as ["me" | "opp", "deck" | "grave"];
      app.state.pileModal = {
        side: whose,
        kind,
        cardIds: null,
        loading: true,
      };
      app.state.client?.send({ type: "view_pile", side: whose, kind });
      app.render();
    });
  });

  // Hand pointer flow — drag threshold 5px, click < 400ms → zoom
  const handFan = stage.querySelector<HTMLElement>(".handFan");
  handFan?.querySelectorAll<HTMLElement>(".handSlot").forEach((slot) => {
    const cardId = slot.getAttribute("data-card")!;
    const card = app.state.hand.find((c) => c.id === cardId);
    if (!card) return;
    const locked =
      app.state.silencedCardIds.includes(cardId) ||
      (sigLocked && card.signature);

    slot.addEventListener("pointerenter", () => {
      if (dragState?.moved) return;
      slot.classList.add("hover");
    });
    slot.addEventListener("pointerleave", () => {
      slot.classList.remove("hover");
    });

    slot.addEventListener("pointerdown", (e) => {
      if (dragState) return;
      const canPlay =
        !locked &&
        app.state.activeId === app.state.myId &&
        !app.state.isAnimating;
      e.preventDefault();
      beginPointer(app, stage, slot, card, e as PointerEvent, canPlay);
    });
  });

  // Bet overlay
  const slider = stage.querySelector<HTMLInputElement>("#duelBetSlider");
  slider?.addEventListener("input", () => {
    const bet = Number(slider.value);
    app.state.pendingBet = bet;
    const cap = Number(slider.max);
    slider.style.setProperty("--fill", `${cap > 0 ? (bet / cap) * 100 : 0}%`);
    const big = stage.querySelector<HTMLElement>("#duelBetBig");
    if (big) big.textContent = `${bet}`;
    const ticks = stage.querySelectorAll<HTMLElement>(
      "#duelBetTicks .betTick",
    );
    ticks.forEach((t, i) => t.classList.toggle("lit", i <= bet));
    const card = app.state.hand.find((c) => c.id === app.state.selectedCardId);
    if (card) {
      // 현재 state.players 기준으로 me 를 다시 조회 — 버프 변동분 반영
      const currentMe = app.state.players.find(
        (p) => p.connectionId === app.state.myId,
      );
      const preview = stage.querySelector<HTMLElement>("#duelBetPreview");
      if (preview && currentMe) {
        preview.innerHTML = betPreviewRowsHtml(card, bet, currentMe);
      }
    }
  });
  stage
    .querySelector<HTMLButtonElement>("#duelBetCancel")
    ?.addEventListener("click", () => {
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    });
  stage
    .querySelector<HTMLButtonElement>("#duelBetClose")
    ?.addEventListener("click", () => {
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    });
  stage
    .querySelector<HTMLButtonElement>("#duelBetConfirm")
    ?.addEventListener("click", () => {
      const id = app.state.selectedCardId;
      if (!id) return;
      app.state.client?.send({
        type: "play_card",
        cardId: id,
        bet: app.state.pendingBet,
      });
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    });

  // Pile modal
  stage
    .querySelector<HTMLElement>("#duelPileBackdrop")
    ?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "duelPileBackdrop") {
        app.state.pileModal = null;
        app.render();
      }
    });
  stage
    .querySelector<HTMLButtonElement>("#duelPileClose")
    ?.addEventListener("click", () => {
      app.state.pileModal = null;
      app.render();
    });

  // Zoom modal — 닫을 땐 전체 re-render 하지 않고 backdrop DOM 만 즉시 제거
  // (full render 는 wire 재실행 + innerHTML 재조립으로 체감 지연이 생김)
  const closeZoom = () => {
    app.state.zoomCardId = null;
    stage.querySelector<HTMLElement>("#duelZoomBackdrop")?.remove();
  };
  stage
    .querySelector<HTMLElement>("#duelZoomBackdrop")
    ?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "duelZoomBackdrop") {
        closeZoom();
      }
    });
  stage
    .querySelector<HTMLButtonElement>("#duelZoomClose")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeZoom();
    });

  // Delegated zoom — field card / pile modal card
  stage.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-zoom-card]",
    );
    if (!el) return;
    if (el.closest(".handSlot")) return;
    const id = el.getAttribute("data-zoom-card");
    if (!id) return;
    app.state.zoomCardId = id;
    app.render();
  });

  // ESC: zoom > pile
  const w = window as unknown as { __duelEscHandler?: (e: KeyboardEvent) => void };
  if (w.__duelEscHandler)
    window.removeEventListener("keydown", w.__duelEscHandler);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (app.state.zoomCardId) {
      closeZoom();
      return;
    }
    if (app.state.pileModal) {
      app.state.pileModal = null;
      app.render();
    }
  };
  w.__duelEscHandler = onKey;
  window.addEventListener("keydown", onKey);
}

// =====================================================================
// Pointer flow — drag vs click
// =====================================================================

const DRAG_THRESHOLD = 5;
const CLICK_MAX_MS = 400;

function beginPointer(
  app: App,
  stage: HTMLElement,
  slot: HTMLElement,
  card: Card,
  startEv: PointerEvent,
  canPlay: boolean,
) {
  const startX = startEv.clientX;
  const startY = startEv.clientY;
  const startTime = performance.now();

  let started = false;

  const onMove = (ev: PointerEvent) => {
    const dx = Math.abs(ev.clientX - startX);
    const dy = Math.abs(ev.clientY - startY);
    if (!started) {
      if (canPlay && Math.max(dx, dy) > DRAG_THRESHOLD) {
        started = true;
        startDrag(app, stage, slot, card, startEv);
      }
      return;
    }
    if (!dragState) return;
    updateDrag(ev);
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (started) {
      finishDrag(app);
      return;
    }
    // click → zoom
    const elapsed = performance.now() - startTime;
    const dx = Math.abs(ev.clientX - startX);
    const dy = Math.abs(ev.clientY - startY);
    if (elapsed <= CLICK_MAX_MS && Math.max(dx, dy) <= DRAG_THRESHOLD) {
      app.state.zoomCardId = card.id;
      app.render();
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startDrag(
  app: App,
  stage: HTMLElement,
  slot: HTMLElement,
  card: Card,
  startEv: PointerEvent,
) {
  slot.classList.add("drag");

  const stageRect = stage.getBoundingClientRect();
  const scale = stageRect.width / 1600;
  const cardRect = slot.getBoundingClientRect();
  const offsetX = (startEv.clientX - cardRect.left) / scale;
  const offsetY = (startEv.clientY - cardRect.top) / scale;

  const me = app.state.players.find((p) => p.connectionId === app.state.myId);
  const opp = app.state.players.find((p) => p.connectionId !== app.state.myId);
  const ghostEl = document.createElement("div");
  ghostEl.className = "dragGhost";
  ghostEl.innerHTML = cardHtml(card, {
    size: "hand",
    dragging: true,
    owner: me?.className ?? undefined,
    ctx: { me, opp },
  });
  stage.appendChild(ghostEl);

  dragState = {
    card,
    pointerId: startEv.pointerId,
    ghostEl,
    stage,
    offsetX,
    offsetY,
    hoverSlotIdx: -1,
    startX: startEv.clientX,
    startY: startEv.clientY,
    startTime: performance.now(),
    moved: true,
  };
  placeGhost(startEv);
}

function updateDrag(ev: PointerEvent) {
  if (!dragState) return;
  placeGhost(ev);
  const zones = dragState.stage.querySelectorAll<HTMLElement>(
    ".dropZone.zone-self.empty",
  );
  let found = -1;
  zones.forEach((z, idx) => {
    const zr = z.getBoundingClientRect();
    if (
      ev.clientX >= zr.left &&
      ev.clientX <= zr.right &&
      ev.clientY >= zr.top &&
      ev.clientY <= zr.bottom
    ) {
      found = idx;
    }
  });
  if (found !== dragState.hoverSlotIdx) {
    zones.forEach((z, idx) =>
      z.classList.toggle("dropActive", idx === found),
    );
    dragState.hoverSlotIdx = found;
  }
}

function placeGhost(ev: PointerEvent) {
  if (!dragState) return;
  const stageRect = dragState.stage.getBoundingClientRect();
  const scale = stageRect.width / 1600;
  const x = (ev.clientX - stageRect.left) / scale - dragState.offsetX;
  const y = (ev.clientY - stageRect.top) / scale - dragState.offsetY;
  dragState.ghostEl.style.left = `${x}px`;
  dragState.ghostEl.style.top = `${y}px`;
}

function finishDrag(app: App) {
  if (!dragState) return;
  const st = dragState;
  dragState = null;

  // cleanup
  st.ghostEl.remove();
  const zones = st.stage.querySelectorAll<HTMLElement>(
    ".dropZone.zone-self",
  );
  zones.forEach((z) => z.classList.remove("dropActive"));
  st.stage.querySelectorAll(".handSlot.drag").forEach((el) =>
    el.classList.remove("drag"),
  );

  if (st.hoverSlotIdx < 0) {
    app.render();
    return;
  }
  // 드롭 성공 → 베팅 가능 캡 계산
  const me = app.state.players.find(
    (p) => p.connectionId === app.state.myId,
  );
  if (!me) return;
  const hpMinus1 = Math.max(0, me.hp - 1);
  const override = me.statuses.betCapOverride;
  const cap = Math.min(st.card.maxBet, hpMinus1, override ?? st.card.maxBet);
  if (cap === 0) {
    app.state.client?.send({
      type: "play_card",
      cardId: st.card.id,
      bet: 0,
    });
    app.state.selectedCardId = null;
    app.state.pendingBet = 0;
    app.render();
    return;
  }
  app.state.selectedCardId = st.card.id;
  app.state.pendingBet = 0;
  app.render();
}

// =====================================================================
// Utils
// =====================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
