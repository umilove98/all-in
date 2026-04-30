/**
 * Bracket 알고리즘 단위 테스트.
 * - 부전승 인원/위치
 * - 라운드 트리 모양
 * - winner 진출 propagation
 */

import { describe, expect, it } from "vitest";

import {
  buildInitialBracket,
  getChampion,
  propagateInitialByes,
  propagateWinner,
} from "../worker/bracket";

const SEED = 0xa5a5a5;

describe("buildInitialBracket", () => {
  it("N=2: 1라운드 1매치, 부전승 없음", () => {
    const bracket = buildInitialBracket(["a", "b"], SEED);
    expect(bracket).toHaveLength(1);
    expect(bracket[0]!).toHaveLength(1);
    expect(bracket[0]![0]!.status).toBe("ready");
    expect(bracket[0]![0]!.p1Id).toBeTruthy();
    expect(bracket[0]![0]!.p2Id).toBeTruthy();
  });

  it("N=4: 2라운드, 4명 모두 매치", () => {
    const bracket = buildInitialBracket(["a", "b", "c", "d"], SEED);
    expect(bracket).toHaveLength(2);
    expect(bracket[0]!).toHaveLength(2);
    expect(bracket[1]!).toHaveLength(1);
    expect(bracket[0]!.every((m) => m.status === "ready")).toBe(true);
    expect(bracket[1]![0]!.status).toBe("pending");
  });

  it("N=8: 3라운드, 부전승 없음", () => {
    const bracket = buildInitialBracket(
      ["a", "b", "c", "d", "e", "f", "g", "h"],
      SEED,
    );
    expect(bracket).toHaveLength(3);
    expect(bracket[0]!).toHaveLength(4);
    expect(bracket[1]!).toHaveLength(2);
    expect(bracket[2]!).toHaveLength(1);
    expect(bracket[0]!.every((m) => m.status === "ready")).toBe(true);
  });

  it("N=3: 4슬롯, 부전승 1개", () => {
    const bracket = buildInitialBracket(["a", "b", "c"], SEED);
    expect(bracket).toHaveLength(2);
    const round0 = bracket[0]!;
    expect(round0).toHaveLength(2);
    const byes = round0.filter((m) => m.status === "bye");
    const ready = round0.filter((m) => m.status === "ready");
    expect(byes).toHaveLength(1);
    expect(ready).toHaveLength(1);
    // 부전승 매치는 winner 즉시 결정
    expect(byes[0]!.winnerId).toBeTruthy();
    expect(byes[0]!.p2Id).toBeNull();
  });

  it("N=5: 8슬롯, 부전승 3개", () => {
    const bracket = buildInitialBracket(
      ["a", "b", "c", "d", "e"],
      SEED,
    );
    expect(bracket).toHaveLength(3);
    const round0 = bracket[0]!;
    expect(round0).toHaveLength(4);
    const byes = round0.filter((m) => m.status === "bye");
    expect(byes).toHaveLength(3);
  });

  it("N=7: 8슬롯, 부전승 1개", () => {
    const bracket = buildInitialBracket(
      ["a", "b", "c", "d", "e", "f", "g"],
      SEED,
    );
    const round0 = bracket[0]!;
    const byes = round0.filter((m) => m.status === "bye");
    expect(byes).toHaveLength(1);
    expect(round0.filter((m) => m.status === "ready")).toHaveLength(3);
  });

  it("N=16: 4라운드, 부전승 없음", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
    const bracket = buildInitialBracket(ids, SEED);
    expect(bracket).toHaveLength(4);
    expect(bracket[0]!).toHaveLength(8);
    expect(bracket[1]!).toHaveLength(4);
    expect(bracket[2]!).toHaveLength(2);
    expect(bracket[3]!).toHaveLength(1);
  });

  it("N=1 은 거부", () => {
    expect(() => buildInitialBracket(["a"], SEED)).toThrow();
  });

  it("매치 ID 패턴이 일관됨", () => {
    const bracket = buildInitialBracket(
      ["a", "b", "c", "d", "e", "f", "g", "h"],
      SEED,
    );
    expect(bracket[0]![0]!.matchId).toBe("r0-m0");
    expect(bracket[0]![3]!.matchId).toBe("r0-m3");
    expect(bracket[1]![0]!.matchId).toBe("r1-m0");
    expect(bracket[2]![0]!.matchId).toBe("r2-m0");
  });

  it("모든 매치는 round/index 가 위치와 일치", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `p${i}`);
    const bracket = buildInitialBracket(ids, SEED);
    bracket.forEach((round, ri) => {
      round.forEach((m, mi) => {
        expect(m.round).toBe(ri);
        expect(m.index).toBe(mi);
      });
    });
  });
});

describe("propagateInitialByes", () => {
  it("N=3: bye winner 가 다음 라운드로 이동", () => {
    const bracket = buildInitialBracket(["a", "b", "c"], SEED);
    propagateInitialByes(bracket);
    const round1 = bracket[1]!;
    // round1.m0 의 p1Id 또는 p2Id 중 하나가 채워졌거나 양쪽 모두 (부전승 winner + ready 매치 결과 대기)
    const filled = (round1[0]!.p1Id ? 1 : 0) + (round1[0]!.p2Id ? 1 : 0);
    expect(filled).toBeGreaterThanOrEqual(1);
  });

  it("N=5: 3개 bye winner 가 round1 슬롯에 채워짐", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const bracket = buildInitialBracket(ids, SEED);
    propagateInitialByes(bracket);
    const round1 = bracket[1]!;
    const totalFilled = round1.reduce(
      (sum, m) => sum + (m.p1Id ? 1 : 0) + (m.p2Id ? 1 : 0),
      0,
    );
    expect(totalFilled).toBe(3);
  });
});

describe("propagateWinner", () => {
  it("4인 토너먼트 결승 진출", () => {
    const bracket = buildInitialBracket(["a", "b", "c", "d"], SEED);
    const m0 = bracket[0]![0]!;
    const m1 = bracket[0]![1]!;
    propagateWinner(bracket, 0, 0, m0.p1Id!);
    expect(bracket[1]![0]!.p1Id).toBe(m0.p1Id);
    expect(bracket[1]![0]!.status).toBe("pending");
    propagateWinner(bracket, 0, 1, m1.p2Id!);
    expect(bracket[1]![0]!.p2Id).toBe(m1.p2Id);
    expect(bracket[1]![0]!.status).toBe("ready");
  });

  it("8인 토너먼트 결승까지 propagation", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const bracket = buildInitialBracket(ids, SEED);
    // 첫 라운드 모두 p1 승리로
    bracket[0]!.forEach((m, i) => {
      propagateWinner(bracket, 0, i, m.p1Id!);
    });
    // 둘째 라운드 2 매치가 ready
    bracket[1]!.forEach((m) => expect(m.status).toBe("ready"));
    // 둘째 라운드 모두 p1 승리
    bracket[1]!.forEach((m, i) => {
      propagateWinner(bracket, 1, i, m.p1Id!);
    });
    expect(bracket[2]![0]!.status).toBe("ready");
    propagateWinner(bracket, 2, 0, bracket[2]![0]!.p1Id!);
    expect(bracket[2]![0]!.winnerId).toBeNull(); // propagateWinner 는 다음 매치만 채움
    // 결승 winner 직접 set 후 champion 검사
    bracket[2]![0]!.winnerId = bracket[2]![0]!.p1Id;
    expect(getChampion(bracket)).toBe(bracket[2]![0]!.p1Id);
  });

  it("결승 매치에서 propagate 호출은 null 반환", () => {
    const bracket = buildInitialBracket(["a", "b"], SEED);
    const result = propagateWinner(bracket, 0, 0, "a");
    expect(result).toBeNull();
  });
});

describe("getChampion", () => {
  it("결승 winner 가 없으면 null", () => {
    const bracket = buildInitialBracket(["a", "b"], SEED);
    expect(getChampion(bracket)).toBeNull();
  });

  it("결승 winner 가 있으면 그 ID", () => {
    const bracket = buildInitialBracket(["a", "b"], SEED);
    bracket[0]![0]!.winnerId = "a";
    expect(getChampion(bracket)).toBe("a");
  });
});
