# 07. 에셋 라인업 & AI 이미지 프롬프트

## 개요

ALL-IN 웹게임에 필요한 이미지/사운드/UI 에셋 전체 라인업.
각 에셋에 대해 **AI 이미지 생성 툴용 프롬프트**(Midjourney/NovelAI/DALL-E 공용) 동봉.

## 전체 아트 컨셉 가이드

### 비주얼 톤

- **장르**: 다크 판타지 + 카지노 분위기
- **색상 팔레트**: 핏빛 레드 (#8B0000), 골드 (#D4AF37), 딥 블랙 (#0A0A0A), 크림소 화이트 (#F5EBDC)
- **분위기**: 어두운 도박장, 피로 물든 카드, 촛불 조명
- **대비 강조**: 직업별 색상 (광전사 🔴, 도박사 🟣, 컨트롤러 🔵)

### 스타일 키워드 (모든 프롬프트 공통)

```
dark fantasy, gothic casino aesthetic, blood-stained cards, candlelit atmosphere, 
high contrast lighting, cinematic composition, painterly digital art,
deep shadows, rim lighting, dramatic mood
```

### 해상도 권장

- **캐릭터 일러스트 (풀샷)**: 1024 × 1536 (세로)
- **캐릭터 아바타 (원형)**: 512 × 512
- **카드 아트**: 512 × 768
- **배경**: 1920 × 1080
- **UI 아이콘**: 128 × 128, 투명 배경 PNG

---

## 1. 캐릭터 아트 (직업 3종)

### 각 직업마다 필요한 에셋

| 용도 | 해상도 | 수량 |
|---|---|---|
| 직업 선택 팝업 풀샷 | 1024×1536 | 1 |
| 게임판 아바타 (원형) | 512×512 | 1 |
| 승리 포즈 | 1024×1536 | 1 |
| 패배/다운 포즈 | 1024×1536 | 1 |
| 시그니처 컷인 (×2) | 1920×1080 | 2 |

**직업당 총 6장, 3직업 × 6 = 18장**
</content>
---

### 🔥 광전사 (Berserker) 프롬프트

**공통 베이스**:
> A battle-scarred warrior with unkempt dark red hair and crimson eyes, 
> bare muscular torso covered in ritual scars and fresh wound marks, 
> wielding a massive two-handed axe stained with dried blood, 
> wearing tattered leather pants and iron gauntlets, 
> primal and feral aura, self-inflicted wounds visible on arms.

#### 광전사 - 풀샷 (직업 선택용)
```
[BASE] A battle-scarred warrior with unkempt dark red hair and crimson eyes, 
bare muscular torso covered in ritual scars and fresh wound marks, 
wielding a massive two-handed axe stained with dried blood,
standing in a dark arena with candles, full body shot, facing viewer, 
confident wild grin, blood dripping from axe, dark fantasy gothic casino aesthetic, 
cinematic lighting from below, painterly digital art, 1024x1536
```

#### 광전사 - 아바타 (원형 아이콘)
```
[BASE] close-up portrait of the berserker, snarling face with bloody lips, 
circular composition, symmetric framing, dark red and black color scheme, 
512x512, vignette
```

#### 광전사 - 승리 포즈
```
[BASE] raising the bloody axe overhead with a triumphant roar, 
blood splattered across face and chest, backlit by crimson light, 
low angle heroic shot, victory pose, dark fantasy
```

#### 광전사 - 패배 포즈
```
[BASE] kneeling on one knee, axe dropped beside, head down, 
blood pooling around, broken and exhausted, defeated pose, 
dim candlelight flickering out
```

#### 광전사 - 시그니처 컷인 1: "피의 광기"
```
extreme close-up of the berserker's face, one eye wide open with crimson veins glowing, 
blood streaming down face, mouth open in feral scream, 
insanity and rage expression, dramatic horror lighting, 
cinematic cutin composition, blood splatter overlay, 1920x1080
```

#### 광전사 - 시그니처 컷인 2: "베르세르크"
```
full body action shot, berserker mid-charge with axe raised high, 
red aura surrounding body, motion blur, 
blood spraying from self-inflicted wounds, 
dynamic diagonal composition, explosion of red particles, 1920x1080
```
</content>
---

### 🎲 도박사 (Gambler) 프롬프트

**공통 베이스**:
> A suave charismatic gambler with slicked-back dark purple hair and 
> mismatched eyes (one gold, one violet), wearing an elegant dark purple tailcoat 
> with gold embroidery, unbuttoned white dress shirt, loose black cravat, 
> white gloves, holding a deck of cards between long fingers, 
> confident smirk with a hint of madness.

#### 도박사 - 풀샷 (직업 선택용)
```
[BASE] standing behind a casino table with scattered playing cards and golden coins, 
full body shot, leaning casually with one hand on the table, 
fanning a hand of cards with the other, 
dark purple and gold color palette, candelabra lighting behind,
dark fantasy gothic casino aesthetic, painterly digital art, 1024x1536
```

#### 도박사 - 아바타 (원형)
```
[BASE] close-up portrait, one eye closed in a wink, holding a single card to their lips, 
knowing smile, circular composition, purple and gold tones, 512x512
```

#### 도박사 - 승리 포즈
```
[BASE] tossing a handful of cards into the air, laughing, gold coins raining down, 
confident winner pose, victory bow gesture, purple light glow, 
dark casino backdrop
```

#### 도박사 - 패배 포즈
```
[BASE] slumped in a chair, cards scattered on the floor, hat tipped over eyes, 
empty wine glass beside, gambler who lost it all, 
dimmed purple lighting, somber mood
```

#### 도박사 - 시그니처 컷인 1: "마크된 운명"
```
hands close-up shot, flipping a card that glows with golden light, 
trail of glowing card suits (♠♥♦♣) floating around hand, 
mystical fate energy, time seeming to slow, 
dramatic magical realism, 1920x1080
```

#### 도박사 - 시그니처 컷인 2: "올인"
```
dramatic shot of gambler pushing ALL chips and cards forward across the table, 
maniacal wide grin with gleaming teeth, eyes wide and feverish, 
gold coins flying, cards spinning mid-air, 
high-stakes moment, intense backlight, 1920x1080
```
</content>
---

### 🛡️ 컨트롤러 (Warden) 프롬프트

**공통 베이스**:
> A solemn templar warden with silver hair in a tight braid, cold blue eyes, 
> wearing heavy sapphire-blue plate armor with gold filigree, 
> a long flowing cape, holding a tall tower shield in one hand and a scepter in the other, 
> stoic dignified posture, halo of faint blue light.

#### 컨트롤러 - 풀샷 (직업 선택용)
```
[BASE] standing with tower shield planted firmly in the ground, 
full body shot, regal and imposing, 
gothic cathedral interior with stained glass behind, 
blue and gold color palette, holy light from above, 
dark fantasy gothic aesthetic, painterly digital art, 1024x1536
```

#### 컨트롤러 - 아바타 (원형)
```
[BASE] close-up portrait, eyes closed in meditation, gentle blue glow on face, 
serene expression, circular composition, sapphire and gold tones, 512x512
```

#### 컨트롤러 - 승리 포즈
```
[BASE] scepter raised to the sky, blue light beam descending from above, 
shield held forward as if judgment delivered, 
stoic triumphant pose, divine authority manifested
```

#### 컨트롤러 - 패배 포즈
```
[BASE] shield broken in half on the ground, armor cracked, 
kneeling with head bowed, scepter dim and flickering, 
fallen guardian, muted blue lighting
```

#### 컨트롤러 - 시그니처 컷인 1: "무효 선언"
```
warden slamming the scepter down, shockwave of blue energy spreading outward, 
geometric magical barrier appearing in mid-air, 
runes and glyphs circling, divine judgment moment, 
cold blue light with gold accents, 1920x1080
```

#### 컨트롤러 - 시그니처 컷인 2: "최후의 심판"
```
warden with eyes glowing pure white, arms spread wide, 
towering column of golden light descending from the sky, 
scales of justice appearing above, divine retribution, 
epic scale and grandeur, biblical imagery, 1920x1080
```
</content>
---

## 2. 카드 아트 (45장)

### 카드 프레임 디자인

전체 카드 공통 프레임 먼저 제작, 그 위에 카드별 일러스트 + 텍스트.

#### 카드 프레임 - 공격 카드 (빨강)
```
ornate tarot card frame, blood red with dark iron borders, 
gothic filigree decoration, skull motifs on corners, 
parchment background with bloodstains, 
empty center area for illustration, 512x768, 
game asset, transparent center window
```

#### 카드 프레임 - 방어/유틸 (은색)
```
ornate tarot card frame, silver and cold blue, 
angelic filigree decoration, shield motifs on corners, 
marble background with subtle cracks, 
empty center area for illustration, 512x768, 
game asset, transparent center window
```

#### 카드 프레임 - 시그니처 (황금)
```
legendary tier card frame, pure gold with black accents, 
elaborate royal decoration, crown and lightning motifs, 
swirling divine light background, 
empty center area for illustration, 512x768, 
ultra-rare appearance, shimmering effect
```

### 카드 일러스트 프롬프트 (핵심 카드 샘플)

45장 전체는 방대하므로 **직업별 시그니처 6장 + 주력 공격 카드** 우선순위로 제작 권장. 
나머지는 기본 프레임에 텍스트만으로도 초기 MVP 가능.

#### 광전사 핵심 카드

**B1. 분쇄 일격**
```
a massive battle axe cleaving downward, motion blur on the blade, 
sparks flying, blood spatter, dark fantasy, 512x768, dramatic angle
```

**B5. 처형**
```
executioner's axe embedded in a kneeling figure's shadow, 
crimson splatter radiating outward, grim finality, 
silhouette composition, 512x768
```

**B14. ⚡ 피의 광기 (시그니처)**
```
glowing red eye surrounded by swirling blood, 
magical runes of rage, tribal markings, 
otherworldly madness manifested, 512x768, legendary card art
```

**B15. ⚡ 베르세르크 (시그니처)**
```
silhouette of the berserker consumed by a crimson aura, 
chains of restraint breaking off, veins glowing red, 
primal transformation moment, 512x768, legendary
```
</content>
#### 도박사 핵심 카드

**G1. 카드 던지기**
```
a hand of playing cards fanning outward mid-air, each card trailing purple light, 
gambler's trick shot, dynamic spiral composition, 512x768
```

**G4. 잭팟**
```
slot machine reels aligning on three glowing cherries, 
coins explosion bursting forth, purple and gold lighting, 
jackpot moment, retro-gothic casino art, 512x768
```

**G14. ⚡ 마크된 운명 (시그니처)**
```
a single playing card floating in the air, marked with glowing golden runes, 
threads of fate weaving around it, mystical and ominous, 
cosmic background with constellations, 512x768, legendary
```

**G15. ⚡ 올인 (시그니처)**
```
massive pile of poker chips and cards being pushed across a dark table, 
chip tower falling, golden coins spilling, gambler's hand in frame, 
ultimate bet moment, 512x768, legendary
```

#### 컨트롤러 핵심 카드

**W1. 정의의 일격**
```
a gleaming scepter striking downward with divine light trail, 
rays of blue and gold bursting from impact, 
ornate holy imagery, 512x768
```

**W7. 방패 강타**
```
a heavy tower shield charging forward, crushing force, 
shockwave rippling outward, stalwart defender's attack, 512x768
```

**W14. ⚡ 무효 선언 (시그니처)**
```
hexagonal magical barrier forming around a central figure, 
glyphs and runes freezing mid-air, 
time-stopping magic moment, cold blue and gold, 512x768, legendary
```

**W15. ⚡ 최후의 심판 (시그니처)**
```
golden scales of justice hovering in sky, 
pillars of divine light descending upon earth, 
celestial judgment scene, biblical grandeur, 512x768, legendary
```

### 카드 일러스트 우선순위

**Phase 1 (MVP, 필수 제작)**: 시그니처 6장, 주력 공격 9장 (B1,B5,B8,G1,G4,G6,W1,W5,W8) — 총 15장
**Phase 2 (정식 출시)**: 나머지 공격 카드 12장
**Phase 3 (풀 에셋)**: 모든 방어/유틸 18장
</content>
---

## 3. 부운 아이콘 (10종)

### 스타일 가이드

- 128×128 원형 또는 뱃지형 아이콘
- 투명 배경 PNG
- 직업 아트와 동일한 다크 판타지 톤
- 각 카테고리별 색상 톤 (안정=초록, 공격=빨강, 도박=보라, 유틸=금색)

### 부운 프롬프트

**BN01. 🩸 강철 심장**
```
an anatomical heart made of dark iron with blood crystals inside, 
pulsating with life, ornate gothic icon, green healing aura, 
128x128 circular badge, transparent background
```

**BN02. 🛡️ 견고한 의지**
```
a small kite shield crossed with a feather, 
symbolizing protection and resolve, silver and green tones, 
circular badge icon, 128x128, transparent
```

**BN03. 💚 회복의 가호**
```
a glowing green chalice with golden liquid overflowing, 
warm healing light emanating, sacred holy item, 
circular badge, 128x128, transparent
```

**BN04. ⚔️ 칼날의 축복**
```
a crossed pair of glowing swords with runic inscriptions, 
red power aura, razor-sharp edges, 
circular badge icon, 128x128, transparent
```

**BN05. 🎯 정밀의 눈**
```
a stylized eye with crosshair iris, sharp and piercing gaze, 
red and gold color scheme, mystical accuracy, 
circular badge, 128x128, transparent
```

**BN06. 🔥 광기의 인장**
```
a burning brand mark in the shape of a roaring flame with horns, 
infernal and aggressive, red and orange fire, 
circular badge, 128x128, transparent
```

**BN07. 🎰 행운의 동전**
```
a spinning gold coin with different symbols on each face, 
motion blur, purple lucky aura, casino chip aesthetic, 
circular badge, 128x128, transparent
```

**BN08. 💸 피의 환원**
```
a droplet of blood being caught mid-fall by a golden vial, 
transformation magic, red and gold, alchemy symbolism, 
circular badge, 128x128, transparent
```

**BN09. 🃏 풍요의 손**
```
a jester's hand holding an overflowing fan of cards, 
golden coins spilling, abundance symbolism, 
circular badge, 128x128, transparent
```

**BN10. 👁️ 예지의 눈동자**
```
a third eye opening in the middle of a forehead, 
cosmic constellation patterns around it, 
all-seeing mystical symbol, deep purple and gold, 
circular badge, 128x128, transparent
```
</content>
---

## 4. 배경 에셋

### 대기실 배경
```
a dark gothic tavern interior, round tables with playing cards, 
flickering candles, wooden beams, medieval atmosphere with casino elements, 
empty atmosphere awaiting players, 1920x1080, cinematic composition
```

### 게임판 배경 (가장 중요)
```
top-down view of an ornate gothic gambling table, 
dark wood with red velvet center, gold trim, 
positioned for two players facing each other, 
candelabras on both sides casting warm light, 
scattered playing cards and chips around edges, 
dark fantasy casino aesthetic, 1920x1080, highly detailed
```

### 직업 선택 배경
```
three gothic stone pillars in a dark hall, 
each pillar bathed in different colored light (red, purple, blue), 
candles and banners hanging, sense of choice and destiny, 
fog at the floor level, 1920x1080, dramatic symmetric composition
```

### 부운 선택 배경
```
a mystical altar surrounded by floating cards and runes, 
cosmic starfield background, three pedestals awaiting offerings, 
magical and fateful atmosphere, dark fantasy with divine touches, 
1920x1080
```

### 승리 화면 배경
```
triumphant golden light rays bursting from center, 
confetti of cards and coins falling, 
royal fanfare atmosphere, 1920x1080
```

### 패배 화면 배경
```
dark and somber scene, fallen cards scattered on ground, 
single flickering candle, mist rolling in, 
muted grayscale tones with subtle red accents, 1920x1080
```

---

## 5. UI 아이콘

128×128 투명 PNG, 깔끔한 라인 스타일.

### UI 아이콘 공통 스타일
```
flat minimalist UI icon, white line on dark background, 
clean gothic art style, 128x128, transparent background, game UI
```

### 필수 아이콘 목록

| 용도 | 프롬프트 키워드 |
|---|---|
| HP 하트 | anatomical heart outline, simple |
| 공격력 검 | crossed swords icon |
| 방어력 방패 | kite shield icon |
| 베팅 코인 | stack of coins icon |
| 명중률 과녁 | bullseye target icon |
| 크리티컬 눈 | eye with crosshair icon |
| 덱 카드뭉치 | stacked cards icon |
| 묘지 해골 | skull on cards icon |
| 타이머 모래시계 | hourglass icon |
| 턴 종료 | end turn arrow icon |
| 설정 기어 | gear icon |
| 나가기 문 | door exit icon |
| 채팅 말풍선 | speech bubble icon |
| 음소거 스피커 | muted speaker icon |
</content>
---

## 6. 이펙트 에셋

게임 중 카드 발동 시 보여줄 이펙트. 스프라이트 시트 또는 Lottie 애니메이션으로 제작 가능.

### 이펙트 목록

| 이펙트 | 용도 | 형태 |
|---|---|---|
| 피격 이펙트 | 공격 카드 명중 | 빨간 십자 슬래시, 60fps 8프레임 |
| MISS 텍스트 | 빗나감 | 회색 "MISS" 플로팅 |
| CRITICAL 텍스트 | 크리 발동 | 금색 "CRITICAL!" 화면 중앙 플래시 |
| 데미지 숫자 | 공통 | 빨간 숫자 팝업 |
| 힐 이펙트 | 회복 | 녹색 상승 파티클 |
| 독 이펙트 | 독 상태 | 보라 방울 파티클 |
| 쉴드 이펙트 | 방어 | 파란 육각 방패 오라 |
| 베팅 이펙트 | HP 베팅 | 빨간 피 방울이 카드로 흘러감 |
| 코인토스 | 게임 시작 | 금색 코인 회전 애니메이션 |

### AI 이펙트 생성 프롬프트 (예시)

**피격 이펙트**
```
bright red diagonal slash effect, 8 frames animation spritesheet, 
game VFX, impact moment, transparent background, 512x512 per frame
```

**크리 이펙트**
```
golden explosion burst effect, radial lines, shockwave, 
game VFX critical hit, transparent background, 
6 frames spritesheet, 512x512
```

**코인 토스**
```
gold coin spinning animation, 3D metallic coin with engraved symbol, 
12 frame sequence showing full rotation, transparent background, 512x512
```

---

## 7. 사운드 에셋 (참고)

AI 이미지 생성 범위 밖이지만 라인업만 정리.

### BGM (음악)

| 장면 | 분위기 |
|---|---|
| 타이틀/대기실 | 차분한 재즈 + 긴장감 (Casino Noir 느낌) |
| 직업 선택 | 미스터리한 Pad + 심장박동 |
| 전투 | 빠른 드럼 + 불안한 스트링 |
| 크리티컬 순간 | 일시 정지 + 리버브 사운드 |
| 승리 | 장엄한 팡파르 |
| 패배 | 가라앉는 피아노 |

**추천 소스**: Pixabay, Freesound.org (CC0 라이센스), Suno AI (유료 생성)

### SFX (효과음)

- 카드 뽑기, 카드 버리기
- 버튼 클릭, Hover
- 코인 떨어짐 (베팅)
- 칼날 휘두름 (공격)
- 방패 부딪힘 (방어)
- 힐 차임, 독 슬라임
- 크리티컬 "칭!"
- 승리 팡파르, 패배 비명
</content>
---

## 8. AI 이미지 생성 툴별 가이드

### Midjourney (추천: 캐릭터/배경 일러스트)
- **강점**: 시네마틱 퀄리티, 일관된 스타일, 판타지 아트 최강
- **파라미터 예시**: `--ar 2:3 --style raw --v 6 --s 250`
- **워크플로우**: 프롬프트 → v 버튼으로 variation → 선택 후 upscale
- **캐릭터 일관성**: `--cref [이미지URL]` 옵션으로 여러 포즈에 동일 캐릭터 유지

### NovelAI (추천: 애니 스타일로 전환 시)
- **강점**: 애니메 스타일, Aseprite와 조합 좋음 (빨간약 방송국 파이프라인과 동일)
- **단점**: 사실적 다크판타지 톤은 미드저니 대비 약함
- **대안**: 프롬프트를 애니 톤으로 수정 후 사용

### DALL-E 3 / ChatGPT
- **강점**: 아이콘, UI 요소 깔끔
- **단점**: 캐릭터 일관성 약함
- **추천 용도**: 부운 아이콘 10종, UI 아이콘

### Stable Diffusion (로컬)
- **강점**: 커스텀 LoRA 훈련 가능, 무제한 생성
- **추천 모델**: 
  - 다크 판타지: `RealisticVisionV6`, `JuggernautXL`
  - 일러스트: `DreamShaperXL`, `AnythingV5`
- **ComfyUI**: 복잡한 워크플로우 구성 가능 (캐릭터 일관성 + 업스케일 파이프라인)

### 추천 조합 워크플로우

1. **Midjourney로 캐릭터 풀샷 생성** → `--cref` 또는 Style Reference 저장
2. **해당 참조로 승리/패배/시그니처 포즈 생성** (일관된 캐릭터)
3. **Stable Diffusion (ControlNet)** 으로 포즈 변형 또는 미세 수정
4. **DALL-E 3** 로 아이콘/UI 요소 별도 생성
5. **Photoshop/GIMP** 로 후보정 (투명 배경, 컬러 톤 통일)

---

## 9. 에셋 제작 우선순위 및 로드맵

### Phase 1: MVP (2주 목표)
**필수 에셋 — 게임이 돌아갈 최소 수준**

| 에셋 | 수량 | 예상 시간 |
|---|---|---|
| 직업 풀샷 | 3 | 3시간 |
| 직업 아바타 (원형) | 3 | 1시간 |
| 부운 아이콘 | 10 | 2시간 |
| 카드 프레임 (3종) | 3 | 2시간 |
| 시그니처 카드 아트 | 6 | 3시간 |
| 게임판 배경 | 1 | 1시간 |
| UI 아이콘 | 14 | 2시간 |
| **합계** | **40** | **~14시간** |

### Phase 2: 정식 출시 (추가 1주)
- 나머지 공격 카드 아트 24장
- 승리/패배 포즈 6장
- 시그니처 컷인 6장
- 기본 이펙트 스프라이트 8종

### Phase 3: 풀 에셋 (추가 1주)
- 모든 방어/유틸 카드 아트 15장
- 고급 이펙트 및 애니메이션
- 음악/SFX
- 로비/메뉴 배경

### 비용 예상 (유료 AI 툴 기준)

- Midjourney Standard Plan: 월 $30 (무제한 Relax 모드)
- DALL-E 3 (ChatGPT Plus): 월 $20
- **MVP 총 예상 비용**: $50 (1개월 구독)

---

## 10. 파일 저장 구조 제안

```
D:\all-in\
├── assets\
│   ├── characters\
│   │   ├── berserker\
│   │   │   ├── portrait.png
│   │   │   ├── avatar.png
│   │   │   ├── victory.png
│   │   │   ├── defeat.png
│   │   │   ├── signature_1.png
│   │   │   └── signature_2.png
│   │   ├── gambler\
│   │   └── warden\
│   ├── cards\
│   │   ├── frames\
│   │   │   ├── attack_frame.png
│   │   │   ├── utility_frame.png
│   │   │   └── signature_frame.png
│   │   ├── berserker\
│   │   │   ├── B1_smash.png
│   │   │   └── ...
│   │   ├── gambler\
│   │   └── warden\
│   ├── boons\
│   │   ├── BN01_steel_heart.png
│   │   └── ...
│   ├── backgrounds\
│   │   ├── lobby.jpg
│   │   ├── gameboard.jpg
│   │   ├── class_select.jpg
│   │   ├── boon_select.jpg
│   │   ├── victory.jpg
│   │   └── defeat.jpg
│   ├── ui\
│   │   └── icons\
│   │       ├── hp.svg
│   │       └── ...
│   └── effects\
│       ├── slash.png (스프라이트시트)
│       ├── critical.png
│       └── ...
└── sounds\ (Phase 3)
    ├── bgm\
    └── sfx\
```

---

## 요약

| 카테고리 | 수량 | 우선순위 |
|---|---|---|
| 캐릭터 일러스트 | 18장 | P1 (6) + P2 (12) |
| 카드 아트 | 45장 + 프레임 3 | P1 (15) + P2 (12) + P3 (18) |
| 부운 아이콘 | 10개 | P1 |
| 배경 | 6장 | P1 (2) + P3 (4) |
| UI 아이콘 | 14개 | P1 |
| 이펙트 | 8~10개 | P2 |
| BGM/SFX | 10~15개 | P3 |

**MVP 최소 에셋: 50장 전후 / 예상 제작 시간 14시간 / AI 툴 구독 $50**
</content>