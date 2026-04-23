/**
 * App: 클라이언트 상태 + 라우팅 + 렌더 루프.
 * phase 에 따라 화면 전환.
 */

import { Card, ClassName, getCardById } from "./engine";

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
import { resetDuelState } from "./ui/scenes/duel";
import { resetBoonDraftState } from "./ui/scenes/boonDraft";
import { resetClassPickState } from "./ui/scenes/classPick";

// ---- 타이밍 헬퍼 (ms) ----

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function rollDurationMs(evt: CardPlayedMsg): number {
  if (evt.cardId === "G4") return 0; // 잭팟은 별도 animateJackpotRoll
  // Fixed 타입 / Utility 카드는 룰렛 없이 즉시 시전 (디자인 요구)
  try {
    const c = getCardById(evt.cardId);
    if (c.type === "fixed" || c.type === "utility") return 0;
  } catch {
    /* unknown card — fallback to default */
  }
  // 룰렛 스핀 — 디자인의 2.5s CSS transition + 여유.
  return 2800;
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
  /** ended 수신 시각 + 고정 딜레이. 이 시간 전엔 ending 씬을 띄우지 않고
   *  듀얼 씬 위에 finalBlow 오버레이를 재생한다. */
  endingShowAt: number | null;
  toasts: Array<{
    id: number;
    kind: "info" | "error" | "peek";
    text: string;
  }>;
  showGlossary: boolean;
  /** 이번 턴 봉인된 내 카드 ID 목록 (컨트롤러 패시브 등) */
  silencedCardIds: string[];
  /** 현재 열린 덱/묘지 모달. cardIds=null & loading=true → 서버 응답 대기 중.
   *  cardIds=null & loading=false → 숨김(상대 덱). */
  pileModal: {
    side: "me" | "opp";
    kind: "deck" | "grave";
    cardIds: string[] | null;
    loading: boolean;
  } | null;
  /** zoom 모달로 확대 중인 카드 ID (손패/필드/pile 어디서든 동일 경로). */
  zoomCardId: string | null;
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
    endingShowAt: null,
    toasts: [],
    showGlossary: false,
    silencedCardIds: [],
    pileModal: null,
    zoomCardId: null,
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
    // 이름 로컬 캐시 — 다음 접속/방입장 시 자동 입력용
    try {
      if (this.state.name && this.state.name !== "Player") {
        localStorage.setItem("allin.playerName", this.state.name);
      }
    } catch {
      /* Safari private mode 등 localStorage 비활성 시 무시 */
    }

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
    this.state.endingShowAt = null;
    this.state.error = null;
    this.state.toasts = [];
    this.state.silencedCardIds = [];
    this.state.pileModal = null;
    this.state.zoomCardId = null;
    // 씬 모듈 레벨 상태도 초기화 — 이전 게임의 slot/roulette/timer 가 유출되지 않도록
    resetDuelState();
    resetBoonDraftState();
    resetClassPickState();
  }

  /** Rematch 시 호출 — app.state 의 전투 관련 데이터 + 모든 씬 모듈 상태 정리. */
  private clearBattleState(): void {
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
    this.state.endingShowAt = null;
    this.state.toasts = [];
    this.state.silencedCardIds = [];
    this.state.pileModal = null;
    this.state.zoomCardId = null;
    resetDuelState();
    resetBoonDraftState();
    resetClassPickState();
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
      case "room": {
        // 게임 경계 감지 — 이전 phase 가 battle/ended 였고 새 phase 는 그 이전
        // 단계면, 이전 게임 상태를 일괄 정리한다 (rematch 플로우).
        const wasBattleOrEnded =
          this.state.phase === "battle" || this.state.phase === "ended";
        const nowPreBattle =
          msg.phase === "lobby" ||
          msg.phase === "pick_class" ||
          msg.phase === "pick_boon";
        if (wasBattleOrEnded && nowPreBattle) {
          this.clearBattleState();
        }
        this.state.phase = msg.phase;
        this.state.players = msg.players;
        this.state.firstPickId = msg.firstPickId;
        this.state.activeId = msg.activeId;
        this.state.turn = msg.turn;
        break;
      }
      case "coin_toss": {
        this.state.firstPickId = msg.firstPickId;
        // 코인토스는 Class Pick 씬 안에서 연출된다. 디자인 타임라인:
        //   0ms  → intro
        //   900  → spinning
        //   2600 → resolving
        //   3900 → announced
        //   5600 → picking 시작 (coinTossAnimation 해제)
        const pick = this.state.players.find(
          (p) => p.connectionId === msg.firstPickId,
        );
        this.state.coinTossAnimation = {
          firstPickId: msg.firstPickId,
          firstPickName: pick?.name ?? "???",
          startedAt: Date.now(),
        };
        // 각 페이즈 전환 시점마다 re-render 해서 sub-phase 반영
        [900, 2600, 3900].forEach((ms) =>
          setTimeout(() => this.render(), ms),
        );
        setTimeout(() => {
          this.state.coinTossAnimation = null;
          this.render();
        }, 5600);
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
        // 컨트롤러 패시브는 완전 랜덤 — 워든한테 어떤 카드가 봉인됐는지 알려주지 않음.
        // 서버가 더 이상 이 메시지를 보내지 않지만 protocol 하위호환을 위해 case 는 유지.
        break;
      case "card_played":
        // 턴 스탬프를 달아 보관 — 필드/로그 렌더 시 필터링/표시에 사용
        this.state.plays.push({
          ...msg,
          turn: this.state.turn,
        } as unknown as Record<string, unknown>);
        this.state.pendingEvents.push(msg);
        if (!this.state.isAnimating) {
          void this.processEventQueue();
        }
        break;
      case "turn_changed":
        this.state.activeId = msg.activeId;
        this.state.turn = msg.turn;
        break;
      case "pile":
        // 열려있는 pileModal 과 일치하는 응답만 반영 (경합 방지)
        if (
          this.state.pileModal &&
          this.state.pileModal.side === msg.side &&
          this.state.pileModal.kind === msg.kind
        ) {
          this.state.pileModal.cardIds = msg.cardIds;
          this.state.pileModal.loading = false;
        }
        break;
      case "ended":
        this.state.endedInfo = {
          winnerId: msg.winnerId,
          reason: msg.reason,
          p1Stats: msg.p1Stats,
          p2Stats: msg.p2Stats,
        };
        // Final blow 연출: 마지막 일격 애니메이션이 끝나고 2.5초 뒤에 ending 씬으로.
        // 애니메이션 큐 진행 중이면 끝난 뒤 기준, 아니면 지금 기준.
        {
          const base = this.state.isAnimating
            ? this.estimateQueueEndMs()
            : Date.now();
          this.state.endingShowAt = base + 2500;
          // 지정 시각에 재렌더
          const wait = Math.max(0, this.state.endingShowAt - Date.now());
          setTimeout(() => this.render(), wait + 50);
        }
        break;
      default:
        // exhaustive: TS 레벨에서 새 메시지 추가 시 경고
        break;
    }
    this.render();
  }

  /** 대략적으로 현재 애니메이션 큐가 언제 비는지 (final blow 연출 타이밍 계산용). */
  private estimateQueueEndMs(): number {
    const pending = this.state.pendingEvents.length;
    // 현재 진행 이벤트: 대략 2800 roll + 1100 result 최대 = 3900ms
    const currentRemaining = this.state.currentEvent ? 3900 : 0;
    // 대기 이벤트: 각 이벤트당 ~3900ms (타입별 다르지만 대략치)
    const queued = pending * 3900;
    return Date.now() + currentRemaining + queued;
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
    if (s.route === "lobby") {
      renderLobby(this.root, this);
    } else if (s.route === "room") {
      renderWaitroom(this.root, this);
    }
    this.renderFx();
  }

  /** Coin toss 는 Class Pick 씬 안에서 렌더되므로 여기선 아무것도 안 그림. */
  private renderFx() {
    this.fxRoot.innerHTML = "";
  }
}
