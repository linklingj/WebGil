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
