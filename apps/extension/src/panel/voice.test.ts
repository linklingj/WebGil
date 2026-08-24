// 08 다이얼로그 음성 조작 검증 — 실제 panel.html의 설정 창을 띄워
// "무엇을 소리로 말하는가"와 "Alt+↑/↓가 어디로 가는가"를 확인한다.
// 음성은 ElevenLabs 경로(background 메시지)로 나가므로, 그 메시지를 가로채 문구를 읽는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const html = readFileSync(fileURLToPath(new URL("./panel.html", import.meta.url)), "utf8");
const dom = new JSDOM(html, { pretendToBeVisual: true });

const spoken: string[] = [];

let lastAudio: FakeAudio | undefined;

class FakeAudio {
  currentTime = 0;
  playbackRate = 1;

  constructor() {
    lastAudio = this;
  }
  onended: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  play(): Promise<void> {
    setTimeout(() => this.onended?.(new dom.window.Event("ended")), 0);
    return Promise.resolve();
  }
  pause(): void {}
}

// navigator는 Node 20엔 없고 26엔 getter만 있는 접근자다 → assign이 아니라 defineProperty로 심는다.
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });

// voice.ts는 import 시점에 엔진을 만든다 → 전역을 먼저 세운 뒤에 불러온다.
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  Audio: FakeAudio,
  chrome: {
    runtime: {
      sendMessage: async (message: { text?: string }) => {
        if (message.text !== undefined) spoken.push(message.text);
        return { ok: true, value: "data:audio/mpeg;base64,AA" };
      },
    },
  },
});

const { attachDialogVoice, describeFormControl, setPanelVoiceRate, speak } = await import("./voice.js");

const dialog = dom.window.document.querySelector<HTMLDialogElement>("#settingsDialog")!;
// jsdom 25에는 <dialog>의 showModal/close가 없다(브라우저엔 있다). 테스트용 최소 대역.
Object.assign(dialog, {
  showModal: () => dialog.setAttribute("open", ""),
  close: () => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new dom.window.Event("close"));
  },
});
const voice = attachDialogVoice(dialog, {
  label: "설정",
  stops: () => [...dialog.querySelectorAll<HTMLElement>("select, input, button")],
  describe: (element) => describeFormControl(dialog, element),
});

/** 낭독은 비동기(메시지 → 재생)라 한 틱 흘려보낸다. */
async function flush(): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return spoken.splice(0);
}

test("설정 창을 열면 창 안내와 첫 항목을 한 문장으로 읽는다", async () => {
  voice.open();
  const [first, ...rest] = await flush();

  assert.match(first, /설정 창입니다/);
  assert.match(first, /Alt와 위아래 방향키/);
  assert.match(first, /설정 닫기 버튼/, "첫 지점(닫기 버튼)까지 한 문장에 담는다");
  assert.deepEqual(rest, [], "브라우저 오토포커스로 인한 중복 안내가 없다");
});

test("Alt + 아래/위로 항목을 옮기고, 옮긴 항목을 읽는다", async () => {
  const stops = [...dialog.querySelectorAll<HTMLElement>("select, input, button")];
  stops[0].focus(); // 닫기 버튼에서 시작
  await flush();
  const provider = dialog.querySelector<HTMLSelectElement>("#provider")!;
  const model = dialog.querySelector<HTMLInputElement>("#model")!;
  const apiKey = dialog.querySelector<HTMLInputElement>("#apiKey")!;
  apiKey.value = "sk-비밀";

  const down = () => dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
  const up = () => dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));

  down();
  assert.equal(dom.window.document.activeElement, provider);
  assert.deepEqual(await flush(), ["제공자, 현재 OpenAI ChatGPT API"]);

  down();
  assert.equal(dom.window.document.activeElement, model);
  assert.deepEqual(await flush(), ["모델 ID, 비어 있음"]);

  down();
  assert.equal(dom.window.document.activeElement, apiKey);
  assert.deepEqual(await flush(), ["API 키, 저장된 값 있음"], "비밀번호 값 자체는 읽지 않는다");

  up();
  assert.equal(dom.window.document.activeElement, model);
  await flush();
});

test("끝에서는 순환하지 않고 경계를 알린다", async () => {
  const stops = [...dialog.querySelectorAll<HTMLElement>("select, input, button")];
  stops[0].focus();
  await flush();

  dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }));
  assert.equal(dom.window.document.activeElement, stops[0], "커서가 넘어가지 않는다");
  assert.deepEqual(await flush(), ["첫 번째 항목입니다."]);

  stops.at(-1)!.focus();
  await flush();
  dialog.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }));
  assert.deepEqual(await flush(), ["마지막 항목입니다."]);
});

test("탐색 안내 체크박스는 켜짐·꺼짐 상태를 읽는다", () => {
  const control = dialog.querySelector<HTMLInputElement>("#navigationGuidance")!;
  control.checked = false;
  assert.equal(describeFormControl(dialog, control), "탐색 안내: 레벨·현재 항목·전체 항목 수 함께 읽기, 꺼짐");
  control.checked = true;
  assert.equal(describeFormControl(dialog, control), "탐색 안내: 레벨·현재 항목·전체 항목 수 함께 읽기, 켜짐");
});

test("창을 닫으면 닫혔다고 알린다", async () => {
  dialog.close();
  assert.deepEqual(await flush(), ["설정 창을 닫았습니다."]);
});

test("toggle: 같은 호출로 열고 닫으며, 닫힘도 안내한다", async () => {
  voice.toggle();
  assert.equal(dialog.open, true);
  assert.match((await flush())[0], /설정 창입니다/);

  voice.toggle();
  assert.equal(dialog.open, false);
  assert.deepEqual(await flush(), ["설정 창을 닫았습니다."]);

  voice.close();
  assert.deepEqual(await flush(), [], "이미 닫혀 있으면 아무 말도 하지 않는다");
});

test("검색 결과 사이를 오르내리면 지금 고른 결과를 읽는다", async () => {
  const { SearchBox } = await import("./search.js");
  const header = dom.window.document.querySelector<HTMLElement>("#searchBar")!;
  const input = header.querySelector<HTMLInputElement>("#search")!;
  const search = new SearchBox(header, { onSelect: () => {}, onAsk: () => {}, onDismiss: () => {} });
  search.setTree({
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
          { id: "공지사항", kind: "heading", level: 2, text: "공지사항", children: [] },
          { id: "지난 공지", kind: "text", level: 2, text: "지난 공지", children: [] },
        ],
      },
    ],
  });

  input.value = "공지";
  input.dispatchEvent(new dom.window.Event("input"));
  await flush(); // 타이핑 자체는 읽지 않는다

  // 숫자는 코어의 한국어 발음 정규화를 그대로 탄다(페이지 낭독과 같은 규칙).
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.deepEqual(await flush(), ["지난 공지, 본문 안, 이 번, 전체 이 개"]);

  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.deepEqual(await flush(), ["공지사항, 본문 안, 일 번, 전체 이 개"]);
});

test("낭독 속도 설정은 실제 재생 배속으로 전달된다", async () => {
  setPanelVoiceRate("veryFast");
  speak("빠르게 읽습니다");
  await flush();
  assert.equal(lastAudio?.playbackRate, 2);

  setPanelVoiceRate("slow");
  speak("천천히 읽습니다");
  await flush();
  assert.equal(lastAudio?.playbackRate, 0.75);

  setPanelVoiceRate("normal");
});

test("낭독 속도 선택 항목도 현재 값을 읽어 준다", () => {
  const control = dialog.querySelector<HTMLSelectElement>("#voiceRate")!;
  assert.equal(describeFormControl(dialog, control), "속도, 현재 일반");
  control.value = "fast";
  assert.equal(describeFormControl(dialog, control), "속도, 현재 빠름");
  control.value = "normal";
});
