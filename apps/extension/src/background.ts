import {
  createProviderLanguageModel,
  listOllamaModels,
  type LLMRequest,
  type ProviderConfig,
} from "@webgil/core";

import {
  NAVIGATION_GUIDANCE_STORAGE_KEY,
  isNavigationGuidance,
  type NavigationGuidance,
} from "./navigation/guidance.js";
import { PANEL_COMMAND, PANEL_VIEW_KEY, type PanelCommand, type PanelView } from "./panel/protocol.js";
import {
  DEFAULT_VOICE_RATE,
  VOICE_RATE_STORAGE_KEY,
  isVoiceRate,
  type VoiceRate,
} from "./tts/voice-rate.js";

const LLM_STORAGE_KEY = "webgil.llm.provider";
const TTS_STORAGE_KEY = "webgil.tts.elevenlabs";

// API 키가 content script에 노출되지 않도록 확장 프로그램의 신뢰된 컨텍스트에서만 저장소를 읽게 한다.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// 툴바 아이콘 = popup이 아니라 "사이드패널의 설정 창". (docs/01_SYSTEM/08)
// open()은 사용자 제스처 안에서만 되고 await를 거치면 제스처가 소진되므로 가장 먼저 호출한다.
// 이어서 storage.session에 의도를 남기면, 패널이 방금 열렸으면 부팅 시 읽기가,
// 이미 열려 있었으면 onChanged가 잡는다 — 메시지를 쓰지 않아 경쟁 조건이 없다.
chrome.action.onClicked.addListener((tab) => showPanel("settings", tab.windowId));

// 브라우저 단축키는 **포커스가 어디에 있든** 동작한다 — 페이지를 읽는 중에도 설정·도움말을 연다.
// 패널 안에서만 듣는 keydown으로는 이게 불가능하다(패널에 포커스가 있어야 하니까).
// onCommand는 사용자 제스처로 취급되므로 여기서 sidePanel.open()을 부를 수 있다.
const COMMAND_VIEWS: Record<string, PanelView> = {
  "open-settings": "settings",
  "open-help": "help",
  "focus-search": "search",
};

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-navigation-guidance") {
    scheduleNavigationGuidanceToggle(tab?.id);
    return;
  }
  const view = COMMAND_VIEWS[command];
  if (view) showPanel(view, tab?.windowId);
});

// 설정 창에서 바꾼 값도 이미 열려 있는 모든 페이지에 즉시 전파한다.
chrome.storage.local.onChanged.addListener((changes) => {
  const guidance = changes[NAVIGATION_GUIDANCE_STORAGE_KEY]?.newValue;
  if (isNavigationGuidance(guidance)) void broadcastNavigationGuidance(guidance);

  const rate = changes[VOICE_RATE_STORAGE_KEY]?.newValue;
  if (isVoiceRate(rate)) void broadcastToTabs({ type: "setVoiceRate", rate });
});

/** 패널을 열고(닫혀 있었다면) 무엇을 띄울지 남긴다. open()을 먼저 불러야 제스처가 살아 있다. */
function showPanel(view: PanelView, windowId: number | undefined): void {
  void chrome.sidePanel
    .open(windowId !== undefined ? { windowId } : {})
    .then(() => chrome.storage.session.set({ [PANEL_VIEW_KEY]: view }))
    .catch((error: unknown) => console.warn("[WebGil] 사이드패널을 열지 못했습니다", error));
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isCompleteMessage(message)) {
    void complete(message.request)
      .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "LLM 요청에 실패했습니다.";
        sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
      });
    return true;
  }

  if (isElevenLabsSpeechMessage(message)) {
    void synthesizeWithElevenLabs(message.text)
      .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "ElevenLabs 음성 요청에 실패했습니다.";
        sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
      });
    return true;
  }

  if (isOllamaModelsMessage(message)) {
    // 로컬 Ollama 호출도 Background가 맡는다 — 페이지 스크립트에 로컬 서버를 열어 주지 않는다.
    void listOllamaModels()
      .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "Ollama에 연결하지 못했습니다.";
        sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
      });
    return true;
  }

  if (isVoiceRateGetMessage(message)) {
    void readVoiceRate()
      .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "낭독 속도 설정을 읽지 못했습니다.";
        sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
      });
    return true;
  }

  if (isNavigationGuidanceGetMessage(message)) {
    void readNavigationGuidance()
      .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "탐색 안내 설정을 읽지 못했습니다.";
        sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
      });
    return true;
  }
});

async function complete(request: LLMRequest): Promise<unknown> {
  const stored = await chrome.storage.local.get(LLM_STORAGE_KEY);
  const config = stored[LLM_STORAGE_KEY];
  if (!isProviderConfig(config)) {
    throw new Error("확장 프로그램 설정에서 LLM 제공자·모델·API 키를 먼저 저장해 주세요.");
  }
  return createProviderLanguageModel(config).complete(request);
}

async function synthesizeWithElevenLabs(text: string): Promise<string> {
  const stored = await chrome.storage.local.get(TTS_STORAGE_KEY);
  const config = stored[TTS_STORAGE_KEY];
  if (!isElevenLabsConfig(config)) {
    throw new Error("확장 프로그램 설정에서 ElevenLabs API 키와 음성 ID를 먼저 저장해 주세요.");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
        "xi-api-key": config.apiKey,
      },
      body: JSON.stringify({ text, model_id: config.model }),
    },
  );
  if (!response.ok) throw new Error(`ElevenLabs 요청 실패 (${response.status}): ${await responseError(response)}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${response.headers.get("content-type") ?? "audio/mpeg"};base64,${toBase64(bytes)}`;
}

async function readNavigationGuidance(): Promise<NavigationGuidance> {
  const stored = await chrome.storage.local.get(NAVIGATION_GUIDANCE_STORAGE_KEY);
  const guidance = stored[NAVIGATION_GUIDANCE_STORAGE_KEY];
  return isNavigationGuidance(guidance) ? guidance : "compact";
}

let navigationGuidanceQueue: Promise<void> = Promise.resolve();

/** 빠른 연속 입력도 누른 횟수대로 처리한다. 실패는 다음 토글을 막지 않는다. */
function scheduleNavigationGuidanceToggle(tabId: number | undefined): void {
  navigationGuidanceQueue = navigationGuidanceQueue
    .then(() => toggleNavigationGuidance(tabId))
    .catch((error: unknown) => console.warn("[WebGil] 탐색 안내를 바꾸지 못했습니다", error));
}

/** 브라우저 단축키는 Background에서 저장하고 현재 탭에는 즉시 음성 안내를 보낸다. */
async function toggleNavigationGuidance(tabId: number | undefined): Promise<void> {
  const current = await readNavigationGuidance();
  const guidance: NavigationGuidance = current === "detailed" ? "compact" : "detailed";
  await chrome.storage.local.set({ [NAVIGATION_GUIDANCE_STORAGE_KEY]: guidance });
  if (tabId === undefined) return;
  await chrome.tabs.sendMessage(tabId, {
    type: PANEL_COMMAND,
    command: { type: "setNavigationGuidance", guidance, announce: true },
  }).catch(() => {});
}

/** content script가 있는 모든 탭의 메모리 설정을 저장값과 맞춘다. */
async function broadcastNavigationGuidance(guidance: NavigationGuidance): Promise<void> {
  await broadcastToTabs({ type: "setNavigationGuidance", guidance });
}

/** 열려 있는 모든 탭에 같은 명령을 보낸다. content script가 없는 탭의 실패는 정상이라 삼킨다. */
async function broadcastToTabs(command: PanelCommand): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab): tab is ChromeTab & { id: number } => tab.id !== undefined)
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: PANEL_COMMAND, command }).catch(() => {})),
  );
}

async function readVoiceRate(): Promise<VoiceRate> {
  const stored = await chrome.storage.local.get(VOICE_RATE_STORAGE_KEY);
  const rate = stored[VOICE_RATE_STORAGE_KEY];
  return isVoiceRate(rate) ? rate : DEFAULT_VOICE_RATE;
}

function isCompleteMessage(value: unknown): value is { type: "webgil.llm.complete"; request: LLMRequest } {
  if (!isRecord(value) || value.type !== "webgil.llm.complete") return false;
  const request = value.request;
  return isRecord(request)
    && typeof request.system === "string"
    && typeof request.user === "string"
    && isRecord(request.document)
    && typeof request.document.text === "string"
    && Array.isArray(request.document.nodeIds);
}

function isElevenLabsSpeechMessage(value: unknown): value is { type: "webgil.tts.elevenlabs.speak"; text: string } {
  return isRecord(value) && value.type === "webgil.tts.elevenlabs.speak" && typeof value.text === "string";
}

function isNavigationGuidanceGetMessage(value: unknown): value is { type: "webgil.navigation-guidance.get" } {
  return isRecord(value) && value.type === "webgil.navigation-guidance.get";
}

function isVoiceRateGetMessage(value: unknown): value is { type: "webgil.voice-rate.get" } {
  return isRecord(value) && value.type === "webgil.voice-rate.get";
}

function isOllamaModelsMessage(value: unknown): value is { type: "webgil.ollama.models" } {
  return isRecord(value) && value.type === "webgil.ollama.models";
}

function isProviderConfig(value: unknown): value is ProviderConfig {
  return isRecord(value)
    && (value.provider === "openai" || value.provider === "gemini" || value.provider === "anthropic"
      || value.provider === "ollama")
    && typeof value.apiKey === "string"
    && typeof value.model === "string";
}

function isElevenLabsConfig(value: unknown): value is WebGilStoredTTSConfig {
  return isRecord(value)
    && value.provider === "elevenlabs"
    && typeof value.apiKey === "string"
    && typeof value.voiceId === "string"
    && value.model === "eleven_multilingual_v2";
}

async function responseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) return response.statusText;
    const detail = isRecord(body.detail) ? body.detail.message : body.detail;
    const message = detail ?? body.message;
    return typeof message === "string" ? message : response.statusText;
  } catch {
    return response.statusText;
  }
}

function toBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
