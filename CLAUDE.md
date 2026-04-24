# CLAUDE.md

ALL-IN — HP 베팅 1:1 카드 도박 게임. 같은 게임을 **두 번 구현**한 모노레포 (Python 레퍼런스 + TS 프로덕션).

## 레포 구조

```
all-in/
├─ data/                  ← 단일 진실. cards.json / boons.json (Python·TS 양쪽이 직접 import)
├─ cli/                   ← Python 레퍼런스 구현 (CLI 게임 + 시뮬레이션 + 밸런스 검증)
│  ├─ allin/
│  │  ├─ cards.py         ← cards.json 로더
│  │  ├─ player.py        ← 플레이어 상태/턴 훅
│  │  ├─ engine.py        ← 카드 효과 + Game 루프 + Agent
│  │  ├─ boons.py         ← 부운 로더
│  │  └─ modes/           ← hotseat / vs_ai / network (대부분 미구현)
│  └─ tests/              ← pytest, 166개
├─ web/                   ← TS 프로덕션 (Vanilla TS + Vite, no framework)
│  ├─ src/
│  │  ├─ engine/          ← Python engine.py 1:1 미러. types/data/player/card-exec/game/keywords/rng/errors
│  │  ├─ net/             ← protocol.ts (서버↔클라 메시지) + client.ts
│  │  └─ ui/              ← scenes/ (lobby/waitroom/classPick/boonDraft/duel/ending) + sceneStage 라우터
│  ├─ worker/             ← **프로덕션 서버**. Cloudflare Workers + Durable Objects (room.ts = 방 1개)
│  ├─ party/              ← PartyKit 서버 (parallel 유지, 현재는 Cloudflare 가 prod)
│  ├─ tests/              ← Vitest, 233개
│  └─ scripts/            ← smoke-*.mjs (e2e WebSocket 시나리오)
└─ docs/                  ← 게임 디자인 문서 (01-game-overview ~ 07-assets)
```

## 핵심 불변

**1. `data/*.json` 은 단일 진실.** 카드/부운 수치 변경은 무조건 여기서. Python (`cli/allin/cards.py`) 과 TS (`web/src/engine/data.ts`) 둘 다 이 디렉토리를 직접 읽음 (TS 는 vite alias `@data`).

**2. Python ↔ TS 엔진 미러.** `cli/allin/engine.py` 와 `web/src/engine/card-exec.ts` 는 1:1 포팅. 카드 효과 로직 바꿀 땐 양쪽 다. 테스트도 양쪽 다 (Python 케이스가 TS 케이스의 스펙). 같은 시드 → 같은 결과 보장은 *목표*지만 RNG 구현이 달라 완벽하진 않음.

**3. 서버는 두 개, 진실은 하나.** `worker/room.ts` (Cloudflare Durable Objects, 프로덕션) + `party/server.ts` (PartyKit, 미러). 게임 로직은 대부분 동일하므로 한쪽 바꾸면 다른 쪽도. 둘 다 같은 `src/engine` 사용. 프로덕션 배포는 wrangler.

**4. 카드 타입 ↔ 직업 바인딩 (v3).**
- `hit` 타입 → 광전사 (B*) 만 사용
- `crit` 타입 → 도박사 (G*) 만 사용
- `fixed` 타입 → 컨트롤러 (W*) 만 사용
- 새 카드 추가 시 직업 ↔ 타입 일치 필수.

**5. 데미지 흐름 (v3).** `bluff → hit roll → crit roll(crit 카드만) → damage 계산 → dodge roll → shield/감쇠 적용`. bluff 와 dodge 는 hit roll 과 분리된 별개 룰렛 (`_try_consume_bluff` / `_try_consume_dodge`). 치명타 확률 = `floor(현재명중률 / 10) + base_crit + bet_crit*bet + 부운/버프`.

## 자주 쓰는 명령

```bash
# Python (cli/)
cd cli && python -m pytest                    # 전체 테스트
python -m pytest cli/tests/test_engine.py     # 엔진만
python -m allin hotseat                       # CLI 게임 실행

# TS (web/)
cd web && npm test                            # 전체 vitest
npm run dev                                   # Vite 개발 서버 (5173)
npm run worker:dev                            # 로컬 wrangler (Workers + DO)
npm run party                                 # PartyKit dev
npx tsc --noEmit                              # 타입체크만
node scripts/smoke-battle.mjs                 # WebSocket e2e 스모크

# 배포 (Cloudflare 프로덕션)
cd web && npm run deploy                      # = npm run build && wrangler deploy
                                              # → https://allin.umilove98.workers.dev
                                              # 또는 git push 시 Workers Builds 자동 배포
```

## 게임 상태 머신

서버 (`worker/room.ts` `party/server.ts` 둘 다 동일):

```
lobby → coin_toss → pick_class → pick_boon → battle → ended
                                              ↑↓
                                         턴 진행 루프
```

- `Phase` 와 메시지 정의는 `web/src/net/protocol.ts`. 클라/서버가 import 공유.
- 한 방 = `Room` Durable Object 인스턴스 1개. roomId 기반 라우팅.
- 컨트롤러 패시브: 상대 턴 시작 시 상대 손패 1장 침묵 (peek 아님). Python `Game.step` 도 동일.

## 룰렛 UI (duel.ts)

공격 카드 시전 시 UI 가 다단계 룰렛을 순차로 돌림. 각 단계는 서버가 미리 계산해서 broadcast (`accUsed`, `critChanceUsed`, `bluffChance`, `bluffTriggered`, `dodgeChance`, `dodged`).

| 단계 | 발동 조건 | 색 |
|---|---|---|
| 블러프 | 시전자에 force_miss 디버프 | red 성공영역 = 강제 miss |
| 명중 (+ 크리) | 항상 (acc<100). 도박사 카드는 gold 크리 영역 동봉 | green hit / gold crit |
| 회피 | 적에 dodge 버프 | blue 성공영역 = 회피 성공 |

`maybeStartRoulette` → `buildStage` → `syncRouletteMount` → `advanceStageIfReady` 자동 진행.

## 알아두면 좋은 것

- **TASKS.md / TASKS-WEB.md** 는 진행 중 작업 지시서. 방향 결정엔 docs/ 가 우선.
- **Windows 한글 콘솔**: `cli/allin/__main__.py` 가 stdout/stderr 를 UTF-8 로 reconfigure. CLI 로그가 깨지면 여기 확인.
- **카드 색 팔레트** (UI): `CARD_TYPE` (duel.ts) 가 hit/crit/fixed/utility 별 글리프·색·잉크 정의.
- **시그니처 제약**: 게임당 1회, 같은 턴에 1장만, 3턴 이후 해금. `validate_card_play` (양쪽 엔진) 에서 검증.
- **베팅 상한**: `card.max_bet`, `caster.bet_cap_override` (W4 결박), `max(0, hp - 1)` (HP 1 남기기 룰) 의 최소값. `compute_bet_cap` 에서 통합.
