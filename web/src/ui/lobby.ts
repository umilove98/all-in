/**
 * 로비 화면: 방 만들기 / 방 코드 입력.
 */

import { App } from "../app";

export function renderLobby(root: HTMLElement, app: App): void {
  root.innerHTML = `
    <div class="card">
      <h1>ALL-IN <small>Bloodbet</small></h1>
      <p class="muted">한 턴, 한 호흡, 한 방. HP 를 걸고 베팅해 승부하는 1:1 카드 도박.</p>

      <div class="divider"></div>

      <label class="muted" for="name">닉네임</label>
      <input id="name" type="text" maxlength="16" placeholder="나의 이름"
             value="${escapeHtml(app.state.name)}" />

      <div class="row" style="margin-top:16px">
        <button id="create">방 만들기</button>
      </div>

      <div class="divider"></div>

      <label class="muted" for="code">친구가 방을 만들었나요? 방 코드 입력</label>
      <input id="code" type="text" maxlength="8" placeholder="예: AB3F9K" />
      <div class="row">
        <button id="join">방 참가</button>
      </div>

      ${app.state.error ? `<div class="error">${escapeHtml(app.state.error)}</div>` : ""}
    </div>
  `;

  const nameInput = root.querySelector<HTMLInputElement>("#name")!;
  const codeInput = root.querySelector<HTMLInputElement>("#code")!;
  const create = root.querySelector<HTMLButtonElement>("#create")!;
  const join = root.querySelector<HTMLButtonElement>("#join")!;

  create.addEventListener("click", async () => {
    const name = nameInput.value.trim() || "Player";
    await app.createRoom(name);
  });

  join.addEventListener("click", async () => {
    const name = nameInput.value.trim() || "Player";
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      app.state.error = "방 코드를 입력하세요.";
      app.render();
      return;
    }
    app.navigateToRoom(code);
    await app.joinRoom(code, name);
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
