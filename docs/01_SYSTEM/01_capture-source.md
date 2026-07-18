# 01. 브라우저 인터페이스 (CaptureSource)

> 코어가 "페이지에 어떻게 접근하는지" 모르게 하는 **유일한 교체 지점**. 페이지 접근·관찰·제어를 인터페이스 하나 뒤로 숨긴다.

## 목적 / 책임

- 라이브 페이지에서 **DOM과 접근성 트리(AX Tree)를 읽어** 구조 추출 엔진(02)에 넘긴다.
- SPA 변경을 감지해 코어에 알린다(`onMutation`).
- 트리 노드를 화면에 하이라이트한다(노드 ↔ 화면 매핑).
- 코어가 만든 액션을 원본 페이지에 실행한다 → 상세는 [07. 액션 실행기](07_action-executor.md).
- **셸(확장/데스크톱/벤치)마다 다른 건 이 구현체뿐.** 코어·엔진·뷰어는 셸을 모른다.

## 인터페이스 (plan.md §4.1)

```ts
interface CaptureSource {
  getDOM(): Document | RemoteHandle;       // 라이브 DOM
  getAXTree(): AXNode[];                    // 접근성 트리
  execute(action: Action): Promise<void>;  // click/focus/input — 트러스트 핸들로 실행
  highlight(nodeId: string): void;          // 트리 노드 ↔ 화면
  onMutation(cb: () => void): void;         // SPA 갱신 감지
}
```

## 구현체

| 구현 | 단계 | 페이지 접근 | 액션/트러스트 | 세션 |
|---|---|---|---|---|
| `ExtensionSource` | **1차 = MVP** | content script | `.click()` (+필요 시 `chrome.debugger Input.*`) | 사용자 브라우저 그대로 |
| `PlaywrightSource` | 개발/벤치 | CDP(헤드리스) | CDP 트러스트 | 없음 — 코퍼스 채점용 |
| `DesktopSource` | 확장형(Phase 6) | Electron+CDP | CDP 트러스트 | 영속 파티션 1회 로그인 |

## 핵심 설계

- 라이브 DOM 직접 접근 → **원본 노드 핸들을 보존**한다(구조 추출·액션이 같은 핸들을 공유).
- 접근 방식 차이(content script vs CDP)를 이 인터페이스 하나로 격리한다.
- 새 셸 = 이 인터페이스 구현 1개 + 셸 마운트. 코어는 건드리지 않는다.

## 의존

- **상류**: 없음(가장 바깥, 페이지를 직접 만짐).
- **하류**: 구조 추출(02), 액션 실행기(07), 하이라이트(뷰어).

## 범위 / Phase

- Phase 1: 인터페이스 확정 + `PlaywrightSource`(벤치)로 검증.
- Phase 2: `ExtensionSource`(대회 MVP).
- Phase 6: `DesktopSource`.

## 미결정 / 리스크

- `getDOM`의 반환형: 확장은 직접 `Document`, CDP는 원격 핸들 — 두 셸이 공유할 `RemoteHandle` 표현 통일.
- `chrome.debugger` 사용 시 디버깅 배너/권한 UX 트레이드오프(트러스트 이벤트가 꼭 필요한 사이트에서만 승격).
