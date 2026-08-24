import type { NavigationCommand } from "@webgil/core";

/**
 * Alt(Option) + Shift + 문자 단축키 판정.
 *
 * macOS는 Option을 누르면 `event.key`가 **합성 문자**로 바뀐다
 * (Option+Shift+R = "‰", Option+Shift+T = "ˇ", Option+Shift+L = "Ò").
 * 그래서 `event.key.toLowerCase() === "r"` 식의 비교는 macOS에서 절대 참이 되지 않는다.
 *
 * `event.code`는 눌린 **물리 키**를 주므로 레이아웃·수식키와 무관하다. 문자 단축키는 이걸로 판정한다.
 * (방향키·Enter·Backspace는 Option을 눌러도 key가 그대로라 `commandFor`는 key를 계속 써도 된다.)
 */
export function isAltShiftKey(event: KeyboardEvent, code: string): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === code;
}

/** Alt(Option) + 문자 단축키 판정. 이유는 위와 같다 — 문자는 `code`(물리 키)로만 본다. */
export function isAltKey(event: KeyboardEvent, code: string): boolean {
  return event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === code;
}

/**
 * 페이지에서 누른 키 → 탐색 명령. 화면이 없는 목록 은유라 아래=다음, 오른쪽=다음이다
 * (패널 트리는 형제가 좌우로 보여 반대로 맞춘다 — 같은 동작을 다르게 매핑한 건 의도다).
 *
 * Alt만 쓰고 Shift/Ctrl/Meta가 섞이면 무시한다. 브라우저·사이트 단축키와 겹치지 않게 하려는 것.
 * 방향키·Enter·Backspace는 Option을 눌러도 `key`가 그대로라 문자 단축키와 달리 `key`로 판정해도 된다.
 */
export function navigationCommandFor(event: KeyboardEvent): NavigationCommand | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    case "ArrowUp":
    case "ArrowLeft":
      return "previous";
    case "Enter":
      return "enter";
    case "Backspace":
      return "back";
    default:
      return null;
  }
}

/**
 * 지금 키 입력을 페이지에 양보해야 하는 자리인가.
 *
 * 글을 쓰는 칸과 방향키로 값이 바뀌는 위젯(select·listbox 등)에서는 우리가 가로채면 안 된다.
 * **버튼·링크는 일부러 뺐다.** 링크나 버튼을 실행하면 포커스가 거기 남는데, 그 상태에서 탐색이 죽으면
 * "한 번 누르면 더 못 움직이는" 상태가 된다. Alt+방향키는 버튼에서 하는 일이 없어 가로채도 안전하다.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable]:not([contenteditable="false"])',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="spinbutton"]',
        '[role="listbox"]',
      ].join(", "),
    ) !== null
  );
}

/**
 * 사용자에게 보여줄 조작 목록의 **단일 출처**. 도움말 다이얼로그(08)가 이걸 그대로 렌더한다.
 * 표를 따로 적어두면 실제 동작과 어긋나므로, 새 단축키를 붙일 땐 여기부터 고친다.
 */
export const SHORTCUTS: ReadonlyArray<{ group: string; keys: string; what: string }> = [
  // 브라우저 단축키(manifest commands) — 포커스가 페이지에 있어도 동작한다.
  // chrome://extensions/shortcuts 에서 사용자가 바꿀 수 있다.
  { group: "어디서나", keys: "Alt + ,", what: "설정 열기 / 닫기" },
  { group: "어디서나", keys: "Alt + .", what: "도움말 열기 / 닫기" },
  { group: "어디서나", keys: "Alt + Shift + F", what: "패널 검색창으로 이동" },
  { group: "어디서나", keys: "Alt + Shift + G", what: "탐색 안내 켜기 / 끄기" },
  { group: "페이지", keys: "Alt + ↓ / →", what: "같은 레벨 다음 항목" },
  { group: "페이지", keys: "Alt + ↑ / ←", what: "같은 레벨 이전 항목" },
  { group: "페이지", keys: "Alt + Enter", what: "하위 진입 (하위가 없으면 실행)" },
  { group: "페이지", keys: "Alt + Backspace", what: "상위 복귀" },
  { group: "페이지", keys: "Alt + Shift + T", what: "터치패드 제스처 모드 켜기/끄기" },
  { group: "페이지", keys: "Alt + Shift + R", what: "LLM으로 문서 구조 다시 정리" },
  { group: "터치패드", keys: "세로 스크롤", what: "다음 / 이전 항목" },
  { group: "터치패드", keys: "오른쪽 · 왼쪽 스와이프", what: "하위 진입 · 상위 복귀" },
  { group: "패널", keys: "→ / ←", what: "옆 형제 항목으로 (화면에 보이는 방향 그대로)" },
  { group: "패널", keys: "Alt + ↓ / ↑ 등", what: "페이지에서 쓰던 Alt 조합도 그대로 통한다" },
  { group: "패널", keys: "↓ / Enter", what: "하위 진입 (하위가 없으면 실행)" },
  { group: "패널", keys: "↑ / Backspace", what: "상위 복귀" },
  { group: "패널", keys: "Home", what: "현재 위치로 카메라 되돌리기" },
  { group: "패널", keys: "/", what: "검색창으로 이동 (패널에 포커스가 있을 때)" },
  { group: "패널", keys: "검색창에서 ?", what: "자연어 명령으로 실행" },
  { group: "패널", keys: "Esc", what: "어디서든 트리로 포커스 되돌리기" },
  { group: "설정·도움말", keys: "Alt + ↑ / ↓", what: "항목 이동 — 옮긴 항목을 음성으로 읽어준다" },
  { group: "설정·도움말", keys: "Tab", what: "항목 이동 (같은 안내를 읽어준다)" },
  { group: "설정·도움말", keys: "Esc", what: "창 닫기" },
];
