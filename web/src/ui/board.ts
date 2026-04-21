/**
 * 게임 보드. 상대/내 정보 + 손패 + 베팅 UX + 최근 이벤트.
 * phase=battle 때 활성화. phase=ended 면 종료 화면(endgame.ts) 으로.
 */

import { App } from "../app";
import {
  Card,
  CardType,
  ClassName,
  KEYWORD_GLOSSARY,
  KeywordChip,
  KeywordKey,
  displayType,
  getBoonById,
  getCardById,
} from "../engine";
import { CardPlayedMsg, PlayerPublic } from "../net/protocol";

export function renderBoard(root: HTMLElement, app: App): void {
  const s = app.state;
  const me = s.players.find((p) => p.connectionId === s.myId);
  const opp = s.players.find((p) => p.connectionId !== s.myId);
  if (!me || !opp) {
    root.innerHTML = `<div class="card"><p class="muted">플레이어 정보 로딩 중…</p></div>`;
    return;
  }

  // 종료 화면
  if (s.phase === "ended" && s.endedInfo) {
    renderEndgame(root, app, me, opp);
    return;
  }

  const isMyTurn = s.activeId === s.myId;
  const inputLocked = s.isAnimating;
  const canPlayCard = isMyTurn && !inputLocked;
  const selectedCard =
    s.selectedCardId ? s.hand.find((c) => c.id === s.selectedCardId) ?? null : null;

  root.innerHTML = `
    <div class="board">
      <div class="hud hud-top-left">
        ${renderDeckGraveBadge(opp, "상대")}
      </div>
      <div class="hud hud-top-center">
        <div class="turn-indicator ${isMyTurn ? "mine" : ""}">
          Turn ${s.turn} · ${isMyTurn ? "내 턴" : `${escapeHtmlStr(opp.name)} 의 턴`}
        </div>
      </div>
      <div class="hud hud-bottom-right">
        ${renderDeckGraveBadge(me, "내")}
      </div>

      ${renderPlayerPanel(opp, s.myId, false, s)}

      ${renderOpponentHand(opp.handCount)}

      <div class="board-center field-zone" id="field-zone">
        <div class="field-prompt ${canPlayCard ? "" : "dim"}">
          ${canPlayCard ? "🂠 손패의 카드를 이곳으로 드래그" : "상대 턴…"}
        </div>
      </div>

      ${renderHand(me, s.hand, canPlayCard, app)}

      ${renderPlayerPanel(me, s.myId, true, s)}

      <div class="board-actions">
        <button id="end-turn" ${!canPlayCard ? "disabled" : ""}>턴 종료</button>
        <button id="show-glossary" class="muted-btn" title="키워드 사전">? 키워드</button>
        <button id="leave" class="muted-btn">방 나가기</button>
      </div>

      ${
        selectedCard
          ? renderBettingPanel(selectedCard, me, s.pendingBet, app, inputLocked)
          : ""
      }

      ${s.showGlossary ? renderGlossaryModal() : ""}
      ${renderToasts(s.toasts)}
      ${renderEventOverlay(s, me, opp)}
    </div>
  `;

  attachHandInteractions(root, app, canPlayCard);
  attachFieldDropzone(root, app, canPlayCard);

  // 베팅 1~10 버튼 — 각 버튼은 1회 렌더만 트리거 (슬라이더 디바운싱 회피)
  root.querySelectorAll<HTMLButtonElement>(".bet-btn").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.disabled) return;
      const v = parseInt(el.getAttribute("data-bet") ?? "0", 10);
      if (Number.isNaN(v)) return;
      app.state.pendingBet = v;
      app.render();
    });
  });

  root.querySelector<HTMLButtonElement>("#confirm-play")?.addEventListener(
    "click",
    () => {
      const card = selectedCard;
      if (!card) return;
      app.state.client!.send({
        type: "play_card",
        cardId: card.id,
        bet: app.state.pendingBet,
      });
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    },
  );
  root.querySelector<HTMLButtonElement>("#cancel-play")?.addEventListener(
    "click",
    () => {
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    },
  );

  root.querySelector<HTMLButtonElement>("#end-turn")?.addEventListener(
    "click",
    () => {
      if (!canPlayCard) return;
      app.state.client!.send({ type: "end_turn" });
    },
  );

  root.querySelector<HTMLButtonElement>("#leave")?.addEventListener(
    "click",
    () => {
      if (confirm("정말 방을 나가시겠습니까? 게임이 리셋됩니다.")) {
        app.navigateHome();
      }
    },
  );

  root.querySelector<HTMLButtonElement>("#show-glossary")?.addEventListener(
    "click",
    () => {
      app.state.showGlossary = true;
      app.render();
    },
  );
  root.querySelector<HTMLButtonElement>("#close-glossary")?.addEventListener(
    "click",
    () => {
      app.state.showGlossary = false;
      app.render();
    },
  );
  root.querySelector<HTMLElement>(".glossary-overlay")?.addEventListener(
    "click",
    (e) => {
      if ((e.target as HTMLElement).classList.contains("glossary-overlay")) {
        app.state.showGlossary = false;
        app.render();
      }
    },
  );

  ensureCssInjected();
}

// =====================================================================
// 손패 ↔ 필드 드래그 앤 드롭
// =====================================================================

function attachHandInteractions(
  root: HTMLElement,
  app: App,
  canPlayCard: boolean,
): void {
  const silenced = new Set(app.state.silencedCardIds);
  root.querySelectorAll<HTMLElement>(".hand-card").forEach((el) => {
    const cardId = el.getAttribute("data-card")!;
    const isSilenced = silenced.has(cardId);

    // 클릭 폴백 (모바일/접근성).
    el.addEventListener("click", () => {
      if (!canPlayCard || isSilenced) return;
      app.state.selectedCardId = cardId;
      app.state.pendingBet = 0;
      app.render();
    });

    if (!canPlayCard || isSilenced) return;

    // HTML5 Drag & Drop
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", cardId);
      }
      el.classList.add("dragging");
      document.body.classList.add("card-dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      document.body.classList.remove("card-dragging");
      root
        .querySelector("#field-zone")
        ?.classList.remove("drop-hover");
    });
  });
}

function attachFieldDropzone(
  root: HTMLElement,
  app: App,
  canPlayCard: boolean,
): void {
  const zone = root.querySelector<HTMLElement>("#field-zone");
  if (!zone || !canPlayCard) return;

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dt = (e as DragEvent).dataTransfer;
    if (dt) dt.dropEffect = "move";
    zone.classList.add("drop-hover");
  });
  zone.addEventListener("dragleave", (e) => {
    // 자식 요소 사이 이동 시 false positive 방지
    if (e.target === zone) zone.classList.remove("drop-hover");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drop-hover");
    const cardId = (e as DragEvent).dataTransfer?.getData("text/plain");
    if (!cardId) return;
    onCardDropped(app, cardId);
  });
}

function onCardDropped(app: App, cardId: string): void {
  const card = app.state.hand.find((c) => c.id === cardId);
  if (!card) return;
  const me = app.state.players.find(
    (p) => p.connectionId === app.state.myId,
  );
  if (!me) return;

  // 베팅 가능 캡 계산 — 0 이면 즉시 발동, 아니면 베팅 패널 표시.
  const baseCap = card.maxBet;
  const hpMinus1 = Math.max(0, me.hp - 1);
  const override = me.statuses.betCapOverride;
  const cap = Math.min(baseCap, hpMinus1, override ?? baseCap);

  if (cap === 0) {
    app.state.client!.send({ type: "play_card", cardId, bet: 0 });
    app.state.selectedCardId = null;
    app.state.pendingBet = 0;
    app.render();
    return;
  }

  // 베팅 필요 — 오버레이 패널 띄움
  app.state.selectedCardId = cardId;
  app.state.pendingBet = 0;
  app.render();
}

// =====================================================================
// 플레이어 패널
// =====================================================================

function renderPlayerPanel(
  p: PlayerPublic,
  myId: string | null,
  isSelf: boolean,
  s: App["state"],
): string {
  const you = p.connectionId === myId ? " (나)" : "";
  const hpPct = (p.hp / p.maxHp) * 100;
  const hpColor =
    hpPct > 70 ? "var(--ok)" : hpPct > 30 ? "var(--warn)" : "var(--accent)";
  const boon = p.boonId ? getBoonById(p.boonId) : null;
  const st = p.statuses;
  const statuses: string[] = [];
  if (st.poisonTurns > 0) statuses.push(`☠ 독 ${st.poisonTurns}턴`);
  if (st.rageStacks > 0) statuses.push(`🔥 분노 x${st.rageStacks}`);
  if (st.berserkTurns > 0) statuses.push(`⚡ 베르세르크 ${st.berserkTurns}`);
  if (st.incomingDamageMult < 1) statuses.push(`🛡️ 무효선언`);
  if (st.betCapOverride !== null) statuses.push(`⛓ 베팅 ≤${st.betCapOverride}`);

  const isShaking = s.hpShake === p.connectionId;
  const floats = s.damageFloats.filter((f) => f.targetId === p.connectionId);

  const classLabel = classText(p.className);
  return `
    <div class="player-panel ${isSelf ? "self" : "opp"} ${isShaking ? "shake" : ""}">
      <div class="player-row">
        <span class="player-name">
          ${classLabel ? `<span class="class-tag">(${classLabel})</span> ` : ""}${escapeHtmlStr(p.name)}${you}
        </span>
        ${
          boon
            ? `<span class="boon-pill" tabindex="0">
                ${escapeHtmlStr(boon.name)}
                <span class="tooltip">${escapeHtmlStr(boon.desc)}</span>
              </span>`
            : ""
        }
      </div>
      <div class="hp-bar">
        <div class="hp-fill" style="width:${hpPct}%; background:${hpColor}"></div>
        <span class="hp-text">${p.hp} / ${p.maxHp}${p.shield ? `  🛡 ${p.shield}` : ""}</span>
        ${floats
          .map(
            (f) => `
              <div class="damage-float damage-${f.kind} ${f.critical ? "crit" : ""}" data-id="${f.id}">
                ${f.kind === "heal" ? "+" : f.kind === "dmg" ? "-" : "자해 -"}${f.amount}${f.critical ? " ⚡" : ""}
              </div>
            `,
          )
          .join("")}
      </div>
      ${
        statuses.length > 0
          ? `<div class="player-meta muted">${statuses.join(" · ")}</div>`
          : ""
      }
    </div>
  `;
}

function classText(cn: ClassName | null): string {
  switch (cn) {
    case "berserker":
      return "광전사";
    case "gambler":
      return "도박꾼";
    case "warden":
      return "수호자";
    default:
      return "";
  }
}

// =====================================================================
// HUD: 덱/묘지 카운터 + 상대 손패(뒷면) + 토스트
// =====================================================================

function renderDeckGraveBadge(p: PlayerPublic, label: string): string {
  return `
    <div class="dg-badge" title="${escapeHtmlStr(label)} 덱 / 묘지">
      <div class="dg-row">
        <span class="dg-icon">🂠</span>
        <span class="dg-label">덱</span>
        <span class="dg-count">${p.deckCount}</span>
      </div>
      <div class="dg-row">
        <span class="dg-icon">⚰</span>
        <span class="dg-label">묘지</span>
        <span class="dg-count">${p.graveyardCount}</span>
      </div>
    </div>
  `;
}

function renderOpponentHand(handCount: number): string {
  if (handCount <= 0) {
    return `<div class="opp-hand empty muted">상대 손패 없음</div>`;
  }
  const cards = Array.from({ length: handCount })
    .map(() => `<div class="opp-card"><div class="opp-card-pattern"></div></div>`)
    .join("");
  return `<div class="opp-hand"><div class="opp-hand-row">${cards}</div></div>`;
}

function renderGlossaryModal(): string {
  const entries = (Object.entries(KEYWORD_GLOSSARY) as Array<
    [KeywordKey, (typeof KEYWORD_GLOSSARY)[KeywordKey]]
  >).sort(([, a], [, b]) => a.flavor.localeCompare(b.flavor));
  return `
    <div class="glossary-overlay">
      <div class="glossary-panel">
        <div class="glossary-head">
          <h3>키워드 사전</h3>
          <button id="close-glossary" class="muted-btn">닫기</button>
        </div>
        <div class="glossary-body">
          ${entries
            .map(
              ([_k, g]) => `
            <div class="glossary-row">
              <span class="kw-chip kw-${g.flavor}">${escapeHtmlStr(g.name)}</span>
              <span class="glossary-desc muted">${escapeHtmlStr(g.desc)}</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderToasts(
  toasts: Array<{ id: number; kind: string; text: string }>,
): string {
  if (toasts.length === 0) return "";
  return `
    <div class="toast-stack">
      ${toasts
        .map(
          (t) => `
        <div class="toast toast-${escapeHtmlStr(t.kind)}">
          ${escapeHtmlStr(t.text)}
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

// =====================================================================
// 최근 이벤트 로그 + 하이라이트
// =====================================================================

function renderEventOverlay(
  s: App["state"],
  me: PlayerPublic,
  opp: PlayerPublic,
): string {
  const evt = s.currentEvent;
  if (!evt) return "";
  const isMine = evt.by === me.connectionId;
  const actorName = isMine ? "나" : opp.name;
  const cardLabel = evt.cardName;
  const isSignature = ["B14", "B15", "G14", "G15", "W14", "W15"].includes(
    evt.cardId,
  );

  if (s.currentEventPhase === "rolling") {
    // 잭팟 전용
    if (evt.cardId === "G4") {
      return `
        <div class="fx-overlay ${isSignature ? "fx-signature" : ""}">
          <div class="fx-actor">${escapeHtmlStr(actorName)} — 🎰 잭팟</div>
          <div class="fx-jackpot-dice">${s.currentEventJackpotShown ?? "?"}</div>
          <div class="fx-subtitle muted">1d10 + 베팅/2</div>
        </div>
      `;
    }
    // 일반: 룰렛
    const typeLabel = betOrTypeLabel(evt);
    const caster = s.players.find((p) => p.connectionId === evt.by);
    const roulette = renderRoulette(evt, caster);
    return `
      <div class="fx-overlay ${isSignature ? "fx-signature" : ""}">
        <div class="fx-actor">${escapeHtmlStr(actorName)}</div>
        <div class="fx-card">${isSignature ? "⚡ " : ""}${escapeHtmlStr(cardLabel)}</div>
        ${roulette}
        <div class="fx-subtitle muted">${typeLabel}</div>
      </div>
    `;
  }

  // Result phase
  let label: string;
  let kind: string;
  if (evt.cardId === "G4") {
    if (evt.damageToSelf > 0) {
      label = `잭팟 ${s.currentEventJackpotShown} — 자해 ${evt.damageToSelf}`;
      kind = "self";
    } else if (evt.damageToOpponent > 0) {
      label = `잭팟 ${s.currentEventJackpotShown} — ${evt.damageToOpponent}뎀!`;
      kind = s.currentEventJackpotShown === 10 ? "crit" : "hit";
    } else {
      label = `잭팟 ${s.currentEventJackpotShown}`;
      kind = "miss";
    }
  } else if (evt.critical) {
    label = `⚡ CRITICAL — ${evt.damageToOpponent}`;
    kind = "crit";
  } else if (evt.success) {
    if (evt.damageToOpponent > 0) {
      label = `HIT — ${evt.damageToOpponent}`;
      kind = "hit";
    } else if (evt.heal > 0) {
      label = `회복 +${evt.heal}`;
      kind = "heal";
    } else if (evt.shieldGained > 0) {
      label = `🛡 +${evt.shieldGained}`;
      kind = "shield";
    } else {
      label = "발동";
      kind = "hit";
    }
  } else {
    label = "MISS";
    kind = "miss";
  }

  return `
    <div class="fx-overlay ${isSignature ? "fx-signature" : ""}">
      <div class="fx-actor">${escapeHtmlStr(actorName)}</div>
      <div class="fx-card">${isSignature ? "⚡ " : ""}${escapeHtmlStr(cardLabel)}</div>
      <div class="fx-result fx-result-${kind}">${escapeHtmlStr(label)}</div>
    </div>
  `;
}

function betOrTypeLabel(evt: CardPlayedMsg): string {
  const bet = evt.bet > 0 ? `베팅 🩸${evt.bet}` : "베팅 없음";
  return bet;
}

// =====================================================================
// 룰렛 연출 (rolling 단계)
// =====================================================================

/**
 * 룰렛 원판.
 * - 녹색 부채꼴 = 명중 범위 (acc%)
 * - 금색 부채꼴 = 치명타 범위 (crit%) — 녹색 내부에 겹쳐 표시
 * - 적색 부채꼴 = 실패 범위 (100 - acc)%
 * 3초 스핀 후 결과 위치에 포인터가 멈춤 (CSS 애니메이션).
 */
function renderRoulette(
  evt: CardPlayedMsg,
  caster: PlayerPublic | undefined,
): string {
  let card: Card;
  try {
    card = getCardById(evt.cardId);
  } catch {
    return "";
  }

  // 베팅 패널 미리보기와 동일한 공식으로 acc/crit 계산 → 숫자 일치감
  const { accPct, critPct } = computeRouletteZones(card, evt.bet, caster);

  // 랜딩 각도 — 최종 결과(success/critical) 에 맞는 구간 내 무작위 점
  const missStart = accPct;
  let targetDeg: number;
  if (evt.critical) {
    targetDeg = randInRange(0.5, critPct - 0.5) * 3.6;
  } else if (evt.success) {
    // hit 지만 crit 은 아닌 영역: [critPct, accPct]
    const lo = Math.min(critPct + 0.5, accPct - 0.5);
    const hi = accPct - 0.5;
    targetDeg = randInRange(lo, hi > lo ? hi : lo) * 3.6;
  } else {
    targetDeg = randInRange(missStart + 0.5, 99.5) * 3.6;
  }
  // 최소 2회전 + 최종 각도 (포인터가 위쪽 0° 을 가리키도록 보정)
  const finalRotation = 720 + (360 - targetDeg);

  // 원판 배경: conic-gradient — 치명타(gold) → 명중(green) → 실패(red)
  // 명중/치명타가 0 이면 해당 구간 스킵
  const bg = buildConicBg(accPct, critPct);

  return `
    <div class="roulette-container">
      <div class="roulette-stats">
        <span class="r-stat r-stat-crit">치명타 ${critPct.toFixed(0)}%</span>
        <span class="r-stat r-stat-hit">명중 ${accPct.toFixed(0)}%</span>
      </div>
      <div class="roulette-frame">
        <div class="roulette-pointer">▼</div>
        <div class="roulette-wheel" style="background:${bg}; --final-rot:${finalRotation}deg;">
          <div class="roulette-hub"></div>
        </div>
      </div>
    </div>
  `;
}

interface RouletteZones {
  accPct: number;
  critPct: number;
}

function computeRouletteZones(
  card: Card,
  bet: number,
  caster: PlayerPublic | undefined,
): RouletteZones {
  if (card.type === "hit") {
    let acc = card.baseAcc + card.betAcc * bet;
    if (caster?.className === "berserker") acc += 2 * bet;
    acc = Math.max(0, Math.min(100, acc));
    return { accPct: acc, critPct: 0 };
  }
  if (card.type === "crit") {
    let crit = card.baseCrit + card.betCrit * bet;
    crit = Math.max(0, Math.min(100, crit));
    return { accPct: 100, critPct: crit };
  }
  if (card.type === "fixed") {
    return { accPct: 100, critPct: 0 };
  }
  // utility — 룰렛 의미 없음
  return { accPct: 100, critPct: 0 };
}

function buildConicBg(accPct: number, critPct: number): string {
  const critDeg = critPct * 3.6;
  const accDeg = accPct * 3.6;
  const stops: string[] = [];
  if (critDeg > 0) stops.push(`var(--gambler) 0deg ${critDeg}deg`);
  if (accDeg > critDeg) stops.push(`var(--ok) ${critDeg}deg ${accDeg}deg`);
  if (accDeg < 360) stops.push(`var(--accent) ${accDeg}deg 360deg`);
  return `conic-gradient(${stops.join(", ")})`;
}

function randInRange(lo: number, hi: number): number {
  if (hi < lo) return lo;
  return lo + Math.random() * (hi - lo);
}

// =====================================================================
// 손패
// =====================================================================

function renderHand(
  _me: PlayerPublic,
  hand: Card[],
  enabled: boolean,
  app: App,
): string {
  if (hand.length === 0) {
    return `<div class="hand empty muted">손패 없음</div>`;
  }
  const silenced = new Set(app.state.silencedCardIds);
  return `
    <div class="hand">
      ${hand
        .map(
          (c) => {
            const isSilenced = silenced.has(c.id);
            const playable = enabled && !isSilenced;
            const opacity = playable ? 1 : isSilenced ? 0.45 : 0.6;
            return `
        <button class="hand-card ${c.signature ? "signature" : ""} type-${displayType(c.type)} ${isSilenced ? "silenced" : ""}"
                data-card="${c.id}" ${playable ? "" : "disabled"}
                style="opacity:${opacity}">
          <div class="hc-head">
            <span class="hc-display-type ${displayType(c.type)}">${displayType(c.type) === "attack" ? "공격" : "유틸"}</span>
            <span class="hc-archetype" title="${archetypeLabel(c.type)}">${archetypeIcon(c.type)}</span>
          </div>
          <div class="hc-name">${c.signature ? "⚡ " : ""}${escapeHtmlStr(c.name)}</div>
          ${c.desc ? `<div class="hc-desc muted">${escapeHtmlStr(c.desc)}</div>` : ""}
          ${renderKeywordChips(c.keywords)}
          ${isSilenced ? `<div class="silence-stamp">🔒 봉인</div>` : ""}
          ${c.descLong ? `<div class="card-tooltip">${escapeHtmlStr(c.descLong)}</div>` : ""}
        </button>
      `;
          },
        )
        .join("")}
    </div>
  `;
}

function archetypeIcon(t: CardType): string {
  switch (t) {
    case "hit":
      return "🎯";
    case "crit":
      return "🎲";
    case "fixed":
      return "⚔";
    case "utility":
      return "✨";
  }
}

function archetypeLabel(t: CardType): string {
  switch (t) {
    case "hit":
      return "정확형 — 베팅이 명중률을 올림";
    case "crit":
      return "도박형 — 베팅이 크리율을 올림";
    case "fixed":
      return "확정형 — 항상 명중, 베팅이 데미지를 올림";
    case "utility":
      return "유틸형";
  }
}

function renderKeywordChips(chips: KeywordChip[]): string {
  if (!chips || chips.length === 0) return `<div class="hc-chips empty"></div>`;
  return `
    <div class="hc-chips">
      ${chips
        .map((ch) => {
          const g = KEYWORD_GLOSSARY[ch.key];
          return `
            <span class="kw-chip kw-${g.flavor}" tabindex="0">
              ${escapeHtmlStr(ch.label)}
              <span class="tooltip">
                <strong>${escapeHtmlStr(g.name)}</strong> — ${escapeHtmlStr(g.desc)}
              </span>
            </span>`;
        })
        .join("")}
    </div>
  `;
}

// =====================================================================
// 베팅 패널
// =====================================================================

function renderBettingPanel(
  card: Card,
  _me: PlayerPublic,
  bet: number,
  app: App,
  locked: boolean,
): string {
  // 서버 권위형이지만 클라에서도 제한을 보여주기 위해 계산
  // Player 인스턴스를 못 들고 있으므로 PlayerPublic 기반 근사.
  const meSlot = app.state.players.find((p) => p.connectionId === app.state.myId)!;
  const baseCap = card.maxBet;
  const hpMinus1 = Math.max(0, meSlot.hp - 1);
  const override = meSlot.statuses.betCapOverride;
  const cap = Math.min(baseCap, hpMinus1, override ?? baseCap);

  // 명중률/크리율 미리보기 (대략)
  const preview = computePreview(card, bet, meSlot);

  // 베팅 0~maxBet 버튼 (cap 초과는 disabled). 슬라이더 대체 — 1회 클릭 = 1회 렌더.
  const maxButtons = card.maxBet > 0 ? card.maxBet : 0;
  const betButtons =
    maxButtons === 0
      ? `<div class="muted">이 카드는 베팅 불가.</div>`
      : `
      <div class="bet-grid-wrap">
        <div class="bet-grid-label muted">
          베팅 HP <strong class="accent">${bet}</strong> / 최대 ${cap}
        </div>
        <div class="bet-grid">
          ${Array.from({ length: maxButtons + 1 })
            .map((_, n) => {
              const disabled = n > cap;
              const selected = n === Math.min(bet, cap);
              return `<button class="bet-btn ${selected ? "selected" : ""}" data-bet="${n}" ${disabled ? "disabled" : ""}>${n}</button>`;
            })
            .join("")}
        </div>
      </div>
    `;

  return `
    <div class="bet-side-panel" id="bet-side-panel">
      <div class="bet-side-head">
        <span class="hc-display-type ${displayType(card.type)}">${displayType(card.type) === "attack" ? "공격" : "유틸"}</span>
        <span class="hc-archetype" title="${archetypeLabel(card.type)}">${archetypeIcon(card.type)}</span>
        <span class="bet-side-name">${card.signature ? "⚡ " : ""}${escapeHtmlStr(card.name)}</span>
      </div>
      ${card.keywords.length > 0 ? `<div class="bet-side-chips">${renderKeywordChips(card.keywords).replace('<div class="hc-chips">', '<div class="hc-chips bet-chips">')}</div>` : ""}

      ${betButtons}

      ${preview ? `<div class="bet-preview">${preview}</div>` : ""}

      <div class="row">
        <button id="confirm-play" ${locked ? "disabled" : ""}>확정 🩸 ${bet}</button>
        <button id="cancel-play" class="muted-btn">취소</button>
      </div>
    </div>
  `;
}

/**
 * 미리보기 — 명중률·데미지를 분리 표기.
 * Hit 카드는 베팅이 명중률만 올리므로 "명중 N% · 명중 시 X뎀" 으로 표시
 * (기댓값을 합쳐서 보여주면 베팅으로 데미지가 같이 올라가는 것처럼 보여 혼란).
 */
function computePreview(card: Card, bet: number, me: PlayerPublic): string {
  if (card.type === "utility") return "";

  // ---- 기본 데미지 ----
  let baseDmg = card.damage + card.betDamage * bet;
  const range = card.extra.damage_range as [number, number] | undefined;
  const isDynamic = Boolean(card.extra.patience || card.extra.final_judgment);

  // ---- 카드 type 별 분리 표기 ----
  if (card.type === "hit") {
    let acc = card.baseAcc + card.betAcc * bet;
    if (me.className === "berserker") acc += 2 * bet;
    acc = Math.max(0, Math.min(100, acc));
    const hitCount = (card.extra.hit_count as number | undefined) ?? 1;
    const dmgLabel = hitCount > 1 ? `${baseDmg}뎀 ×${hitCount}` : `${baseDmg}뎀`;
    return `명중 <strong>${acc.toFixed(0)}%</strong> · 명중 시 <strong>${dmgLabel}</strong>`;
  }
  if (card.type === "crit") {
    let crit = card.baseCrit + card.betCrit * bet;
    crit = Math.max(0, Math.min(100, crit));
    const dmgRange = range
      ? `${range[0]}~${range[1]}뎀`
      : `${baseDmg}뎀`;
    const critDmgLabel = range
      ? `${Math.floor(range[0] * card.critMult)}~${Math.floor(range[1] * card.critMult)}뎀`
      : `${Math.floor(baseDmg * card.critMult)}뎀`;
    return `크리 <strong>${crit.toFixed(0)}%</strong> · 일반 ${dmgRange} / 크리 <strong>${critDmgLabel}</strong>`;
  }
  if (card.type === "fixed") {
    if (isDynamic) return `데미지 <strong>가변</strong> (상황 의존)`;
    return `확정 데미지 <strong>${baseDmg}뎀</strong>`;
  }
  return "";
}

// =====================================================================
// 종료 화면
// =====================================================================

function renderEndgame(
  root: HTMLElement,
  app: App,
  me: PlayerPublic,
  opp: PlayerPublic,
) {
  const info = app.state.endedInfo!;
  const iWon = info.winnerId === me.connectionId;
  const draw = info.winnerId === null;
  const myStats =
    info.p1Stats.connectionId === me.connectionId
      ? info.p1Stats
      : info.p2Stats;
  const oppStats =
    info.p1Stats.connectionId === opp.connectionId
      ? info.p1Stats
      : info.p2Stats;

  const title = draw ? "DRAW" : iWon ? "VICTORY" : "DEFEAT";
  const titleColor = draw
    ? "var(--muted)"
    : iWon
      ? "var(--ok)"
      : "var(--accent)";

  const reasonLabel = {
    hp_zero: "HP 0",
    mutual_hp_zero: "동시 HP 0",
    turn_limit: "15턴 초과 (HP 우위)",
    turn_limit_draw: "15턴 초과 (HP 동률)",
    safety_break: "시스템 오류 (safety break)",
  }[info.reason];

  root.innerHTML = `
    <div class="board">
      <div class="endgame">
        <div class="endgame-title" style="color:${titleColor}">${title}</div>
        <div class="muted">종료 사유: ${escapeHtmlStr(reasonLabel)}</div>

        <div class="divider"></div>

        <div class="stats-grid">
          ${renderStatsCard("나", myStats, iWon)}
          ${renderStatsCard("상대", oppStats, !iWon && !draw)}
        </div>

        <div class="divider"></div>

        <div class="row">
          <button id="rematch">재대전</button>
          <button id="leave">방 나가기</button>
        </div>
      </div>
    </div>
  `;

  root.querySelector<HTMLButtonElement>("#rematch")?.addEventListener(
    "click",
    () => {
      app.state.client!.send({ type: "rematch" });
      // 로컬 상태 일부 리셋 — 서버가 reset 후 room 브로드캐스트.
      app.state.plays = [];
      app.state.peeks = [];
      app.state.endedInfo = null;
      app.state.selectedCardId = null;
      app.state.pendingBet = 0;
      app.render();
    },
  );
  root.querySelector<HTMLButtonElement>("#leave")?.addEventListener(
    "click",
    () => app.navigateHome(),
  );

  ensureCssInjected();
}

function renderStatsCard(
  label: string,
  s: { name: string; finalHp: number; totalBet: number; totalDamageDealt: number; totalDamageTaken: number; critCount: number; missCount: number },
  winner: boolean,
): string {
  return `
    <div class="stats-card ${winner ? "winner" : ""}">
      <div class="stats-head">${escapeHtmlStr(label)} · ${escapeHtmlStr(s.name)}</div>
      <table class="stats-table">
        <tr><td>최종 HP</td><td>${s.finalHp}</td></tr>
        <tr><td>총 데미지</td><td>${s.totalDamageDealt}</td></tr>
        <tr><td>받은 데미지</td><td>${s.totalDamageTaken}</td></tr>
        <tr><td>총 베팅 HP</td><td>${s.totalBet}</td></tr>
        <tr><td>크리티컬</td><td>${s.critCount}</td></tr>
        <tr><td>빗나감</td><td>${s.missCount}</td></tr>
      </table>
    </div>
  `;
}

// =====================================================================
// 스타일
// =====================================================================

let cssInjected = false;
function ensureCssInjected() {
  if (cssInjected) return;
  const style = document.createElement("style");
  style.textContent = `
    #app { align-items: flex-start; }
    .board {
      width: 100%;
      max-width: 960px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      padding-top: 56px;
    }
    /* ---------- HUD: 코너 위젯 ---------- */
    .hud {
      position: fixed;
      z-index: 60;
      pointer-events: none;
    }
    .hud > * { pointer-events: auto; }
    .hud-top-left { top: 12px; left: 12px; }
    .hud-top-center {
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
    }
    .hud-bottom-right { bottom: 12px; right: 12px; }
    .dg-badge {
      background: rgba(20, 24, 32, 0.85);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
      min-width: 110px;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .dg-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
    }
    .dg-icon { font-size: 16px; width: 18px; text-align: center; }
    .dg-label { color: var(--muted); flex: 1; }
    .dg-count {
      font-family: "SF Mono", Menlo, monospace;
      font-weight: 700;
      color: var(--fg);
      font-variant-numeric: tabular-nums;
    }
    /* ---------- 상대 손패 (face-down, 미러링) ---------- */
    .opp-hand {
      display: flex;
      justify-content: center;
      padding: 4px 0;
    }
    .opp-hand-row {
      display: flex;
      gap: -16px;
      justify-content: center;
    }
    .opp-card {
      width: 54px;
      height: 78px;
      margin-left: -14px;
      background: linear-gradient(135deg, #2a3a5a 0%, #1a2438 100%);
      border: 1.5px solid #4a5a7a;
      border-radius: 6px;
      box-shadow: 0 3px 8px rgba(0,0,0,0.45);
      transform: rotate(180deg);
      position: relative;
      overflow: hidden;
    }
    .opp-card:first-child { margin-left: 0; }
    .opp-card-pattern {
      position: absolute;
      inset: 4px;
      border: 1px dashed rgba(255,255,255,0.15);
      border-radius: 4px;
      background:
        repeating-linear-gradient(45deg,
          rgba(255,255,255,0.04) 0 4px,
          transparent 4px 8px);
    }
    /* ---------- Toast notifications ---------- */
    .toast-stack {
      position: fixed;
      top: 70px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 90;
      max-width: 320px;
      pointer-events: none;
    }
    .toast {
      background: rgba(20, 24, 32, 0.92);
      border: 1px solid var(--border);
      border-left-width: 4px;
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 13px;
      color: var(--fg);
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
      animation: toastIn 0.25s ease-out;
      backdrop-filter: blur(4px);
    }
    .toast-error { border-left-color: var(--accent); }
    .toast-peek { border-left-color: var(--gambler); }
    .toast-info { border-left-color: var(--ok); }
    @keyframes toastIn {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    /* ---------- Class tag ---------- */
    .class-tag {
      color: var(--muted);
      font-weight: 500;
      font-size: 14px;
    }
    .player-panel {
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 18px;
    }
    .player-panel.self { border-color: var(--accent); }
    .player-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .player-name { font-size: 18px; font-weight: 600; }
    .boon-pill {
      font-size: 13px;
      background: var(--bg);
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      position: relative;
      cursor: help;
    }
    .boon-pill:hover { border-color: var(--accent); }
    .tooltip {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 200px;
      max-width: 280px;
      background: rgba(15, 18, 24, 0.96);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.45;
      text-align: left;
      white-space: normal;
      box-shadow: 0 6px 18px rgba(0,0,0,0.5);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-4px);
      transition: opacity 0.12s, transform 0.12s, visibility 0.12s;
      pointer-events: none;
      z-index: 70;
    }
    .boon-pill:hover .tooltip,
    .boon-pill:focus-within .tooltip {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .tooltip::before {
      content: "";
      position: absolute;
      top: -5px;
      right: 14px;
      width: 8px;
      height: 8px;
      background: rgba(15, 18, 24, 0.96);
      border-left: 1px solid var(--border);
      border-top: 1px solid var(--border);
      transform: rotate(45deg);
    }
    .hp-bar {
      position: relative;
      height: 24px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .hp-fill {
      height: 100%;
      transition: width 0.4s;
    }
    .hp-text {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-weight: 600; font-size: 13px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    }
    .player-meta { margin-top: 6px; font-size: 12px; }

    .board-center {
      text-align: center;
      padding: 16px;
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      min-height: 100px;
    }
    /* ---------- Field zone (drop target) ---------- */
    .field-zone {
      position: relative;
      min-height: 180px;
      background:
        radial-gradient(ellipse at center, rgba(60, 80, 60, 0.18) 0%, var(--bg-alt) 70%),
        var(--bg-alt);
      border: 2px dashed var(--border);
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    body.card-dragging .field-zone {
      border-color: var(--accent);
      box-shadow: inset 0 0 32px rgba(226, 58, 58, 0.18);
    }
    .field-zone.drop-hover {
      border-color: var(--ok);
      background:
        radial-gradient(ellipse at center, rgba(80, 200, 120, 0.28) 0%, var(--bg-alt) 70%),
        var(--bg-alt);
      box-shadow:
        inset 0 0 48px rgba(80, 200, 120, 0.35),
        0 0 24px rgba(80, 200, 120, 0.25);
    }
    .field-prompt {
      font-size: 14px;
      color: var(--muted);
      letter-spacing: 0.05em;
      margin-bottom: 10px;
      opacity: 0.85;
      pointer-events: none;
    }
    .field-prompt.dim { opacity: 0.4; }
    body.card-dragging .field-prompt {
      color: var(--accent);
      opacity: 1;
      animation: promptPulse 0.9s ease-in-out infinite;
    }
    .field-zone.drop-hover .field-prompt {
      color: var(--ok);
      animation: none;
      transform: scale(1.05);
    }
    @keyframes promptPulse {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; }
    }
    .turn-indicator {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--muted);
    }
    .turn-indicator.mine {
      color: var(--accent);
    }

    .log { font-size: 13px; text-align: left; max-width: 600px; margin: 0 auto; }
    .log-entry {
      padding: 4px 0;
      border-bottom: 1px dashed var(--border);
    }
    .log-entry:last-child { border-bottom: none; }

    /* ---------- FX overlay (card roll/result) ---------- */
    .fx-overlay {
      position: fixed;
      inset: 0;
      background: rgba(10, 12, 16, 0.72);
      backdrop-filter: blur(2px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      z-index: 100;
      animation: fadeIn 0.18s ease-out;
    }
    .fx-signature {
      background:
        radial-gradient(ellipse at center, rgba(226, 58, 58, 0.35) 0%, rgba(10, 12, 16, 0.9) 70%);
      animation: sigPulse 0.9s ease-out;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes sigPulse {
      0% { opacity: 0; transform: scale(1.08); }
      40% { opacity: 1; }
      100% { opacity: 1; transform: scale(1); }
    }
    .fx-actor {
      font-size: 14px; color: var(--muted);
      letter-spacing: 0.05em;
    }
    .fx-card {
      font-size: 28px; font-weight: 700;
      text-shadow: 0 2px 6px rgba(0,0,0,0.5);
    }
    .fx-signature .fx-card {
      color: var(--accent);
      text-shadow: 0 0 18px rgba(226, 58, 58, 0.7);
    }
    .fx-subtitle { font-size: 13px; }
    /* ---------- Roulette (card-play rolling phase) ---------- */
    .roulette-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .roulette-stats {
      display: flex;
      gap: 18px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .r-stat-hit  { color: var(--ok); }
    .r-stat-crit { color: var(--gambler); }
    .roulette-frame {
      position: relative;
      width: 220px;
      height: 220px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .roulette-pointer {
      position: absolute;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 28px;
      color: var(--fg);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
      z-index: 2;
    }
    .roulette-wheel {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.15);
      box-shadow:
        0 0 0 4px rgba(0,0,0,0.4),
        0 10px 28px rgba(0,0,0,0.55);
      animation: rouletteSpin 3s cubic-bezier(0.12, 0.62, 0.16, 1) forwards;
    }
    @keyframes rouletteSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(var(--final-rot, 720deg)); }
    }
    .roulette-hub {
      position: absolute;
      top: 50%; left: 50%;
      width: 44px; height: 44px;
      margin: -22px 0 0 -22px;
      background: radial-gradient(circle, #3a4050 0%, #181c24 100%);
      border: 2px solid rgba(255,255,255,0.2);
      border-radius: 50%;
    }
    .fx-jackpot-dice {
      font-size: 96px; font-weight: 900;
      font-family: "SF Mono", Menlo, monospace;
      color: var(--gambler);
      text-shadow: 0 0 24px rgba(214, 168, 62, 0.7);
      min-width: 130px;
      text-align: center;
    }
    .fx-result {
      font-size: 44px; font-weight: 800;
      animation: popIn 0.3s ease-out;
    }
    @keyframes popIn {
      0% { transform: scale(0.3); opacity: 0; }
      50% { transform: scale(1.25); opacity: 1; }
      100% { transform: scale(1); }
    }
    .fx-result-crit {
      color: var(--accent);
      text-shadow: 0 0 20px var(--accent), 0 0 40px rgba(226,58,58,0.5);
      font-size: 56px;
    }
    .fx-result-hit { color: var(--warn); }
    .fx-result-heal { color: var(--ok); }
    .fx-result-shield { color: var(--warden); }
    .fx-result-self { color: var(--accent); }
    .fx-result-miss { color: var(--muted); letter-spacing: 0.15em; }

    /* ---------- HP shake + damage float ---------- */
    .player-panel.shake { animation: shake 0.45s ease-in-out; }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      15% { transform: translateX(-6px); }
      30% { transform: translateX(5px); }
      45% { transform: translateX(-4px); }
      60% { transform: translateX(3px); }
      75% { transform: translateX(-2px); }
    }
    .hp-bar { position: relative; overflow: visible; }
    .hp-bar .hp-fill { border-radius: 12px; }
    .damage-float {
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 26px;
      font-weight: 800;
      pointer-events: none;
      animation: floatUp 1.2s ease-out forwards;
      text-shadow: 0 2px 4px rgba(0,0,0,0.8);
    }
    .damage-float.damage-dmg { color: var(--accent); }
    .damage-float.damage-self { color: var(--accent); opacity: 0.85; }
    .damage-float.damage-heal { color: var(--ok); }
    .damage-float.crit {
      color: var(--accent);
      font-size: 34px;
      text-shadow: 0 0 12px var(--accent), 0 2px 4px rgba(0,0,0,0.8);
    }
    @keyframes floatUp {
      0% { opacity: 0; transform: translate(-50%, 12px); }
      15% { opacity: 1; transform: translate(-50%, -4px); }
      80% { opacity: 1; transform: translate(-50%, -38px); }
      100% { opacity: 0; transform: translate(-50%, -52px); }
    }

    .peeks { margin-top: 12px; font-size: 12px; text-align: left; max-width: 600px; margin-left: auto; margin-right: auto; }
    .peek-item { color: var(--fg); opacity: 0.7; }

    .hand {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 10px;
      margin-top: 4px;
    }
    .hand-card {
      background: var(--bg-alt);
      border: 1.5px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      text-align: left;
      cursor: pointer;
      transition: transform 0.1s, border 0.15s;
    }
    .hand-card:not(:disabled):hover {
      transform: translateY(-6px) scale(1.02);
      border-color: var(--accent);
      box-shadow: 0 8px 18px rgba(0,0,0,0.35);
    }
    .hand-card[draggable="true"] { cursor: grab; }
    .hand-card[draggable="true"]:active { cursor: grabbing; }
    .hand-card.dragging {
      opacity: 0.4;
      transform: scale(0.94);
      border-color: var(--accent);
    }
    .hc-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-bottom: 6px; }
    .hc-display-type {
      text-transform: uppercase;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 3px;
      background: var(--bg);
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .hc-display-type.attack { color: var(--accent); }
    .hc-display-type.utility { color: var(--gambler); }
    .hc-archetype { font-size: 14px; cursor: help; opacity: 0.85; }
    .hand-card.type-attack { border-left: 3px solid var(--accent); }
    .hand-card.type-utility { border-left: 3px solid var(--gambler); }
    .hand-card.signature { box-shadow: 0 0 0 1px rgba(214, 168, 62, 0.5) inset; }
    .hand-card.silenced {
      cursor: not-allowed !important;
      filter: grayscale(0.6);
      border-color: rgba(120, 120, 140, 0.6) !important;
    }
    .hand-card.silenced:hover { transform: none !important; }
    .silence-stamp {
      position: absolute;
      bottom: 8px;
      right: 8px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      color: var(--fg);
      background: rgba(80, 80, 100, 0.85);
      border: 1px solid rgba(180, 180, 200, 0.5);
      border-radius: 3px;
      letter-spacing: 0.05em;
      pointer-events: none;
    }
    .hc-name { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
    .hc-desc {
      font-size: 11px;
      line-height: 1.35;
      margin-bottom: 6px;
      min-height: 15px;
    }
    .hc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 22px;
    }
    .hc-chips.empty { min-height: 4px; }

    /* ---------- Card hover tooltip (long desc) ---------- */
    .hand-card { position: relative; }
    .card-tooltip {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translate(-50%, 6px);
      width: max-content;
      max-width: 280px;
      background: rgba(15, 18, 24, 0.97);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.5;
      text-align: left;
      white-space: normal;
      box-shadow: 0 8px 22px rgba(0,0,0,0.55);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
      pointer-events: none;
      z-index: 75;
    }
    .card-tooltip::after {
      content: "";
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%) rotate(45deg);
      width: 8px; height: 8px;
      background: rgba(15, 18, 24, 0.97);
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .hand-card:not(:disabled):hover .card-tooltip,
    .hand-card:focus-within .card-tooltip {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
    }

    /* ---------- Keyword chip ---------- */
    .kw-chip {
      position: relative;
      display: inline-flex;
      align-items: center;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      color: var(--fg);
      cursor: help;
      line-height: 1.4;
    }
    .kw-chip.kw-buff      { border-color: rgba(80, 200, 120, 0.45); color: var(--ok); }
    .kw-chip.kw-debuff    { border-color: rgba(214, 168, 62, 0.45); color: var(--gambler); }
    .kw-chip.kw-self_cost { border-color: rgba(226, 58, 58, 0.45); color: var(--accent); }
    .kw-chip.kw-utility   { border-color: rgba(80, 140, 220, 0.45); color: #6aa6ff; }
    .kw-chip.kw-special   { border-color: rgba(180, 100, 220, 0.55); color: #c79bff; }
    .kw-chip:focus-within,
    .kw-chip:hover {
      filter: brightness(1.25);
    }
    .kw-chip .tooltip {
      bottom: calc(100% + 8px);
      top: auto;
      left: 50%;
      right: auto;
      transform: translate(-50%, -4px);
      min-width: 220px;
      max-width: 300px;
      text-align: left;
      font-size: 11px;
      color: var(--fg);
      letter-spacing: normal;
    }
    .kw-chip:hover .tooltip,
    .kw-chip:focus-within .tooltip {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
    }
    .kw-chip .tooltip::before {
      top: auto;
      right: auto;
      left: 50%;
      bottom: -5px;
      transform: translateX(-50%) rotate(225deg);
      border-color: var(--border);
    }

    /* ---------- Glossary modal ---------- */
    .glossary-overlay {
      position: fixed;
      inset: 0;
      background: rgba(10, 12, 16, 0.65);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 95;
      animation: fadeIn 0.15s ease-out;
    }
    .glossary-panel {
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      width: min(92vw, 520px);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 36px rgba(0,0,0,0.55);
    }
    .glossary-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .glossary-head h3 { margin: 0; font-size: 16px; letter-spacing: 0.05em; }
    .glossary-body {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-right: 4px;
    }
    .glossary-row {
      display: grid;
      grid-template-columns: 96px 1fr;
      align-items: center;
      gap: 12px;
      font-size: 12px;
    }
    .glossary-desc { line-height: 1.45; }

    /* ---------- Bet side panel (좌측 고정, non-blocking) ---------- */
    .bet-side-panel {
      position: fixed;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      width: 280px;
      background: var(--bg-alt);
      border: 2px solid var(--accent);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.55);
      z-index: 75;
      animation: slideInLeft 0.2s ease-out;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    @keyframes slideInLeft {
      from { opacity: 0; transform: translate(-30px, -50%); }
      to   { opacity: 1; transform: translate(0, -50%); }
    }
    .bet-side-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .bet-side-name {
      font-weight: 600;
      font-size: 14px;
      flex: 1;
    }
    .bet-side-chips { margin-top: -4px; }
    .bet-chips { min-height: auto !important; }
    .bet-grid-wrap { display: flex; flex-direction: column; gap: 8px; }
    .bet-grid-label { font-size: 12px; }
    .bet-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
    }
    .bet-btn {
      padding: 6px 0;
      font-size: 13px;
      font-weight: 600;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--fg);
      cursor: pointer;
      font-family: "SF Mono", Menlo, monospace;
      transition: background 0.08s, border-color 0.08s;
    }
    .bet-btn:not(:disabled):hover {
      background: rgba(226, 58, 58, 0.15);
      border-color: var(--accent);
    }
    .bet-btn.selected {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .bet-btn:disabled {
      opacity: 0.25;
      cursor: not-allowed;
    }
    .bet-preview {
      font-size: 13px;
      color: var(--fg);
      padding: 8px 10px;
      background: rgba(0,0,0,0.25);
      border-radius: 6px;
      line-height: 1.5;
    }

    .board-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .muted-btn { color: var(--muted); }

    .endgame {
      text-align: center;
      padding: 32px;
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .endgame-title {
      font-size: 64px;
      font-weight: 800;
      letter-spacing: 0.1em;
      margin-bottom: 8px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .stats-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      text-align: left;
    }
    .stats-card.winner { border-color: var(--ok); }
    .stats-head {
      font-weight: 600;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .stats-table { width: 100%; font-size: 13px; }
    .stats-table td { padding: 4px 0; }
    .stats-table td:last-child { text-align: right; font-family: monospace; }
  `;
  document.head.appendChild(style);
  cssInjected = true;
}

function escapeHtmlStr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
