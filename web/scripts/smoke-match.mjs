#!/usr/bin/env node
/**
 * W7 검증: 두 명 접속 → coin_toss → pick_class(미러 금지) → pick_boon → battle 진입.
 */
import { WebSocket } from "partysocket";

const HOST = process.env.HOST || "127.0.0.1:1999";
const ROOM = "match-" + Date.now();

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HOST}/parties/main/${ROOM}`);
    const state = {
      ws,
      label,
      received: [],
      phase: null,
      firstPickId: null,
      myId: null,
      boonOptions: null,
    };
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      state.received.push(msg);
      if (msg.type === "connected") state.myId = msg.connectionId;
      if (msg.type === "room") {
        state.phase = msg.phase;
        state.firstPickId = msg.firstPickId;
      }
      if (msg.type === "coin_toss") state.firstPickId = msg.firstPickId;
      if (msg.type === "boon_options") state.boonOptions = msg.options;
    });
    ws.addEventListener("open", () => setTimeout(() => resolve(state), 200));
    ws.addEventListener("error", (e) =>
      console.error(`[${label}] error`, e.message),
    );
  });
}

function send(state, msg) {
  state.ws.send(JSON.stringify(msg));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lastRoom(state) {
  return [...state.received].reverse().find((m) => m.type === "room");
}

(async () => {
  const a = await connect("A");
  const b = await connect("B");

  send(a, { type: "join", name: "Alice" });
  send(b, { type: "join", name: "Bob" });
  await sleep(400);

  console.log("---- after join ----");
  console.log("A phase:", a.phase, "firstPick:", a.firstPickId);
  console.log("B phase:", b.phase, "firstPick:", b.firstPickId);
  if (a.phase !== "pick_class" || !a.firstPickId) {
    console.error("FAIL: coin_toss did not transition to pick_class");
    process.exit(1);
  }

  // 선픽/후픽 식별
  const first = a.myId === a.firstPickId ? a : b;
  const second = first === a ? b : a;
  console.log("first pick =", first.label, "second pick =", second.label);

  // 선픽: berserker
  send(first, { type: "pick_class", className: "berserker" });
  await sleep(200);

  // 후픽이 berserker 시도 → error
  send(second, { type: "pick_class", className: "berserker" });
  await sleep(200);
  const mirrorErr = second.received.find(
    (m) => m.type === "error" && m.message.includes("미러"),
  );
  console.log("mirror rejected:", mirrorErr ? "OK" : "FAIL");

  // 후픽: warden
  send(second, { type: "pick_class", className: "warden" });
  await sleep(400);

  console.log("---- after pick_class ----");
  console.log("A phase:", lastRoom(a)?.phase);
  console.log("B phase:", lastRoom(b)?.phase);
  console.log("A boon options:", a.boonOptions);
  console.log("B boon options:", b.boonOptions);

  if (lastRoom(a)?.phase !== "pick_boon") {
    console.error("FAIL: did not transition to pick_boon");
    process.exit(1);
  }

  // 각자 첫 번째 부운 선택
  send(a, { type: "pick_boon", boonId: a.boonOptions[0] });
  send(b, { type: "pick_boon", boonId: b.boonOptions[0] });
  await sleep(400);

  console.log("---- after pick_boon ----");
  const aRoom = lastRoom(a);
  console.log("A phase:", aRoom?.phase);
  console.log("A players:");
  for (const p of aRoom.players) {
    console.log(`  ${p.name}: class=${p.className}, boon=${p.boonId}, hp=${p.hp}/${p.maxHp}`);
  }
  if (aRoom?.phase !== "battle") {
    console.error("FAIL: did not transition to battle");
    process.exit(1);
  }

  console.log("✅ W7 매치 시퀀스 통과");
  a.ws.close();
  b.ws.close();
  process.exit(0);
})();
