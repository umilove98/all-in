/**
 * Cloudflare Workers entry — 라우터 역할.
 *
 *   /parties/tournament/<TID>     → TournamentRoom Durable Object
 *   /parties/<anything>/<roomId>  → Room Durable Object (1:1 빠른 매치)
 *   그 외                          → 정적 에셋 (Vite dist/)
 *
 * `partysocket` 클라이언트는 기본적으로 `wss://{host}/parties/main/{room}` 형식.
 * 토너먼트 클라는 party 이름을 "tournament" 로 지정해 토너먼트 DO 로 라우팅됨.
 */

export { Room } from "./room";
export { TournamentRoom } from "./tournament-room";

export interface Env {
  ROOMS: DurableObjectNamespace;
  TOURNAMENTS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const TOURNAMENT_ROUTE = /^\/parties\/tournament\/([^/]+)\/?$/;
const ROOM_ROUTE = /^\/parties\/[^/]+\/([^/]+)\/?$/;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    const tMatch = TOURNAMENT_ROUTE.exec(url.pathname);
    if (tMatch) {
      const tournamentId = tMatch[1]!.toUpperCase();
      const id = env.TOURNAMENTS.idFromName(tournamentId);
      const stub = env.TOURNAMENTS.get(id);
      return stub.fetch(request);
    }

    const rMatch = ROOM_ROUTE.exec(url.pathname);
    if (rMatch) {
      const roomId = rMatch[1]!.toUpperCase();
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    // 정적 에셋 (SPA fallback 포함)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
