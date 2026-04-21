/**
 * Seedable RNG (Mulberry32). Python `random.Random` 대체.
 * 알고리즘은 Python 과 다르므로 cross-runtime 일치는 기대하지 말 것.
 * 동일 seed 로 같은 런타임에서 반복 실행 시에만 결정론적.
 */

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** 정수 [a, b] (양쪽 포함) — Python random.randint 호환 */
  randint(a: number, b: number): number;
  /** Fisher-Yates in-place */
  shuffle<T>(arr: T[]): void;
  /** 배열에서 하나 선택 */
  choice<T>(arr: T[]): T;
  /** 중복 없이 n 개 샘플링 */
  sample<T>(arr: T[], n: number): T[];
}

export function createRng(seed: number | null = null): Rng {
  let state =
    seed ?? Math.floor(Math.random() * 0xffffffff);

  const rawNext = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next: rawNext,
    randint(a: number, b: number): number {
      return Math.floor(rawNext() * (b - a + 1)) + a;
    },
    shuffle<T>(arr: T[]): void {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rawNext() * (i + 1));
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
    },
    choice<T>(arr: T[]): T {
      if (arr.length === 0) throw new Error("choice() from empty sequence");
      return arr[Math.floor(rawNext() * arr.length)]!;
    },
    sample<T>(arr: T[], n: number): T[] {
      if (n > arr.length) throw new Error("sample n > arr.length");
      const copy = [...arr];
      this.shuffle(copy);
      return copy.slice(0, n);
    },
  };
  return rng;
}

/** 항상 `a` 를 반환하는 테스트용 RNG (명중/크리 굴림 = 성공측). */
export function alwaysMinRng(): Rng {
  return {
    next: () => 0,
    randint: (a: number, _b: number) => a,
    shuffle<T>(_arr: T[]): void {
      /* no-op: 셔플 안 함 → 결정론 */
    },
    choice<T>(arr: T[]): T {
      return arr[0]!;
    },
    sample<T>(arr: T[], n: number): T[] {
      return arr.slice(0, n);
    },
  };
}

/** 항상 `b` 를 반환하는 테스트용 RNG (명중/크리 굴림 = 실패측). */
export function alwaysMaxRng(): Rng {
  return {
    next: () => 1 - Number.EPSILON,
    randint: (_a: number, b: number) => b,
    shuffle<T>(_arr: T[]): void {
      /* no-op */
    },
    choice<T>(arr: T[]): T {
      return arr[arr.length - 1]!;
    },
    sample<T>(arr: T[], n: number): T[] {
      return arr.slice(arr.length - n);
    },
  };
}

/** `randint` 가 항상 지정 값을 반환 (미세 조정용). */
export function fixedRandintRng(value: number): Rng {
  return {
    next: () => 0,
    randint: () => value,
    shuffle<T>(_arr: T[]): void {
      /* no-op */
    },
    choice<T>(arr: T[]): T {
      return arr[0]!;
    },
    sample<T>(arr: T[], n: number): T[] {
      return arr.slice(0, n);
    },
  };
}
