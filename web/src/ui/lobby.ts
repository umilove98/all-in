/**
 * Main Scene — 사이트 진입.
 * design handoff (Main.html / MainScene.jsx) 1:1 포팅. 클래스명/DOM 구조는 원본
 * 과 동일하고, onCreate/onJoin 은 실제 app.navigateToRoom / navigateToTournament
 * 로 연결된다. 모드 탭(1:1 빠른 매치 / 토너먼트) 추가.
 */

import { App } from "../app";
import { generateRoomCode } from "../net/client";
import { ensureStage, sceneChromeHtml, teardownStage } from "./sceneStage";

const ACTIVE_CLASS = "main-active";
const IGNITION_MS = 1050;

type Mode = "duel" | "tournament";

export function renderLobby(root: HTMLElement, app: App): void {
  const stage = ensureStage(root, ACTIVE_CLASS);

  let code = "";
  let mode: Mode = "duel";
  let igniting = false;

  const render = () => {
    const trimmed = code.trim().toUpperCase();
    const canJoin = trimmed.length > 0;
    const createLabel = mode === "tournament" ? "새 토너먼트" : "새 방 만들기";
    const joinLabel = mode === "tournament" ? "토너먼트 코드 입력" : "방 코드 입력";
    const helper = canJoin
      ? mode === "tournament"
        ? "입력한 토너먼트에 참가한다"
        : "입력한 방에 입장한다"
      : " ";
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

          <div class="mainModeTabs">
            <button type="button" id="mainModeDuel" class="mainModeTab ${mode === "duel" ? "active" : ""}">1:1 빠른 매치</button>
            <button type="button" id="mainModeTournament" class="mainModeTab ${mode === "tournament" ? "active" : ""}">토너먼트</button>
          </div>

          <div class="mainActions">
            <form class="mainCreateWrap" id="mainCreateForm">
              <button type="submit" class="mainCreateBtn">
                <span class="smGlyph">❦</span>
                <span>${createLabel}</span>
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
              <div class="mainInputLabel">${joinLabel}</div>
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
              <div class="mainHelper">${helper}</div>
            </form>
          </div>
        </div>

        <div class="mainFoot">
          <span>v0·1</span>
          <span>${mode === "tournament" ? "2~16P TOURNAMENT" : "2P DUEL"}</span>
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
      const trimmed = code.trim();
      const canJoin = trimmed.length > 0;
      if (input.value !== code) input.value = code;
      const btn = stage.querySelector<HTMLButtonElement>(".mainSubmit.join");
      if (btn) {
        btn.disabled = !canJoin;
        btn.classList.toggle("disabled", !canJoin);
      }
      const helper = stage.querySelector<HTMLElement>(".mainHelper");
      if (helper) {
        helper.textContent = canJoin
          ? mode === "tournament"
            ? "입력한 토너먼트에 참가한다"
            : "입력한 방에 입장한다"
          : " ";
      }
    });

    stage
      .querySelector<HTMLButtonElement>("#mainModeDuel")
      ?.addEventListener("click", () => {
        if (mode === "duel") return;
        mode = "duel";
        render();
      });
    stage
      .querySelector<HTMLButtonElement>("#mainModeTournament")
      ?.addEventListener("click", () => {
        if (mode === "tournament") return;
        mode = "tournament";
        render();
      });

    stage
      .querySelector<HTMLFormElement>("#mainCreateForm")
      ?.addEventListener("submit", (e) => {
        e.preventDefault();
        trigger(() => {
          const newCode = generateRoomCode();
          teardownStage(root, ACTIVE_CLASS);
          if (mode === "tournament") {
            app.navigateToTournament(newCode);
          } else {
            app.navigateToRoom(newCode);
          }
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
          if (mode === "tournament") {
            app.navigateToTournament(trimmed);
          } else {
            app.navigateToRoom(trimmed);
          }
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
