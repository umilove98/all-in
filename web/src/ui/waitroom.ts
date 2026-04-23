/**
 * Waiting Room Scene — 방 대기.
 * design handoff (Waiting Room.html / WaitingRoomScene.jsx) 1:1 포팅.
 *
 * phase 머신은 프로토타입의 "waiting-alone → waiting-pair → countdown → launching"
 * 을 그대로 따르되, 서버에 시작 버튼/카운트다운이 없으므로:
 *   - 1명   → waiting-alone
 *   - 2명   → waiting-pair (서버가 곧 coin_toss → pick_class 로 자동 전환)
 * countdown/launching 은 이 앱 흐름에선 사실상 관측되지 않지만, DOM 은 같이 포팅.
 *
 * 접속 전(닉네임 미입력) 상태는 프로토타입에 없는 상태라, 같은 프레임 안에서
 * 간결한 입력 카드를 띄워 톤을 맞춘다.
 */

import { App } from "../app";
import { renderBoard } from "./board";
import { renderPick } from "./pick";
import { renderBoonDraft, isBoonTransitioning } from "./scenes/boonDraft";
import { ensureStage, sceneChromeHtml, teardownStage } from "./sceneStage";

const ACTIVE_CLASS = "wr-active";

export function renderWaitroom(root: HTMLElement, app: App): void {
  const s = app.state;

  if (!s.client || !s.myId) {
    renderJoinForm(root, app);
    return;
  }

  if (s.phase === "lobby") {
    renderWaitingRoomScene(root, app);
    return;
  }

  teardownStage(root, ACTIVE_CLASS);

  // Boon Draft 의 exit 트랜지션이 재생 중이면 서버가 phase=battle 로 넘어갔더라도
  // 화면을 유지 — 디자인의 consecrate/imprint/blackout 시퀀스를 보여준 뒤 배틀로.
  if (isBoonTransitioning()) {
    renderBoonDraft(root, app);
    return;
  }

  if (s.phase === "pick_class" || s.phase === "pick_boon") {
    renderPick(root, app);
    return;
  }

  if (s.phase === "battle" || s.phase === "ended") {
    renderBoard(root, app);
    return;
  }
}

// =====================================================================
// 닉네임 입력 (프로토타입에 없는 상태 — 톤 맞춘 패널)
// =====================================================================

function renderJoinForm(root: HTMLElement, app: App) {
  const stage = ensureStage(root, ACTIVE_CLASS);
  stage.innerHTML = `
    <div class="sceneRoot">
      ${sceneChromeHtml()}
      <div class="wrFrame">
        <div class="wrRoomPlaque">
          <div class="wrRoomLabel">Room Code</div>
          <div class="wrRoomCodeBox">
            <div class="wrRoomCode">${escapeHtml(app.state.roomId ?? "??????")}</div>
          </div>
          <div class="wrPreamble">
            <h1 class="wrTitle">대기실</h1>
          </div>
        </div>

        <div class="wrJoinBox">
          <label class="wrJoinLabel" for="wrNameInput">HOST</label>
          <input id="wrNameInput" class="wrJoinInput" type="text"
            maxlength="16" placeholder="나의 이름" autocomplete="off" spellcheck="false" />
        </div>

        <div class="wrBottomBar">
          <button id="wrJoinConfirm" class="sceneBtn primary wrStartButton">참가</button>
          <div class="wrHint">2명이 입장하면 전투를 시작할 수 있습니다</div>
          ${app.state.error ? `<div class="wrHint" style="color:#ffb9b9">${escapeHtml(app.state.error)}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  const input = stage.querySelector<HTMLInputElement>("#wrNameInput")!;
  input.focus();
  const submit = async () => {
    const name = (input.value || "").trim() || "Player";
    await app.joinRoom(app.state.roomId!, name);
  };
  stage.querySelector<HTMLButtonElement>("#wrJoinConfirm")!.addEventListener("click", () => {
    void submit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
}

// =====================================================================
// Waiting Room 본편 — 프로토타입 JSX 1:1
// =====================================================================

function renderWaitingRoomScene(root: HTMLElement, app: App) {
  const s = app.state;
  const roomCode = s.roomId ?? "??????";
  const me = s.players.find((p) => p.connectionId === s.myId);
  const other = s.players.find((p) => p.connectionId !== s.myId);
  const hostName = me?.name ?? "YOU";
  const guestName = other?.name ?? "— EMPTY —";

  // phase — 서버 상태 기반
  const guestFilled = s.players.length >= 2;
  const phase: "waiting-alone" | "waiting-pair" = guestFilled
    ? "waiting-pair"
    : "waiting-alone";

  const stage = ensureStage(root, ACTIVE_CLASS);
  stage.innerHTML = `
    <div class="sceneRoot wr-phase-${phase}">
      ${sceneChromeHtml()}

      <div class="wrFrame">
        <div class="wrRoomPlaque">
          <div class="wrRoomLabel">Room Code</div>
          <div class="wrRoomCodeBox">
            <div class="wrRoomCode">${escapeHtml(roomCode)}</div>
            <button id="wrCopyBtn" class="wrRoomCopyBtn">
              <span>⎘</span>
              <span>COPY</span>
            </button>
          </div>
          <div class="wrPreamble">
            <h1 class="wrTitle">대기실</h1>
            <div class="wrSubtitle">${escapeHtml(subtitleFor(phase))}</div>
          </div>
        </div>

        <div class="wrPair">
          ${playerSlotHtml({ filled: true, host: true, right: false, name: hostName, status: "\n" })}
          <div class="wrVsPillar">
            <div class="wrVsLineTop"></div>
            <div class="wrVsMark">VS</div>
            <div class="wrVsLineBottom"></div>
          </div>
          ${playerSlotHtml({
            filled: guestFilled,
            host: false,
            right: true,
            name: guestFilled ? guestName : "— EMPTY —",
            status: guestFilled ? "\n" : "WAITING",
          })}
        </div>

        <div class="wrBottomBar">
          ${bottomBarHtml(phase)}
        </div>
      </div>
    </div>
  `;

  const copyBtn = stage.querySelector<HTMLButtonElement>("#wrCopyBtn");
  copyBtn?.addEventListener("click", () => {
    const ok = copyToClipboard(roomCode);
    copyBtn.classList.add("copied");
    const spans = copyBtn.querySelectorAll("span");
    if (spans.length >= 2) {
      spans[0]!.textContent = ok ? "◆" : "✕";
      spans[1]!.textContent = ok ? "COPIED" : "FAIL";
    }
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      if (spans.length >= 2) {
        spans[0]!.textContent = "⎘";
        spans[1]!.textContent = "COPY";
      }
    }, 1500);
  });
}

/**
 * 클립보드 복사 — HTTPS/localhost 에선 navigator.clipboard, 그 외(LAN IP http)
 * 에선 execCommand('copy') 폴백. 두 경로 모두 실패 시 false 반환.
 */
function copyToClipboard(text: string): boolean {
  // Secure context (https / localhost) 에선 API 사용
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).catch(() => {
      /* ignore — 이미 fire-and-forget, 실패해도 UI 는 COPIED 표시 */
    });
    return true;
  }
  // 폴백: hidden textarea + execCommand('copy')
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function subtitleFor(phase: "waiting-alone" | "waiting-pair"): string {
  if (phase === "waiting-alone") return "상대를 기다린다…";
  if (phase === "waiting-pair") return "결투자가 모였다";
  return "";
}

function bottomBarHtml(phase: "waiting-alone" | "waiting-pair"): string {
  if (phase === "waiting-alone") {
    return `
      <button class="sceneBtn wrStartButton" disabled>START</button>
      <div class="wrHint">상대가 입장해야 시작할 수 있다</div>
    `;
  }
  // waiting-pair — 서버가 자동으로 coin_toss 로 넘어가므로 START 는
  // 시각적으로 활성화만 하고 실제론 클릭해도 아무 일 없음 (서버가 주도).
  return `
    <button class="sceneBtn primary wrStartButton">START</button>
    <div class="wrHint">곧 결투가 개시된다</div>
  `;
}

interface SlotOpts {
  filled: boolean;
  host: boolean;
  right: boolean;
  name: string;
  status: string;
}

function playerSlotHtml({ filled, host, right, name, status }: SlotOpts): string {
  const cls = ["wrSlot"];
  if (filled) cls.push("filled");
  if (host) cls.push("host");
  if (right) cls.push("right");
  return `
    <div class="${cls.join(" ")}">
      <span class="wrSlotCornerGlyph tl">✦</span>
      <span class="wrSlotCornerGlyph tr">✦</span>
      <span class="wrSlotCornerGlyph bl">✦</span>
      <span class="wrSlotCornerGlyph br">✦</span>

      <div class="wrAvatarRing">
        <div class="wrAvatarGlyph">${filled ? "❦" : "○"}</div>
      </div>
      <div class="wrSlotName${filled ? "" : " empty"}">${escapeHtml(name)}</div>
      <div class="wrSlotStatus">
        <span class="wrSlotStatusDot"></span>
        <span>${escapeHtml(status)}</span>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
