import {
  createProviderLanguageModel,
  type LLMRequest,
  type ProviderConfig,
} from "@webgil/core";

const STORAGE_KEY = "webgil.llm.provider";

// API 키가 content script에 노출되지 않도록 확장 프로그램의 신뢰된 컨텍스트에서만 저장소를 읽게 한다.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isCompleteMessage(message)) return;

  void complete(message.request)
    .then((value) => sendResponse({ ok: true, value } satisfies ChromeRuntimeMessageResponse))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "LLM 요청에 실패했습니다.";
      sendResponse({ ok: false, error: text } satisfies ChromeRuntimeMessageResponse);
    });
  return true;
});

async function complete(request: LLMRequest): Promise<unknown> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY];
  if (!isProviderConfig(config)) {
    throw new Error("확장 프로그램 설정에서 LLM 제공자·모델·API 키를 먼저 저장해 주세요.");
  }
  return createProviderLanguageModel(config).complete(request);
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

function isProviderConfig(value: unknown): value is ProviderConfig {
  return isRecord(value)
    && (value.provider === "openai" || value.provider === "gemini" || value.provider === "anthropic")
    && typeof value.apiKey === "string"
    && typeof value.model === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
