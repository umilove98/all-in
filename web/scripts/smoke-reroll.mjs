#!/usr/bin/env node
/**
 * 도박사 리롤 패시브 검증.
 */
import { WebSocket } from "partysocket";

const HOST = process.env.HOST || "127.0.0.1:1999";
const ROOM = "reroll-" + Date.now();

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HOST}/parties/main/${ROOM}`);
    const st = { ws, label, received: [], myId: null, room: null, opts: null };
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      st.received.push(msg);
      if (msg.type === "connected") st.myId = msg.connectionId;
      if (msg.type === "room") st.room = msg;
      if (msg.type === "boon_options") st.opts = msg.options;
    });
    ws.addEventListener("open", () => setTimeout(() => resolve(st), 200));
  });
}
const send = (s, m) => s.ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findMe = (st) => st.room.players.find((p) => p.connectionId === st.myId);

(async () => {
  const a = await connect("A");
  const b = await connect("B");
  send(a, { type: "join", name: "Alice" });
  send(b, { type: "join", name: "Bob" });
  await sleep(400);

  // 도박사를 A 로 강제하기 위해: A 가 선픽이면 A 가 gambler 픽. 후픽이면 A 가 gambler 픽 가능 (미러 아님 보장)
  const firstPickId = a.room.firstPickId;
  const gamblerSide = firstPickId === a.myId ? a : b;
  const otherSide = gamblerSide === a ? b : a;

  send(gamblerSide, { type: "pick_class", className: "gambler" });
  await sleep(200);
  send(otherSide, { type: "pick_class", className: "warden" });
  await sleep(300);

  console.log("=== 초기 부운 옵션 ===");
  console.log("gambler opts:", gamblerSide.opts);
  console.log("warden  opts:", otherSide.opts);
  console.log("gambler rerollsLeft:", findMe(gamblerSide).boonRerollsLeft);
  console.log("warden  rerollsLeft:", findMe(otherSide).boonRerollsLeft);

  const beforeOpts = [...gamblerSide.opts];

  // 리롤 시도
  send(gamblerSide, { type: "reroll_boon" });
  await sleep(300);

  console.log("=== 리롤 후 ===");
  console.log("gambler opts:", gamblerSide.opts);
  console.log("gambler rerollsLeft:", findMe(gamblerSide).boonRerollsLeft);
  const afterOpts = gamblerSide.opts;
  console.log("opts changed:", JSON.stringify(beforeOpts) !== JSON.stringify(afterOpts));

  // 두 번째 리롤은 거부되어야
  send(gamblerSide, { type: "reroll_boon" });
  await sleep(200);
  const err2 = gamblerSide.received.find(
    (m) => m.type === "error" && /리롤.*남아있지 않/.test(m.message),
  );
  console.log("second reroll rejected:", err2 ? "OK" : "FAIL");

  // 워든은 리롤 불가
  send(otherSide, { type: "reroll_boon" });
  await sleep(200);
  const err3 = otherSide.received.find(
    (m) => m.type === "error" && /도박사/.test(m.message),
  );
  console.log("non-gambler reroll rejected:", err3 ? "OK" : "FAIL");

  a.ws.close();
  b.ws.close();
  process.exit(0);
})();
