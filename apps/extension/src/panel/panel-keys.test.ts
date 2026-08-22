// 08 패널 키 배선 검증 — 진짜 panel.ts를 띄워 "어떤 키가 어떤 명령이 되는가"를 고정한다.
// 패널 UI에서 가장 자주 바뀌고 가장 조용히 깨지는 부분이라 여기만은 실물로 확인한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const html = readFileSync(fileURLToPath(new URL("./panel.html", import.meta.url)), "utf8");
const dom = new JSDOM(html, { pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

/** 콘텐츠 스크립트로 나간 명령들. */
const sent: unknown[] = [];

class FakeAudio {
  onended: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  currentTime = 0;
  playbackRate = 1;
  play(): Promise<void> {
    setTimeout(() => this.onended?.(new window.Event("ended")), 0);
    return Promise.resolve();
  }
  pause(): void {}
}

const noopEvent = { addListener: () => {} };
Object.assign(globalThis, {
  window,
  document,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  SVGElement: window.SVGElement,
  Audio: FakeAudio,
  chrome: {
    // 낭독은 background로 나간다. 성공한 척 돌려줘야 브라우저 음성 폴백 경고가 안 뜬다.
    runtime: { onMessage: noopEvent, sendMessage: async () => ({ ok: true, value: "data:audio/mpeg;base64,AA" }) },
    tabs: {
      query: async () => [{ id: 7, title: "테스트 페이지" }],
      sendMessage: async (_tabId: number, message: { command?: unknown }) => {
        sent.push(message.command);
        return { type: "webgil.panel.state", state: { title: "", tree: TREE, cursorId: "공지", index: 0, count: 2 } };
      },
      onActivated: noopEvent,
      onUpdated: noopEvent,
    },
    storage: {
      local: { get: async () => ({}), set: async () => {}, onChanged: noopEvent },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {}, onChanged: noopEvent },
    },
  },
});

const TREE = {
  id: "root",
  kind: "group",
  level: 0,
  text: "",
  children: [
    {
      id: "본문",
      kind: "group",
      level: 1,
      text: "본문",
      children: [
        { id: "공지", kind: "heading", level: 2, text: "공지", children: [] },
        { id: "소식", kind: "heading", level: 2, text: "소식", children: [] },
      ],
    },
  ],
};

// jsdom 25에는 <dialog>의 showModal/close가 없다.
for (const element of document.querySelectorAll("dialog")) {
  Object.assign(element, {
    showModal: () => element.setAttribute("open", ""),
    close: () => {
      element.removeAttribute("open");
      element.dispatchEvent(new window.Event("close"));
    },
  });
}

await import("./panel.js");
await new Promise((resolve) => setTimeout(resolve, 5)); // 첫 sync가 끝나길 기다린다

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const search = document.querySelector<HTMLInputElement>("#search")!;

function press(init: KeyboardEventInit & { target?: Element }): unknown[] {
  sent.length = 0;
  const target = init.target ?? viewport;
  target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, ...init }));
  return sent;
}

test("맨손 방향키는 화면 배치와 같은 방향으로 움직인다", () => {
  assert.deepEqual(press({ key: "ArrowRight" }), [{ type: "navigate", command: "next" }]);
  assert.deepEqual(press({ key: "ArrowLeft" }), [{ type: "navigate", command: "previous" }]);
  assert.deepEqual(press({ key: "ArrowDown" }), [{ type: "navigate", command: "enter" }]);
  assert.deepEqual(press({ key: "ArrowUp" }), [{ type: "navigate", command: "back" }]);
  assert.deepEqual(press({ key: "Enter" }), [{ type: "navigate", command: "enter" }]);
});

test("페이지에서 쓰던 Alt 조합도 패널 안에서 그대로 통한다", () => {
  assert.deepEqual(press({ key: "ArrowDown", altKey: true }), [{ type: "navigate", command: "next" }]);
  assert.deepEqual(press({ key: "ArrowUp", altKey: true }), [{ type: "navigate", command: "previous" }]);
  assert.deepEqual(press({ key: "ArrowRight", altKey: true }), [{ type: "navigate", command: "next" }]);
  assert.deepEqual(press({ key: "Backspace", altKey: true }), [{ type: "navigate", command: "back" }]);
});

test("그래프 밖(하단 버튼)에 포커스가 있어도 같은 키로 탐색한다", () => {
  const settingsButton = document.querySelector<HTMLElement>("#settingsButton")!;
  settingsButton.focus();
  assert.deepEqual(press({ key: "ArrowRight", target: settingsButton }), [{ type: "navigate", command: "next" }]);
});

test("검색창에 타이핑 중인 방향키는 트리로 새지 않는다", () => {
  search.focus();
  assert.deepEqual(press({ key: "ArrowDown", target: search }), [], "검색 결과 이동은 SearchBox 몫");
  assert.deepEqual(press({ key: "ArrowRight", target: search }), [], "커서 이동이지 트리 탐색이 아니다");
});

test("Esc는 어디서든 그래프로 포커스를 되돌린다", () => {
  const helpButton = document.querySelector<HTMLElement>("#helpButton")!;
  helpButton.focus();
  press({ key: "Escape", target: helpButton });
  assert.equal(document.activeElement, viewport);
});

test("Alt + , 로 연 설정 창은 닫을 때 포커스를 그래프로 돌려준다", async () => {
  const settings = document.querySelector<HTMLDialogElement>("#settingsDialog")!;
  press({ code: "Comma", key: "≤", altKey: true });
  await new Promise((resolve) => setTimeout(resolve, 5)); // 저장값을 읽은 뒤 열린다
  assert.equal(settings.open, true, "설정이 열린다");
  assert.equal(settings.contains(document.activeElement), true, "포커스가 설정 창 안으로 들어간다");

  settings.close();
  assert.equal(document.activeElement, viewport, "닫으면 그래프로 돌아온다");
});
