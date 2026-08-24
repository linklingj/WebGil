import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import type { CommandDispatchResult } from "@webgil/core";
import { installCommandPalette } from "./command-palette.js";

/** 이 테스트는 창의 동작만 본다. 명령 결과는 아무것도 하지 않는 값으로 고정한다. */
const noop: CommandDispatchResult = { status: "message", text: "" };

test("명령창: 열면 입력칸으로 이동하고 Esc로 닫으면 이전 포커스로 돌아간다", () => {
  const dom = new JSDOM("<!doctype html><button id=trigger>명령 열기</button>");
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });

  try {
    const trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
    trigger.focus();
    const palette = installCommandPalette({ run: async () => noop, confirm: async () => noop });
    palette.open();

    const root = document.querySelector<HTMLElement>("[data-webgil-ui=command-palette]")!;
    const input = root.querySelector<HTMLInputElement>("input")!;
    assert.equal(document.activeElement, input);
    assert.equal(root.hidden, false);

    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(root.hidden, true);
    assert.equal(document.activeElement, trigger);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: previousHTMLElement });
  }
});

test("명령창: 여러 인스턴스의 입력칸 ID가 충돌하지 않는다", () => {
  const dom = new JSDOM("<!doctype html>");
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: dom.window.HTMLElement });

  try {
    installCommandPalette({ run: async () => noop, confirm: async () => noop });
    installCommandPalette({ run: async () => noop, confirm: async () => noop });
    const ids = [...document.querySelectorAll<HTMLInputElement>("[data-webgil-ui] input")].map((input) => input.id);
    assert.equal(new Set(ids).size, 2);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: previousHTMLElement });
  }
});
