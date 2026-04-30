/**
 * Tournament Bracket — 진행 중 브래킷 + 내 매치 ready 버튼.
 *
 * - 라운드별 매치 트리 표시
 * - 내가 참가한 매치는 강조
 * - 내 매치 status="ready" 면 "게임시작" 버튼. 한 번 누르면 토글.
 *   양쪽 모두 ready 상태가 되면 서버가 자동 시작 → renderBoard 로 전환.
 */

import { App } from "../../app";
import {
  PublicMatch,
  PublicParticipant,
} from "../../net/tournament-protocol";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "wr-active";

export function renderTournamentBracket(root: HTMLElement, app: App): void {
  const t = app.state.tournament;
  if (!t) return;

  const stage = ensureStage(root, ACTIVE_CLASS);
  const myMatch = findMatch(t.bracket, t.myCurrentMatchId);
  const myId = t.myParticipantId;

  const finished = t.phase === "tournament_finished";
  const champ = finished ? t.participants.find((p) => p.participantId === t.champion) : null;

  stage.innerHTML = `
    <div class="sceneRoot wr-phase-tournament-running">
      ${sceneChromeHtml()}

      <div class="wrFrame tBracketFrame">
        <button id="wrBackBtn" class="wrBackBtn" aria-label="로비로">
          <span class="wrBackArrow">←</span>
          <span>로비</span>
        </button>

        <div class="wrRoomPlaque">
          <div class="wrRoomLabel">${finished ? "Champion" : "Tournament"}</div>
          <div class="wrPreamble">
            <h1 class="wrTitle">${finished ? `🏆 ${escapeHtml(champ?.name ?? "")}` : "대진표"}</h1>
            ${
              finished
                ? `<div class="wrSubtitle">토너먼트 종료</div>`
                : myMatch
                  ? `<div class="wrSubtitle">${matchSubtitle(myMatch, myId)}</div>`
                  : `<div class="wrSubtitle">다음 매치를 기다리는 중…</div>`
            }
          </div>
        </div>

        <div class="tBracket">
          ${t.bracket
            .map((round, ri) => roundColHtml(round, ri, t.participants, myId))
            .join("")}
        </div>

        <div class="wrBottomBar">
          ${myMatchActionHtml(myMatch, myId)}
        </div>
      </div>
    </div>
  `;

  stage
    .querySelector<HTMLButtonElement>("#wrBackBtn")
    ?.addEventListener("click", () => {
      app.state.tournamentClient?.leaveRoom();
      app.navigateHome();
    });

  stage
    .querySelector<HTMLButtonElement>("#tReadyBtn")
    ?.addEventListener("click", () => {
      if (myMatch) app.state.tournamentClient?.toggleReady(myMatch.matchId);
    });
}

function findMatch(
  bracket: PublicMatch[][],
  matchId: string | null,
): PublicMatch | null {
  if (!matchId) return null;
  for (const round of bracket) {
    for (const m of round) if (m.matchId === matchId) return m;
  }
  return null;
}

function nameOf(participants: PublicParticipant[], id: string | null): string {
  if (!id) return "—";
  const p = participants.find((x) => x.participantId === id);
  return p?.name ?? id.slice(0, 6);
}

function matchSubtitle(m: PublicMatch, myId: string | null): string {
  if (m.status === "bye") return "부전승 — 다음 라운드 대기 중";
  if (m.status === "pending") return "직전 라운드 결과를 기다리는 중";
  if (m.status === "ready") {
    const myReady = m.p1Id === myId ? m.readyP1 : m.p2Id === myId ? m.readyP2 : false;
    const oppReady = m.p1Id === myId ? m.readyP2 : m.readyP1;
    if (myReady && !oppReady) return "상대 준비 대기 중";
    if (myReady && oppReady) return "곧 시작합니다";
    return "준비되면 게임 시작 버튼을 누르세요";
  }
  if (m.status === "in_progress") return "매치 진행 중";
  if (m.status === "finished") {
    const won = m.winnerId === myId;
    return won ? "승리! 다음 라운드 대기" : "탈락";
  }
  return "";
}

function myMatchActionHtml(
  m: PublicMatch | null,
  myId: string | null,
): string {
  if (!m || !myId) return `<div class="wrHint">관전 중</div>`;
  if (m.status === "ready") {
    const myReady = m.p1Id === myId ? m.readyP1 : m.p2Id === myId ? m.readyP2 : false;
    return `
      <button id="tReadyBtn" class="sceneBtn ${myReady ? "" : "primary"} wrStartButton">
        ${myReady ? "준비 취소" : "게임 시작"}
      </button>
      <div class="wrHint">${myReady ? "상대를 기다리는 중" : "양쪽이 모두 준비하면 매치가 시작됩니다"}</div>
    `;
  }
  if (m.status === "pending") {
    return `<div class="wrHint">상대가 결정되면 게임 시작 버튼이 활성화됩니다</div>`;
  }
  if (m.status === "in_progress") {
    return `<div class="wrHint">매치 진행 중…</div>`;
  }
  if (m.status === "bye") {
    return `<div class="wrHint">부전승 — 다음 매치를 기다리세요</div>`;
  }
  if (m.status === "finished") {
    const won = m.winnerId === myId;
    return `<div class="wrHint">${won ? "다음 라운드 대진을 기다립니다" : "탈락. 토너먼트가 끝나면 결과를 볼 수 있어요."}</div>`;
  }
  return "";
}

function roundColHtml(
  round: PublicMatch[],
  roundIdx: number,
  participants: PublicParticipant[],
  myId: string | null,
): string {
  const title =
    round.length === 1
      ? "결승"
      : round.length === 2
        ? "준결승"
        : `R${roundIdx + 1}`;
  return `
    <div class="tRound">
      <div class="tRoundTitle">${title}</div>
      ${round.map((m) => matchCardHtml(m, participants, myId)).join("")}
    </div>
  `;
}

function matchCardHtml(
  m: PublicMatch,
  participants: PublicParticipant[],
  myId: string | null,
): string {
  const cls = ["tMatch", `status-${m.status}`];
  if (myId && (m.p1Id === myId || m.p2Id === myId)) cls.push("mine");
  const p1Won = m.winnerId !== null && m.winnerId === m.p1Id;
  const p2Won = m.winnerId !== null && m.winnerId === m.p2Id;
  return `
    <div class="${cls.join(" ")}">
      <div class="tMatchSlot ${p1Won ? "won" : m.winnerId ? "lost" : ""}">
        <span class="tMatchName">${escapeHtml(nameOf(participants, m.p1Id))}</span>
        ${m.readyP1 && m.status === "ready" ? `<span class="tMatchTag">READY</span>` : ""}
      </div>
      <div class="tMatchVs">${matchVsLabel(m)}</div>
      <div class="tMatchSlot ${p2Won ? "won" : m.winnerId ? "lost" : ""}">
        <span class="tMatchName">${m.p2Id ? escapeHtml(nameOf(participants, m.p2Id)) : "— BYE —"}</span>
        ${m.readyP2 && m.status === "ready" ? `<span class="tMatchTag">READY</span>` : ""}
      </div>
    </div>
  `;
}

function matchVsLabel(m: PublicMatch): string {
  if (m.status === "in_progress") return m.matchPhase ?? "VS";
  if (m.status === "ready") return "VS";
  if (m.status === "bye") return "BYE";
  if (m.status === "finished") return "—";
  return "·";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
