/**
 * 단일 토너먼트 브래킷 자료구조 + 부전승(bye) 알고리즘.
 *
 * - N 명 입장 → 다음 2의 거듭제곱 K → 부전승 K-N 명
 * - 시드 셔플 후 표준 single-elimination 매핑
 *   (i 번째 매치 = slots[i] vs slots[K-1-i])
 * - 부전승은 슬롯 중 한쪽이 null. 즉시 winnerId 결정.
 * - 이후 라운드는 비어있는 매치들로 미리 생성. 진출 시 채움.
 */

import { createRng } from "../src/engine";
import { TMatchStatus } from "../src/net/tournament-protocol";

export interface InternalMatch {
  matchId: string;
  round: number;
  index: number;
  p1Id: string | null;
  p2Id: string | null;
  winnerId: string | null;
  status: TMatchStatus;
  readyP1: boolean;
  readyP2: boolean;
}

/**
 * 입장 순서대로 받은 participantIds 로 빈 브래킷 생성.
 * 첫 라운드는 시드 셔플 + 부전승 처리해 status="ready" 또는 "bye" 로,
 * 이후 라운드는 status="pending" + p1Id/p2Id=null 로 미리 만들어둠.
 */
export function buildInitialBracket(
  participantIds: string[],
  rngSeed: number,
): InternalMatch[][] {
  if (participantIds.length < 2) {
    throw new Error("토너먼트는 최소 2명 필요");
  }
  const rng = createRng(rngSeed);
  const seeded = [...participantIds];
  rng.shuffle(seeded);
  const N = seeded.length;
  const K = nextPow2(N);
  const byes = K - N;

  // top-half 에 부전승 우선 배정 — 시드 i 가 작을수록 상위.
  // 표준 페어링: slots[i] vs slots[K-1-i]
  // 부전승을 K-1-i 자리에 배치하려면 끝쪽부터 채움.
  const slots: (string | null)[] = [];
  // 1..K-byes 까지 일반 슬롯, K-byes+1..K 가 부전승(null)
  for (let i = 0; i < N; i++) slots.push(seeded[i]!);
  for (let i = 0; i < byes; i++) slots.push(null);

  const round0: InternalMatch[] = [];
  for (let i = 0; i < K / 2; i++) {
    const a = slots[i] ?? null;
    const b = slots[K - 1 - i] ?? null;
    let p1: string | null;
    let p2: string | null;
    let status: TMatchStatus;
    let winnerId: string | null = null;

    if (a !== null && b !== null) {
      p1 = a;
      p2 = b;
      status = "ready";
    } else if (a !== null) {
      p1 = a;
      p2 = null;
      status = "bye";
      winnerId = a;
    } else if (b !== null) {
      p1 = b;
      p2 = null;
      status = "bye";
      winnerId = b;
    } else {
      // 양쪽 다 null — 이론상 N=0 일 때만. 위에서 차단.
      p1 = null;
      p2 = null;
      status = "pending";
    }

    round0.push({
      matchId: `r0-m${i}`,
      round: 0,
      index: i,
      p1Id: p1,
      p2Id: p2,
      winnerId,
      status,
      readyP1: false,
      readyP2: false,
    });
  }

  const totalRounds = Math.log2(K);
  const bracket: InternalMatch[][] = [round0];
  for (let r = 1; r < totalRounds; r++) {
    const matches: InternalMatch[] = [];
    const matchesInRound = K >> (r + 1);
    for (let i = 0; i < matchesInRound; i++) {
      matches.push({
        matchId: `r${r}-m${i}`,
        round: r,
        index: i,
        p1Id: null,
        p2Id: null,
        winnerId: null,
        status: "pending",
        readyP1: false,
        readyP2: false,
      });
    }
    bracket.push(matches);
  }

  return bracket;
}

/**
 * 매치 종료 시 다음 라운드 슬롯에 winner 를 채워 넣음.
 * bracket[r][i] 의 winner → bracket[r+1][floor(i/2)] 의
 *   - i 짝수 → p1Id
 *   - i 홀수 → p2Id
 * 다음 매치의 양쪽이 모두 차면 status="pending" → "ready".
 *
 * @returns 변경된(propagation 으로 채워진) 다음 라운드 매치 (있으면), 없으면 null.
 */
export function propagateWinner(
  bracket: InternalMatch[][],
  matchRound: number,
  matchIndex: number,
  winnerId: string,
): InternalMatch | null {
  const nextRound = matchRound + 1;
  if (nextRound >= bracket.length) return null; // 결승

  const nextMatchIndex = Math.floor(matchIndex / 2);
  const nextMatch = bracket[nextRound]?.[nextMatchIndex];
  if (!nextMatch) return null;

  if (matchIndex % 2 === 0) {
    nextMatch.p1Id = winnerId;
  } else {
    nextMatch.p2Id = winnerId;
  }

  // 다음 매치의 양쪽이 모두 차면 ready (직전 라운드 모두 결정 시점)
  if (nextMatch.p1Id && nextMatch.p2Id && nextMatch.status === "pending") {
    nextMatch.status = "ready";
  }

  return nextMatch;
}

/**
 * 첫 라운드의 bye 매치들을 다음 라운드로 propagate.
 * buildInitialBracket 호출 직후 한 번만.
 */
export function propagateInitialByes(
  bracket: InternalMatch[][],
): InternalMatch[] {
  const propagated: InternalMatch[] = [];
  const round0 = bracket[0];
  if (!round0) return propagated;
  for (const match of round0) {
    if (match.status === "bye" && match.winnerId) {
      const next = propagateWinner(
        bracket,
        match.round,
        match.index,
        match.winnerId,
      );
      if (next) propagated.push(next);
    }
  }
  // bye 가 짝지어 만나서 next 가 또 bye 가 될 수 있는 경우 — 1차에서는
  // N≥2 + byes < N 보장이라 한 번 propagate 면 충분.
  return propagated;
}

/** 챔피언이 결정됐는지 (마지막 라운드 마지막 매치의 winnerId). */
export function getChampion(bracket: InternalMatch[][]): string | null {
  const last = bracket[bracket.length - 1];
  const final = last?.[0];
  return final?.winnerId ?? null;
}

/** 특정 participantId 의 현재(또는 직전 finished) 매치를 찾음. UI 라우팅용. */
export function findCurrentMatchOf(
  bracket: InternalMatch[][],
  participantId: string,
): InternalMatch | null {
  // 진행/대기 중 매치 우선
  for (const round of bracket) {
    for (const m of round) {
      if (
        (m.p1Id === participantId || m.p2Id === participantId) &&
        (m.status === "in_progress" ||
          m.status === "ready" ||
          m.status === "pending")
      ) {
        return m;
      }
    }
  }
  // 없으면 가장 최근 finished 매치
  for (let r = bracket.length - 1; r >= 0; r--) {
    const round = bracket[r]!;
    for (const m of round) {
      if (
        (m.p1Id === participantId || m.p2Id === participantId) &&
        (m.status === "finished" || m.status === "bye")
      ) {
        return m;
      }
    }
  }
  return null;
}

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 1 << Math.ceil(Math.log2(n));
}
