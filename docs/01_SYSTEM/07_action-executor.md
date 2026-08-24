# 07. 액션 실행기

> 코어가 만든 액션을 원본 페이지에 **트러스트(사용자 신뢰) 이벤트로** 반영한다. click·focus·input·submit.

## 목적 / 책임

- 네비게이션(04)·LLM 명령(06)이 만든 `Action`을 실제 페이지에서 실행한다.
- 트리 노드 `id` → 원본 DOM 핸들로 해소해 조작한다(구조 추출(02)이 보존한 핸들 사용).
- **트러스트 이벤트를 보장**한다 — 사이트가 합성(synthetic) 이벤트를 막아도 동작하도록.

## Action 모델 (설계 초안)

```ts
type Action =
  | { type: "click";  nodeId: string }
  | { type: "focus";  nodeId: string }
  | { type: "input";  nodeId: string; value: string }
  | { type: "submit"; nodeId: string };
```

> 실제 실행은 `CaptureSource.execute(action)`(01) 뒤로 위임한다. 액션 종류는 코어가 정의하고, **트러스트 확보 방식만 셸마다 다르다**.

## 셸별 트러스트 (plan.md §4.1)

| 셸 | 실행 방식 |
|---|---|
| `ExtensionSource` | `.click()` (+필요 시 `chrome.debugger Input.*`로 승격) |
| `PlaywrightSource` | CDP 트러스트 |
| `DesktopSource` | CDP 트러스트 |

## 핵심 설계

- 실행 경로는 **`CaptureSource.execute()` 하나로 통일**한다(셸 무관).
- `input`/`submit` 등 비가역·민감 액션은 **LLM 가드레일(06)에서 확인을 거친 뒤** 호출된다.
- 핸들이 없는 폴백 트리 노드(02)는 실행 불가 → 상위(04/06)에서 차단.

## 의존

- **상류**: 네비게이션(04), LLM 명령(06).
- **하류**: 브라우저 인터페이스(01) `execute()`.

## 범위 / Phase

- Phase 2: `click`/`focus`/`input` 기본 동작.
- Phase 4: LLM 명령 연동 + 가드레일.

## 미결정 / 리스크

- 확장의 트러스트 한계: 일부 사이트가 `.click()`을 무시 → `chrome.debugger` 승격 기준.
- `input` 값 채우기와 프레임워크(React 등) 상태 동기화 — 네이티브 setter 사용 + `input`/`change` 이벤트 디스패치 필요.
