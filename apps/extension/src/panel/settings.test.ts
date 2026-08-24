// 08 설정 다이얼로그 — 제공자에 따라 필요한 칸만 보이고, 저장 규칙이 제공자마다 다른 부분을 고정한다.
// 특히 Ollama는 키가 없고 모델을 목록에서 고른다 — 원격 제공자 규칙을 그대로 적용하면 저장이 막힌다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const html = readFileSync(fileURLToPath(new URL("./panel.html", import.meta.url)), "utf8");
const dom = new JSDOM(html, { pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

const storage = new Map<string, unknown>();
let ollamaModels: string[] | Error = ["llama3.2:latest", "qwen2.5:7b"];

class SilentAudio {
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

Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
Object.assign(globalThis, {
  window,
  document,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Audio: SilentAudio,
  chrome: {
    runtime: {
      sendMessage: async (message: { type: string }) => {
        if (message.type !== "webgil.ollama.models") return { ok: true, value: "data:audio/mpeg;base64,AA" };
        return ollamaModels instanceof Error
          ? { ok: false, error: ollamaModels.message }
          : { ok: true, value: ollamaModels };
      },
    },
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, storage.get(key)])),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) storage.set(key, value);
        },
      },
    },
  },
});

const { SettingsDialog } = await import("./settings.js");

const dialog = document.querySelector<HTMLDialogElement>("#settingsDialog")!;
const settings = new SettingsDialog(dialog);
const provider = document.querySelector<HTMLSelectElement>("#provider")!;
const remoteFields = document.querySelector<HTMLElement>("#remoteFields")!;
const ollamaFields = document.querySelector<HTMLElement>("#ollamaFields")!;
const ollamaModel = document.querySelector<HTMLSelectElement>("#ollamaModel")!;
const status = document.querySelector<HTMLElement>("#llmStatus")!;

/** 저장·목록 조회가 모두 비동기라 한 틱 흘려보낸다. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

function submitLLMForm(): Promise<unknown> {
  document.querySelector<HTMLFormElement>("#settings")!
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  return settled();
}

async function chooseProvider(value: string): Promise<void> {
  provider.value = value;
  provider.dispatchEvent(new window.Event("change"));
  await settled();
}

test("Ollama를 고르면 키 칸을 감추고 설치된 모델을 불러온다", async () => {
  await chooseProvider("ollama");

  assert.equal(remoteFields.hidden, true, "API 키·모델 ID 칸은 필요 없다");
  assert.equal(ollamaFields.hidden, false);
  assert.deepEqual([...ollamaModel.options].map((option) => option.value), ["llama3.2:latest", "qwen2.5:7b"]);
});

test("Ollama는 키 없이 저장되고, 고른 모델이 그대로 들어간다", async () => {
  await chooseProvider("ollama");
  ollamaModel.value = "qwen2.5:7b";
  await submitLLMForm();

  assert.deepEqual(storage.get("webgil.llm.provider"), {
    provider: "ollama",
    model: "qwen2.5:7b",
    apiKey: "",
  });
  assert.match(status.textContent ?? "", /저장/);
});

test("원격 제공자는 여전히 API 키를 요구한다", async () => {
  storage.clear();
  await chooseProvider("openai");
  document.querySelector<HTMLInputElement>("#model")!.value = "gpt-5";
  document.querySelector<HTMLInputElement>("#apiKey")!.value = "";
  await submitLLMForm();

  assert.equal(storage.has("webgil.llm.provider"), false, "키 없이 원격 제공자를 저장하지 않는다");
  assert.match(status.textContent ?? "", /API 키/);
});

test("Ollama가 꺼져 있으면 다음에 할 일을 알려 준다", async () => {
  ollamaModels = new Error("연결 실패");
  await chooseProvider("openai");
  await chooseProvider("ollama");
  document.querySelector<HTMLButtonElement>("#ollamaRefresh")!.dispatchEvent(new window.MouseEvent("click"));
  await settled();

  assert.match(status.textContent ?? "", /ollama serve/);
  ollamaModels = ["llama3.2:latest"];
});

test("숨겨진 칸은 Alt 이동 지점에서 빠진다", async () => {
  await chooseProvider("ollama");
  const stops = [...dialog.querySelectorAll<HTMLElement>("select, input, button")]
    .filter((element) => !element.hidden && !element.closest("[hidden]"))
    .map((element) => element.id);

  assert.equal(stops.includes("ollamaModel"), true);
  assert.equal(stops.includes("apiKey"), false, "안 보이는 칸으로 포커스가 들어가면 길을 잃는다");
  assert.ok(settings, "다이얼로그는 살아 있다");
});
