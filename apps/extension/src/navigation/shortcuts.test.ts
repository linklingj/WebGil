import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { isAltShiftKey } from "./shortcuts.js";

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
