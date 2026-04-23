/**
 * PartyKit 클라이언트 래퍼. 메시지 파싱 + 리스너 디스패치.
 */

import { PartySocket } from "partysocket";
import { ClientMsg, ServerMsg } from "./protocol";

type Listener = (msg: ServerMsg) => void;

export class AllinClient {
  private socket: PartySocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(status: "open" | "close" | "error") => void>();

  constructor(
    private readonly host: string,
    private readonly roomId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new PartySocket({
        host: this.host,
        room: this.roomId,
      });
      this.socket = ws;
      ws.addEventListener("message", (e: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(e.data) as ServerMsg;
          for (const l of this.listeners) l(msg);
        } catch (err) {
          console.error("bad msg:", e.data, err);
        }
      });
      ws.addEventListener("open", () => {
        for (const l of this.statusListeners) l("open");
        resolve();
      });
      ws.addEventListener("close", () => {
        for (const l of this.statusListeners) l("close");
      });
      ws.addEventListener("error", (err) => {
        for (const l of this.statusListeners) l("error");
        reject(err);
      });
    });
  }

  send(msg: ClientMsg) {
    if (!this.socket) throw new Error("not connected");
    this.socket.send(JSON.stringify(msg));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (s: "open" | "close" | "error") => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
  }
}

export function getPartyHost(): string {
  // 1) 명시적 환경변수 우선 (Vercel 등 분리 배포 대비)
  const envHost = import.meta.env.VITE_PARTYKIT_HOST;
  if (envHost) return envHost;
  // 2) 프로덕션 빌드는 같은 도메인에서 서빙된다고 가정 (PartyKit `serve: "./dist"`)
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return window.location.host;
  }
  // 3) 로컬 dev 기본값 — `partykit dev` 포트
  return "127.0.0.1:1999";
}

export function generateRoomCode(length = 6): string {
  const alphabet = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/1/O/I 제외
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
