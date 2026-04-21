/**
 * 픽 화면: 직업 선택 + 부운 선택.
 * 서버 phase 가 pick_class / pick_boon 일 때 이 뷰로 전환.
 */

import { App } from "../app";
import { ClassName, getBoonById } from "../engine";

interface ClassInfo {
  id: ClassName;
  name: string;
  emoji: string;
  /** 카드 기본 화면에 1줄로 노출. 짧고 플레이버 중심. */
  tagline: string;
  /** hover 툴팁에 노출. 직업의 패시브/정체성 상세 설명. */
  passive: string;
  color: string;
}

// ============================================================================
//  ★ 이 CLASSES 배열이 직업 설명의 단일 진실. 수정은 여기서만 하세요. ★
//     - tagline : 카드에 기본으로 보이는 한 줄 설명
//     - passive : 카드에 마우스 hover 시 툴팁으로 나타나는 상세 설명
// ============================================================================
const CLASSES: ClassInfo[] = [
  {
    id: "berserker",
    name: "광전사",
    emoji: "🔥",
    tagline: "내 피는 무기다",
    passive: "HP 베팅 1당 명중률 추가 +2%. 화력 + 베팅 극대화.",
    color: "var(--berserker)",
  },
  {
    id: "gambler",
    name: "도박사",
    emoji: "🎲",
    tagline: "이번 판도 운이 좋네",
    passive: "행운아이템 리롤 1회. 제시된 3개가 맘에 안 들면 통째로 재추첨.",
    color: "var(--gambler)",
  },
  {
    id: "warden",
    name: "컨트롤러",
    emoji: "🛡️",
    tagline: "살아남는 자가 승자다",
    passive: "상대 턴 시작마다 상대 손패 1장을 이번 턴 사용 불가(봉인). 확정타 + 회복 + 운영.",
    color: "var(--warden)",
  },
];

export function renderPick(root: HTMLElement, app: App): void {
  const s = app.state;
  if (s.phase === "pick_class") {
    renderPickClass(root, app);
    return;
  }
  if (s.phase === "pick_boon") {
    renderPickBoon(root, app);
    return;
  }
}

// =====================================================================
// 직업 선택
// =====================================================================

function renderPickClass(root: HTMLElement, app: App) {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const iAmFirstPick = s.myId === s.firstPickId;
  const iPicked = Boolean(me?.className);
  const otherPicked = s.players
    .filter((p) => p.connectionId !== s.myId)
    .some((p) => p.className);

  const myTurn =
    !iPicked &&
    ((iAmFirstPick && !otherPicked) || (!iAmFirstPick && otherPicked));

  const statusLabel = iPicked
    ? "선택 완료. 상대를 기다리는 중…"
    : myTurn
      ? iAmFirstPick
        ? "당신은 선픽입니다. 직업을 선택하세요."
        : "당신은 후픽입니다. 직업을 선택하세요 (상대와 다른 직업)."
      : iAmFirstPick
        ? "선택되었습니다. 상대가 직업을 선택 중…"
        : "선픽이 직업을 선택 중입니다…";

  root.innerHTML = `
    <div class="card" style="max-width:800px">
      <h1>직업 선택 <small>turn ${s.turn === 0 ? "—" : s.turn}</small></h1>
      <p class="muted">${escapeHtml(statusLabel)}</p>

      <div class="class-grid">
        ${CLASSES.map((c) => renderClassCard(c, app, myTurn)).join("")}
      </div>

      ${renderPlayersStatus(app)}
      ${s.error ? `<div class="error">${escapeHtml(s.error)}</div>` : ""}
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".class-card[data-enabled='true']").forEach((el) => {
    el.addEventListener("click", () => {
      const className = el.getAttribute("data-class") as ClassName;
      app.state.client!.send({ type: "pick_class", className });
    });
  });

  ensureCssInjected();
}

function renderClassCard(c: ClassInfo, app: App, myTurn: boolean): string {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const disabled =
    s.disabledClasses.includes(c.id) ||
    !myTurn ||
    Boolean(me?.className);
  const picked = me?.className === c.id;
  const oppPicked = s.players.find(
    (p) => p.connectionId !== s.myId && p.className === c.id,
  );

  return `
    <button class="class-card"
            data-class="${c.id}"
            data-enabled="${!disabled}"
            ${disabled ? "disabled" : ""}
            style="border-color:${picked ? c.color : "var(--border)"}">
      <div class="class-emoji" style="color:${c.color}">${c.emoji}</div>
      <div class="class-name">${escapeHtml(c.name)}</div>
      <div class="class-tag muted">"${escapeHtml(c.tagline)}"</div>
      ${picked ? `<div class="class-stamp">✓ 선택됨</div>` : ""}
      ${oppPicked ? `<div class="class-stamp" style="color:var(--muted)">상대 직업</div>` : ""}
      <div class="class-tooltip">${escapeHtml(c.passive)}</div>
    </button>
  `;
}

// =====================================================================
// 부운 선택
// =====================================================================

function renderPickBoon(root: HTMLElement, app: App) {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const iPicked = Boolean(me?.boonId);
  const canReroll = !iPicked && (me?.boonRerollsLeft ?? 0) > 0;

  const opts = s.boonOptions.map((id) => getBoonById(id));
  const statusLabel = iPicked
    ? "행운아이템 선택 완료. 상대를 기다리는 중…"
    : `행운아이템을 선택하세요 (${opts.length}개 중 1개).`;

  root.innerHTML = `
    <div class="card" style="max-width:860px">
      <h1>행운아이템 선택 <small>매 판 다른 빌드</small></h1>
      <p class="muted">${escapeHtml(statusLabel)}</p>

      <div class="boon-grid">
        ${opts.map((b) => renderBoonCard(b, app)).join("")}
      </div>

      ${
        canReroll
          ? `
        <div class="row reroll-row">
          <button id="reroll-boon" class="reroll-btn"
                  title="제시된 3개 행운아이템을 전부 버리고 3개 다시 뽑습니다. 결과가 더 나빠질 수도 있음.">
            🔄 행운아이템 다시 뽑기 (${me?.boonRerollsLeft}회 남음, 도박사 패시브)
          </button>
        </div>
      `
          : me?.className === "gambler" && !iPicked
            ? `<div class="muted" style="margin-top:12px;text-align:center">리롤 사용 완료 — 이 중에서 골라야 합니다.</div>`
            : ""
      }

      ${renderPlayersStatus(app)}
      ${s.error ? `<div class="error">${escapeHtml(s.error)}</div>` : ""}
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".boon-card[data-enabled='true']").forEach((el) => {
    el.addEventListener("click", () => {
      const boonId = el.getAttribute("data-boon")!;
      app.state.client!.send({ type: "pick_boon", boonId });
    });
  });

  root.querySelector<HTMLButtonElement>("#reroll-boon")?.addEventListener(
    "click",
    () => {
      app.state.client!.send({ type: "reroll_boon" });
    },
  );

  ensureCssInjected();
}

function renderBoonCard(
  b: ReturnType<typeof getBoonById>,
  app: App,
): string {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const picked = me?.boonId === b.id;
  const disabled = Boolean(me?.boonId);

  return `
    <button class="boon-card"
            data-boon="${b.id}"
            data-enabled="${!disabled}"
            ${disabled ? "disabled" : ""}
            style="border-color:${picked ? "var(--accent)" : "var(--border)"}">
      <div class="boon-emoji">${b.emoji}</div>
      <div class="boon-name">${escapeHtml(b.name)}</div>
      <div class="boon-cat muted">${escapeHtml(b.category)}</div>
      <div class="boon-desc">${escapeHtml(b.desc)}</div>
      ${picked ? `<div class="class-stamp">✓ 선택됨</div>` : ""}
    </button>
  `;
}

// =====================================================================
// 공통
// =====================================================================

function renderPlayersStatus(app: App): string {
  const s = app.state;
  return `
    <div class="divider"></div>
    <div class="muted">플레이어</div>
    ${s.players
      .map((p) => {
        const you = p.connectionId === s.myId ? " (나)" : "";
        const first = p.connectionId === s.firstPickId ? " ⭐ 선픽" : "";
        const cls = p.className ? ` · ${classLabel(p.className)}` : "";
        const boon = p.boonId ? ` · 행운아이템 ✓` : "";
        return `<div class="slot"><span>${escapeHtml(p.name)}${you}${first}${cls}${boon}</span></div>`;
      })
      .join("")}
  `;
}

function classLabel(cn: ClassName): string {
  switch (cn) {
    case "berserker":
      return "🔥 광전사";
    case "gambler":
      return "🎲 도박사";
    case "warden":
      return "🛡️ 컨트롤러";
  }
}

let cssInjected = false;
function ensureCssInjected() {
  if (cssInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    .class-grid, .boon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .boon-grid {
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .class-card, .boon-card {
      background: var(--bg);
      border: 2px solid var(--border);
      padding: 20px 16px;
      border-radius: 10px;
      text-align: center;
      cursor: pointer;
      transition: transform 0.1s, border 0.15s;
      position: relative;
    }
    .class-tooltip {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translate(-50%, 6px);
      width: max-content;
      max-width: 280px;
      background: rgba(15, 18, 24, 0.97);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      text-align: left;
      white-space: normal;
      box-shadow: 0 8px 22px rgba(0,0,0,0.55);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
      pointer-events: none;
      z-index: 50;
    }
    .class-tooltip::after {
      content: "";
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 8px; height: 8px;
      background: rgba(15, 18, 24, 0.97);
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .class-card:hover .class-tooltip,
    .class-card:focus-within .class-tooltip {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
    }
    .class-card[data-enabled='true']:hover,
    .boon-card[data-enabled='true']:hover {
      transform: translateY(-2px);
      border-color: var(--accent) !important;
    }
    .class-emoji { font-size: 48px; margin-bottom: 8px; }
    .class-name { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
    .class-tag { font-size: 13px; margin-bottom: 10px; font-style: italic; }
    .class-passive { font-size: 13px; color: var(--fg); opacity: 0.85; line-height: 1.4; }
    .boon-emoji { font-size: 36px; margin-bottom: 6px; }
    .boon-name { font-size: 17px; font-weight: 600; margin-bottom: 2px; }
    .boon-cat { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
    .boon-desc { font-size: 13px; line-height: 1.4; }
    .class-stamp {
      margin-top: 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--accent);
    }
    .reroll-row { margin-top: 16px; }
    .reroll-btn {
      background: transparent;
      border: 1.5px dashed var(--gambler);
      color: var(--gambler);
      font-weight: 600;
    }
    .reroll-btn:hover {
      background: rgba(214, 168, 62, 0.08);
      border-style: solid;
      border-color: var(--gambler) !important;
    }
  `;
  document.head.appendChild(style);
  cssInjected = true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
