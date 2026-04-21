# 웹 MVP 개발 작업 지시서

> CLI Phase 1 (Task 1–5) 로 룰 엔진·게임 루프 검증 완료.
> 원격 플레이 요구사항 때문에 CLI 나머지 (AI/로그/시뮬/네트워크) 는 보류하고
> 웹 MVP 로 바로 전환. CLI 의 Python 엔진은 TS 로 포팅.

## 기술 스택

| 계층 | 기술 | 비고 |
|---|---|---|
| 프론트엔드 | Vanilla TS + Vite | 단일 SPA, `vanilla-ts` 템플릿 |
| 실시간 통신 | PartyKit (Cloudflare Durable Objects) | WebSocket 기본, 배포 `npx partykit deploy` |
| 상태 관리 | 서버 권위형 (방 = 1 Durable Object) | 치팅 방지. 모든 룰은 서버에서만 |
| 엔진 | TypeScript 1:1 포팅 (`cli/allin/*.py` → `web/src/engine/*.ts`) | 데이터 주도 구조라 기계적 |
| 데이터 | `data/*.json` 그대로 공유 | `fetch` 또는 `import` |
| 테스트 | Vitest | pytest 166 개 케이스 복제 |
| 호스팅 | Vercel (프론트) + PartyKit (서버) | 둘 다 무료 티어 충분 |

### 스택 선택 근거

- **PartyKit**: 방 단위 Durable Object 가 "게임 상태 홀더" 로 딱 맞음. 배포 한 줄. Cloudflare 엣지 무료.
- **Vanilla TS**: 게임 UI 는 상태·애니메이션 중심 — React 가 오히려 오버헤드. 번들 크기 최소화.
- **TS 포팅**: Python 백엔드 유지는 호스팅 복잡성 추가. 프론트·백 언어 통일이 배포·디버깅 모두 단순.
- **데이터 JSON 공유**: 카드/부운 수치는 한 곳(`data/*.json`)에만 두고 서버/클라 양쪽에서 import → 밸런스 수정 시 한 곳만 수정.

## 프로젝트 구조

```
D:\all-in\
├── cli\                    # 기존 Python CLI (레퍼런스, 삭제 안 함)
├── data\                   # 공유 카드/부운 JSON
├── docs\
├── web\                    # ← 새 작업
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── partykit.json       # PartyKit 배포 설정
│   ├── index.html
│   ├── src\
│   │   ├── main.ts         # Vite 엔트리
│   │   ├── engine\         # TS 포팅 엔진
│   │   │   ├── types.ts    # Card, Boon, Player 인터페이스
│   │   │   ├── data.ts     # JSON 로더
│   │   │   ├── player.ts   # Player 클래스
│   │   │   ├── engine.ts   # execute_card + Game
│   │   │   └── index.ts    # 재노출
│   │   ├── net\            # PartyKit 클라이언트
│   │   │   ├── protocol.ts # 메시지 타입 정의 (서버와 공유)
│   │   │   └── client.ts
│   │   └── ui\             # 화면 컴포넌트 (렌더 함수들)
│   │       ├── lobby.ts
│   │       ├── pick.ts
│   │       ├── board.ts
│   │       └── effects.ts
│   ├── party\
│   │   └── server.ts       # PartyKit 서버 (방 = 1 인스턴스)
│   └── tests\              # Vitest
│       ├── player.test.ts
│       ├── engine.test.ts
│       └── game.test.ts
└── TASKS-WEB.md
```

## 메시지 프로토콜 (클라 ↔ 서버)

W6 에서 확정하되 초안:

```typescript
// 클라 → 서버
type ClientMsg =
  | { type: "join"; name: string }
  | { type: "pick_class"; class: "berserker" | "gambler" | "warden" }
  | { type: "pick_boon"; boonId: string }
  | { type: "play_card"; cardId: string; bet: number }
  | { type: "end_turn" };

// 서버 → 클라 (방 내 전원 브로드캐스트)
type ServerMsg =
  | { type: "room_state"; players: PlayerPublic[] }
  | { type: "phase"; phase: "lobby" | "coin_toss" | "pick_class" | "pick_boon" | "battle" | "ended" }
  | { type: "coin_toss_result"; firstPick: string }
  | { type: "class_locked"; player: string; class: string }
  | { type: "boon_options"; player: string; options: string[] }   // 본인에게만
  | { type: "boon_locked"; player: string; boonId: string }
  | { type: "turn_start"; player: string; turn: number }
  | { type: "hand_update"; hand: Card[] }                          // 본인에게만
  | { type: "card_result"; result: CardResultPublic }
  | { type: "game_ended"; winner: string | null; result: GameResultPublic };
```

부정 방지:
- 상대 손패는 **ID 없이 카운트만** 전송 (`{ id: "?" }`)
- 워든 peek 결과는 해당 플레이어에게만 `{ type: "peek", cardId }` 따로
- 베팅 HP 차감/명중 판정은 서버에서만

---

# 작업 태스크 리스트

## Phase 1 — 엔진 포팅 (Python → TS)

### 🎯 W1: 프로젝트 셋업

- `web/` 디렉토리 + Vite + TS + Vitest + PartyKit
- `npm install`
- 완료 기준:
  - [ ] `npm run dev` 동작 (Hello 화면)
  - [ ] `npm run test` → 0 테스트, 에러 없음
  - [ ] `partykit dev` 로컬 서버 기동 (ws://127.0.0.1:1999)

### 🎯 W2: 타입 정의 + 데이터 로더

- `src/engine/types.ts`: Card, Boon, CardType, BoonCategory, DamageEvent
- `src/engine/data.ts`: `loadCards()`, `loadBoons()`, `getDeck(class)`, `getBoonById(id)` 등
- 완료 기준:
  - [ ] 카드/부운 로더가 Python 과 동일 필드명 (snake_case → camelCase 변환 1회)
  - [ ] 시그니처 6장, 부운 10종, 클래스별 15장 테스트 통과

### 🎯 W3: Player 상태 포팅

- `src/engine/player.ts`
- Python `player.py` 의 모든 필드 + 메서드 1:1 이식
- 완료 기준:
  - [ ] `tests/player.test.ts` 33 테스트 통과 (Python 과 동일 케이스)

### 🎯 W4: 카드 효과 엔진 포팅

- `src/engine/engine.ts` 중 `executeCard`, `validateCardPlay`, 타입별 핸들러
- 45장 전부 이식, 부운 상호작용, 시그니처 제약
- 완료 기준:
  - [ ] `tests/engine.test.ts` 78 테스트 통과

### 🎯 W5: Game 루프 포팅

- `Game`, `Agent`, `PlayAction`, `GameResult`, `PassAgent`, `ScriptedAgent`
- 완료 기준:
  - [ ] `tests/game.test.ts` 13 테스트 통과
  - [ ] 총 **124 테스트 통과** (Python 166 중 CLI 전용 제외)

## Phase 2 — PartyKit 서버

### 🎯 W6: 방 생성/참가 프로토콜

- `party/server.ts` — `onConnect`, `onMessage`, `onClose`
- 메시지 타입 (`src/net/protocol.ts`, 서버/클라 공유)
- 방 코드 = PartyKit party ID (URL 마지막 세그먼트)
- 완료 기준:
  - [ ] 두 명 연결되면 `phase: lobby` → `phase: coin_toss`
  - [ ] 연결 끊기면 방 리셋 (재연결 가능)

### 🎯 W7: 매치 시퀀스

- 코인토스 (서버 RNG) → 선픽 직업 → 후픽 직업 (미러전 금지) → 부운 각자 선택 (15초 타이머)
- 도박사 선택 시 부운 4개 제시 패시브
- 완료 기준:
  - [ ] 양쪽 직업 확정 후 `phase: battle` 전환
  - [ ] 타임아웃 시 서버가 랜덤 대입

### 🎯 W8: 턴 진행 + 상태 브로드캐스트

- `play_card` / `end_turn` 수신 → `executeCard` → 차분 브로드캐스트
- 본인 전용 메시지 (hand, peek) 는 `connection.send`, 방 공통은 `room.broadcast`
- 완료 기준:
  - [ ] 한 판 완주 (로비 → 게임 종료)
  - [ ] 상대 손패 ID 노출되지 않음 (네트워크 탭 확인)

## Phase 3 — 프론트 UI

### 🎯 W9: 로비 + 대기실

- `/` 초기 화면: 방 생성 / 코드 입력 / 닉네임
- `/room/:code` 대기실: 두 명 입장 시 자동 진행
- 완료 기준:
  - [ ] 두 브라우저 탭으로 방 만들고 참가 → 양쪽 화면 동기화

### 🎯 W10: 픽 화면

- 코인토스 3초 애니메이션
- 직업 카드 3장 (클릭 시 덱 미리보기 팝업)
- 부운 카드 3개 (도박사는 4개) 동시 선택, 15초 타이머
- 완료 기준:
  - [ ] 선픽/후픽 턴 UI 구분
  - [ ] 후픽은 선픽이 고른 직업 회색 처리

### 🎯 W11: 게임 보드

- 상하 2분할. 상대 HP/부운/손패(뒷면), 내 HP/부운/손패(앞면)
- 턴 인디케이터, 덱/묘지 카운터
- 완료 기준:
  - [ ] HP 바 색상 전환 (70%+ 초록 / 30–70 노랑 / -30 빨강)
  - [ ] 카드 hover 상세 툴팁

### 🎯 W12: 베팅 UX

- 카드 클릭 → 확대 뷰 → 베팅 슬라이더 (0 ~ `card.maxBet`)
- 슬라이더 값에 따라 실시간 명중률/크리율 미리보기 ("베팅 5 → 명중 70%")
- 확정 버튼으로 서버에 `play_card` 전송
- 완료 기준:
  - [ ] 베팅 상한 (HP-1, `bet_cap_override`, `card.maxBet`) 자동 반영
  - [ ] 광전사 패시브 +2%/베팅도 미리보기에 반영

### 🎯 W13: 공격 연출

- 명중: 데미지 숫자 플로팅 + 피격 shake
- 크리: 화면 플래시 + 큰 숫자 + 2–3배 데미지 숫자
- 미스: "MISS" 연기 이펙트
- 시그니처: 풀스크린 컷인 (캐릭터 이름 + 카드명 + 1초 대기)
- 완료 기준:
  - [ ] 연출 길이 0.5–2.5초 (게임 템포 유지)
  - [ ] 연출 중 중복 입력 잠금

### 🎯 W14: 종료 화면

- VICTORY / DEFEAT / DRAW
- 통계 (턴 수, 총 데미지, 총 베팅, 크리 횟수)
- 재대전 (방 유지) / 방 나가기
- 완료 기준:
  - [ ] 재대전 시 직업/부운 픽 단계부터 다시

## Phase 4 — 배포/베타

### 🎯 W15: 배포 (사용자 계정 필요, 가이드 완료)

**PartyKit 배포**:
```bash
cd D:\all-in\web
npx partykit login          # 브라우저 OAuth
npm run party:deploy
```

**Vercel 배포**: `web/` 디렉토리를 Root 로 지정, 환경변수 `VITE_PARTYKIT_HOST=allin.<user>.partykit.dev` 설정. `vercel.json` 은 이미 준비됨.

완료 기준:
- [x] 배포 설정 파일 (`vercel.json`, `partykit.json`) 준비 완료
- [x] README 에 배포 절차 명시
- [ ] 실제 배포 및 친구와 원격 플레이 검증 (사용자 수행)

---

## 작업 원칙 (CLI TASKS.md 와 동일)

1. **Task 단위로 끊어서 진행** — 완료 기준 다 통과 → 보고 → 다음 태스크
2. **테스트 우선** — Phase 1 포팅은 pytest 케이스 복제. Vitest 로 동치 검증
3. **디자인 문서가 진실** — `docs/*` + `data/*.json` 이 밸런스 소스
4. **밸런스 수정 금지** — 이슈는 `docs/06-balance-notes.md` 에만 기록

## 예상 소요

| Phase | 예상 |
|---|---|
| Phase 1 (엔진 포팅) | 1–2일 |
| Phase 2 (서버) | 1일 |
| Phase 3 (UI) | 3–4일 |
| Phase 4 (배포) | 0.5일 |
| **합계** | **5–7일** |

## CLI 와의 관계

CLI (`cli/`) 는 레퍼런스로 유지. TS 포팅 시 Python 코드와 동일 동작을 목표.
의문 생기면:
1. `cli/allin/*.py` 구현 확인
2. `cli/tests/*.py` 케이스 확인
3. 여전히 모호하면 사용자에게 질문
