/**
 * Main Scene — 사이트 진입.
 * design handoff (Main.html / MainScene.jsx) 1:1 포팅. 클래스명/DOM 구조는 원본
 * 과 동일하고, onCreate/onJoin 은 실제 app.navigateToRoom 으로 연결된다.
 */

import { App } from "../app";
import { generateRoomCode } from "../net/client";
import { ensureStage, sceneChromeHtml, teardownStage } from "./sceneStage";

const ACTIVE_CLASS = "main-active";
const IGNITION_MS = 1050;

export function renderLobby(root: HTMLElement, app: App): void {
  const stage = ensureStage(root, ACTIVE_CLASS);

  let code = "";
  let igniting = false;

  const render = () => {
    const trimmed = code.trim().toUpperCase();
    const canJoin = trimmed.length > 0;
    stage.innerHTML = `
      <div class="sceneRoot mainRoot${igniting ? " igniting" : ""}">
        ${sceneChromeHtml()}

        <div class="mainIgniteHalo" aria-hidden="true"></div>
        <div class="mainIgniteFlash" aria-hidden="true"></div>

        <div class="mainFrame">
          <div class="mainLogoStack">
            <div class="mainGlyphs"><span>✦</span><span>❦</span><span>✦</span></div>
            <div class="mainOverline">Bloodbet</div>
            <h1 class="mainTitle">ALL-IN</h1>
            <div class="mainSubtitle">— a duel of blood and fortune —</div>
            <div class="mainTagline">${"\n"}</div>
          </div>

          <div class="mainActions">
            <form class="mainCreateWrap" id="mainCreateForm">
              <button type="submit" class="mainCreateBtn">
                <span class="smGlyph">❦</span>
                <span>새 방 만들기</span>
                <span class="smGlyph">❦</span>
              </button>
              <div class="mainCreateSub">${"\n"}</div>
            </form>

            <div class="mainDivider">
              <span class="mainDividerLine"></span>
              <span class="mainDividerMark">OR</span>
              <span class="mainDividerLine"></span>
            </div>

            <form class="mainInputWrap" id="mainJoinForm">
              <div class="mainInputLabel">방 코드 입력</div>
              <div class="mainInputRow">
                <input
                  id="mainCode"
                  class="mainInput"
                  value="${escapeAttr(code)}"
                  placeholder="6자리 코드"
                  maxlength="6"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  type="submit"
                  class="mainSubmit join${canJoin ? "" : " disabled"}"
                  ${canJoin ? "" : "disabled"}
                >
                  <span class="smGlyph">⚔</span>
                  <span>입장</span>
                </button>
              </div>
              <div class="mainHelper">${canJoin ? "입력한 방에 입장한다" : " "}</div>
            </form>
          </div>
        </div>

        <div class="mainFoot">
          <span>v0·1</span>
          <span>2P DUEL</span>
          <span>3 MIN</span>
          <span>HP·BET</span>
        </div>
      </div>
    `;
    wire();
  };

  const wire = () => {
    const input = stage.querySelector<HTMLInputElement>("#mainCode");
    input?.addEventListener("input", () => {
      code = input.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
      // 부분 업데이트: disabled 상태와 helper 만 바꾼다 (전체 re-render 하면 focus 유실)
      const trimmed = code.trim();
      const canJoin = trimmed.length > 0;
      if (input.value !== code) input.value = code;
      const btn = stage.querySelector<HTMLButtonElement>(".mainSubmit.join");
      if (btn) {
        btn.disabled = !canJoin;
        btn.classList.toggle("disabled", !canJoin);
      }
      const helper = stage.querySelector<HTMLElement>(".mainHelper");
      if (helper) helper.textContent = canJoin ? "입력한 방에 입장한다" : " ";
    });

    stage
      .querySelector<HTMLFormElement>("#mainCreateForm")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        trigger(() => {
          const roomCode = generateRoomCode();
          teardownStage(root, ACTIVE_CLASS);
          app.navigateToRoom(roomCode);
        });
      });

    stage
      .querySelector<HTMLFormElement>("#mainJoinForm")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        const trimmed = code.trim().toUpperCase();
        if (!trimmed) return;
        trigger(() => {
          teardownStage(root, ACTIVE_CLASS);
          app.navigateToRoom(trimmed);
        });
      });
  };

  const trigger = (action: () => void) => {
    if (igniting) return;
    igniting = true;
    const scene = stage.querySelector<HTMLElement>(".mainRoot");
    scene?.classList.add("igniting");
    setTimeout(action, IGNITION_MS);
  };

  render();
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
