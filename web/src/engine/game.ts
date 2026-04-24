/**
 * Game 루프 포팅. Python `cli/allin/engine.py` 의 Game 부분.
 */

import { Card } from "./types";
import { Player } from "./player";
import { Rng, createRng } from "./rng";
import { InvalidPlayError } from "./errors";
import {
  CardResult,
  executeCard,
  validateClassMatchup,
} from "./card-exec";

export const MAX_TURNS = 15;

export interface PlayAction {
  kind: "play" | "end";
  cardId?: string;
  bet?: number;
}

export interface Agent {
  chooseAction(game: Game, player: Player): PlayAction;
}

export class PassAgent implements Agent {
  chooseAction(_game: Game, _player: Player): PlayAction {
    return { kind: "end" };
  }
}

export class ScriptedAgent implements Agent {
  private i = 0;
  constructor(private readonly actions: PlayAction[]) {}
  chooseAction(_game: Game, _player: Player): PlayAction {
    if (this.i >= this.actions.length) return { kind: "end" };
    return this.actions[this.i++]!;
  }
}

export type EndReason =
  | "hp_zero"
  | "mutual_hp_zero"
  | "turn_limit"
  | "turn_limit_draw"
  | "safety_break";

export interface PlayerStats {
  totalBet: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  critCount: number;
  missCount: number;
  finalHp: number;
}

export interface GameResult {
  winner: Player | null;
  turns: number;
  reason: EndReason;
  p1FinalHp: number;
  p2FinalHp: number;
  p1Stats: PlayerStats;
  p2Stats: PlayerStats;
  log: Record<string, unknown>[];
}

function snapshotStats(p: Player): PlayerStats {
  return {
    totalBet: p.totalBet,
    totalDamageDealt: p.totalDamageDealt,
    totalDamageTaken: p.totalDamageTaken,
    critCount: p.critCount,
    missCount: p.missCount,
    finalHp: p.hp,
  };
}

function findCardInHand(player: Player, cardId: string | undefined): Card | null {
  if (!cardId) return null;
  return player.hand.find((c) => c.id === cardId) ?? null;
}

export class Game {
  readonly p1: Player;
  readonly p2: Player;
  readonly agents: WeakMap<Player, Agent>;
  rng: Rng;
  turn = 0;
  current: Player;
  log: Record<string, unknown>[] = [];
  private winner: Player | null = null;
  private endReason: EndReason | null = null;

  constructor(
    p1: Player,
    p2: Player,
    p1Agent: Agent = new PassAgent(),
    p2Agent: Agent = new PassAgent(),
    options: { seed?: number | null } = {},
  ) {
    validateClassMatchup(p1.className, p2.className);
    this.p1 = p1;
    this.p2 = p2;
    this.agents = new WeakMap();
    this.agents.set(p1, p1Agent);
    this.agents.set(p2, p2Agent);
    this.rng = createRng(options.seed ?? null);
    this.current = p1;
  }

  opponentOf(player: Player): Player {
    return player === this.p1 ? this.p2 : this.p1;
  }

  isOver(): boolean {
    return this.endReason !== null;
  }

  step(): void {
    if (this.isOver()) return;

    this.turn += 1;
    const current = this.current;
    const opp = this.opponentOf(current);

    // 턴 시작 훅
    const beginInfo = current.beginTurn();
    if (beginInfo.heal || beginInfo.poison || beginInfo.berserkSelfDmg) {
      this.log.push({
        type: "turn_start",
        turn: this.turn,
        player: current.name,
        heal: beginInfo.heal,
        poison: beginInfo.poison,
        berserk_self_dmg: beginInfo.berserkSelfDmg,
      });
    }

    // 손패 보충
    current.fillHand();

    // 컨트롤러 패시브: 상대 턴 시작마다 상대 손패 1장을 이번 턴 사용 불가(봉인)
    // 이미 침묵된 카드(W3 약점 포착 등으로) 는 후보에서 제외 → 항상 새 카드 1장 추가 침묵.
    if (opp.className === "warden" && current.hand.length > 0) {
      const candidates = current.hand.filter(
        (c) => !current.silencedCards.includes(c.id),
      );
      if (candidates.length > 0) {
        const silenced = this.rng.choice(candidates);
        current.silencedCards.push(silenced.id);
        this.log.push({
          type: "passive_silence",
          turn: this.turn,
          player: opp.name,
          silenced_card: silenced.id,
          silenced_name: silenced.name,
        });
      }
    }

    if (this.checkEnd()) return;

    // 카드 사용 루프
    const maxCards = current.maxCardsPerTurn();
    let cardsUsed = 0;
    const agent = this.agents.get(current);
    if (!agent) throw new Error(`No agent for ${current.name}`);

    while (cardsUsed < maxCards) {
      if (!current.isAlive() || !opp.isAlive()) break;
      const action = agent.chooseAction(this, current);
      if (action.kind === "end") break;
      if (action.kind !== "play") {
        throw new Error(`Unknown action kind: ${action.kind as string}`);
      }

      const card = findCardInHand(current, action.cardId);
      if (!card) {
        throw new InvalidPlayError(
          `${action.cardId ?? "?"} 는 ${current.name} 의 손패에 없음`,
        );
      }

      const result = executeCard(card, current, opp, {
        bet: action.bet ?? 0,
        gameTurn: this.turn,
        rng: this.rng,
      });
      current.discard(card);
      cardsUsed += 1;

      this.log.push(toPlayLogEntry(this.turn, current.name, card, result));

      if (this.checkEnd()) return;
    }

    // 턴 종료 훅
    current.endTurn();

    if (this.checkEnd()) return;

    this.current = opp;
  }

  run(): GameResult {
    const safetyLimit = MAX_TURNS * 2 + 4;
    let iterations = 0;
    while (!this.isOver()) {
      this.step();
      iterations += 1;
      if (iterations > safetyLimit) {
        this.endReason = "safety_break";
        break;
      }
    }
    return {
      winner: this.winner,
      turns: this.turn,
      reason: this.endReason ?? "safety_break",
      p1FinalHp: this.p1.hp,
      p2FinalHp: this.p2.hp,
      p1Stats: snapshotStats(this.p1),
      p2Stats: snapshotStats(this.p2),
      log: [...this.log],
    };
  }

  private checkEnd(): boolean {
    const p1Alive = this.p1.isAlive();
    const p2Alive = this.p2.isAlive();
    if (!p1Alive && !p2Alive) {
      this.winner = null;
      this.endReason = "mutual_hp_zero";
      return true;
    }
    if (!p1Alive) {
      this.winner = this.p2;
      this.endReason = "hp_zero";
      return true;
    }
    if (!p2Alive) {
      this.winner = this.p1;
      this.endReason = "hp_zero";
      return true;
    }
    if (this.turn >= MAX_TURNS) {
      if (this.p1.hp > this.p2.hp) {
        this.winner = this.p1;
        this.endReason = "turn_limit";
      } else if (this.p2.hp > this.p1.hp) {
        this.winner = this.p2;
        this.endReason = "turn_limit";
      } else {
        this.winner = null;
        this.endReason = "turn_limit_draw";
      }
      return true;
    }
    return false;
  }
}

function toPlayLogEntry(
  turn: number,
  playerName: string,
  card: Card,
  result: CardResult,
): Record<string, unknown> {
  return {
    type: "play",
    turn,
    player: playerName,
    card: card.id,
    card_name: card.name,
    bet: result.bet,
    success: result.success,
    critical: result.critical,
    damage_out: result.damageToOpponent,
    damage_self: result.damageToSelf,
    heal: result.heal,
    shield_gained: result.shieldGained,
    drawn: [...result.drawnCards],
    notes: [...result.notes],
    jackpot_roll: result.jackpotRoll,
  };
}
