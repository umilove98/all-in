# ALL-IN CLI

ALL-IN (Bloodbet) 프로토타입 — 터미널에서 돌리는 1:1 카드 도박 게임.

## 설치

```bash
cd D:\all-in\cli
python -m venv .venv
.venv\Scripts\activate     # Windows
# source .venv/bin/activate # macOS/Linux
pip install -e ".[dev]"
```

## 실행

```bash
# 엔트리포인트 (개발 중엔 패키지 모드 추천)
python -m allin --help

# 플레이 모드
python -m allin hotseat              # 한 컴퓨터에서 번갈아 플레이
python -m allin vs-ai                # 사람 vs AI
python -m allin host --port 5555     # 네트워크 호스트
python -m allin join --host 1.2.3.4 --port 5555
```

## 테스트

```bash
pytest
```

## 구조

```
cli/
├── allin/                # 패키지
│   ├── __main__.py       # argparse 엔트리
│   ├── cards.py          # data/cards.json 로더
│   ├── boons.py          # data/boons.json 로더
│   ├── engine.py         # 게임 엔진
│   ├── player.py         # Player 클래스
│   ├── ui.py             # 터미널 UI
│   ├── ai.py             # AI 봇
│   ├── logger.py         # 게임 로그
│   └── modes/            # hotseat / vs_ai / network
├── tests/                # pytest
├── scripts/              # 시뮬레이션 스크립트
└── logs/                 # 플레이 로그 저장
```

## 데이터 파일

`cli/` 외부의 `D:\all-in\data\cards.json`, `boons.json` 을 읽어옴.
디자인 문서는 `D:\all-in\docs\` 참고.
