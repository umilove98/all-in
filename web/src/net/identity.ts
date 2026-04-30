/**
 * Persistent participantId — 토너먼트 참가자 식별자.
 *
 * WebSocket 의 connectionId 는 연결 단위로 매번 새로 발급되므로
 * 새로고침/재접속 시 같은 사람으로 인식되지 않는다. 토너먼트는
 * 매치 사이에 들락날락하는 게 자연스러워 persistent 식별자가 필요.
 *
 * localStorage 비활성(Safari private 등) 시 메모리상 임시 UUID 로 폴백.
 */

const STORAGE_KEY = "allin.participantId";

let memoryFallback: string | null = null;

export function getOrCreateParticipantId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = randomUuid();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    if (!memoryFallback) memoryFallback = randomUuid();
    return memoryFallback;
  }
}

function randomUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // 폴백 — RFC4122 v4 비슷한 형태 (실제 랜덤성은 Math.random 한계).
  // 1차에서는 식별 충돌만 안 나면 충분.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
