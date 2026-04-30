/**
 * 토너먼트 입장 전 닉네임 입력 폼. Waitroom join 폼과 톤 통일.
 */

import { App } from "../../app";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "wr-active";

export function renderJoinForm(root: HTMLElement, app: App): void {
  const stage = ensureStage(root, ACTIVE_CLASS);
  const cachedName = getCachedName();
  const tid = app.state.tournamentId ?? "??????";
  stage.innerHTML = `
    <div class="sceneRoot">
      ${sceneChromeHtml()}
      <div class="wrFrame">
        <button id="wrBackBtn" class="wrBackBtn" aria-label="로비로">
          <span class="wrBackArrow">←</span>
          <span>로비</span>
        </button>

        <div class="wrRoomPlaque">
          <div class="wrRoomLabel">Tournament Code</div>
          <div class="wrRoomCodeBox">
            <div class="wrRoomCode">${escapeHtml(tid)}</div>
          </div>
          <div class="wrPreamble">
            <h1 class="wrTitle">토너먼트</h1>
          </div>
        </div>

        <div class="wrJoinBox">
          <label class="wrJoinLabel" for="wrNameInput">YOUR NAME</label>
          <input id="wrNameInput" class="wrJoinInput" type="text"
            maxlength="16" placeholder="나의 이름" autocomplete="off" spellcheck="false"
            value="${escapeHtml(cachedName)}" />
        </div>

        <div class="wrBottomBar">
          <button id="wrJoinConfirm" class="sceneBtn primary wrStartButton">참가</button>
          <div class="wrHint">2~16명이 모이면 호스트가 시작합니다</div>
          ${app.state.error ? `<div class="wrHint" style="color:#ffb9b9">${escapeHtml(app.state.error)}</div>` : ""}
        </div>
      </div>
    </div>
  `;

  const input = stage.querySelector<HTMLInputElement>("#wrNameInput")!;
  input.focus();
  if (input.value) input.select();
  const submit = async () => {
    const name = (input.value || "").trim() || "Player";
    await app.joinTournament(app.state.tournamentId!, name);
  };
  stage
    .querySelector<HTMLButtonElement>("#wrJoinConfirm")!
    .addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit();
  });
  stage
    .querySelector<HTMLButtonElement>("#wrBackBtn")
    ?.addEventListener("click", () => app.navigateHome());
}

function getCachedName(): string {
  try {
    return localStorage.getItem("allin.playerName") ?? "";
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
