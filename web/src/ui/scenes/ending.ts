/**
 * Ending Scene — 승리/패배 화면.
 * design handoff (Ending.html / EndingScene.jsx) 1:1 포팅. 제목 + 종료 사유
 * 만 미니멀하게. 실제 endedInfo 의 이유/승자를 화면에 투영.
 */

import { App } from "../../app";
import { PlayerPublic } from "../../net/protocol";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "end-active";

export function renderEndingScene(
  root: HTMLElement,
  app: App,
  me: PlayerPublic,
  opp: PlayerPublic,
): void {
  const info = app.state.endedInfo!;
  const iWon = info.winnerId === me.connectionId;
  const draw = info.winnerId === null;
  const outcome: "win" | "lose" = iWon ? "win" : "lose";
  // 무승부는 "lose" 계열 분위기로 묘사 (디자인은 win/lose 만 존재)
  const effective: "win" | "lose" = draw ? "lose" : outcome;

  const stage = ensureStage(root, ACTIVE_CLASS);
  const title = draw ? "무승부" : iWon ? "승리" : "패배";

  stage.innerHTML = `
    <div class="sceneRoot endRoot ${effective}">
      ${sceneChromeHtml()}

      <div class="endAtmosphere">
        ${effective === "win" ? `<div class="endLightShaft"></div>` : `<div class="endAshFall">${ashHtml()}</div>`}
      </div>

      ${effective === "lose" ? `<div class="endCrack"></div>` : ""}

      <div class="endMinimal">
        <h1 class="endTitle">${escapeHtml(title)}</h1>
      </div>

      <div class="endExitWrap">
        <button class="btn btnPrimary endExitBtn" id="endRematch">재대전</button>
        <button class="btn btnGhost endExitBtn" id="endExit">나가기</button>
      </div>
    </div>
  `;

  stage
    .querySelector<HTMLButtonElement>("#endRematch")
    ?.addEventListener("click", () => {
      app.sendGameMsg({ type: "rematch" });
      // 클라 쪽 battle 상태 선제 정리 — 서버 room 브로드캐스트 도착 전에 UI 잔상 제거
      app.state.plays = [];
      app.state.hand = [];
      app.state.silencedCardIds = [];
      app.state.currentEvent = null;
      app.state.pendingEvents = [];
      app.state.damageFloats = [];
      app.state.endedInfo = null;
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    });
  stage
    .querySelector<HTMLButtonElement>("#endExit")
    ?.addEventListener("click", () => {
      app.navigateHome();
    });

  // opp 는 아직 안 쓰임 (미니멀 디자인) — 향후 확장 여지용
  void opp;
}

function ashHtml(): string {
  const parts: string[] = [];
  for (let i = 0; i < 40; i++) {
    const left = (i * 37) % 100;
    const delay = (i * 0.3) % 8;
    const duration = 9 + (i % 6);
    parts.push(
      `<span class="endAsh" style="left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s"></span>`,
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
