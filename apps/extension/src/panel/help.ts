// 08 도움말 다이얼로그 — 단축키 표는 shortcuts.ts의 SHORTCUTS 하나에서만 온다.
// 문구를 여기 또 적으면 실제 동작과 어긋난다.
import { SHORTCUTS } from "../navigation/shortcuts.js";

export function renderHelp(dialog: HTMLDialogElement): void {
  const body = dialog.querySelector<HTMLElement>(".help-body")!;
  body.replaceChildren();

  for (const group of [...new Set(SHORTCUTS.map((item) => item.group))]) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    const list = document.createElement("dl");
    for (const item of SHORTCUTS.filter((entry) => entry.group === group)) {
      const key = document.createElement("dt");
      key.textContent = item.keys;
      const what = document.createElement("dd");
      what.textContent = item.what;
      list.append(key, what);
    }
    body.append(heading, list);
  }
}
