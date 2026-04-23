/**
 * Cloudflare Workers entry — 라우터 역할.
 *
 *   /parties/<anything>/<roomId>  → Room Durable Object
 *   그 외                          → 정적 에셋 (Vite dist/)
 *
 * `partysocket` 클라이언트는 기본적으로 `wss://{host}/parties/main/{room}` 형식으로
 * 접속하므로 위 패턴과 일치. 두 번째 세그먼트(party 이름) 는 무엇이든 허용.
 */

export { Room } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const ROOM_ROUTE = /^\/parties\/[^/]+\/([^/]+)\/?$/;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const match = ROOM_ROUTE.exec(url.pathname);
    if (match) {
      const roomId = match[1]!.toUpperCase();
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }
    // 정적 에셋 (SPA fallback 포함)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
