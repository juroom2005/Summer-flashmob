# CREDITS / 서드파티 출처 표기

이 프로젝트(flashmob)는 아래의 외부 코드·디자인 자료를 참고하거나 일부 차용했습니다.
각 항목의 원저작자와 라이선스를 존중하며, 원본 라이선스 조건에 따라 출처를 표기합니다.

아래 CodePen 자료는 모두 MIT 라이선스입니다. MIT 는 저작권 고지와 라이선스 전문을
사본에 포함할 것을 요구하며, 각 라이선스 전문은 `licenses/` 폴더에 보존되어 있습니다.

---

## CodePen 자료 (모두 MIT)

### 1. Minimalistic Cups — 커피 믹스 게임 컵 UI
- **사용 위치**: `components/noticeboard/cafe/mix/CafeMixGame.tsx`, `CafeMixGame.module.css`
- **차용 범위**: 컵 영역의 `clip-path` 사다리꼴 몸통, pseudo-element 파도 SVG 등 컵 비주얼 구조
- **원저작자**: Visnu Ravichandran
- **원본 URL**: https://codepen.io/visnuravichandran/pen/JjXWEox
- **라이선스**: MIT — `licenses/cups-VisnuRavichandran-LICENSE.txt`

### 2. UI - Flip Card (using :focus-within for a11y) — 일일활동 패널 3D 뒤집기
- **사용 위치**: `components/noticeboard/panels/DailyPanel.tsx`, `DailyPanel.module.css`
- **차용 범위**: 3D flip 메커니즘(`perspective` / `rotateY` / `backface-visibility`). 비주얼은 자체 재해석.
- **원저작자**: Abubaker Saeed
- **원본 URL**: https://codepen.io/AbubakerSaeed/pen/EJrRvY
- **라이선스**: MIT — `licenses/flip-card-AbubakerSaeed-LICENSE.txt`

### 3. Animated Weather Icons — 날씨 위젯 아이콘
- **사용 위치**: `components/noticeboard/widgets/WeatherIcon.tsx`, `WeatherIcon.module.css`
- **차용 범위**: CSS 날씨 아이콘. 전역 선택자를 CSS Module 로컬 스코프로 이관.
- **원저작자**: Josh Bader
- **원본 URL**: https://codepen.io/joshbader/pen/EjXgqr
- **원 디자인 출처**: dribbble "Widget Weather" by kylor (https://dribbble.com/shots/2097042-Widget-Weather)
- **라이선스**: MIT — `licenses/weather-JoshBader-LICENSE.txt`

### 4. Liquid Chart — 카페 음료(액체 채움) UI
- **사용 위치**: `components/noticeboard/panels/StatBottle.tsx`, `StatBottle.module.css` (및 `MyPanel.module.css`)
- **차용 범위**: 액체가 차오르는 병 형태 차트 구조.
- **원저작자**: Matthew Alner
- **원본 URL**: https://codepen.io/MatthewAlner/pen/GoVrNN
- **라이선스**: MIT — `licenses/liquidchart-MatthewAlner-LICENSE.txt`

### 5. Musica Reproductor mp3 — 홈화면 유튜브 임베드 UI
- **사용 위치**: `components/noticeboard/widgets/NowPlayingWidget.tsx`, `NowPlayingDock.tsx`, `PlayerIcons.tsx`, `SideWidgets.module.css`
- **차용 범위**: 음악 플레이어 UI 스타일. (재생 제어는 YouTube IFrame Player API 로 자체 구현)
- **원저작자**: jandito
- **원본 URL**: https://codepen.io/jando132456/pen/jOKbayX
- **라이선스**: MIT — `licenses/musicplayer-jandito-LICENSE.txt`

### 6. Book opening animation (pure css) — 카페 믹스 레시피북
- **사용 위치**: `components/noticeboard/cafe/mix/CafeMixGame.tsx`, `CafeMixGame.module.css`
- **차용 범위**: 책 펼침(3D flip) 애니메이션 구조.
- **원저작자**: Valeriia
- **원본 URL**: https://codepen.io/valerite-dev/pen/XjOeeK
- **라이선스**: MIT — `licenses/bookopening-Valeriia-LICENSE.txt`

### 7. Daily UI #013 | Direct Messaging — 관리자 채팅(admin-chat) UI
- **사용 위치**: `components/admin-chat/GmChatView.tsx` (좌: 방 목록 / 우: 선택된 방 2단 레이아웃), `ChatRoomBody.tsx` (말풍선·입력바 본문)
- **차용 범위**: 좌측 대화 목록 + 우측 대화창 레이아웃, 메시지 말풍선 스타일.
- **원저작자**: Mubanga
- **원본 URL**: https://codepen.io/mubangadv/pen/rXrOQa
- **라이선스**: MIT — `licenses/messaging-Mubanga-LICENSE.txt`

---

## 폰트

### DotGothic16 (리듬게임 곡 제목 — 일본어 픽셀 폰트)
- **사용 위치**: `public/fonts/DotGothic16-Regular.ttf`, `app/globals.css`.
  @font-face family 이름은 기존 'Donguri Duel' 을 그대로 유지(참조부 안정성, 실제 파일만 교체).
- **저작권**: The DotGothic16 Project Authors (https://github.com/fontworks-fonts/DotGothic16)
- **라이선스**: SIL Open Font License 1.1 (OFL) — 전문: `licenses/DotGothic16-OFL.txt`
- **비고**: OFL 이라 임베딩·셀프호스팅·변환 자유(단 라이선스 사본 동봉 필요 → licenses/ 에 보존).
  한글 글리프 없음 → 곡 제목은 일본어/영문/숫자 전제. 이전 Donguri Duel(서브셋 변형 의혹)에서 교체함.

### KBL Jump EB Extended (헤딩/타이틀 — 각 패널 제목)
- **사용 위치**: `public/fonts/KBLJumpEBExtended.otf`, `app/globals.css`.
  @font-face family 이름은 기존 'Stretch Pro' 를 그대로 유지
  (참조부가 많아 안정성 위해 이름 보존, 실제 파일만 KBL 로 교체).
- **저작권**: KBL (한국농구연맹)
- **라이선스**: 개인·기업·상업 사용 무료, 웹사이트·임베딩(서버 내 폰트 탑재) 허용.
  단 폰트 파일 자체의 유료 판매 금지, 왜곡·변형 비권장.
- **비고**: 공식 배포 otf 원본 그대로 사용. 이전 'Stretch Pro' 는 출처·라이선스 불명확이라 교체함.
  (한자 글리프 없음 — 기존 Stretch Pro 와 동일, 한자 제목은 폴백 처리)

### NEXON Lv2 Gothic (본문 · 문서/패널 등 광범위)
- **사용 위치**: `public/fonts/NEXONLv2GothicRegular.otf` / `NEXONLv2GothicBold.otf`, `app/globals.css`.
  @font-face family 이름은 기존 'KoPubWorld Dotum' / 'KoPubWorld Dotum Bold' 를 그대로 유지
  (참조부가 많아 안정성 위해 이름 보존, 실제 파일만 넥슨으로 교체).
- **저작권**: (주)넥슨코리아
- **라이선스**: 개인·기업·상업 사용 무료, 웹사이트·임베딩(서버 내 폰트 탑재) 허용.
  단 폰트 수정·편집 금지(배포 형태 그대로 사용), 폰트 파일 자체의 유료 판매 금지. 출처 표기 권장.
- **비고**: 라이선스 "수정 금지"이므로 서브셋·변환 없이 원본 otf 그대로 사용.
  이전 KoPubWorld Dotum 은 웹 임베딩에 별도 승인이 필요해 교체함.

### NEXON Kart Gothic Bold (네임태그 성 표기)
- **사용 위치**: `public/fonts/NEXONKartGothicBold.otf`, `app/globals.css` (@font-face 'Nexon Kart Gothic')
- **저작권**: (주)넥슨코리아
- **라이선스**: 개인·기업·상업 사용 무료, 웹사이트·임베딩(서버 내 폰트 탑재) 허용.
  단 폰트 수정·편집 금지(배포 형태 그대로 사용), 폰트 파일 자체의 유료 판매 금지. 출처 표기 권장.
- **비고**: 라이선스가 "수정 금지"이므로 서브셋·변환 없이 원본 otf 그대로 사용.

### Hey November (네임태그 이름 손글씨)
- **사용 위치**: `public/fonts/HeyNovember.otf`, `app/globals.css` (@font-face 'Hey November')
- **디자이너**: Khurasan (khurasantype@gmail.com · https://www.khurasan.net)
- **라이선스**: 개인·상업 사용 무료 (디자이너 동봉 라이선스 문구에 명시: "100% free for personal use & commercial use")
- **비고**: 배포처 fontmeme.com / creativefabrica.com. 라이선스 근거는 폰트 zip 동봉 문구.

<!-- 본문에서 쓰는 Jua, Gaegu, Gamja 등 웹폰트가 있다면 여기에 함께 기재.
     Google Fonts 는 대개 OFL(SIL Open Font License)이며, 출처 표기가 권장됩니다. -->

---

## 기반 소프트웨어

- **Mastodon** (별도 리포/서버) — AGPLv3. 본 커뮤니티 서버는 Mastodon 을 기반으로 운영됩니다.

---

## 표기 원칙

- 새 외부 자료를 가져다 쓸 때는 (1) 이 파일에 항목을 추가하고, (2) 라이선스 전문을
  `licenses/` 에 보존하고, (3) 실제 사용 파일 상단 주석에도 원본 URL 을 남깁니다.
- 라이선스가 출처 표기를 요구하는 경우(MIT 등), 위 세 가지 유지가 그 의무를 충족합니다.
- 라이선스가 불명확하거나 재배포를 금지하는 자료는 사용을 재검토합니다.