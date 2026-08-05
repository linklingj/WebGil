const STORAGE_KEY = "webgil.llm.provider";
const form = requiredElement<HTMLFormElement>("#settings");
const provider = requiredElement<HTMLSelectElement>("#provider");
const model = requiredElement<HTMLInputElement>("#model");
const apiKey = requiredElement<HTMLInputElement>("#apiKey");
const statusElement = requiredElement<HTMLElement>("#status");

void load();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY];
  if (!isConfig(config)) return;
  provider.value = config.provider;
  model.value = config.model;
  apiKey.value = config.apiKey;
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
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  statusElement.textContent = "이 기기에 저장했습니다.";
}

function isConfig(value: unknown): value is WebGilStoredProviderConfig {
  return typeof value === "object" && value !== null
    && ["openai", "gemini", "anthropic"].includes((value as { provider?: string }).provider ?? "")
    && typeof (value as { apiKey?: unknown }).apiKey === "string"
    && typeof (value as { model?: unknown }).model === "string";
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`설정 화면 요소를 찾지 못했습니다: ${selector}`);
  return element;
}

export {};
