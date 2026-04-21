/**
 * 대기실 화면: 방 코드 공유, 2명 대기, 자동 매치 시작.
 * phase 가 바뀌면 상위 App.render() 가 다른 화면(pick/board)으로 전환.
 * 현재는 lobby(서버 phase) 단계만 처리. 이후 단계는 Placeholder.
 */

import { App } from "../app";
import { renderBoard } from "./board";
import { renderPick } from "./pick";

export function renderWaitroom(root: HTMLElement, app: App): void {
  const s = app.state;

  // 아직 연결 안 됐으면 닉네임 입력 후 join
  if (!s.client || !s.myId) {
    renderJoinForm(root, app);
    return;
  }

  if (s.phase === "lobby") {
    renderLobbyWaitingPlayers(root, app);
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

  renderPlaceholder(root, app);
}

function renderJoinForm(root: HTMLElement, app: App) {
  root.innerHTML = `
    <div class="card">
      <h1>ALL-IN <small>Bloodbet</small></h1>
      <p class="muted">방 <strong class="accent">${escapeHtml(app.state.roomId ?? "")}</strong> 에 참가합니다.</p>
      <div class="divider"></div>
      <label class="muted" for="name">닉네임</label>
      <input id="name" type="text" maxlength="16" placeholder="나의 이름" />
      <div class="row" style="margin-top:16px">
        <button id="confirm">참가</button>
        <button id="back">홈으로</button>
      </div>
      ${app.state.error ? `<div class="error">${escapeHtml(app.state.error)}</div>` : ""}
    </div>
  `;
  root.querySelector("#confirm")!.addEventListener("click", async () => {
    const name =
      (root.querySelector<HTMLInputElement>("#name")!.value || "").trim() ||
      "Player";
    await app.joinRoom(app.state.roomId!, name);
  });
  root.querySelector("#back")!.addEventListener("click", () => {
    app.navigateHome();
  });
}

function renderLobbyWaitingPlayers(root: HTMLElement, app: App) {
  const s = app.state;
  const shareUrl = `${location.origin}${location.pathname}?room=${s.roomId}`;

  root.innerHTML = `
    <div class="card">
      <h1>대기실</h1>
      <p class="muted">아래 코드를 친구에게 공유하세요. 두 명 모이면 자동으로 매치가 시작됩니다.</p>

      <div class="room-code">${escapeHtml(s.roomId ?? "??????")}</div>
      <div class="row">
        <button id="copy-code">코드 복사</button>
        <button id="copy-url">URL 복사</button>
      </div>

      <div class="divider"></div>
      <div class="muted">플레이어 (${s.players.length} / 2)</div>
      ${renderSlots(s.players, s.myId)}

      <div class="divider"></div>
      <div class="row">
        <button id="leave">방 나가기</button>
      </div>
      ${s.error ? `<div class="error">${escapeHtml(s.error)}</div>` : ""}
    </div>
  `;

  const copyCodeBtn = root.querySelector<HTMLButtonElement>("#copy-code")!;
  copyCodeBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(s.roomId ?? "");
    copyCodeBtn.textContent = "복사됨 ✓";
    setTimeout(() => (copyCodeBtn.textContent = "코드 복사"), 1500);
  });
  const copyUrlBtn = root.querySelector<HTMLButtonElement>("#copy-url")!;
  copyUrlBtn.addEventListener("click", () => {
    void navigator.clipboard.writeText(shareUrl);
    copyUrlBtn.textContent = "복사됨 ✓";
    setTimeout(() => (copyUrlBtn.textContent = "URL 복사"), 1500);
  });
  root.querySelector("#leave")!.addEventListener("click", () => {
    app.navigateHome();
  });
}

function renderSlots(players: { connectionId: string; name: string }[], myId: string | null) {
  const slots: string[] = [];
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (p) {
      const you = p.connectionId === myId ? " (나)" : "";
      slots.push(
        `<div class="slot"><span>${escapeHtml(p.name)}${you}</span><span class="muted">준비</span></div>`,
      );
    } else {
      slots.push(
        `<div class="slot empty"><span>비어있음</span><span class="muted">대기중…</span></div>`,
      );
    }
  }
  return slots.join("");
}

function renderPlaceholder(root: HTMLElement, app: App) {
  root.innerHTML = `
    <div class="card">
      <h1>게임 진행 중</h1>
      <p class="muted">Phase: <strong>${app.state.phase}</strong></p>
      <p class="muted">턴: ${app.state.turn}</p>
      <p class="muted">이 화면은 W10~W14 에서 실제 게임 UI 로 교체됩니다.</p>
      <div class="divider"></div>
      <div class="row">
        <button id="leave">방 나가기</button>
      </div>
    </div>
  `;
  root.querySelector("#leave")!.addEventListener("click", () => {
    app.navigateHome();
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
