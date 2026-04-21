# CLI 프로토타입 개발 작업 지시서

> Claude Code에게 전달하여 순차 수행하는 작업 리스트.
> 각 태스크는 독립적으로 완료 가능하도록 설계되어 있음.
> 시작 전 반드시 `docs/` 전체와 `data/*.json`을 먼저 읽고 게임 룰을 이해할 것.

## 프로젝트 배경

- 프로젝트 루트: `D:\all-in\`
- 디자인 문서: `D:\all-in\docs\`
- 카드/부운 데이터: `D:\all-in\data\`
- 핵심 게임명: **ALL-IN (Bloodbet)**
- 타겟: 1:1 대전 카드게임, HP 100 기반, 베팅으로 명중/크리 확률 조정

## 목표

**웹 MVP 개발 전에 CLI로 먼저 룰을 검증한다.**
친구들과 Discord/Zoom 화면공유로 함께 플레이하면서 카드 수치, 페이싱, 재미를 테스트하는 용도.

### CLI 프로토타입이 검증해야 할 것

1. 매 판 3~6턴 안에 결착되는지
2. 직업 밸런스가 체감상 어떤지 (시뮬과 다를 수 있음)
3. 부운 10종이 각각 선택할 만한 가치가 있는지
4. 시그니처 3턴 제한이 적절한지
5. "내가 질러?" "쟤 콜 할까?"의 도파민이 실제로 살아나는지

### CLI 프로토타입이 검증하지 않는 것

- UI/UX (웹 MVP에서)
- 실시간 네트워킹 (웹 MVP에서)
- 아트/사운드 (에셋 제작 별도)

## 기술 스택 결정

**Python 3.11+ 단일 파일 or 패키지 구조.**

이유:
- 사용자가 이미 Python 환경 보유 (시뮬레이션 엔진 경험 있음)
- 빠른 반복 수정 가능
- 터미널 컬러 출력이 네이티브로 쉬움 (`rich` 라이브러리)
- WebSocket 없이 "두 사람이 한 키보드 번갈아 치기" or "같은 컴퓨터 2개 터미널" 방식

**추천 라이브러리:**
- `rich` — 컬러/테이블/프로그레스바 (터미널 UI 핵심)
- `prompt_toolkit` — 인터랙티브 입력 (탭 보완, 히스토리)
- 표준 라이브러리만으로도 가능 (가벼운 버전)

## 플레이 모드 3종

| 모드 | 용도 | 구현 우선순위 |
|---|---|---|
| **Hotseat** | 한 컴퓨터에서 번갈아 플레이. "상대 안 보기" 지시 후 입력 | P1 (필수) |
| **Local vs AI** | 룰 테스트용. 혼자 밸런스 빠르게 검증 | P2 |
| **Network** | TCP 소켓 기반 2P 대전. 친구들과 원격 플레이 | P3 (선택) |
</content>
---

## 프로젝트 구조 (최종 타겟)

```
D:\all-in\
├── cli\                       # ← 새로 만들 CLI 프로토타입
│   ├── pyproject.toml        # 의존성 관리
│   ├── README.md             # CLI 사용법
│   ├── allin\                # 메인 패키지
│   │   ├── __init__.py
│   │   ├── __main__.py       # 엔트리포인트 (python -m allin)
│   │   ├── cards.py          # 카드 데이터 로더 (data/cards.json 읽기)
│   │   ├── boons.py          # 부운 데이터 로더
│   │   ├── engine.py         # 게임 엔진 (룰 전체 구현)
│   │   ├── player.py         # Player 클래스
│   │   ├── ui.py             # 터미널 렌더링 (rich 기반)
│   │   ├── modes\
│   │   │   ├── __init__.py
│   │   │   ├── hotseat.py    # 핫시트 모드
│   │   │   ├── vs_ai.py      # AI 대전 모드
│   │   │   └── network.py    # 네트워크 모드 (선택)
│   │   ├── ai.py             # AI 봇 (기존 ai_v2.py 이식)
│   │   └── utils.py
│   ├── tests\
│   │   ├── test_engine.py
│   │   ├── test_cards.py
│   │   └── test_boons.py
│   └── logs\                 # 게임 로그 저장 (분석용)
└── (기존 docs, data 유지)
```

---

# 작업 태스크 리스트

## 🎯 Task 1: 프로젝트 셋업

**우선순위**: P0 (즉시)
**예상 시간**: 30분
**전제조건**: 없음

### 해야 할 일

1. `D:\all-in\cli\` 디렉토리 생성
2. `pyproject.toml` 작성 (의존성: `rich`, `prompt_toolkit`, `pytest`)
3. 패키지 구조 스캐폴딩 (빈 파일들)
4. `cli/README.md` 작성 (설치 및 실행 방법)
5. `pip install -e .` 로 설치 검증

### 완료 기준

- [ ] `cd D:\all-in\cli && python -m allin --help` 실행 시 에러 없이 동작 (당장은 "Hello" 정도만 출력해도 OK)
- [ ] `pytest` 실행 시 "no tests ran" 이 나오고 에러 없음
- [ ] `README.md` 에 설치/실행 명령어 명시

### 참고

- Python 3.11+ 기준
- `rich` 문서: https://rich.readthedocs.io/
- `__main__.py` 에서 `argparse` 로 서브커맨드 처리 (`hotseat`, `vs-ai`, `network`)
</content>
---

## 🎯 Task 2: 카드/부운 데이터 로더

**우선순위**: P0
**예상 시간**: 1시간
**전제조건**: Task 1 완료

### 해야 할 일

1. `allin/cards.py` — `../data/cards.json` 파싱하는 `Card` dataclass 정의
2. `allin/boons.py` — `../data/boons.json` 파싱하는 `Boon` dataclass 정의
3. `get_deck(class_name) -> List[Card]` 함수 구현
4. `get_all_boons() -> List[Boon]` 함수 구현
5. 모든 카드/부운 필드가 잘 로드되는지 확인하는 테스트 작성

### 완료 기준

- [ ] `Card` dataclass에 id, name, type, category, damage, base_acc 등 JSON 필드 전부 매핑
- [ ] 시그니처 카드 6장이 `card.signature == True` 로 올바르게 마킹됨
- [ ] `tests/test_cards.py`: 광전사/도박사/컨트롤러 각각 15장 로드 테스트
- [ ] `tests/test_boons.py`: 부운 10종 로드 + 카테고리별 필터링 테스트

### 설계 팁

```python
@dataclass
class Card:
    id: str
    name: str
    type: str  # 'hit' | 'crit' | 'fixed' | 'utility'
    category: str
    damage: int = 0
    base_acc: int = 0
    base_crit: int = 0
    crit_mult: float = 1.0
    max_bet: int = 0
    bet_acc: int = 0
    bet_crit: int = 0
    bet_damage: int = 0
    signature: bool = False
    desc: str = ""
    # ... 나머지 선택적 필드
    extra: dict = field(default_factory=dict)  # 복잡한 효과는 dict로
```

카드 효과가 많으니 모든 필드를 dataclass로 풀지 말고, 
자주 쓰는 공통 필드만 명시하고 나머지는 `extra` dict로 두는 게 유연함.

---

## 🎯 Task 3: 게임 엔진 — Player 상태

**우선순위**: P0
**예상 시간**: 2시간
**전제조건**: Task 2 완료

### 해야 할 일

1. `allin/player.py` — `Player` 클래스 정의
2. HP, 덱, 손패, 묘지, 상태효과(독/실드/분노 등) 필드
3. `draw()`, `take_damage()`, `heal()`, `play_card()` 메서드
4. 부운 적용 로직 (시작 HP 수정, 매 턴 회복 등)

### 완료 기준

- [ ] `Player(class_name='berserker', boon=steel_heart_boon)` 생성 시 HP 130 (강철 심장 적용됨)
- [ ] `player.draw(5)` 호출 시 핸드 5장
- [ ] `player.take_damage(20)` 후 HP 올바르게 감소
- [ ] 실드 보유 시 데미지 감쇠 정확히 계산

### 참고 (기존 엔진 재활용)

`/home/claude/allin/engine_v2.py` (이전 세션에서 만든 시뮬 엔진)의 Player 클래스를 그대로 가져다 써도 됨. 단, 원본은 이미 레거시 상태가 있을 수 있으니 디자인 문서 기준으로 재작성 권장.

---

## 🎯 Task 4: 게임 엔진 — 카드 효과 처리

**우선순위**: P0
**예상 시간**: 4시간 (가장 복잡)
**전제조건**: Task 3 완료

### 해야 할 일

1. `allin/engine.py` — `execute_card(card, caster, opponent, bet)` 함수
2. 카드 타입별 분기 (hit/crit/fixed/utility)
3. 조건부 효과 처리 (execute_threshold, condition_hp 등)
4. 45장 전부 올바르게 동작하도록 테스트

### 완료 기준

- [ ] 45장 카드 각각에 대해 최소 1개 유닛 테스트 작성
- [ ] 시그니처 3턴 제한 룰 구현 (게임 시작 후 3턴 이전엔 사용 불가)
- [ ] 같은 턴 시그니처 1장 제한 구현
- [ ] 미러전 금지 룰 구현
- [ ] `tests/test_engine.py` 전체 통과
</content>
### 핵심 로직 예시

```python
def execute_card(card: Card, caster: Player, opponent: Player, bet: int) -> CardResult:
    """카드 실행. 데미지/효과 계산 후 적용."""
    # 1. 베팅 유효성 검사
    bet = min(bet, card.max_bet, caster.hp - 1)  # HP 1은 남김 (자살 방지)
    
    # 2. 베팅 HP 즉시 차감
    caster.hp -= bet
    caster.total_bet += bet
    
    # 3. 피의 환원 부운 적용
    if caster.boon and caster.boon.id == "BN08":
        caster.hp += bet // 2
    
    # 4. 카드 타입별 효과 계산
    if card.type == "hit":
        return execute_hit(card, caster, opponent, bet)
    elif card.type == "crit":
        return execute_crit(card, caster, opponent, bet)
    elif card.type == "fixed":
        return execute_fixed(card, caster, opponent, bet)
    elif card.type == "utility":
        return execute_utility(card, caster, opponent)
    
    raise ValueError(f"Unknown card type: {card.type}")
```

### 주의사항

- 카드별 `desc` 를 꼼꼼히 읽고 구현
- 예외 케이스 많음: "HP 1 남기고 베팅", "시그니처 턴 제한", "조건부 카드(최후의 발악)"
- 이전 세션 Python 시뮬(engine_v2.py)을 참고하되, **디자인 문서가 우선**
- 부운 효과는 엔진에 **전역 수정자**로 적용 (카드 효과 계산 직전/직후에 훅)

---

## 🎯 Task 5: 게임 루프

**우선순위**: P0
**예상 시간**: 2시간
**전제조건**: Task 4 완료

### 해야 할 일

1. `allin/engine.py` 에 `Game` 클래스 정의
2. `Game.run()` — 턴 진행 메인 루프
3. 승리 조건 체크 (HP 0, 15턴 시간초과)
4. 게임 상태 스냅샷 저장 (로깅용)

### 완료 기준

- [ ] `game = Game(p1, p2); result = game.run()` 형태로 게임 한 판 완주
- [ ] 15턴 내 승자 결정
- [ ] 플레이어 턴 교대 올바르게 동작
- [ ] 턴 시작 시 훅 실행 (회복의 가호 부운, 독 데미지, 베르세르크 자해 등)
- [ ] 턴 종료 시 훅 실행

### 게임 루프 의사코드

```python
class Game:
    def __init__(self, p1: Player, p2: Player):
        self.p1 = p1
        self.p2 = p2
        self.turn = 0
        self.current = p1  # 선픽 = p1
        self.log = []
    
    def run(self) -> GameResult:
        while self.turn < 15:
            self.turn += 1
            self.start_turn()
            self.execute_player_turn()
            if self.check_game_end():
                break
            self.end_turn()
            self.switch_current()
        return self.determine_winner()
```

---

## 🎯 Task 6: AI 봇 (룰 검증용)

**우선순위**: P1
**예상 시간**: 2시간
**전제조건**: Task 5 완료

### 해야 할 일

1. `allin/ai.py` — 직업별 휴리스틱 AI 3종
2. `choose_card()`, `decide_bet()`, `pick_boon()`, `pick_class()` 메서드
3. 이전 세션 `ai_v2.py` 를 참고하되 부운 고려 로직 추가

### 완료 기준

- [ ] `BerserkerAI`, `GamblerAI`, `WardenAI` 3종 구현
- [ ] AI vs AI 1000판 시뮬 돌리면 직업별 승률 40~60% 범위
- [ ] `allin/modes/vs_ai.py` 모드 완성 (사람 vs AI 플레이 가능)

### 참고

- AI는 "완벽한 플레이"가 아니라 **밸런스 검증용 대조군**이면 충분
- 사용자가 수동으로 플레이하면서 "이 카드 이렇게 쓰면 되는구나" 감각 잡는 게 목적

---

## 🎯 Task 7: 터미널 UI (rich 기반)

**우선순위**: P0
**예상 시간**: 3시간
**전제조건**: Task 5 완료 (UI는 엔진과 병렬 개발 가능)
</content>
### 해야 할 일

1. `allin/ui.py` — 터미널 렌더링 함수들
2. 게임 보드 출력 (HP 바, 핸드, 묘지)
3. 카드 상세 표시 (ID 입력 시 상세 정보 팝업)
4. 베팅 입력 슬라이더 (숫자 입력 방식, 실시간 명중률 미리보기)
5. 공격 연출 (텍스트 + 딜레이)

### 완료 기준

- [ ] `rich.Console` 로 컬러 출력
- [ ] HP 바: 초록(70%+), 노랑(30~70%), 빨강(30%-)
- [ ] 손패: 숫자 + 카드명 + 타입 표시 (`[1] B3 피의 대가 (Hit)` 형식)
- [ ] 상대 HP, 부운, 상태효과는 항상 보이게
- [ ] "자기 손패만 보임" 모드 (핫시트용)

### 레이아웃 예시

```
┌────────────────────────────────────────────────────────┐
│  상대: 🎲 도박사 (민수)                                  │
│  HP: ████████████░░░░░░░░  72/100                      │
│  🎰 행운의 동전 (부운)                                   │
│  상태: [독 2턴]                                          │
│  손패: [?][?][?][?][?]  묘지: 2장  덱: 10장             │
├────────────────────────────────────────────────────────┤
│                                                          │
│              [ Turn 4 / P1의 턴 ]                        │
│                                                          │
├────────────────────────────────────────────────────────┤
│  나: 🔥 광전사                                           │
│  HP: ████████████████░░░░  85/100                      │
│  ⚔️ 칼날의 축복 (부운)                                    │
│  상태: [분노 x2]                                         │
│                                                          │
│  손패:                                                   │
│   [1] B1 분쇄 일격  (Hit, 18뎀, 명중 40% +6%/베팅)       │
│   [2] B5 처형       (Hit, 30뎀, 상대 HP↓ 시 보너스)      │
│   [3] B11 분노 폭발 (Util, 분노 스택 +1)                 │
│   [4] B7 고통 흡수  (Util, 방어 +12)                     │
│   [5] B9 강철 피부  (Util, 방어 +15)                     │
│                                                          │
│  > 명령: [1-5] 카드 선택 / [q] 턴 종료 / [?] 도움말        │
└────────────────────────────────────────────────────────┘
```

---

## 🎯 Task 8: Hotseat 모드

**우선순위**: P0 (메인 플레이 모드)
**예상 시간**: 2시간
**전제조건**: Task 5, 7 완료

### 해야 할 일

1. `allin/modes/hotseat.py` — 핫시트 게임 모드
2. 게임 시작 → 코인토스 → 직업 선택 → 부운 선택 → 전투
3. "상대에게 화면 보이지 마세요" 경고 후 Enter 대기
4. 자기 턴 끝나면 화면 지우고 "상대에게 넘기세요" 표시

### 완료 기준

- [ ] 두 플레이어가 한 터미널에서 번갈아 플레이 가능
- [ ] 상대 핸드는 화면에 절대 노출되지 않음 (뒷면만)
- [ ] 턴 교대 시 `os.system('cls')` 로 화면 클리어
- [ ] 게임 종료 후 승자/패자 화면 + 통계 (총 베팅 HP, 최대 데미지 등)

### 화면 전환 플로우

```
1. "플레이어 1 차례입니다. 플레이어 2는 시선을 돌려주세요. [Enter]"
2. [클리어 후 P1 턴 진행]
3. "플레이어 2에게 넘겨주세요. [Enter]"
4. [클리어]
5. "플레이어 2 차례입니다. 플레이어 1은 시선을 돌려주세요. [Enter]"
6. [클리어 후 P2 턴 진행]
7. 반복
```

---

## 🎯 Task 9: 게임 로그 시스템

**우선순위**: P1
**예상 시간**: 1시간
**전제조건**: Task 5 완료

### 해야 할 일

1. `allin/logger.py` — 게임 진행 JSON/TXT 로그
2. 턴별 상태 스냅샷, 사용 카드, 베팅액, 결과 기록
3. `logs/YYYY-MM-DD_HHMMSS.json` 형식으로 저장

### 완료 기준

- [ ] 게임 종료 시 `logs/` 에 JSON 파일 생성
- [ ] 로그에 포함: 양쪽 직업/부운, 턴별 행동, 최종 승패
- [ ] 사람이 읽기 좋은 요약 `logs/*.txt` 도 같이 생성
- [ ] 로그 파일 크기 과하면 압축 (선택)

### 활용

- 친구들과 플레이 후 "아 그 카드 개사기잖아" 발언 나오면 로그 보고 수치 조정
- 밸런스 이슈 발견 시 `docs/06-balance-notes.md` 에 히스토리 기록
</content>
---

## 🎯 Task 10: 밸런스 시뮬레이션 재구현

**우선순위**: P1
**예상 시간**: 2시간
**전제조건**: Task 5, 6 완료

### 해야 할 일

1. `cli/scripts/simulate.py` — AI vs AI 대량 시뮬
2. 부운 시스템 포함 (이전 세션에서 누락됨)
3. 매치업별 통계 + 부운별 통계 출력
4. matplotlib 차트 자동 생성 (선택)

### 완료 기준

- [ ] `python -m allin.scripts.simulate --games 10000` 실행 가능
- [ ] 출력: 직업별 승률, 매치업 승률, 부운별 픽률/승률
- [ ] 결과가 `docs/06-balance-notes.md` 의 히스토리 섹션에 자동 append 되는 스크립트 (선택)

### 검증 항목 (시뮬 결과로 확인)

- [ ] 직업별 승률 50% ± 7%
- [ ] 부운 픽률 균등성 (각 부운 5~15% 범위)
- [ ] 평균 게임 길이 3~6턴
- [ ] 첫 턴 즉사 콤보 5% 미만

### 밸런스 이슈 발견 시

카드/부운 수치 조정 전에 먼저:
1. `docs/06-balance-notes.md` 에 이슈 기록
2. 가설 수립 (예: "G15 올인 크리 배수가 너무 큼")
3. 수정안 설계
4. 수정 후 재시뮬 비교

**절대 룰**: 한 번에 여러 카드 수정 금지. 한 변경에 한 번 검증.

---

## 🎯 Task 11: AI 대전 모드

**우선순위**: P2
**예상 시간**: 1시간
**전제조건**: Task 6, 8 완료

### 해야 할 일

1. `allin/modes/vs_ai.py` — 플레이어 vs AI
2. 난이도 설정 (easy: 랜덤, normal: 휴리스틱, hard: 최적화 휴리스틱)
3. AI의 의사결정을 로그로 노출 (배우는 용도)

### 완료 기준

- [ ] `python -m allin vs-ai --class berserker --difficulty normal`
- [ ] AI가 카드 선택/베팅 결정 시 간단한 이유 표시 ("상대 HP 낮음 → 처형 시도")
- [ ] 혼자서 룰 익히기 모드로 활용 가능

---

## 🎯 Task 12: 네트워크 대전 모드 (선택)

**우선순위**: P3
**예상 시간**: 4시간
**전제조건**: Task 8 완료

### 해야 할 일

1. `allin/modes/network.py` — TCP 소켓 기반 2P
2. 호스트/클라이언트 구조 (한 명이 서버, 한 명이 접속)
3. 간단한 프로토콜: JSON 메시지 교환

### 완료 기준

- [ ] `python -m allin host --port 5555` (호스트)
- [ ] `python -m allin join --host 1.2.3.4 --port 5555` (참가)
- [ ] 두 컴퓨터에서 연결 후 실제 플레이 가능
- [ ] 치팅 방지는 필요 없음 (내수용이라 신뢰 가정)

### 구현 팁

- 복잡한 상태 동기화 피하기 위해 **서버가 게임 엔진 소유**
- 클라이언트는 행동(카드 선택, 베팅)만 서버에 전송
- 서버가 결과를 양쪽에 브로드캐스트
- `asyncio` 또는 `socket` 표준 라이브러리만으로 충분

---

# 작업 우선순위 요약

## Phase 1: MVP (Hotseat 플레이 가능)
1. ✅ Task 1: 프로젝트 셋업
2. ✅ Task 2: 데이터 로더
3. ✅ Task 3: Player 상태
4. ✅ Task 4: 카드 효과 엔진 ← **가장 무거운 작업**
5. ✅ Task 5: 게임 루프
6. ✅ Task 7: 터미널 UI
7. ✅ Task 8: Hotseat 모드

**Phase 1 완료 시**: 친구와 한 컴퓨터에서 함께 플레이 가능. 룰 검증 시작.

## Phase 2: 밸런스 검증
8. ✅ Task 6: AI 봇
9. ✅ Task 9: 게임 로그
10. ✅ Task 10: 시뮬레이션

**Phase 2 완료 시**: 수치 조정 루프 확립. 1만 판 시뮬 돌려가며 밸런싱.

## Phase 3: 편의 기능 (선택)
11. Task 11: AI 대전 모드
12. Task 12: 네트워크 대전
</content>
---

# Claude Code 실행 가이드

## 대화 시작 시 전달할 프롬프트

```
D:\all-in\ 프로젝트의 CLI 프로토타입을 개발한다.
먼저 아래 문서를 순서대로 읽고 게임 룰을 이해해라:

1. D:\all-in\README.md
2. D:\all-in\docs\01-game-overview.md
3. D:\all-in\docs\02-classes.md
4. D:\all-in\docs\03-cards.md
5. D:\all-in\docs\04-boons.md
6. D:\all-in\docs\05-game-flow.md
7. D:\all-in\data\cards.json (카드 데이터 구조 파악)
8. D:\all-in\data\boons.json (부운 데이터 구조 파악)

그 다음 D:\all-in\TASKS.md 를 읽고 Task 1부터 순차적으로 진행해라.
각 Task 완료 후 "완료 기준" 체크리스트를 모두 확인하고 
다음 Task로 넘어가기 전에 내게 보고해라.
```

## Claude Code 작업 원칙

### 1. Task 단위로 끊어서 진행
- 한 Task 완료 → 완료 보고 → 다음 Task 시작
- 여러 Task 동시 진행 금지
- 완료 기준 체크리스트 모두 통과해야 "완료"

### 2. 테스트 우선
- Task 2 이후부터는 **구현 전에 테스트 작성** 권장
- `pytest` 통과 안 하면 Task 완료 아님
- 테스트 커버리지는 핵심 로직 위주 (UI는 제외 OK)

### 3. 디자인 문서가 진실
- 카드/부운 수치는 `data/*.json` 이 정답
- 룰은 `docs/` 가 정답
- 모호한 점은 질문 (추측 금지)

### 4. 밸런스 수정 금지 (당장은)
- Task 진행 중 "이 카드 이상하네" 생각이 들어도 **수치 수정 금지**
- 이슈는 `docs/06-balance-notes.md` 에 기록만
- 수치 조정은 Task 10 시뮬 돌린 후 사용자와 합의

### 5. 커밋 단위
- 매 Task 완료 시 Git 커밋 (Git 쓰는 경우)
- 커밋 메시지: `feat: task N - [태스크명]`
- 세부 변경은 중간 커밋 OK

## 예상 소요 시간 총계

| Phase | Task 수 | 예상 시간 |
|---|---|---|
| Phase 1 (MVP) | 7개 | 14~16시간 |
| Phase 2 (밸런스) | 3개 | 5시간 |
| Phase 3 (선택) | 2개 | 5시간 |
| **합계** | **12개** | **24~26시간** |

Claude Code 기준 Phase 1까지 1~2일, 전체 3~4일 예상.

## 문제 발생 시 에스컬레이션

Claude Code 가 다음 상황에 직면하면 즉시 사용자에게 물어볼 것:

- 디자인 문서와 JSON 데이터가 충돌함
- 카드 효과가 다른 카드와 상호작용할 때 처리 우선순위 불명확
- 라이브러리 선택이 여러 옵션일 때 (rich vs textual 등)
- 테스트가 계속 실패해서 구현 방향 자체가 의심될 때

추측해서 진행하지 말 것.

---

# 후속 작업 (CLI 완성 후)

CLI로 룰/밸런스 검증이 끝나면 웹 MVP 개발로 넘어감. 이때 별도 `TASKS-WEB.md` 작성 예정.

웹 MVP 예상 작업:
- 프론트엔드 (Vanilla JS + Vite)
- 백엔드 (Supabase Realtime 또는 PartyKit)
- 에셋 제작 (`docs/07-assets.md` 참고)
- 서버 권위형 상태 관리
- 배포 (Vercel)

CLI 엔진 코드는 웹 MVP에서도 상당 부분 재사용 가능 (Python → JS 포팅 or Python 백엔드 유지).
</content>