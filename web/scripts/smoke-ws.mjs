#!/usr/bin/env node
/**
 * PartyKit 서버 스모크 테스트.
 * 두 명 접속 → join → 연결 해제 흐름 검증.
 */
import { WebSocket } from "partysocket";

const HOST = process.env.HOST || "127.0.0.1:1999";
const ROOM = "smoke-" + Date.now();

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${HOST}/parties/main/${ROOM}`);
    const received = [];
    ws.addEventListener("open", () => {
      console.log(`[${label}] open`);
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      received.push(msg);
      console.log(`[${label}] recv:`, msg);
    });
    ws.addEventListener("close", () => {
      console.log(`[${label}] close`);
    });
    ws.addEventListener("error", (e) => {
      console.error(`[${label}] error`, e.message);
    });
    setTimeout(() => resolve({ ws, received }), 300);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const a = await connect("A");
  a.ws.send(JSON.stringify({ type: "join", name: "Alice" }));
  await sleep(200);

  const b = await connect("B");
  b.ws.send(JSON.stringify({ type: "join", name: "Bob" }));
  await sleep(300);

  // A 가 떠남
  a.ws.close();
  await sleep(300);

  // 검증
  const aRoomMsgs = a.received.filter((m) => m.type === "room");
  const bRoomMsgs = b.received.filter((m) => m.type === "room");
  const aConnected = a.received.find((m) => m.type === "connected");
  const bConnected = b.received.find((m) => m.type === "connected");
  console.log("---");
  console.log("A connected msg:", aConnected?.connectionId ? "OK" : "FAIL");
  console.log("B connected msg:", bConnected?.connectionId ? "OK" : "FAIL");
  console.log("A room msgs count:", aRoomMsgs.length);
  console.log("B room msgs count:", bRoomMsgs.length);
  const finalB = bRoomMsgs[bRoomMsgs.length - 1];
  console.log(
    "After A leaves, B sees players:",
    finalB?.players?.map((p) => p.name),
  );

  b.ws.close();
  process.exit(0);
})();
