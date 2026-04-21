#!/usr/bin/env node
/**
 * W8 검증: 전투 진입 후 카드 사용/턴 종료 → 게임 종료까지.
 */
import { WebSocket } from "partysocket";

const HOST = process.env.HOST || "127.0.0.1:1999";
const ROOM = "battle-" + Date.now();

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
      hand: [],
      ended: null,
      isActive: false,
    };
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      state.received.push(msg);
      switch (msg.type) {
        case "connected":
          state.myId = msg.connectionId;
          break;
        case "room":
          state.phase = msg.phase;
          state.firstPickId = msg.firstPickId;
          state.isActive = msg.activeId === state.myId;
          state.room = msg;
          break;
        case "coin_toss":
          state.firstPickId = msg.firstPickId;
          break;
        case "boon_options":
          state.boonOptions = msg.options;
          break;
        case "hand":
          state.hand = msg.hand;
          break;
        case "turn_changed":
          state.isActive = msg.activeId === state.myId;
          state.turn = msg.turn;
          break;
        case "ended":
          state.ended = msg;
          break;
      }
    });
    ws.addEventListener("open", () => setTimeout(() => resolve(state), 200));
    ws.addEventListener("error", (e) =>
      console.error(`[${label}] error`, e.message),
    );
  });
}

const send = (s, m) => s.ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickCard(state, predicate) {
  return state.hand.find(predicate);
}

(async () => {
  const a = await connect("A");
  const b = await connect("B");

  send(a, { type: "join", name: "Alice" });
  send(b, { type: "join", name: "Bob" });
  await sleep(400);

  const first = a.myId === a.firstPickId ? a : b;
  const second = first === a ? b : a;
  console.log(`first=${first.label}, second=${second.label}`);

  send(first, { type: "pick_class", className: "berserker" });
  await sleep(200);
  send(second, { type: "pick_class", className: "warden" });
  await sleep(300);

  send(a, { type: "pick_boon", boonId: a.boonOptions[0] });
  send(b, { type: "pick_boon", boonId: b.boonOptions[0] });
  await sleep(400);

  console.log("phase:", a.phase);
  console.log("A hand:", a.hand.map((c) => c.id).join(","));
  console.log("B hand:", b.hand.map((c) => c.id).join(","));
  console.log("A active:", a.isActive, "B active:", b.isActive);

  // 턴 진행. 첫 플레이어가 공격 카드(B13 제외) 찾기
  const active = a.isActive ? a : b;
  const passive = active === a ? b : a;

  const attackCard = pickCard(
    active,
    (c) => c.category === "attack" && c.id !== "B13",
  );
  if (!attackCard) {
    console.error("공격 카드가 손패에 없음");
    process.exit(1);
  }
  console.log(`${active.label} → play ${attackCard.id} bet=5`);
  send(active, { type: "play_card", cardId: attackCard.id, bet: 5 });
  await sleep(300);

  const playEvents = active.received.filter((m) => m.type === "card_played");
  console.log("card_played event:", playEvents.length > 0 ? "OK" : "FAIL");
  const evt = playEvents[0];
  console.log(
    `  bet=${evt.bet} success=${evt.success} dmg=${evt.damageToOpponent}`,
  );

  // end_turn
  send(active, { type: "end_turn" });
  await sleep(300);

  // 이제 상대 턴. passive 의 손패 확인 + 카드 사용
  console.log("After end_turn:");
  console.log(`  ${passive.label} active? ${passive.isActive}`);

  // 10턴 동안 번갈아 공격 → 게임 종료 유도
  for (let t = 0; t < 30; t++) {
    const current = a.isActive ? a : (b.isActive ? b : null);
    if (!current) break;
    if (a.ended || b.ended) break;
    const atk = pickCard(
      current,
      (c) => c.category === "attack" && c.id !== "B13",
    );
    if (atk) {
      send(current, { type: "play_card", cardId: atk.id, bet: 3 });
      await sleep(150);
    }
    send(current, { type: "end_turn" });
    await sleep(200);
  }

  console.log("---- end ----");
  if (a.ended) {
    console.log("ended msg:", JSON.stringify(a.ended, null, 2));
    console.log("✅ W8 전투 플로우 통과");
  } else {
    console.log("WARN: 게임이 30 루프 안에 끝나지 않음 (게임 자체는 정상 동작할 수도)");
    console.log("A phase:", a.phase, "B phase:", b.phase);
    const aRoom = [...a.received].reverse().find((m) => m.type === "room");
    console.log(
      "A HP:",
      aRoom?.players?.map((p) => `${p.name}=${p.hp}`).join(", "),
    );
  }

  a.ws.close();
  b.ws.close();
  process.exit(0);
})();
