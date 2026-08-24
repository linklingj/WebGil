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

/**
 * 메시지 라우터. 여기 오는 요청은 전부 "콘텐츠 스크립트·패널이 직접 하면 안 되는 일"이다 —
 * API 키를 읽는 일, 외부·로컬 서버를 부르는 일, TRUSTED_CONTEXTS 저장소를 읽는 일.
 *
 * 응답 규약은 하나뿐이다: `{ ok: true, value }` 또는 `{ ok: false, error }`.
 * 오류를 던져서 넘기지 않는 이유는 메시지 경계를 넘으면 Error 객체가 사라지기 때문이다.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isCompleteMessage(message)) {
    return reply(() => complete(message.request), "LLM 요청에 실패했습니다.", sendResponse);
  }
  if (isElevenLabsSpeechMessage(message)) {
    return reply(() => synthesizeWithElevenLabs(message.text), "ElevenLabs 음성 요청에 실패했습니다.", sendResponse);
  }
  if (isOllamaModelsMessage(message)) {
    // 로컬 서버라도 페이지 스크립트에 열어 주지 않는다. 통로는 여기 하나뿐이다.
    return reply(listOllamaModels, "Ollama에 연결하지 못했습니다.", sendResponse);
  }
  if (isVoiceRateGetMessage(message)) {
    return reply(readVoiceRate, "낭독 속도 설정을 읽지 못했습니다.", sendResponse);
  }
  if (isNavigationGuidanceGetMessage(message)) {
    return reply(readNavigationGuidance, "탐색 안내 설정을 읽지 못했습니다.", sendResponse);
  }
});

/**
 * 비동기 작업 하나를 응답 규약에 맞춰 돌려준다.
 *
 * `true`를 반환하는 건 Chrome에 "응답을 나중에 보내겠다"고 알리는 신호다.
 * 빼먹으면 리스너가 끝나는 순간 메시지 채널이 닫혀, 나중에 부르는 sendResponse가 조용히 사라진다.
 */
function reply(
  work: () => Promise<unknown>,
  fallbackError: string,
  sendResponse: (response: unknown) => void,
): true {
  void work()
    .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
    .catch((error: unknown) => {
      // 사용자에게 보일 문장이다. 제공자가 준 설명이 있으면 그걸 쓰고, 없을 때만 기본 문구로 내린다.
      const text = error instanceof Error ? error.message : fallbackError;
      sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
    });
  return true;
}

/** 저장된 제공자 설정으로 LLM을 부른다. 키는 이 함수 밖으로 나가지 않는다. */
async function complete(request: LLMRequest): Promise<unknown> {
  const stored = await chrome.storage.local.get(LLM_STORAGE_KEY);
  const config = stored[LLM_STORAGE_KEY];
  if (!isProviderConfig(config)) {
    throw new Error("확장 프로그램 설정에서 LLM 제공자·모델·API 키를 먼저 저장해 주세요.");
  }
  return createProviderLanguageModel(config).complete(request);
}

/**
 * 음성을 합성해 data: URL로 돌려준다. 오디오 바이트를 그대로 메시지에 실을 수 없어 base64로 감싼다
 * (구조화 복제로 ArrayBuffer를 보낼 수는 있지만, 재생 쪽에서 URL 하나만 받는 편이 단순하다).
 */
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

/** btoa는 문자열만 받는다. 인자를 한 번에 펼치면 큰 오디오에서 스택이 넘치므로 32KB씩 끊는다. */
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
