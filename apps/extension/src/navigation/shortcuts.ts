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
