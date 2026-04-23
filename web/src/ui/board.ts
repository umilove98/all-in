/**
 * Battle / Ended 화면 디스패처.
 *   phase=battle → Underground Duel 씬 (src/ui/scenes/duel.ts)
 *   phase=ended  → Ending 씬 (src/ui/scenes/ending.ts)
 */

import { App } from "../app";
import { renderDuelScene } from "./scenes/duel";
import { renderEndingScene } from "./scenes/ending";
import { ensureStage } from "./sceneStage";

export function renderBoard(root: HTMLElement, app: App): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  if (!me || !opp) {
    const stage = ensureStage(root, "duel-active");
    stage.innerHTML = `
      <div class="gameField">
        <div class="bgRoom"></div>
        <div class="bgVignette"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--scene-parch-dim);font-family:'Cinzel',serif;letter-spacing:6px;z-index:20">
          LOADING
        </div>
      </div>
    `;
    return;
  }

  if (s.phase === "ended" && s.endedInfo) {
    // Final blow 연출: endingShowAt 이 미래면 듀얼 씬 + 오버레이로 머무르다가
    // 지정 시각 지나야 ending 씬으로 이동.
    const now = Date.now();
    if (s.endingShowAt !== null && s.endingShowAt > now) {
      renderDuelScene(root, app, me, opp);
      mountFinalBlowOverlay(root, s.endingShowAt - now, app);
      return;
    }
    renderEndingScene(root, app, me, opp);
    return;
  }

  renderDuelScene(root, app, me, opp);
}

/**
 * 최후의 일격 연출 — 듀얼 씬 위에 붉은 플래시 + 화면 페이드 오버레이.
 * 지정 시간 후 자연스럽게 ending 씬으로 넘어감 (타임아웃으로 app.render 호출).
 */
function mountFinalBlowOverlay(
  root: HTMLElement,
  remainingMs: number,
  app: App,
): void {
  const stage = root.querySelector<HTMLElement>(".scene-stage");
  if (!stage) return;
  let overlay = stage.querySelector<HTMLElement>(".finalBlowOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "finalBlowOverlay";
    overlay.innerHTML = `
      <div class="finalBlowFlash"></div>
      <div class="finalBlowFade"></div>
    `;
    stage.appendChild(overlay);
    // 연출 종료 후 ending 씬 전환 유도 (백업)
    setTimeout(() => app.render(), remainingMs + 50);
  }
}
