/**
 * 토너먼트 모드 라우터.
 * tournament.phase + myCurrentMatchId 의 status 에 따라 분기:
 *   tournament_lobby                              → tournamentLobby
 *   tournament_running, lastMatchEnded 있음       → postMatch (1차에서는 leave 만)
 *   tournament_running, 내 매치 status=in_progress → 기존 씬 (renderPick / renderBoard)
 *   tournament_running, 그 외                     → tournamentBracket
 *   tournament_finished                           → tournamentBracket (champion 표시)
 */

import { App } from "../../app";
import { renderBoard } from "../board";
import { renderPick } from "../pick";
import { renderJoinForm } from "./join";
import { renderTournamentLobby } from "../scenes/tournamentLobby";
import { renderTournamentBracket } from "../scenes/tournamentBracket";
import { renderPostMatch } from "../scenes/postMatch";

export function renderTournamentRoot(root: HTMLElement, app: App): void {
  const s = app.state;

  // 닉네임 미입력 — join 폼
  if (!s.tournamentClient || !s.tournament?.myParticipantId) {
    renderJoinForm(root, app);
    return;
  }

  const t = s.tournament;

  if (t.phase === "tournament_lobby") {
    renderTournamentLobby(root, app);
    return;
  }

  // 직전 매치 결과를 아직 못 본 상태 — postMatch 우선
  if (t.lastMatchEnded && !t.acknowledgedLastMatch) {
    renderPostMatch(root, app);
    return;
  }

  // 진행 중인 내 매치가 있으면 1:1 씬 재사용
  const myMatch = findMatch(t.bracket, t.myCurrentMatchId);
  if (
    t.phase === "tournament_running" &&
    myMatch?.status === "in_progress"
  ) {
    if (s.phase === "battle" || s.phase === "ended") {
      renderBoard(root, app);
      return;
    }
    if (
      s.phase === "pick_class" ||
      s.phase === "pick_boon" ||
      s.phase === "coin_toss"
    ) {
      renderPick(root, app);
      return;
    }
    // 그 외 phase (lobby) 인 경우 — 매치 시작 직후 일시 — bracket 표시
  }

  renderTournamentBracket(root, app);
}

function findMatch(
  bracket: import("../../net/tournament-protocol").PublicMatch[][],
  matchId: string | null,
) {
  if (!matchId) return null;
  for (const round of bracket) {
    for (const m of round) if (m.matchId === matchId) return m;
  }
  return null;
}
