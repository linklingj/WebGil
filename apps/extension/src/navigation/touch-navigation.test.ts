import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { TouchNavigationController } from "./touch-navigation.js";

test("한 번의 제스처는 한 번만 이동하고 줄 단위 wheel 값도 처리한다", () => {
  const dom = new JSDOM("<!doctype html><main></main>");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousWheelEvent = globalThis.WheelEvent;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: dom.window.WheelEvent });

  try {
    const commands: string[] = [];
    const controller = new TouchNavigationController({ onCommand: (command) => commands.push(command) });
    controller.toggle();
    const first = new dom.window.WheelEvent("wheel", { deltaY: 80, cancelable: true });
    const second = new dom.window.WheelEvent("wheel", { deltaY: 80, cancelable: true });
    document.dispatchEvent(first);
    document.dispatchEvent(second);

    assert.deepEqual(commands, ["next"]);
    assert.equal(first.defaultPrevented, true);
    assert.equal(second.defaultPrevented, true);
    controller.destroy();

    const lineCommands: string[] = [];
    const lineController = new TouchNavigationController({ onCommand: (command) => lineCommands.push(command) });
    lineController.toggle();
    document.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: 5, deltaMode: 1, cancelable: true }));
    assert.deepEqual(lineCommands, ["next"]);
    lineController.destroy();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: previousWheelEvent });
  }
});

test("터치 네비게이션: 모드가 켜진 동안 네 방향 스와이프를 탐색 명령으로 바꾼다", () => {
  const dom = new JSDOM("<!doctype html><main></main>");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousWheelEvent = globalThis.WheelEvent;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: dom.window.WheelEvent });

  try {
    const directions = [
      [{ deltaY: 80 }, "next"],
      [{ deltaY: -80 }, "previous"],
      [{ deltaX: 80 }, "enter"],
      [{ deltaX: -80 }, "back"],
    ] as const;

    for (const [init, expected] of directions) {
      const commands: string[] = [];
      const controller = new TouchNavigationController({ onCommand: (command) => commands.push(command) });
      controller.toggle();
      document.dispatchEvent(new dom.window.WheelEvent("wheel", { ...init, cancelable: true }));
      assert.deepEqual(commands, [expected]);
      controller.destroy();
    }
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: previousWheelEvent });
  }
});

test("터치 네비게이션: 비활성·입력칸·Ctrl 확대 제스처는 가로채지 않는다", () => {
  const dom = new JSDOM("<!doctype html><input />");
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousWheelEvent = globalThis.WheelEvent;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: dom.window.WheelEvent });

  try {
    const commands: string[] = [];
    const controller = new TouchNavigationController({
      onCommand: (command) => commands.push(command),
      shouldIgnoreTarget: (target) => target instanceof dom.window.HTMLInputElement,
    });
    const input = document.querySelector("input")!;

    input.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true }));
    controller.toggle();
    input.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: 80, bubbles: true, cancelable: true }));
    document.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: 80, ctrlKey: true, cancelable: true }));

    assert.deepEqual(commands, []);
    controller.destroy();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "WheelEvent", { configurable: true, value: previousWheelEvent });
  }
});
