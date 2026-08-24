// 08 도움말 다이얼로그 — 단축키 표는 shortcuts.ts의 SHORTCUTS 하나에서만 온다.
// 문구를 여기 또 적으면 실제 동작과 어긋난다.
// 각 줄은 포커스를 받을 수 있게 만든다 — 그래야 Alt+↑/↓로 한 줄씩 들으며 내려갈 수 있다.
import { SHORTCUTS } from "../navigation/shortcuts.js";
import { attachDialogVoice, type DialogVoice } from "./voice.js";

export function createHelpDialog(dialog: HTMLDialogElement): DialogVoice {
  render(dialog);
  const voice: DialogVoice = attachDialogVoice(dialog, {
    label: "도움말",
    stops: () => [...dialog.querySelectorAll<HTMLElement>('[tabindex="-1"], button')],
    describe: (element) => element.dataset.speech ?? element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
  });

  return voice;
}

function render(dialog: HTMLDialogElement): void {
  const body = dialog.querySelector<HTMLElement>(".help-body")!;
  body.replaceChildren();

  for (const group of [...new Set(SHORTCUTS.map((item) => item.group))]) {
    const heading = document.createElement("h3");
    heading.textContent = group;
    const list = document.createElement("dl");
    for (const item of SHORTCUTS.filter((entry) => entry.group === group)) {
      const row = document.createElement("div");
      row.className = "row";
      row.tabIndex = -1;
      row.dataset.speech = `${group}, ${item.keys}, ${item.what}`;
      const key = document.createElement("dt");
      key.textContent = item.keys;
      const what = document.createElement("dd");
      what.textContent = item.what;
      row.append(key, what);
      list.append(row);
    }
    body.append(heading, list);
  }
}
