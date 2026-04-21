# ALL-IN Web MVP

## 설치

```bash
cd D:\all-in\web
npm install
```

## 개발

```bash
# 프론트 (Vite)
npm run dev                 # http://localhost:5173

# PartyKit 서버 (WebSocket)
npm run party               # ws://127.0.0.1:1999
```

## 테스트

```bash
npm run test
```

## 배포

### 1. PartyKit (서버)

```bash
cd D:\all-in\web
npx partykit login           # 브라우저로 GitHub OAuth
npm run party:deploy
# → 배포 완료 URL 확인: https://allin.<your-user>.partykit.dev
```

### 2. Vercel (프론트)

방법 A — GitHub 연동 (권장):
1. 저장소를 GitHub 에 push
2. [vercel.com/new](https://vercel.com/new) 에서 import
3. **Root Directory**: `web`
4. **Environment Variables**:
   - `VITE_PARTYKIT_HOST` = `allin.<your-user>.partykit.dev`
5. Deploy

방법 B — CLI:
```bash
npm i -g vercel
cd D:\all-in\web
echo "VITE_PARTYKIT_HOST=allin.<your-user>.partykit.dev" > .env.production
vercel --prod
```

### 3. 검증

배포된 URL 로 접속 → 방 만들기 → 다른 기기에서 URL 열어 참가 → 플레이.
PartyKit 은 `wss://` 로 자동 업그레이드되므로 별도 설정 불필요.

## 구조

```
web/
├── src/
│   ├── engine/       # TS 엔진 (Python cli/ 포팅)
│   ├── net/          # PartyKit 클라이언트 + 프로토콜
│   ├── ui/           # 화면 렌더 함수
│   └── main.ts
├── party/
│   └── server.ts     # PartyKit 서버 (방 = 1 Durable Object)
├── tests/            # Vitest
└── public/           # 정적 에셋
```

## 데이터 소스

`D:\all-in\data\cards.json`, `boons.json` 을 `fetch`/`import` 해서 공유.
수치 변경은 data/ 에만 하고 서버/클라 재빌드.
