/**
 * Post-Match — 토너먼트 매치 종료 후 표시되는 결과/메뉴 화면.
 * 관전 / 나가기 / 브래킷으로 돌아가기 선택지.
 *
 * 1차에서는 "관전" 비활성 (라벨만 노출).
 */

import { App } from "../../app";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "end-active";

export function renderPostMatch(root: HTMLElement, app: App): void {
  const t = app.state.tournament;
  const last = t?.lastMatchEnded;
  if (!t || !last) return;

  const myId = t.myParticipantId;
  const youWon = last.youWon === true;
  const draw = last.winnerId === null;
  const title = draw ? "무승부" : youWon ? "승리" : "패배";
  const effective: "win" | "lose" = draw ? "lose" : youWon ? "win" : "lose";

  const stillAlive = !draw && youWon;
  const tournamentDone = t.phase === "tournament_finished";
  const isChampion = stillAlive && tournamentDone && t.champion === myId;

  const stage = ensureStage(root, ACTIVE_CLASS);
  stage.innerHTML = `
    <div class="sceneRoot endRoot ${effective}">
      ${sceneChromeHtml()}

      <div class="endAtmosphere">
        ${effective === "win" ? `<div class="endLightShaft"></div>` : `<div class="endAshFall"></div>`}
      </div>

      <div class="endMinimal">
        <h1 class="endTitle">${escapeHtml(isChampion ? "🏆 우승" : title)}</h1>
        <div class="endSubtitle">${escapeHtml(subtitleFor(youWon, draw, tournamentDone, isChampion))}</div>
      </div>

      <div class="endExitWrap">
        <button class="btn btnPrimary endExitBtn" id="pmBracket">대진표로</button>
        <button class="btn btnGhost endExitBtn" id="pmSpectate" disabled>관전 (곧 출시)</button>
        <button class="btn btnGhost endExitBtn" id="pmExit">나가기</button>
      </div>
    </div>
  `;

  stage
    .querySelector<HTMLButtonElement>("#pmBracket")
    ?.addEventListener("click", () => {
      // 결과 확인 처리 — 다음 매치까진 브래킷 화면 머무름
      if (app.state.tournament) {
        app.state.tournament.acknowledgedLastMatch = true;
      }
      app.render();
    });

  stage
    .querySelector<HTMLButtonElement>("#pmExit")
    ?.addEventListener("click", () => {
      app.state.tournamentClient?.afterMatchChoice("leave");
      app.navigateHome();
    });
}

function subtitleFor(
  youWon: boolean,
  draw: boolean,
  tournamentDone: boolean,
  isChampion: boolean,
): string {
  if (isChampion) return "토너먼트 우승!";
  if (tournamentDone) return "토너먼트 종료";
  if (draw) return "양쪽 다 탈락";
  if (youWon) return "다음 라운드 대진을 기다립니다";
  return "이번 토너먼트는 여기서 마무리";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
