# @webgil/extension

`CaptureSource`의 1차 구현 `ExtensionSource` (Chrome MV3). Phase 1~5 대회 MVP 셸.

- content script로 라이브 DOM 접근, 사용자 세션 그대로 사용
- 사이드패널: 트리 뷰어 + 트랙패드 훑기 내비게이션 + TTS

참고: [`docs/00_PLAN/plan.md`](../../docs/00_PLAN/plan.md) §4.1, §6 (Phase 1~5)

## 실행 방법

### 1. 빌드

```bash
npm i -g pnpm      # Node 25+ 는 corepack이 번들되지 않는다. 설치가 싫으면 아래를 전부 `npx pnpm`으로.
pnpm install       # 저장소 루트에서
pnpm --filter @webgil/extension build
```

`apps/extension/dist/`에 `content.js`·`background.js`·`panel/`·`manifest.json`이 생긴다. 이 폴더가 로드 대상이다.

### 2. Chrome에 로드

1. `chrome://extensions` → 우상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드** → `apps/extension/dist` 선택
3. 아무 웹페이지를 열고 툴바의 WebGil 아이콘 클릭

### 3. 사이드패널

툴바 아이콘을 누르면 사이드패널이 열리면서 **설정 창**이 함께 뜬다(예전 popup 자리). API 키를 저장한 뒤 닫으면 트리 뷰가 보인다.

| 영역 | 하는 일 |
|---|---|
| 상단 검색창 | 문서 텍스트 검색 → Enter로 그 노드로 점프. `?`로 시작하면 자연어 명령 |
| 트리 뷰 | 현재 위치를 중앙에 확대. 노드 클릭 = 이동, 현재 노드 다시 클릭 = 실행 |
| 하단 | 현재 위치 안내 · 도움말(`?`) · 설정(`⚙`) |

패널에 포커스가 있을 때는 맨손 방향키(`↓`/`↑`/`→`/`←`)로 탐색하고, `Home`으로 카메라를 현재 위치로 되돌린다. 직접 팬·줌하면 자동 추적이 멈추고 "현재 위치로" 버튼이 나타난다.

### 3-1. 페이지에서 직접 조작 (패널 없이)

페이지 로드 시 문서 트리 요약이 콘솔(`F12`)에 찍힌다. 포커스를 입력창 밖에 둔 상태에서:

| 키 | 동작 |
|---|---|
| `Alt` + `↓` / `→` | 같은 레벨 다음 |
| `Alt` + `↑` / `←` | 같은 레벨 이전 |
| `Alt` + `Enter` | 하위 레벨 진입 — 하위가 없으면 활성화(링크·버튼 클릭, 입력칸 포커스) |
| `Alt` + `Backspace` | 상위 레벨 복귀 |

이동한 노드는 오버레이로 강조되고 한국어 음성으로 낭독된다. 경계에 닿으면 콘솔 로그만 남는다(효과음·낭독 미구현).

콘솔 디버깅 핸들:

```js
__webgil.navigation.current   // 현재 커서 노드 (페이지 콘솔)
__webgil.tts.voices()         // 사용 가능한 음성 목록
__webgil.scan()               // 트리 재추출
__webgilPanel.state           // 패널이 받은 스냅샷 (패널 우클릭 → 검사)
```

### 4. 코드 수정 후

`build` 다시 → `chrome://extensions`에서 새로고침 → **대상 페이지도 새로고침**.

### 문제 해결

- **아무 로그도 안 나옴 / 패널이 "사용할 수 없는 페이지"**: `chrome://`, 크롬 웹스토어 페이지에는 content script가 주입되지 않는다. 일반 웹페이지에서 확인.
- **음성이 안 나옴**: macOS `시스템 설정 → 손쉬운 사용 → 음성 콘텐츠`에서 한국어 음성 설치 여부 확인. 없으면 브라우저 기본 음성으로 폴백한다.
- **Alt 키가 안 먹음**: 입력창·버튼 등 편집 가능 요소에 포커스가 있으면 의도적으로 무시한다. 본문 여백을 클릭하고 다시 시도.

### 테스트

```bash
pnpm -r test        # core + extension
pnpm -r typecheck
```
