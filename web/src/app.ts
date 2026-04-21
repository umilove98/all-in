/**
 * App: 클라이언트 상태 + 라우팅 + 렌더 루프.
 * phase 에 따라 화면 전환.
 */

import { Card, ClassName } from "./engine";

import { AllinClient, generateRoomCode, getPartyHost } from "./net/client";
import {
  CardPlayedMsg,
  PlayerPublic,
  ServerMsg,
  Phase,
  EndReason,
  PlayerStatsPublic,
} from "./net/protocol";
import { renderLobby } from "./ui/lobby";
import { renderWaitroom } from "./ui/waitroom";

// ---- 타이밍 헬퍼 (ms) ----

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rollDurationMs(evt: CardPlayedMsg): number {
  if (evt.cardId === "G4") return 0; // 잭팟은 별도 animateJackpotRoll
  // 룰렛 스핀 — 3초. 이 값을 바꾸면 .roulette-wheel 의 CSS animation 시간도 같이 조정할 것.
  return 3000;
}

function resultDurationMs(evt: CardPlayedMsg): number {
  if (evt.critical) return 1100;
  return 700;
}

export interface AppState {
  route: "lobby" | "room";
  roomId: string | null;
  name: string;
  myId: string | null;
  client: AllinClient | null;
  error: string | null;

  // 서버 상태
  phase: Phase;
  players: PlayerPublic[];
  firstPickId: string | null;
  activeId: string | null;
  turn: number;
  hand: Card[];
  disabledClasses: ClassName[];
  boonOptions: string[];
  peeks: Array<{ cardId: string; cardName: string; turn: number }>;
  plays: Array<Record<string, unknown>>;
  selectedCardId: string | null;
  pendingBet: number;
  // 연출 큐: card_played 이벤트를 순차 재생 (FX1)
  pendingEvents: CardPlayedMsg[];
  currentEvent: CardPlayedMsg | null;
  currentEventPhase: "rolling" | "result" | null;
  currentEventJackpotShown: number | null; // 잭팟 롤링 중 임시 표시 숫자 (FX2)
  isAnimating: boolean;
  hpShake: string | null; // 피격 HP 바 shake 대상 connectionId (FX3)
  damageFloats: Array<{
    id: number;
    targetId: string;
    amount: number;
    kind: "dmg" | "heal" | "self";
    critical: boolean;
  }>;
  // 코인토스 오버레이 (FX4) — phase 전환 걸친 전역 연출
  coinTossAnimation: {
    firstPickId: string;
    firstPickName: string;
    startedAt: number;
  } | null;
  endedInfo: {
    winnerId: string | null;
    reason: EndReason;
    p1Stats: PlayerStatsPublic;
    p2Stats: PlayerStatsPublic;
  } | null;
  toasts: Array<{
    id: number;
    kind: "info" | "error" | "peek";
    text: string;
  }>;
  showGlossary: boolean;
  /** 이번 턴 봉인된 내 카드 ID 목록 (컨트롤러 패시브 등) */
  silencedCardIds: string[];
}

export class App {
  state: AppState = {
    route: "lobby",
    roomId: null,
    name: "",
    myId: null,
    client: null,
    error: null,
    phase: "lobby",
    players: [],
    firstPickId: null,
    activeId: null,
    turn: 0,
    hand: [],
    disabledClasses: [],
    boonOptions: [],
    peeks: [],
    plays: [],
    selectedCardId: null,
    pendingBet: 0,
    pendingEvents: [],
    currentEvent: null,
    currentEventPhase: null,
    currentEventJackpotShown: null,
    isAnimating: false,
    hpShake: null,
    damageFloats: [],
    coinTossAnimation: null,
    endedInfo: null,
    toasts: [],
    showGlossary: false,
    silencedCardIds: [],
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly fxRoot: HTMLElement,
  ) {
    this.parseRoute();
    this.render();
    window.addEventListener("popstate", () => {
      this.parseRoute();
      this.render();
    });
  }

  // --------------------------------------------------------- 라우팅
  private parseRoute() {
    const params = new URLSearchParams(location.search);
    const room = params.get("room");
    if (room) {
      this.state.route = "room";
      this.state.roomId = room.toUpperCase();
    } else {
      this.state.route = "lobby";
      this.state.roomId = null;
    }
  }

  navigateToRoom(roomId: string) {
    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    history.pushState(null, "", url.toString());
    this.state.route = "room";
    this.state.roomId = roomId;
    this.render();
  }

  navigateHome() {
    this.disconnect();
    history.pushState(null, "", location.pathname);
    this.state.route = "lobby";
    this.state.roomId = null;
    this.resetGameState();
    this.render();
  }

  // --------------------------------------------------------- 방 액션
  async createRoom(name: string) {
    this.state.name = name;
    const code = generateRoomCode();
    this.navigateToRoom(code);
    await this.joinRoom(code, name);
  }

  async joinRoom(roomId: string, name: string) {
    this.state.name = name || "Player";
    this.state.roomId = roomId.toUpperCase();
    this.state.error = null;

    const client = new AllinClient(getPartyHost(), this.state.roomId);
    this.state.client = client;

    client.onMessage((msg) => this.onServerMsg(msg));
    client.onStatus((s) => {
      if (s === "error") {
        this.state.error = "연결 실패. 서버를 확인하세요.";
        this.render();
      }
    });

    try {
      await client.connect();
      client.send({ type: "join", name: this.state.name });
    } catch {
      this.state.error = "WebSocket 연결에 실패했습니다.";
      this.render();
    }
  }

  disconnect() {
    this.state.client?.disconnect();
    this.state.client = null;
    this.state.myId = null;
  }

  private resetGameState() {
    this.state.phase = "lobby";
    this.state.players = [];
    this.state.firstPickId = null;
    this.state.activeId = null;
    this.state.turn = 0;
    this.state.hand = [];
    this.state.disabledClasses = [];
    this.state.boonOptions = [];
    this.state.peeks = [];
    this.state.plays = [];
    this.state.selectedCardId = null;
    this.state.pendingBet = 0;
    this.state.pendingEvents = [];
    this.state.currentEvent = null;
    this.state.currentEventPhase = null;
    this.state.currentEventJackpotShown = null;
    this.state.isAnimating = false;
    this.state.hpShake = null;
    this.state.damageFloats = [];
    this.state.coinTossAnimation = null;
    this.state.endedInfo = null;
    this.state.error = null;
    this.state.toasts = [];
    this.state.silencedCardIds = [];
  }

  pushToast(kind: "info" | "error" | "peek", text: string, ttlMs = 4000) {
    const id = Date.now() + Math.random();
    this.state.toasts.push({ id, kind, text });
    setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((t) => t.id !== id);
      this.render();
    }, ttlMs);
  }

  // --------------------------------------------------------- 메시지
  private onServerMsg(msg: ServerMsg) {
    switch (msg.type) {
      case "connected":
        this.state.myId = msg.connectionId;
        break;
      case "error":
        this.state.error = msg.message;
        this.pushToast("error", msg.message);
        break;
      case "room":
        this.state.phase = msg.phase;
        this.state.players = msg.players;
        this.state.firstPickId = msg.firstPickId;
        this.state.activeId = msg.activeId;
        this.state.turn = msg.turn;
        break;
      case "coin_toss": {
        this.state.firstPickId = msg.firstPickId;
        // 코인토스 오버레이 시작. 선픽 이름은 players 중에서 찾음 (직전 room 메시지로 이미 채워져 있음).
        const pick = this.state.players.find(
          (p) => p.connectionId === msg.firstPickId,
        );
        this.state.coinTossAnimation = {
          firstPickId: msg.firstPickId,
          firstPickName: pick?.name ?? "???",
          startedAt: Date.now(),
        };
        setTimeout(() => {
          this.state.coinTossAnimation = null;
          this.render();
        }, 2200);
        break;
      }
      case "class_options":
        this.state.disabledClasses = msg.disabled;
        break;
      case "boon_options":
        this.state.boonOptions = msg.options;
        break;
      case "hand":
        this.state.hand = msg.hand;
        this.state.silencedCardIds = msg.silenced ?? [];
        break;
      case "peek":
        this.state.peeks.push({
          cardId: msg.cardId,
          cardName: msg.cardName,
          turn: this.state.turn,
        });
        this.pushToast("peek", `👁 상대 손패에서 본 카드: ${msg.cardName}`, 5000);
        break;
      case "passive_silence":
        this.pushToast(
          "peek",
          `🔒 컨트롤러 패시브 — 상대 "${msg.cardName}" 이번 턴 봉인`,
          5000,
        );
        break;
      case "card_played":
        this.state.plays.push(msg as unknown as Record<string, unknown>);
        this.state.pendingEvents.push(msg);
        if (!this.state.isAnimating) {
          void this.processEventQueue();
        }
        break;
      case "turn_changed":
        this.state.activeId = msg.activeId;
        this.state.turn = msg.turn;
        break;
      case "ended":
        this.state.endedInfo = {
          winnerId: msg.winnerId,
          reason: msg.reason,
          p1Stats: msg.p1Stats,
          p2Stats: msg.p2Stats,
        };
        break;
      default:
        // exhaustive: TS 레벨에서 새 메시지 추가 시 경고
        break;
    }
    this.render();
  }

  // --------------------------------------------------------- 연출 큐 (FX1)

  private async processEventQueue(): Promise<void> {
    if (this.state.isAnimating) return;
    this.state.isAnimating = true;
    while (this.state.pendingEvents.length > 0) {
      const evt = this.state.pendingEvents.shift()!;
      await this.playCardEvent(evt);
    }
    this.state.isAnimating = false;
    this.state.currentEvent = null;
    this.state.currentEventPhase = null;
    this.state.currentEventJackpotShown = null;
    this.render();
  }

  private async playCardEvent(evt: CardPlayedMsg): Promise<void> {
    this.state.currentEvent = evt;

    // 1) Rolling phase: 명중/크리 굴림 or 잭팟 주사위
    this.state.currentEventPhase = "rolling";
    this.render();

    if (evt.cardId === "G4" && evt.jackpotRoll !== null) {
      await this.animateJackpotRoll(evt.jackpotRoll);
    } else {
      await wait(rollDurationMs(evt));
    }

    // 2) Result phase: 결과 표시 + 피격 연출
    this.state.currentEventPhase = "result";
    // 피격 플로팅 + shake
    const opponentId = this.state.players
      .map((p) => p.connectionId)
      .find((id) => id !== evt.by);
    if (evt.damageToOpponent > 0 && opponentId) {
      this.spawnDamageFloat(opponentId, evt.damageToOpponent, "dmg", evt.critical);
      this.state.hpShake = opponentId;
    }
    if (evt.damageToSelf > 0) {
      this.spawnDamageFloat(evt.by, evt.damageToSelf, "self", false);
      if (!this.state.hpShake) this.state.hpShake = evt.by;
    }
    if (evt.heal > 0) {
      this.spawnDamageFloat(evt.by, evt.heal, "heal", false);
    }
    this.render();

    // shake 해제
    setTimeout(() => {
      if (this.state.hpShake) {
        this.state.hpShake = null;
        this.render();
      }
    }, 500);

    await wait(resultDurationMs(evt));
  }

  private async animateJackpotRoll(finalRoll: number): Promise<void> {
    const TICKS = 12;
    const TICK_MS = 80;
    for (let i = 0; i < TICKS; i++) {
      this.state.currentEventJackpotShown = 1 + Math.floor(Math.random() * 10);
      this.render();
      await wait(TICK_MS);
    }
    this.state.currentEventJackpotShown = finalRoll;
    this.render();
    await wait(400);
  }

  private spawnDamageFloat(
    targetId: string,
    amount: number,
    kind: "dmg" | "heal" | "self",
    critical: boolean,
  ): void {
    const id = Date.now() + Math.random();
    this.state.damageFloats.push({ id, targetId, amount, kind, critical });
    setTimeout(() => {
      this.state.damageFloats = this.state.damageFloats.filter(
        (f) => f.id !== id,
      );
      this.render();
    }, 1200);
  }

  // --------------------------------------------------------- 렌더
  render() {
    const s = this.state;
    this.updateBodyClass();
    if (s.route === "lobby") {
      renderLobby(this.root, this);
    } else if (s.route === "room") {
      renderWaitroom(this.root, this);
    }
    this.renderFx();
  }

  private updateBodyClass() {
    const s = this.state;
    // 화면별 배경 이미지 토글용 class (assets/backgrounds/*.png)
    let screen = "home";
    if (s.route === "lobby") {
      screen = "home";
    } else if (!s.client || !s.myId) {
      screen = "home"; // 참가 폼도 홈 배경
    } else if (s.phase === "lobby") {
      screen = "lobby";
    } else if (s.phase === "pick_class") {
      screen = "pick-class";
    } else if (s.phase === "pick_boon") {
      screen = "pick-boon";
    } else if (s.phase === "battle" || s.phase === "ended") {
      screen = "battle";
    }
    const cls = `screen-${screen}`;
    if (document.body.dataset.screen !== screen) {
      document.body.className = document.body.className
        .split(/\s+/)
        .filter((c) => !c.startsWith("screen-"))
        .concat(cls)
        .join(" ")
        .trim();
      document.body.dataset.screen = screen;
    }
  }

  private renderFx() {
    const s = this.state;
    if (s.coinTossAnimation) {
      const isMe = s.coinTossAnimation.firstPickId === s.myId;
      this.fxRoot.innerHTML = `
        <div class="fx-cointoss">
          <div class="coin">🪙</div>
          <div class="fx-subtitle muted">코인 토스</div>
          <div class="fx-coin-result">
            선픽 — <span class="accent">${escapeHtmlSimple(s.coinTossAnimation.firstPickName)}</span>${isMe ? " (나)" : ""}
          </div>
        </div>
      `;
    } else {
      this.fxRoot.innerHTML = "";
    }
  }
}

function escapeHtmlSimple(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
