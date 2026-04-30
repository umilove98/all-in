/**
 * Tournament Lobby — 참가자 모집 + 호스트 시작 버튼.
 * Waitroom 의 톤(돌+양피지) 을 따라 디자인.
 */

import { App } from "../../app";
import {
  MAX_TOURNAMENT_PLAYERS,
  MIN_TOURNAMENT_PLAYERS,
} from "../../net/tournament-protocol";
import { ensureStage, sceneChromeHtml } from "../sceneStage";

const ACTIVE_CLASS = "wr-active";

export function renderTournamentLobby(root: HTMLElement, app: App): void {
  const t = app.state.tournament;
  if (!t) return;
  const tid = t.tournamentId || app.state.tournamentId || "??????";
  const me = t.participants.find((p) => p.participantId === t.myParticipantId);
  const myName = me?.name ?? app.state.name ?? "YOU";
  const count = t.participants.length;
  const isHost = t.isHost;

  const stage = ensureStage(root, ACTIVE_CLASS);
  stage.innerHTML = `
    <div class="sceneRoot wr-phase-tournament-lobby">
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
            <button id="wrCopyBtn" class="wrRoomCopyBtn">
              <span>⎘</span><span>COPY</span>
            </button>
          </div>
          <div class="wrPreamble">
            <h1 class="wrTitle">토너먼트 대기실</h1>
            <div class="wrSubtitle">${count}/${MAX_TOURNAMENT_PLAYERS} · 최소 ${MIN_TOURNAMENT_PLAYERS}명 필요</div>
          </div>
        </div>

        <div class="tLobbyList">
          ${t.participants
            .map((p) => participantRowHtml(p, t.hostId, t.myParticipantId))
            .join("")}
          ${count === 0 ? `<div class="wrHint">참가자를 기다리는 중…</div>` : ""}
        </div>

        <div class="wrBottomBar">
          ${
            isHost
              ? `<button id="tStartBtn" class="sceneBtn primary wrStartButton" ${t.canStart ? "" : "disabled"}>
                   토너먼트 시작 (${count}명)
                 </button>
                 <div class="wrHint">${t.canStart ? "지금 시작할 수 있습니다." : `최소 ${MIN_TOURNAMENT_PLAYERS}명이 모여야 시작할 수 있습니다.`}</div>`
              : `<button class="sceneBtn wrStartButton" disabled>호스트의 시작을 기다리는 중…</button>
                 <div class="wrHint">${escapeHtml(myName)} 으로 참가했습니다.</div>`
          }
          ${app.state.error ? `<div class="wrHint" style="color:#ffb9b9">${escapeHtml(app.state.error)}</div>` : ""}
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
    .querySelector<HTMLButtonElement>("#wrCopyBtn")
    ?.addEventListener("click", () => {
      copyToClipboard(tid);
    });

  stage
    .querySelector<HTMLButtonElement>("#tStartBtn")
    ?.addEventListener("click", () => {
      app.state.tournamentClient?.startTournament();
    });
}

function participantRowHtml(
  p: import("../../net/tournament-protocol").PublicParticipant,
  hostId: string | null,
  myId: string | null,
): string {
  const cls: string[] = ["tLobbyRow"];
  if (!p.online) cls.push("offline");
  if (p.participantId === myId) cls.push("me");
  return `
    <div class="${cls.join(" ")}">
      <span class="tLobbyMark">❦</span>
      <span class="tLobbyName">${escapeHtml(p.name)}</span>
      <span class="tLobbyTags">
        ${p.participantId === hostId ? `<span class="tLobbyTag host">HOST</span>` : ""}
        ${p.participantId === myId ? `<span class="tLobbyTag me">YOU</span>` : ""}
        ${!p.online ? `<span class="tLobbyTag off">OFF</span>` : ""}
      </span>
    </div>
  `;
}

function copyToClipboard(text: string): void {
  if (navigator.clipboard && window.isSecureContext) {
    void navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
