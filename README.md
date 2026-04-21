# ALL-IN

> "한 턴, 한 호흡, 한 방."

웹 기반 1:1 대전 카드게임. HP를 자원으로 베팅하는 3분짜리 하이텐션 도박 배틀.

## 핵심 컨셉

- **1판 3~6턴, 평균 3분** — 단시간 하이라이트 반복
- **HP = 유일한 자원** — 체력을 베팅해서 공격 성공률/치명타율 증폭
- **직업 고정덱** — 3개 직업, 각 15장 고정, 덱빌딩 없음
- **매 판 다른 빌드** — 10종 부운(Boon) 중 3개 랜덤 제시 → 1개 선택
- **미러전 금지** — 선픽/후픽 순서로 직업 배분, 서로 다른 직업 강제

## 직업

| 직업 | 정체성 | 패시브 |
|---|---|---|
| 🔥 광전사 (Berserker) | 화력 + 베팅 극대화 | HP 베팅 1당 추가 +2% 명중률 |
| 🎲 도박사 (Gambler) | 변수 + 부운 빌드 | 부운 선택지 3 → 4개 |
| 🛡️ 컨트롤러 (Warden) | 확정타 + 회복 | 매 턴 상대 손패 1장 확인 |

## 문서 구조

| 파일 | 내용 |
|---|---|
| [docs/01-game-overview.md](docs/01-game-overview.md) | 게임 전체 컨셉과 핵심 룰 |
| [docs/02-classes.md](docs/02-classes.md) | 직업 3종 상세 설명 |
| [docs/03-cards.md](docs/03-cards.md) | 카드 45장 전체 스펙 |
| [docs/04-boons.md](docs/04-boons.md) | 부운 10종 카탈로그 |
| [docs/05-game-flow.md](docs/05-game-flow.md) | 게임 진행 플로우 (픽 → 턴 → 종료) |
| [docs/06-balance-notes.md](docs/06-balance-notes.md) | 시뮬레이션 결과 및 밸런싱 히스토리 |
| [docs/07-assets.md](docs/07-assets.md) | 에셋 라인업 및 AI 이미지 프롬프트 |
| [data/cards.json](data/cards.json) | 카드 데이터 (JSON, 구현용) |
| [data/boons.json](data/boons.json) | 부운 데이터 (JSON, 구현용) |
| [TASKS.md](TASKS.md) | CLI 프로토타입 개발 작업 지시서 (Phase 1 완료, 나머지 보류) |
| [TASKS-WEB.md](TASKS-WEB.md) | **웹 MVP 개발 작업 지시서** (현재 진행) |

## 개발 상태

- [x] 게임 컨셉 확정 (v2 Bloodbet)
- [x] 직업 3종 정체성 확정
- [x] 카드 45장 1차 디자인
- [x] 부운 10종 1차 디자인
- [x] Python 시뮬레이션 엔진으로 밸런스 1차 검증
- [x] 디자인 문서 정리
- [x] 에셋 라인업 및 AI 프롬프트 정리
- [x] CLI Phase 1 (엔진 + 게임 루프 + 166 테스트) — Python 레퍼런스 구현
- [ ] 웹 MVP (Vanilla TS + Vite + PartyKit) — **현재 진행**
  - [ ] 엔진 TS 포팅 (Python → TS)
  - [ ] PartyKit 서버 권위형 상태 관리
  - [ ] 프론트 UI (로비 / 픽 / 보드 / 연출)
  - [ ] Vercel + PartyKit 배포
- [ ] 에셋 제작 (Phase 1 — MVP 필수 50장)
- [ ] 베타 테스트 → 정식 출시

## 기술 스택 (확정)

- **프론트엔드**: Vanilla TypeScript + Vite
- **실시간 통신**: PartyKit (Cloudflare Durable Objects + WebSocket)
- **엔진**: TypeScript (Python 레퍼런스를 1:1 포팅)
- **호스팅**: Vercel (프론트) + PartyKit.dev (서버)
- **상태 관리**: 서버 권위형 — 방 = 1 Durable Object 인스턴스

## 타겟

내수용 — 친구들끼리 반복 플레이할 수 있는 캐주얼 도박 게임.
</content>