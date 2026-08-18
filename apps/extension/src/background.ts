import {
  createProviderLanguageModel,
  type LLMRequest,
  type ProviderConfig,
} from "@webgil/core";

const LLM_STORAGE_KEY = "webgil.llm.provider";
const TTS_STORAGE_KEY = "webgil.tts.elevenlabs";

// API 키가 content script에 노출되지 않도록 확장 프로그램의 신뢰된 컨텍스트에서만 저장소를 읽게 한다.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

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

function isProviderConfig(value: unknown): value is ProviderConfig {
  return isRecord(value)
    && (value.provider === "openai" || value.provider === "gemini" || value.provider === "anthropic")
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
