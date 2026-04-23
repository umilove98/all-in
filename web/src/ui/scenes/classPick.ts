/**
 * Class Pick Scene — 직업 선택.
 * design handoff (Class Pick.html / ClassPickScene.jsx + CoinToss.jsx + ClassCard.jsx)
 * 1:1 포팅 + mount-once 패턴.
 *
 * phase timeline:
 *   intro | coin-spin | coin-resolve | coin-announced   ← coinTossAnimation 활성
 *   first-picking | first-picked (1.4s bridge) | second-picking | second-picked
 */

import { App } from "../../app";
import { ClassName } from "../../engine";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "cp-active";
const CLASS_IDS: ClassName[] = ["berserker", "gambler", "warden"];
const PICK_TIMER_SECONDS = 30;
/** 선픽 확정 후 후픽 단계로 넘어가기 전 브릿지 (디자인과 동일 1.4s). */
const FIRST_PICKED_BRIDGE_MS = 1400;

interface ClassDef {
  nameKo: string;
  nameEn: string;
  role: string;
  glyph: string;
  accent: string;
  hue: string;
  tagline: string;
  passiveName: string;
  passiveDesc: string;
  cornerGlyph: string;
}

const CLASS_DEFS: Record<ClassName, ClassDef> = {
  berserker: {
    nameKo: "광전사",
    nameEn: "BERSERKER",
    role: "OFFENSE",
    glyph: "🔥",
    accent: "#d97030",
    hue: "rgba(217,112,48,0.35)",
    tagline: "내 피 한 방울이 더 강하다.",
    passiveName: "광기의 각인",
    passiveDesc: "HP 베팅 1당 추가 명중률 +2%",
    cornerGlyph: "✦",
  },
  gambler: {
    nameKo: "도박사",
    nameEn: "GAMBLER",
    role: "CHAOS",
    glyph: "🎲",
    accent: "#b07cd9",
    hue: "rgba(176,124,217,0.35)",
    tagline: "이번 판도 운이 좋네.",
    passiveName: "운명의 총아",
    passiveDesc: "부운 픽 단계에서 리롤 1회",
    cornerGlyph: "❖",
  },
  warden: {
    nameKo: "컨트롤러",
    nameEn: "WARDEN",
    role: "CONTROL",
    glyph: "🛡️",
    accent: "#6fa8c9",
    hue: "rgba(111,168,201,0.35)",
    tagline: "안 죽는 게 이김.",
    passiveName: "감시의 눈",
    passiveDesc: "매 턴 시작 시 상대 손패 1장 랜덤 봉인",
    cornerGlyph: "❈",
  },
};

type Phase =
  | "intro"
  | "coin-spin"
  | "coin-resolve"
  | "coin-announced"
  | "first-picking"
  | "first-picked"
  | "second-picking"
  | "second-picked";

// ===== 모듈 상태 =====
let mountedMode: "coin" | "pick" | null = null;
/** 현재 코인 페이즈 (mount-once 시 직접 DOM class 토글). */
let coinPhaseApplied: "intro" | "coin-spin" | "coin-resolve" | "coin-announced" | null = null;
let timerIntervalId: number | null = null;
let timerStartedAt: number | null = null;
let pickTimerPhase: "first" | "second" | null = null;
/** first-picked 브릿지 시작 시각. 1.4s 후 "second-picking" 으로 넘긴다. */
let firstPickedAt: number | null = null;
let bridgeTimerId: number | null = null;

export function resetClassPickState(): void {
  mountedMode = null;
  coinPhaseApplied = null;
  if (timerIntervalId !== null) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  timerStartedAt = null;
  pickTimerPhase = null;
  firstPickedAt = null;
  if (bridgeTimerId !== null) {
    clearTimeout(bridgeTimerId);
    bridgeTimerId = null;
  }
}

export function renderClassPick(root: HTMLElement, app: App): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  const iAmFirstPick = s.myId === s.firstPickId;
  const iPicked = Boolean(me?.className);
  const otherPicked = Boolean(opp?.className);
  const myName = me?.name ?? "YOU";
  const oppName = opp?.name ?? "RIVAL";
  const winnerIsMe = iAmFirstPick;

  const phase = computePhase(app, iAmFirstPick, iPicked, otherPicked);
  const inCoin =
    phase === "intro" ||
    phase === "coin-spin" ||
    phase === "coin-resolve" ||
    phase === "coin-announced";

  const stage = ensureStage(root, ACTIVE_CLASS);

  if (inCoin) {
    // mount once — 이후엔 class/text 토글로만 phase 반영 (CSS 애니메이션 재시작 방지)
    if (mountedMode !== "coin") {
      resetClassPickState();
      mountedMode = "coin";
      stage.innerHTML = `
        <div class="sceneRoot classpick-phase-${phase}" id="cpRoot">
          ${sceneChromeHtml()}
          ${coinTossMountHtml(myName, oppName, winnerIsMe)}
        </div>
      `;
    }
    updateCoinPhase(stage, phase, winnerIsMe);
    updateRootPhase(stage, phase);
    return;
  }

  // pick mode 첫 진입 (또는 coin → pick 전환)
  if (mountedMode !== "pick") {
    stage.innerHTML = `
      <div class="sceneRoot classpick-phase-${phase}" id="cpRoot">
        ${sceneChromeHtml()}
        ${pickFrameHtml(app, phase)}
      </div>
    `;
    mountedMode = "pick";
    wireHandlers(stage, app, iAmFirstPick);
  }

  // 상태 변화만 반영
  updateRootPhase(stage, phase);
  updateCards(stage, app, phase, iAmFirstPick);
  updateTurnBanner(stage, phase, myName, oppName, iAmFirstPick);
  updateFoot(stage, phase, meIsPickerFor(phase, iAmFirstPick));

  // 타이머 관리 — picking 진입 시 시작, 다른 phase 로 바뀌면 정지
  const inPickingPhase =
    phase === "first-picking" || phase === "second-picking";
  const expectedPickerMe = meIsPickerFor(phase, iAmFirstPick);
  // 타이머는 "내가 고르는 중" 인 픽킹 phase 에서만 표시
  if (inPickingPhase && expectedPickerMe) {
    const wantedPhase: "first" | "second" =
      phase === "first-picking" ? "first" : "second";
    if (timerIntervalId === null || pickTimerPhase !== wantedPhase) {
      pickTimerPhase = wantedPhase;
      startCountdown(stage, app, iAmFirstPick);
    }
  } else if (timerIntervalId !== null) {
    stopCountdown(stage);
  }

  // first-picked 브릿지 타이머 예약
  if (phase === "first-picked" && bridgeTimerId === null) {
    bridgeTimerId = window.setTimeout(() => {
      bridgeTimerId = null;
      app.render();
    }, FIRST_PICKED_BRIDGE_MS);
  }
}

function wireHandlers(stage: HTMLElement, app: App, iAmFirstPick: boolean): void {
  stage.querySelectorAll<HTMLButtonElement>(".classCard[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id") as ClassName;
      const s = app.state;
      const me = s.players.find((p) => p.connectionId === s.myId);
      const opp = s.players.find((p) => p.connectionId !== s.myId);
      const iPicked = Boolean(me?.className);
      const otherPicked = Boolean(opp?.className);
      const phase = computePhase(app, iAmFirstPick, iPicked, otherPicked);
      const meIsPicker = meIsPickerFor(phase, iAmFirstPick);
      if (!meIsPicker) return;
      if (btn.classList.contains("cc-locked")) return;
      if (btn.disabled) return;
      app.state.client?.send({ type: "pick_class", className: id });
    });
  });
}

// =====================================================================
// Phase & Picker
// =====================================================================

function computePhase(
  app: App,
  iAmFirstPick: boolean,
  iPicked: boolean,
  otherPicked: boolean,
): Phase {
  const ct = app.state.coinTossAnimation;
  if (ct) {
    const elapsed = Date.now() - ct.startedAt;
    if (elapsed < 900) return "intro";
    if (elapsed < 2600) return "coin-spin";
    if (elapsed < 3900) return "coin-resolve";
    return "coin-announced";
  }
  const firstPicker = iAmFirstPick ? iPicked : otherPicked;
  const secondPicker = iAmFirstPick ? otherPicked : iPicked;
  if (!firstPicker) {
    firstPickedAt = null;
    return "first-picking";
  }
  if (!secondPicker) {
    // 1.4s 브릿지: 선픽 확정 직후엔 "first-picked" (연출용), 이후 "second-picking"
    if (firstPickedAt === null) firstPickedAt = Date.now();
    const elapsed = Date.now() - firstPickedAt;
    if (elapsed < FIRST_PICKED_BRIDGE_MS) return "first-picked";
    return "second-picking";
  }
  return "second-picked";
}

function meIsPickerFor(phase: Phase, iAmFirstPick: boolean): boolean {
  if (phase === "first-picking") return iAmFirstPick;
  if (phase === "second-picking") return !iAmFirstPick;
  return false;
}

// =====================================================================
// Coin Toss (mount-once + class toggle)
// =====================================================================

function coinTossMountHtml(
  myName: string,
  oppName: string,
  winnerIsMe: boolean,
): string {
  const mePlinth = winnerIsMe ? "coinPlinth winner" : "coinPlinth";
  const oppPlinth = winnerIsMe ? "coinPlinth" : "coinPlinth winner";
  // 주의: 초기 phase="intro" 이므로 coin 에 어떤 애니메이션 클래스도 없음. winner 클래스는
  // announced phase 에서만 노출되도록 나중에 직접 토글.
  return `
    <div class="coinTossStage">
      <div class="coinTossOverline">RITE OF THE COIN</div>

      <div class="coinArena">
        <div class="coinPlinth" id="cpPlinthMe" data-winner="${winnerIsMe ? "1" : "0"}" data-fixed-cls="${mePlinth}">
          <div class="coinPlinthSigil">⚘</div>
          <div class="coinPlinthName">${escapeHtml(myName)}</div>
          <div class="coinPlinthRole" id="cpPlinthRoleMe">⚘ 장미</div>
        </div>

        <div class="coinHolder">
          <div class="coin" id="cpCoin">
            <div class="coinFace">
              <div class="runeRing"></div>
              <div class="coinFaceInner"><div class="coinFaceGlyph">☠</div></div>
            </div>
            <div class="coinFace back">
              <div class="runeRing"></div>
              <div class="coinFaceInner"><div class="coinFaceGlyph">⚘</div></div>
            </div>
          </div>
          <div class="coinShadow"></div>
          <div class="coinRays" id="cpCoinRays" style="display:none"></div>
        </div>

        <div class="coinPlinth" id="cpPlinthOpp" data-winner="${winnerIsMe ? "0" : "1"}" data-fixed-cls="${oppPlinth}">
          <div class="coinPlinthSigil">☠</div>
          <div class="coinPlinthName">${escapeHtml(oppName)}</div>
          <div class="coinPlinthRole" id="cpPlinthRoleOpp">☠ 해골</div>
        </div>
      </div>

      <div class="coinResultLine" id="cpResultLine"></div>
    </div>
  `;
}

function updateCoinPhase(
  stage: HTMLElement,
  phase: "intro" | "coin-spin" | "coin-resolve" | "coin-announced" | Phase,
  winnerIsMe: boolean,
): void {
  if (coinPhaseApplied === phase) return;
  coinPhaseApplied = phase as typeof coinPhaseApplied;

  const coin = stage.querySelector<HTMLElement>("#cpCoin");
  const resultLine = stage.querySelector<HTMLElement>("#cpResultLine");
  const rays = stage.querySelector<HTMLElement>("#cpCoinRays");
  const plinthMe = stage.querySelector<HTMLElement>("#cpPlinthMe");
  const plinthOpp = stage.querySelector<HTMLElement>("#cpPlinthOpp");
  const roleMe = stage.querySelector<HTMLElement>("#cpPlinthRoleMe");
  const roleOpp = stage.querySelector<HTMLElement>("#cpPlinthRoleOpp");

  if (!coin) return;

  if (phase === "intro") {
    coin.className = "coin";
    if (resultLine) resultLine.textContent = "";
    if (rays) rays.style.display = "none";
  } else if (phase === "coin-spin") {
    coin.className = "coin spinning";
    if (resultLine) resultLine.textContent = "";
    if (rays) rays.style.display = "none";
  } else if (phase === "coin-resolve" || phase === "coin-announced") {
    // resolving → rose (me win) / 기본(skull=opp win)
    const cls = ["coin", "resolving"];
    if (winnerIsMe) cls.push("rose");
    coin.className = cls.join(" ");

    if (phase === "coin-announced") {
      // winner plinth 금빛 강조
      if (plinthMe && plinthMe.getAttribute("data-winner") === "1")
        plinthMe.classList.add("winner");
      if (plinthOpp && plinthOpp.getAttribute("data-winner") === "1")
        plinthOpp.classList.add("winner");

      // Role 텍스트 변경
      if (roleMe) roleMe.textContent = winnerIsMe ? "◆ 선픽 ◆" : "후픽";
      if (roleOpp) roleOpp.textContent = winnerIsMe ? "후픽" : "◆ 선픽 ◆";

      // 결과 라인 — announce 클래스로 플래시
      if (resultLine) {
        resultLine.textContent = winnerIsMe ? "선픽" : "후픽";
        resultLine.className = "coinResultLine announce";
      }

      // rays 표출
      if (rays) rays.style.display = "";
    } else {
      // coin-resolve 단계엔 아직 결과 노출 안 함
      if (resultLine) resultLine.textContent = "";
      if (rays) rays.style.display = "none";
    }
  }
}

// =====================================================================
// Pick frame HTML
// =====================================================================

function pickFrameHtml(app: App, phase: Phase): string {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  const iAmFirstPick = s.myId === s.firstPickId;
  const myName = me?.name ?? "YOU";
  const oppName = opp?.name ?? "RIVAL";
  const firstPicker = iAmFirstPick ? myName : oppName;
  const secondPicker = iAmFirstPick ? oppName : myName;

  const isFirstPhase = phase === "first-picking" || phase === "first-picked";
  const isSecondPhase = phase === "second-picking" || phase === "second-picked";
  const meIsPicker = meIsPickerFor(phase, iAmFirstPick);

  return `
    <div class="sceneFrame">
      <div class="scenePreamble">
        <div class="scenePreambleGlyphs"><span>✦</span><span>❦</span><span>✦</span></div>
        <div class="sceneOverline">RITE OF THE CLASS</div>
        <h1 class="sceneTitle">직업 선택</h1>
        <div class="sceneSubtitle" id="cpSubtitle"> </div>
      </div>

      <div style="display:flex; flex-direction:column; align-items:center">
        <div class="classTurnBanner">
          <div class="classTurnPlayers" id="cpTurnPlayers">
            <span class="${isFirstPhase ? "active" : ""}">${escapeHtml(firstPicker)}</span>
            <span class="chev">▸</span>
            <span class="${isSecondPhase ? "active" : ""}">${escapeHtml(secondPicker)}</span>
          </div>
          <div class="classTurnPhaseLabel" id="cpTurnLabel">${turnLabelFor(phase, meIsPicker)}</div>
        </div>

        <div class="classCardRow" id="cpCardRow">
          ${CLASS_IDS.map((id, i) => classCardMarkup(id, i)).join("")}
        </div>
      </div>

      <div class="sceneFootBar">
        <div class="sceneFootSide sceneFootLeft" id="cpFootLeft"></div>
        <div class="sceneFootCenter" id="cpFootCenter">${footStatusPillHtml(phase, meIsPicker)}</div>
        <div class="sceneFootSide sceneFootRight"></div>
      </div>
    </div>
  `;
}

function classCardMarkup(id: ClassName, index: number): string {
  const c = CLASS_DEFS[id];
  const style = `--cls-accent:${c.accent}; --cls-hue:${c.hue}; --delay:${0.2 + index * 0.18}s`;
  const slotCls = ["classSlot"];
  if (index === 1) slotCls.push("elevated");
  return `
    <div class="${slotCls.join(" ")}">
      <button class="classCard" data-id="${id}" style="${style}">
        <span class="cornerGlyph tl">${c.cornerGlyph}</span>
        <span class="cornerGlyph tr">${c.cornerGlyph}</span>
        <span class="cornerGlyph bl">${c.cornerGlyph}</span>
        <span class="cornerGlyph br">${c.cornerGlyph}</span>

        <div class="ccEmblem" style="margin-top:24px">
          <div class="ccEmblemHalo"></div>
          <div class="ccEmblemRing"></div>
          <div class="ccEmblemCore">${c.glyph}</div>
        </div>

        <div class="ccName">${escapeHtml(c.nameKo)}</div>
        <div class="ccNameEn">${escapeHtml(c.nameEn)}</div>
        <div class="ccDivider"></div>

        <div class="ccPassive">
          <div class="ccPassiveLabel">◆ PASSIVE ◆</div>
          <div class="ccPassiveName">${escapeHtml(c.passiveName)}</div>
          <div class="ccPassiveDesc">${escapeHtml(c.passiveDesc)}</div>
        </div>

        <div class="ccLockBadge" data-role="lock" style="display:none">
          <div class="ccLockIcon">🔒</div>
          <div class="ccLockText">SEALED</div>
          <div class="ccLockSub" data-role="lock-sub"></div>
        </div>

        <div class="ccSealOverlay" data-role="seal" style="display:none">
          <div class="ccSeal">
            <div class="ccSealGlyph">${c.cornerGlyph}</div>
            <div class="ccSealText">CHOSEN</div>
          </div>
        </div>
      </button>
    </div>
  `;
}

function updateCards(
  stage: HTMLElement,
  app: App,
  phase: Phase,
  iAmFirstPick: boolean,
): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  const firstPick: ClassName | null = iAmFirstPick
    ? (me?.className ?? null)
    : (opp?.className ?? null);
  const secondPick: ClassName | null = iAmFirstPick
    ? (opp?.className ?? null)
    : (me?.className ?? null);
  const firstPickerName = iAmFirstPick
    ? (me?.name ?? "YOU")
    : (opp?.name ?? "RIVAL");
  const meIsPicker = meIsPickerFor(phase, iAmFirstPick);
  const isFirstPhase = phase === "first-picking" || phase === "first-picked";
  const isSecondPhase = phase === "second-picking" || phase === "second-picked";

  stage.querySelectorAll<HTMLButtonElement>(".classCard").forEach((btn) => {
    const id = btn.getAttribute("data-id") as ClassName;
    // 디자인의 selected 정의: 이번 phase 의 활성 pick. 1:1 재현.
    const selected =
      (isFirstPhase && firstPick === id) ||
      (isSecondPhase && secondPick === id);
    const dimmed =
      (isFirstPhase && firstPick && firstPick !== id) ||
      (isSecondPhase && secondPick && secondPick !== id);
    const locked = isSecondPhase && id === firstPick;

    btn.classList.toggle("cc-selected", Boolean(selected));
    btn.classList.toggle("cc-dimmed", Boolean(dimmed) && !selected);
    btn.classList.toggle("cc-locked", locked);
    btn.disabled = Boolean(locked || selected || !meIsPicker);

    const lockEl = btn.querySelector<HTMLElement>('[data-role="lock"]');
    const sealEl = btn.querySelector<HTMLElement>('[data-role="seal"]');
    if (lockEl) lockEl.style.display = locked ? "" : "none";
    if (sealEl) sealEl.style.display = selected ? "" : "none";
    const lockSub = btn.querySelector<HTMLElement>('[data-role="lock-sub"]');
    if (lockSub && locked) lockSub.textContent = `${firstPickerName}의 선택`;
  });
}

function updateRootPhase(stage: HTMLElement, phase: Phase): void {
  const root = stage.querySelector<HTMLElement>("#cpRoot");
  if (!root) return;
  const next: string[] = [];
  root.classList.forEach((c) => {
    if (!c.startsWith("classpick-phase-")) next.push(c);
  });
  root.className = next.join(" ") + ` classpick-phase-${phase}`;
}

function updateTurnBanner(
  stage: HTMLElement,
  phase: Phase,
  myName: string,
  oppName: string,
  iAmFirstPick: boolean,
): void {
  const players = stage.querySelector<HTMLElement>("#cpTurnPlayers");
  const label = stage.querySelector<HTMLElement>("#cpTurnLabel");
  const isFirstPhase = phase === "first-picking" || phase === "first-picked";
  const isSecondPhase = phase === "second-picking" || phase === "second-picked";
  const firstPicker = iAmFirstPick ? myName : oppName;
  const secondPicker = iAmFirstPick ? oppName : myName;
  const meIsPicker = meIsPickerFor(phase, iAmFirstPick);

  if (players) {
    players.innerHTML = `
      <span class="${isFirstPhase ? "active" : ""}">${escapeHtml(firstPicker)}</span>
      <span class="chev">▸</span>
      <span class="${isSecondPhase ? "active" : ""}">${escapeHtml(secondPicker)}</span>
    `;
  }
  if (label) label.textContent = turnLabelFor(phase, meIsPicker);
}

function turnLabelFor(phase: Phase, meIsPicker: boolean): string {
  if (phase === "first-picking")
    return meIsPicker ? "" : "상대가 직업을 선택하고 있습니다";
  if (phase === "second-picking")
    return meIsPicker ? "그대의 선택" : "상대가 직업을 선택하고 있습니다";
  if (phase === "first-picked") return "선픽 확정 · 후픽 차례";
  return "";
}

function updateFoot(
  stage: HTMLElement,
  phase: Phase,
  meIsPicker: boolean,
): void {
  const center = stage.querySelector<HTMLElement>("#cpFootCenter");
  if (center) center.innerHTML = footStatusPillHtml(phase, meIsPicker);
}

function footStatusPillHtml(phase: Phase, meIsPicker: boolean): string {
  if (phase === "first-picked") {
    return `
      <div class="sceneStatusPill ready">
        <span class="sceneCheck">◆</span>
        <span>선픽 확정. 후픽을 기다린다.</span>
      </div>
    `;
  }
  if (phase === "second-picked") {
    return `
      <div class="sceneStatusPill ready">
        <span class="sceneCheck">◆</span>
        <span>양 진영 결전 준비.</span>
      </div>
    `;
  }
  if ((phase === "first-picking" || phase === "second-picking") && !meIsPicker) {
    return `
      <div class="sceneStatusPill">
        <span class="sceneSpinner"></span>
        <span>상대가 직업을 선택하고 있습니다</span>
      </div>
    `;
  }
  return "";
}

// =====================================================================
// Timer tick
// =====================================================================

function startCountdown(
  stage: HTMLElement,
  app: App,
  iAmFirstPick: boolean,
): void {
  if (timerIntervalId !== null) clearInterval(timerIntervalId);
  const left = stage.querySelector<HTMLElement>("#cpFootLeft");
  if (!left) return;
  timerStartedAt = Date.now();

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
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="sceneMoonTick"></line>`,
    );
  }

  left.innerHTML = `
    <div class="sceneMoon" id="cpMoon">
      <svg viewBox="0 0 72 72" class="sceneMoonSvg">
        <circle cx="36" cy="36" r="${R}" class="sceneMoonTrack"></circle>
        <circle cx="36" cy="36" r="${R}" class="sceneMoonFill"
          stroke-dasharray="${C}" stroke-dashoffset="0"
          transform="rotate(-90 36 36)"></circle>
        ${ticks.join("")}
      </svg>
      <div class="sceneMoonNum" id="cpMoonNum">${PICK_TIMER_SECONDS}</div>
      <div class="sceneMoonLabel">SEC</div>
    </div>
  `;

  const moonEl = left.querySelector<HTMLElement>("#cpMoon");
  const numEl = left.querySelector<HTMLElement>("#cpMoonNum");
  const fillEl = left.querySelector<SVGCircleElement>(".sceneMoonFill");

  const tick = () => {
    if (!timerStartedAt) return;
    const elapsed = (Date.now() - timerStartedAt) / 1000;
    const remaining = Math.max(0, PICK_TIMER_SECONDS - Math.floor(elapsed));
    if (numEl) numEl.textContent = String(remaining);
    if (fillEl) {
      const offset = C * (1 - remaining / PICK_TIMER_SECONDS);
      fillEl.setAttribute("stroke-dashoffset", String(offset));
    }
    if (moonEl) moonEl.classList.toggle("urgent", remaining <= 5);
    if (remaining <= 0 && timerIntervalId !== null) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      autoPickClass(app, iAmFirstPick);
    }
  };
  tick();
  timerIntervalId = window.setInterval(tick, 250);
}

/** 타이머 만료 시 가용한 클래스 중 하나를 랜덤 자동 선택. */
function autoPickClass(app: App, iAmFirstPick: boolean): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  // 이미 내가 픽 완료면 skip
  if (me?.className) return;
  // 내 차례가 아니면 skip (방어)
  const iPicked = Boolean(me?.className);
  const otherPicked = Boolean(opp?.className);
  const phase = computePhase(app, iAmFirstPick, iPicked, otherPicked);
  if (!meIsPickerFor(phase, iAmFirstPick)) return;

  // 후픽이면 선픽 클래스 제외
  const disabled = new Set<ClassName>();
  if (!iAmFirstPick && opp?.className) disabled.add(opp.className);
  s.disabledClasses.forEach((c) => disabled.add(c));
  const available = CLASS_IDS.filter((id) => !disabled.has(id));
  if (available.length === 0) return;
  const pick = available[Math.floor(Math.random() * available.length)]!;
  app.state.client?.send({ type: "pick_class", className: pick });
}

function stopCountdown(stage: HTMLElement): void {
  if (timerIntervalId !== null) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  timerStartedAt = null;
  pickTimerPhase = null;
  const left = stage.querySelector<HTMLElement>("#cpFootLeft");
  if (left) left.innerHTML = "";
}

// =====================================================================
// Helpers
// =====================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
