import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { isAltKey, isAltShiftKey, isEditableTarget, navigationCommandFor } from "./shortcuts.js";

const { window } = new JSDOM("");
const KeyboardEvent = window.KeyboardEvent;

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init) as unknown as KeyboardEvent;
}

test("macOS: Option을 누르면 key가 합성 문자여도 code로 단축키를 알아본다", () => {
  // macOS Chrome이 실제로 주는 이벤트 — key는 "‰"이지 "r"이 아니다.
  const macEvent = keydown({ key: "‰", code: "KeyR", altKey: true, shiftKey: true });

  assert.equal(isAltShiftKey(macEvent, "KeyR"), true);
  assert.equal(macEvent.key.toLowerCase() === "r", false); // 옛 판정이 왜 실패했는지 고정
});

test("Windows/Linux: key와 code가 같은 경우에도 동작한다", () => {
  assert.equal(
    isAltShiftKey(keydown({ key: "R", code: "KeyR", altKey: true, shiftKey: true }), "KeyR"),
    true,
  );
});

test("다른 물리 키나 수식키 조합은 걸리지 않는다", () => {
  const alt = { altKey: true, shiftKey: true };
  assert.equal(isAltShiftKey(keydown({ key: "ˇ", code: "KeyT", ...alt }), "KeyR"), false);
  assert.equal(isAltShiftKey(keydown({ code: "KeyR", altKey: true }), "KeyR"), false); // Shift 없음
  assert.equal(isAltShiftKey(keydown({ code: "KeyR", shiftKey: true }), "KeyR"), false); // Alt 없음
  // 브라우저 단축키와 겹치지 않도록 Ctrl/Cmd가 섞이면 무시한다.
  assert.equal(isAltShiftKey(keydown({ code: "KeyR", ...alt, ctrlKey: true }), "KeyR"), false);
  assert.equal(isAltShiftKey(keydown({ code: "KeyR", ...alt, metaKey: true }), "KeyR"), false);
});

test("isAltKey: Option + 쉼표·마침표를 물리 키로 알아본다", () => {
  // macOS에서 Option+, 는 key가 "≤"로 온다. code는 레이아웃과 무관하다.
  assert.equal(isAltKey(keydown({ key: "≤", code: "Comma", altKey: true }), "Comma"), true);
  assert.equal(isAltKey(keydown({ key: ".", code: "Period", altKey: true }), "Period"), true);

  assert.equal(isAltKey(keydown({ code: "Comma" }), "Comma"), false, "Alt 없이는 안 걸린다");
  assert.equal(isAltKey(keydown({ code: "Comma", altKey: true }), "Period"), false, "다른 키");
  // Shift/Ctrl/Cmd가 섞이면 다른 단축키다(Alt+Shift 조합은 페이지 쪽에서 쓴다).
  assert.equal(isAltKey(keydown({ code: "Comma", altKey: true, shiftKey: true }), "Comma"), false);
  assert.equal(isAltKey(keydown({ code: "Comma", altKey: true, ctrlKey: true }), "Comma"), false);
  assert.equal(isAltKey(keydown({ code: "Comma", altKey: true, metaKey: true }), "Comma"), false);
});

test("navigationCommandFor: Alt + 방향키를 탐색 명령으로 바꾼다", () => {
  const alt = { altKey: true };
  assert.equal(navigationCommandFor(keydown({ key: "ArrowDown", ...alt })), "next");
  assert.equal(navigationCommandFor(keydown({ key: "ArrowRight", ...alt })), "next");
  assert.equal(navigationCommandFor(keydown({ key: "ArrowUp", ...alt })), "previous");
  assert.equal(navigationCommandFor(keydown({ key: "Enter", ...alt })), "enter");
  assert.equal(navigationCommandFor(keydown({ key: "Backspace", ...alt })), "back");

  assert.equal(navigationCommandFor(keydown({ key: "ArrowDown" })), null, "Alt 없이는 페이지 것이다");
  assert.equal(navigationCommandFor(keydown({ key: "ArrowDown", ...alt, shiftKey: true })), null);
  assert.equal(navigationCommandFor(keydown({ key: "a", ...alt })), null);
});

test("isEditableTarget: 글 쓰는 칸은 비켜서고 버튼은 가로챈다", () => {
  const { window } = new JSDOM(`<!doctype html><body>
    <input id="text" />
    <div id="editor" contenteditable="true"><span id="inside">글</span></div>
    <div id="frozen" contenteditable="false"></div>
    <select id="picker"></select>
    <button id="press">누르기</button>
    <p id="prose">본문</p>
  </body>`);
  const at = (id: string) => window.document.getElementById(id);
  const previous = globalThis.Element;
  Object.defineProperty(globalThis, "Element", { configurable: true, value: window.Element });

  try {
    assert.equal(isEditableTarget(at("text")), true);
    assert.equal(isEditableTarget(at("inside")), true, "편집 영역 안쪽에서 눌러도 편집 중이다");
    assert.equal(isEditableTarget(at("picker")), true, "방향키가 값을 바꾸는 위젯");
    assert.equal(isEditableTarget(at("frozen")), false, 'contenteditable="false"는 편집 영역이 아니다');
    assert.equal(isEditableTarget(at("press")), false, "버튼에서도 탐색은 계속돼야 한다");
    assert.equal(isEditableTarget(at("prose")), false);
    assert.equal(isEditableTarget(null), false);
  } finally {
    Object.defineProperty(globalThis, "Element", { configurable: true, value: previous });
  }
});
