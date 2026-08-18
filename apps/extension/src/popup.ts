const LLM_STORAGE_KEY = "webgil.llm.provider";
const TTS_STORAGE_KEY = "webgil.tts.elevenlabs";
const form = requiredElement<HTMLFormElement>("#settings");
const ttsForm = requiredElement<HTMLFormElement>("#ttsSettings");
const provider = requiredElement<HTMLSelectElement>("#provider");
const model = requiredElement<HTMLInputElement>("#model");
const apiKey = requiredElement<HTMLInputElement>("#apiKey");
const statusElement = requiredElement<HTMLElement>("#status");
const ttsApiKey = requiredElement<HTMLInputElement>("#ttsApiKey");
const ttsVoiceId = requiredElement<HTMLInputElement>("#ttsVoiceId");
const ttsModel = requiredElement<HTMLSelectElement>("#ttsModel");
const ttsStatusElement = requiredElement<HTMLElement>("#ttsStatus");

void load();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});
ttsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveTTS();
});

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([LLM_STORAGE_KEY, TTS_STORAGE_KEY]);
  const config = stored[LLM_STORAGE_KEY];
  if (isConfig(config)) {
    provider.value = config.provider;
    model.value = config.model;
    apiKey.value = config.apiKey;
  }

  const ttsConfig = stored[TTS_STORAGE_KEY];
  if (isTTSConfig(ttsConfig)) {
    ttsApiKey.value = ttsConfig.apiKey;
    ttsVoiceId.value = ttsConfig.voiceId;
    ttsModel.value = ttsConfig.model;
  }
}

async function save(): Promise<void> {
  const config: WebGilStoredProviderConfig = {
    provider: provider.value as WebGilStoredProviderConfig["provider"],
    model: model.value.trim(),
    apiKey: apiKey.value.trim(),
  };
  if (!config.model || !config.apiKey) {
    statusElement.textContent = "모델 ID와 API 키를 입력해 주세요.";
    return;
  }
  await chrome.storage.local.set({ [LLM_STORAGE_KEY]: config });
  statusElement.textContent = "이 기기에 저장했습니다.";
}

async function saveTTS(): Promise<void> {
  const config: WebGilStoredTTSConfig = {
    provider: "elevenlabs",
    apiKey: ttsApiKey.value.trim(),
    voiceId: ttsVoiceId.value.trim(),
    model: "eleven_multilingual_v2",
  };
  if (!config.apiKey || !config.voiceId) {
    ttsStatusElement.textContent = "ElevenLabs API 키와 Voice ID를 입력해 주세요.";
    return;
  }
  await chrome.storage.local.set({ [TTS_STORAGE_KEY]: config });
  ttsStatusElement.textContent = "ElevenLabs 음성을 이 기기에 저장했습니다.";
}

function isConfig(value: unknown): value is WebGilStoredProviderConfig {
  return typeof value === "object" && value !== null
    && ["openai", "gemini", "anthropic"].includes((value as { provider?: string }).provider ?? "")
    && typeof (value as { apiKey?: unknown }).apiKey === "string"
    && typeof (value as { model?: unknown }).model === "string";
}

function isTTSConfig(value: unknown): value is WebGilStoredTTSConfig {
  return typeof value === "object" && value !== null
    && (value as { provider?: unknown }).provider === "elevenlabs"
    && typeof (value as { apiKey?: unknown }).apiKey === "string"
    && typeof (value as { voiceId?: unknown }).voiceId === "string"
    && (value as { model?: unknown }).model === "eleven_multilingual_v2";
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`설정 화면 요소를 찾지 못했습니다: ${selector}`);
  return element;
}

export {};
