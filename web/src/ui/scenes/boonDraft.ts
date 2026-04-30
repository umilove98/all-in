/**
 * Boon Draft Scene — 행운 아이템 선택.
 * design handoff (Boon Draft.html / BoonDraft.jsx + BoonCard.jsx) 1:1 포팅.
 *
 * Mount-once 패턴: 같은 옵션 세트가 유지되는 동안엔 stage.innerHTML 을
 * 다시 쓰지 않는다. reveal cascade / 타이머 / 트랜지션은 직접 DOM 조작으로
 * 처리 (전체 재렌더 시 bcFlyIn 재생되는 깜빡임 방지).
 *
 * Phase timeline:
 *   intro → reveal → picking → picked | waiting →
 *   transition → consecrate → imprint → blackout → (unmount, battle 전환)
 */

import { App } from "../../app";
import { Boon, ClassName, getBoonById } from "../../engine";
import { ensureStage } from "../sceneStage";
import { CLASS_DEFS } from "./classPick";

const ACTIVE_CLASS = "bd-active";

interface CategoryMeta {
  label: string;
  glyph: string;
  accent: string;
  deep: string;
  hue: string;
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  steady: { label: "DEFENSE", glyph: "⛨", accent: "#7ea2b8", deep: "#172630", hue: "rgba(126,162,184,0.14)" },
  aggressive: { label: "OFFENSE", glyph: "⚔", accent: "#c99454", deep: "#3a2008", hue: "rgba(201,148,84,0.16)" },
  risky: { label: "VITALITY", glyph: "❤", accent: "#c54c4c", deep: "#3a0e14", hue: "rgba(197,76,76,0.18)" },
  utility: { label: "INSIGHT", glyph: "👁", accent: "#b8a0c8", deep: "#20142d", hue: "rgba(184,160,200,0.16)" },
};

// ===== 모듈 상태 (재렌더 간 유지) =====
let mountedKey = "";
let revealTimers: number[] = [];
let timerIntervalId: number | null = null;
/** picking phase 진입 시각 — resetBoonDraftState() 외엔 리셋되지 않음.
 *  리롤로 인해 옵션이 바뀌어 mountScene 이 다시 실행돼도 이 값은 유지된다.
 *  도박사의 15초 예산은 리롤 포함해서 공유. */
let pickingStartedAt: number | null = null;
let transitionStartedAt: number | null = null;
let transitionTimers: number[] = [];
const REVEAL_STAGGER = [1400, 1600, 1800];
const PICKING_STARTS_AT = 2400;
const PICKING_TIMER_SECONDS = 15;
/** transition 총 지속. 이 시간만큼 씬을 배틀보다 먼저 보여준다.
 *  curtain(2100ms~) 에서 양쪽 boon 을 대비 공개하므로 여유있게 읽을 수 있도록 5500ms. */
const TRANSITION_TOTAL_MS = 5500;

export function isBoonTransitioning(): boolean {
  return (
    transitionStartedAt !== null &&
    Date.now() - transitionStartedAt < TRANSITION_TOTAL_MS
  );
}

/** 씬 unmount (배틀로 전환 시). 모듈 상태 정리. */
export function resetBoonDraftState(): void {
  mountedKey = "";
  revealTimers.forEach((t) => clearTimeout(t));
  revealTimers = [];
  if (timerIntervalId !== null) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  pickingStartedAt = null;
  transitionStartedAt = null;
  transitionTimers.forEach((t) => clearTimeout(t));
  transitionTimers = [];
}

export function renderBoonDraft(root: HTMLElement, app: App): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);

  const options = s.boonOptions
    .map((id) => {
      try {
        return getBoonById(id);
      } catch {
        return null;
      }
    })
    .filter((b): b is Boon => b !== null);

  const optionsKey = options.map((b) => b.id).join(",");
  const mountKey = `${optionsKey}:${s.myId}`;

  const stage = ensureStage(root, ACTIVE_CLASS);

  // === Mount ===
  if (mountKey !== mountedKey) {
    mountScene(stage, options, me?.className === "gambler");
    mountedKey = mountKey;
    scheduleReveal(stage, app);
    wireHandlers(stage, app);
  }

  // === 업데이트 (mount 여부 상관없이 매 호출) ===
  updateSelection(stage, me?.boonId ?? null);
  updateFoot(stage, app);
  updateReroll(stage, app);
  updateTransition(stage, app, options, me?.boonId ?? null, Boolean(opp?.boonId));
}

// =====================================================================
// Mount
// =====================================================================

function mountScene(
  stage: HTMLElement,
  options: Boon[],
  _isGambler: boolean,
): void {
  stage.innerHTML = `
    <div class="draftRoot draft-phase-intro" id="draftRoot">
      <div class="draftBattleBg"></div>
      <div class="draftDeepOverlay"></div>
      <div class="draftVignette"></div>
      <div class="draftEmbers">${draftEmbersHtml()}</div>

      <div class="draftCeremony">
        <div class="draftPreamble">
          <div class="draftPreambleGlyphs"><span>✦</span><span>❦</span><span>✦</span></div>
          <div class="draftOverline">RITE OF THE BOON</div>
          <h1 class="draftTitle">행운 아이템 선택</h1>
          <div class="draftSubtitle" id="draftSubtitle">${" "}</div>
        </div>

        <div class="draftCardRow" id="draftCardRow">
          ${options.map((b, i) => boonCardHtml(b, i)).join("")}
        </div>

        <div class="draftFootBar">
          <div class="draftFootSide draftFootLeft" id="draftFootLeft"></div>
          <div class="draftFootCenter" id="draftFootCenter"></div>
          <div class="draftFootSide draftFootRight" id="draftFootRight"></div>
        </div>
      </div>

      <div id="draftFlashMount"></div>
      <div id="draftCurtainMount"></div>
    </div>
  `;
}

function boonCardHtml(boon: Boon, index: number): string {
  const meta = CATEGORY_META[boon.category] ?? CATEGORY_META.aggressive!;
  const style = [
    `--accent:${meta.accent}`,
    `--deep:${meta.deep}`,
    `--hue:${meta.hue}`,
    `--delay:${index * 180}ms`,
    `--slot:${index}`,
  ].join(";");
  const effectLabel = boon.nameEn ? boon.nameEn.toUpperCase() : meta.label;

  return `
    <div class="draftSlot draftSlot-${index}">
      <button class="boonCard bc-${boon.category} bc-idle bc-hidden"
        data-id="${escapeAttr(boon.id)}" data-index="${index}"
        style="${style}" aria-label="${escapeAttr(boon.name)}">
        <div class="bcBack">
          <div class="bcBackOrnament">✦</div>
          <div class="bcBackGlyph">${meta.glyph}</div>
          <div class="bcBackOrnament">✦</div>
        </div>
        <div class="bcFront">
          <span class="bcCorner bcCornerTL">✦</span>
          <span class="bcCorner bcCornerTR">✦</span>
          <span class="bcCorner bcCornerBL">✦</span>
          <span class="bcCorner bcCornerBR">✦</span>

          <div class="bcHeader">
            <span class="bcCategory">
              <span class="bcCatGlyph">${meta.glyph}</span>
              <span class="bcCatLabel">${meta.label}</span>
            </span>
          </div>

          <div class="bcEmblem">
            <div class="bcEmblemRing"></div>
            <div class="bcEmblemCore">${boon.emoji || meta.glyph}</div>
            <div class="bcEmblemHalo"></div>
          </div>

          <div class="bcName">${escapeHtml(boon.name)}</div>

          <div class="bcEffectWrap">
            <div class="bcRuleLine"></div>
            <div class="bcEffect">${escapeHtml(effectLabel)}</div>
            <div class="bcRuleLine"></div>
          </div>

          <div class="bcLongDesc">${escapeHtml(boon.desc)}</div>

          <div class="bcSelectOverlay">
            <div class="bcSelectSeal">
              <div class="bcSelectGlyph">❦</div>
              <div class="bcSelectText">선택됨</div>
            </div>
          </div>
        </div>
        <div class="bcPlinth"></div>
      </button>
    </div>
  `;
}

function scheduleReveal(stage: HTMLElement, app: App): void {
  const cards = stage.querySelectorAll<HTMLElement>(".boonCard");
  REVEAL_STAGGER.forEach((ms, idx) => {
    const t = window.setTimeout(() => {
      cards[idx]?.classList.remove("bc-hidden");
      cards[idx]?.classList.add("bc-revealed");
    }, ms);
    revealTimers.push(t);
  });
  // picking 전환 시점
  revealTimers.push(
    window.setTimeout(() => {
      const root = stage.querySelector<HTMLElement>("#draftRoot");
      if (root && !transitionStartedAt) {
        setRootPhase(root, "picking");
        ensurePickingTimer(stage, app);
      }
    }, PICKING_STARTS_AT),
  );
}

function wireHandlers(stage: HTMLElement, app: App): void {
  stage.querySelectorAll<HTMLButtonElement>(".boonCard[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (transitionStartedAt) return;
      const id = btn.getAttribute("data-id")!;
      app.sendGameMsg({ type: "pick_boon", boonId: id });
    });
  });
  stage
    .querySelector<HTMLButtonElement>("#draftReroll")
    ?.addEventListener("click", () => {
      app.sendGameMsg({ type: "reroll_boon" });
    });
}

// =====================================================================
// Incremental updates (직접 DOM)
// =====================================================================

function updateSelection(stage: HTMLElement, selectedId: string | null): void {
  stage.querySelectorAll<HTMLButtonElement>(".boonCard").forEach((btn) => {
    const id = btn.getAttribute("data-id");
    const selected = id === selectedId && selectedId !== null;
    const dimmed = selectedId !== null && !selected;
    btn.classList.toggle("bc-selected", selected);
    btn.classList.toggle("bc-dimmed", dimmed && !selected);
    btn.classList.toggle("bc-idle", !selected && !dimmed);
    btn.disabled = selectedId !== null || transitionStartedAt !== null;
  });
}

function updateFoot(stage: HTMLElement, app: App): void {
  const center = stage.querySelector<HTMLElement>("#draftFootCenter");
  const subtitle = stage.querySelector<HTMLElement>("#draftSubtitle");
  if (!center || !subtitle) return;
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  const iPicked = Boolean(me?.boonId);
  const oppPicked = Boolean(opp?.boonId);
  const phase = currentPhase(iPicked, oppPicked);

  if (phase === "picked") {
    center.innerHTML = `
      <div class="draftOpponentStatus">
        <span class="dosSpinner"></span>
        <span>상대가 운명을 고르고 있다…</span>
      </div>
    `;
    subtitle.textContent = "상대가 운명을 고르고 있다…";
  } else if (phase === "waiting") {
    center.innerHTML = `
      <div class="draftOpponentStatus dosReady">
        <span class="dosCheck">◆</span>
        <span>양쪽 모두 선택했다. 전투 준비.</span>
      </div>
    `;
    subtitle.textContent = "양쪽 모두 선택했다 — 결투가 시작된다";
  } else if (phase === "transition") {
    center.innerHTML = `<div class="draftInstruction draftInstructionFade">운명이 내려진다</div>`;
    subtitle.textContent = " ";
  } else if (phase === "picking") {
    center.innerHTML = "";
    subtitle.textContent = "운명의 세 갈래 — 하나를 골라라";
  } else {
    center.innerHTML = "";
    subtitle.textContent = " ";
  }
}

function updateReroll(stage: HTMLElement, app: App): void {
  const right = stage.querySelector<HTMLElement>("#draftFootRight");
  if (!right) return;
  const me = app.state.players.find((p) => p.connectionId === app.state.myId);
  const isGambler = me?.className === "gambler";
  const iPicked = Boolean(me?.boonId);
  const canReroll =
    !iPicked && isGambler && (me?.boonRerollsLeft ?? 0) > 0;

  if (!isGambler) {
    right.innerHTML = `
      <button class="draftReroll draftRerollHidden" disabled>
        <span class="drRerollIcon">↺</span>
        <span class="drRerollText">리롤</span>
        <span class="drRerollSub">도박사 전용</span>
      </button>
    `;
    return;
  }
  right.innerHTML = `
    <button id="draftReroll" class="draftReroll" ${canReroll ? "" : "disabled"}>
      <span class="drRerollIcon">↺</span>
      <span class="drRerollText">리롤</span>
      <span class="drRerollSub">${canReroll ? `${me?.boonRerollsLeft ?? 0}회 남음` : "사용 완료"}</span>
    </button>
  `;
  // 리바인딩 필요 (innerHTML 교체 시 이벤트 손실)
  right
    .querySelector<HTMLButtonElement>("#draftReroll")
    ?.addEventListener("click", () => {
      app.sendGameMsg({ type: "reroll_boon" });
    });
}

function currentPhase(
  iPicked: boolean,
  oppPicked: boolean,
): "reveal" | "picking" | "picked" | "waiting" | "transition" {
  if (transitionStartedAt) return "transition";
  if (!iPicked && !oppPicked) return "picking"; // reveal 단계는 updateTransition 에서 덮어씀
  if (iPicked && !oppPicked) return "picked";
  if (!iPicked && oppPicked) return "picking";
  return "waiting";
}

// =====================================================================
// Timer tick
// =====================================================================

/**
 * idempotent 타이머 — pickingStartedAt 이 null 이면 시작, 이미 설정돼 있으면
 * 리롤로 인한 재mount 에도 그대로 유지. DOM 재생성만 하고 interval 은 1회만.
 */
function ensurePickingTimer(stage: HTMLElement, app: App): void {
  const left = stage.querySelector<HTMLElement>("#draftFootLeft");
  if (!left) return;

  // Moon dial DOM 은 매 mount 마다 다시 그린다 (stage 내부 innerHTML 갱신 시 사라지므로)
  const R = 28;
  const C = 2 * Math.PI * R;
  const ticks: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x1 = 36 + Math.cos(a) * 33;
    const y1 = 36 + Math.sin(a) * 33;
    const r2 = i % 3 === 0 ? 30 : 31.5;
    const x2 = 36 + Math.cos(a) * r2;
    const y2 = 36 + Math.sin(a) * r2;
    ticks.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="cdMoonTick"></line>`,
    );
  }
  left.innerHTML = `
    <div class="cdMoon" id="draftMoon">
      <svg viewBox="0 0 72 72" class="cdMoonSvg">
        <circle cx="36" cy="36" r="${R}" class="cdMoonTrack"></circle>
        <circle cx="36" cy="36" r="${R}" class="cdMoonFill"
          stroke-dasharray="${C}" stroke-dashoffset="0"
          transform="rotate(-90 36 36)"></circle>
        ${ticks.join("")}
      </svg>
      <div class="cdMoonNum" id="draftMoonNum">${PICKING_TIMER_SECONDS}</div>
      <div class="cdMoonLabel">SEC</div>
    </div>
  `;

  // 최초 진입 시에만 startedAt 설정. 리롤로 재mount 시엔 유지돼 타이머 연속.
  if (pickingStartedAt === null) pickingStartedAt = Date.now();

  const tick = () => {
    if (pickingStartedAt === null) return;
    const elapsed = (Date.now() - pickingStartedAt) / 1000;
    const remaining = Math.max(0, PICKING_TIMER_SECONDS - Math.floor(elapsed));

    // 매번 최신 DOM 을 쿼리 (stage.innerHTML 이 재작성됐을 수 있음)
    const numEl = document.querySelector<HTMLElement>("#draftMoonNum");
    const fillEl = document.querySelector<SVGCircleElement>(".cdMoon .cdMoonFill");
    const moonEl = document.querySelector<HTMLElement>("#draftMoon");
    if (numEl) numEl.textContent = String(remaining);
    if (fillEl) {
      const offset = C * (1 - remaining / PICKING_TIMER_SECONDS);
      fillEl.setAttribute("stroke-dashoffset", String(offset));
    }
    if (moonEl) moonEl.classList.toggle("cdUrgent", remaining <= 5);
    if (remaining <= 0 && timerIntervalId !== null) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      autoPickBoon(app);
    }
  };
  tick();
  // interval 은 1회만
  if (timerIntervalId === null) {
    timerIntervalId = window.setInterval(tick, 250);
  }
}

/** 타이머 만료 시 남은 옵션에서 랜덤 자동 선택 (이미 픽 완료면 skip). */
function autoPickBoon(app: App): void {
  const me = app.state.players.find(
    (p) => p.connectionId === app.state.myId,
  );
  if (me?.boonId) return;
  const options = app.state.boonOptions;
  if (options.length === 0) return;
  const pick = options[Math.floor(Math.random() * options.length)]!;
  app.sendGameMsg({ type: "pick_boon", boonId: pick });
}

// =====================================================================
// Transition (consecrate → imprint → blackout)
// =====================================================================

function updateTransition(
  stage: HTMLElement,
  app: App,
  options: Boon[],
  mySelectedId: string | null,
  oppPicked: boolean,
): void {
  const iPicked = mySelectedId !== null;

  // 두 명 모두 픽 완료 && 아직 트랜지션 시작 안 함 → 시작
  if (iPicked && oppPicked && !transitionStartedAt) {
    transitionStartedAt = Date.now();

    // 타이머 정리
    if (timerIntervalId !== null) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }

    const root = stage.querySelector<HTMLElement>("#draftRoot");
    if (!root) return;

    // rejected/chosen 클래스 붙이기
    const cards = stage.querySelectorAll<HTMLElement>(".boonCard");
    cards.forEach((btn) => {
      const id = btn.getAttribute("data-id");
      if (id === mySelectedId) {
        btn.classList.remove("bc-selected", "bc-idle", "bc-dimmed");
        btn.classList.add("bc-chosen", "chosen-transition");
      } else {
        btn.classList.remove("bc-idle", "bc-dimmed");
        btn.classList.add("bc-rejected");
      }
    });

    // 페이즈 진행
    const scheduleStep = (ms: number, fn: () => void) => {
      transitionTimers.push(window.setTimeout(fn, ms));
    };

    scheduleStep(50, () => {
      setRootPhase(root, "consecrate");
      cards.forEach((btn) => {
        if (btn.getAttribute("data-id") === mySelectedId) {
          btn.classList.remove("chosen-transition");
          btn.classList.add("chosen-consecrate");
        }
      });
    });

    scheduleStep(1500, () => {
      setRootPhase(root, "imprint");
      cards.forEach((btn) => {
        if (btn.getAttribute("data-id") === mySelectedId) {
          btn.classList.remove("chosen-consecrate");
          btn.classList.add("chosen-imprint");
        }
      });
      // crimson flash
      const mount = stage.querySelector<HTMLElement>("#draftFlashMount");
      if (mount) mount.innerHTML = `<div class="draftFlash"></div>`;
    });

    scheduleStep(2100, () => {
      setRootPhase(root, "blackout");
      cards.forEach((btn) => {
        if (btn.getAttribute("data-id") === mySelectedId) {
          btn.classList.remove("chosen-imprint");
          btn.classList.add("chosen-blackout");
        }
      });
      // curtain — 양쪽 boon 대비 공개
      const mount = stage.querySelector<HTMLElement>("#draftCurtainMount");
      if (mount) mount.innerHTML = curtainHtml(app, mySelectedId);
    });

    // 3800ms 후: 트랜지션 종료 → 다음 render 부터 battle 씬이 takeover
    scheduleStep(TRANSITION_TOTAL_MS, () => {
      // 상태 리셋 후 app.render 유도 → waitroom 이 phase=battle 감지하고 duel 로 전환
      resetBoonDraftState();
      app.render();
    });
  }

  void options; // 참조 유지용 (향후 디버그)
}

function curtainHtml(app: App, mySelectedId: string | null): string {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  const myBoon = mySelectedId ? safeBoon(mySelectedId) : null;
  const oppBoon = opp?.boonId ? safeBoon(opp.boonId) : null;

  const myName = me?.name ?? "YOU";
  const oppName = opp?.name ?? "RIVAL";

  return `
    <div class="draftCurtain">
      <div class="draftCurtainInner">
        <div class="draftCurtainGlyph">⚔</div>
        <div class="draftCurtainTitle">전투 개시</div>
        <div class="draftCurtainSub">— UNDERGROUND DUEL —</div>
        <div class="draftCurtainVersus">
          ${versusSideHtml("you", myName, me?.className ?? null, myBoon)}
          <div class="dcvSep">
            <span class="dcvSepLine"></span>
            <span class="dcvVs">VS</span>
            <span class="dcvSepLine"></span>
          </div>
          ${versusSideHtml("rival", oppName, opp?.className ?? null, oppBoon)}
        </div>
      </div>
    </div>
  `;
}

function versusSideHtml(
  kind: "you" | "rival",
  playerName: string,
  className: ClassName | null,
  boon: Boon | null,
): string {
  const meta = boon
    ? (CATEGORY_META[boon.category] ?? CATEGORY_META.aggressive!)
    : null;
  const glyph = boon?.emoji || meta?.glyph || "？";
  const boonName = boon?.name ?? "—";
  const boonEn = boon?.nameEn ?? "";
  const desc = boon?.desc ?? "";
  const accent = meta?.accent ?? "#c99454";
  const hue = meta?.hue ?? "rgba(201,148,84,0.16)";
  const style = `--accent:${accent};--hue:${hue}`;

  const cls = className ? CLASS_DEFS[className] : null;
  const classBadge = cls
    ? `
      <div class="dcvClassBadge" style="--cls-accent:${cls.accent};--cls-hue:${cls.hue}">
        <span class="dcvClassGlyph">${cls.glyph}</span>
        <span class="dcvClassName">${escapeHtml(cls.nameKo)}</span>
        <span class="dcvClassEn">${escapeHtml(cls.nameEn)}</span>
      </div>
    `
    : "";

  return `
    <div class="dcvSide dcvSide-${kind}" style="${style}">
      <div class="dcvSideLabel">${kind === "you" ? "YOU" : "RIVAL"}</div>
      <div class="dcvSidePlayer">${escapeHtml(playerName)}</div>
      ${classBadge}
      <div class="dcvBoonEmblem">
        <div class="dcvBoonRing"></div>
        <div class="dcvBoonGlyph">${glyph}</div>
      </div>
      <div class="dcvBoonName">${escapeHtml(boonName)}</div>
      ${boonEn ? `<div class="dcvBoonEn">${escapeHtml(boonEn.toUpperCase())}</div>` : ""}
      <div class="dcvBoonDesc">${escapeHtml(desc)}</div>
    </div>
  `;
}

function safeBoon(id: string): Boon | null {
  try {
    return getBoonById(id);
  } catch {
    return null;
  }
}

function setRootPhase(root: HTMLElement, phase: string): void {
  // draft-phase-X 만 교체
  const next: string[] = [];
  root.classList.forEach((c) => {
    if (!c.startsWith("draft-phase-")) next.push(c);
  });
  root.className = next.join(" ") + ` draft-phase-${phase}`;
}

// =====================================================================
// Helpers
// =====================================================================

function draftEmbersHtml(): string {
  const parts: string[] = [];
  for (let i = 0; i < 18; i++) {
    const left = (i * 53) % 100;
    const delay = (i * 0.4) % 6;
    const duration = 7 + (i % 5);
    parts.push(
      `<span class="draftEmber" style="left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s"></span>`,
    );
  }
  return parts.join("");
}

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
