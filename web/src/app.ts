/**
 * App: 클라이언트 상태 + 라우팅 + 렌더 루프.
 * phase 에 따라 화면 전환.
 */

import { Card, ClassName, getCardById } from "./engine";

import { AllinClient, generateRoomCode, getPartyHost } from "./net/client";
import { getOrCreateParticipantId } from "./net/identity";
import {
  CardPlayedMsg,
  PlayerPublic,
  ServerMsg,
  Phase,
  EndReason,
  PlayerStatsPublic,
} from "./net/protocol";
import { TournamentClient } from "./net/tournament-client";
import {
  PublicMatch,
  PublicParticipant,
  TPhase,
  TServerMsg,
} from "./net/tournament-protocol";
import { renderLobby } from "./ui/lobby";
import { renderTournamentRoot } from "./ui/tournament";
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

export interface TournamentClientState {
  tournamentId: string;
  myParticipantId: string | null;
  isHost: boolean;
  phase: TPhase;
  bracket: PublicMatch[][];
  participants: PublicParticipant[];
  hostId: string | null;
  canStart: boolean;
  champion: string | null;
  myCurrentMatchId: string | null;
  /** 직전 매치 종료 정보 — postMatch 씬용. 서버 t_match_ended 로 채워짐. */
  lastMatchEnded: {
    matchId: string;
    winnerId: string | null;
    reason: EndReason;
    p1Stats: PlayerStatsPublic;
    p2Stats: PlayerStatsPublic;
    youWon: boolean | null;
  } | null;
  /** 매치 진입 후 다시 브래킷 화면 보러 갈 때 lastMatchEnded 를 비활성화. */
  acknowledgedLastMatch: boolean;
}

export interface AppState {
  route: "lobby" | "room" | "tournament";
  roomId: string | null;
  tournamentId: string | null;
  name: string;
  myId: string | null;
  client: AllinClient | null;
  tournamentClient: TournamentClient | null;
  tournament: TournamentClientState | null;
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
    tournamentId: null,
    name: "",
    myId: null,
    client: null,
    tournamentClient: null,
    tournament: null,
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
    const tournament = params.get("t");
    const room = params.get("room");
    if (tournament) {
      this.state.route = "tournament";
      this.state.tournamentId = tournament.toUpperCase();
      this.state.roomId = null;
    } else if (room) {
      this.state.route = "room";
      this.state.roomId = room.toUpperCase();
      this.state.tournamentId = null;
    } else {
      this.state.route = "lobby";
      this.state.roomId = null;
      this.state.tournamentId = null;
    }
  }

  navigateToRoom(roomId: string) {
    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    url.searchParams.delete("t");
    history.pushState(null, "", url.toString());
    this.state.route = "room";
    this.state.roomId = roomId;
    this.state.tournamentId = null;
    this.render();
  }

  navigateToTournament(tournamentId: string) {
    const url = new URL(location.href);
    url.searchParams.set("t", tournamentId);
    url.searchParams.delete("room");
    history.pushState(null, "", url.toString());
    this.state.route = "tournament";
    this.state.tournamentId = tournamentId;
    this.state.roomId = null;
    this.render();
  }

  navigateHome() {
    this.disconnect();
    this.disconnectTournament();
    history.pushState(null, "", location.pathname);
    this.state.route = "lobby";
    this.state.roomId = null;
    this.state.tournamentId = null;
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

  disconnectTournament() {
    this.state.tournamentClient?.disconnect();
    this.state.tournamentClient = null;
    this.state.tournament = null;
  }

  // --------------------------------------------------------- 토너먼트 액션
  async createTournament(name: string) {
    this.state.name = name;
    const code = generateRoomCode();
    this.navigateToTournament(code);
    await this.joinTournament(code, name);
  }

  async joinTournament(tournamentId: string, name: string) {
    this.state.name = name || "Player";
    this.state.tournamentId = tournamentId.toUpperCase();
    this.state.error = null;
    try {
      if (this.state.name && this.state.name !== "Player") {
        localStorage.setItem("allin.playerName", this.state.name);
      }
    } catch {
      /* ignore */
    }

    const client = new TournamentClient(getPartyHost(), this.state.tournamentId);
    this.state.tournamentClient = client;

    client.onMessage((msg) => this.onTournamentMsg(msg));
    client.onStatus((s) => {
      if (s === "error") {
        this.state.error = "토너먼트 서버 연결 실패.";
        this.render();
      }
    });

    try {
      await client.connect();
      const participantId = getOrCreateParticipantId();
      client.hello(participantId, this.state.name);
    } catch {
      this.state.error = "WebSocket 연결에 실패했습니다.";
      this.render();
    }
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

  // --------------------------------------------------------- 토너먼트 메시지
  private onTournamentMsg(msg: TServerMsg) {
    switch (msg.type) {
      case "t_hello_ok":
        this.state.myId = msg.participantId;
        if (!this.state.tournament) {
          this.state.tournament = makeEmptyTournamentState(msg.tournamentId);
        }
        this.state.tournament.tournamentId = msg.tournamentId;
        this.state.tournament.myParticipantId = msg.participantId;
        this.state.tournament.isHost = msg.isHost;
        break;
      case "t_error":
        this.state.error = msg.message;
        this.pushToast("error", msg.message);
        break;
      case "t_lobby":
        if (!this.state.tournament) {
          this.state.tournament = makeEmptyTournamentState(
            this.state.tournamentId ?? "",
          );
        }
        this.state.tournament.phase = "tournament_lobby";
        this.state.tournament.participants = msg.participants;
        this.state.tournament.hostId = msg.hostId;
        this.state.tournament.canStart = msg.canStart;
        this.state.tournament.bracket = [];
        this.state.tournament.champion = null;
        this.state.tournament.myCurrentMatchId = null;
        // 호스트 여부 갱신 (재접속 등 케이스)
        if (this.state.tournament.myParticipantId) {
          this.state.tournament.isHost =
            msg.hostId === this.state.tournament.myParticipantId;
        }
        break;
      case "t_bracket": {
        if (!this.state.tournament) {
          this.state.tournament = makeEmptyTournamentState(
            this.state.tournamentId ?? "",
          );
        }
        const t = this.state.tournament;
        t.phase = msg.phase;
        t.bracket = msg.bracket;
        t.participants = msg.participants;
        t.champion = msg.champion;
        t.myCurrentMatchId = msg.myCurrentMatchId;
        // lastMatchEnded 는 사용자가 명시적으로 닫을 때까지(acknowledgedLastMatch)
        // 또는 t_match_started 가 도착할 때 유지 — postMatch 화면이 즉시 사라지지
        // 않도록. 매치 컨텍스트(hand/plays 등) 도 다음 매치 시작 시점에 정리.
        break;
      }
      case "t_match_started":
        // 매치 시작 — 1:1 game state 초기화. coin_toss 는 t_match_event 로
        // 별도 디스패치되므로 여기서 다시 부르지 않는다 (중복 방지).
        this.clearBattleState();
        if (this.state.tournament) {
          this.state.tournament.lastMatchEnded = null;
          this.state.tournament.acknowledgedLastMatch = false;
          // 즉시 myCurrentMatchId 를 set — t_bracket 이 늦게 와도 sendInMatch 가
          // matchId 를 알아야 classPick/duel 클릭 메시지가 송신됨.
          this.state.tournament.myCurrentMatchId = msg.matchId;
        }
        // firstPickId 도 즉시 set (t_match_event(room) 도착 전 픽 흐름 안전망)
        this.state.firstPickId = msg.firstPickId;
        break;
      case "t_match_event":
        // 매치 내 1:1 ServerMsg 를 그대로 디스패치 → 기존 씬 자연스럽게 동작
        this.onServerMsg(msg.event);
        return; // onServerMsg 가 render 호출
      case "t_match_ended":
        if (this.state.tournament) {
          this.state.tournament.lastMatchEnded = {
            matchId: msg.matchId,
            winnerId: msg.winnerId,
            reason: msg.reason,
            p1Stats: msg.p1Stats,
            p2Stats: msg.p2Stats,
            youWon: msg.youWon,
          };
        }
        // app.state.endedInfo 도 t_match_event(ended) 가 따로 채움.
        // 여기서는 postMatch 트리거만.
        break;
      default:
        break;
    }
    this.render();
  }

  /** 매치 진행 중 1:1 메시지를 매치 ID 와 함께 서버로 전송. */
  sendInMatch(msg: import("./net/protocol").ClientMsg): void {
    const matchId = this.state.tournament?.myCurrentMatchId;
    if (!matchId || !this.state.tournamentClient) return;
    this.state.tournamentClient.sendInMatch(matchId, msg);
  }

  /**
   * 1:1/토너먼트 양쪽에서 통일된 게임 메시지 송신.
   * 씬 코드는 route 를 신경 쓰지 않고 이 메서드로 보냄.
   * 토너먼트에서 의미 없는 메시지(rematch 등) 는 자동 무시됨.
   */
  sendGameMsg(msg: import("./net/protocol").ClientMsg): void {
    if (this.state.route === "tournament") {
      this.sendInMatch(msg);
      return;
    }
    this.state.client?.send(msg);
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
    } else if (s.route === "tournament") {
      renderTournamentRoot(this.root, this);
    }
    this.renderFx();
  }

  /** Coin toss 는 Class Pick 씬 안에서 렌더되므로 여기선 아무것도 안 그림. */
  private renderFx() {
    this.fxRoot.innerHTML = "";
  }
}

function makeEmptyTournamentState(tournamentId: string): TournamentClientState {
  return {
    tournamentId,
    myParticipantId: null,
    isHost: false,
    phase: "tournament_lobby",
    bracket: [],
    participants: [],
    hostId: null,
    canStart: false,
    champion: null,
    myCurrentMatchId: null,
    lastMatchEnded: null,
    acknowledgedLastMatch: false,
  };
}
