// 08 설정 다이얼로그 — popup.ts에서 그대로 이관.
// 저장 키·스키마를 바꾸지 않는다 → background는 손대지 않아도 되고 기존 설정도 살아남는다.
// 사이드패널도 popup과 같은 신뢰된 확장 컨텍스트라 storage.local(TRUSTED_CONTEXTS)을 그대로 읽는다.
const LLM_STORAGE_KEY = "webgil.llm.provider";
const TTS_STORAGE_KEY = "webgil.tts.elevenlabs";

export class SettingsDialog {
  private readonly form: HTMLFormElement;
  private readonly ttsForm: HTMLFormElement;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.form = dialog.querySelector<HTMLFormElement>("#settings")!;
    this.ttsForm = dialog.querySelector<HTMLFormElement>("#ttsSettings")!;

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save();
    });
    this.ttsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveTTS();
    });
    void this.load();
  }

  /** 툴바 아이콘·⚙ 버튼 양쪽이 부르는 진입점. 열 때마다 저장값을 다시 읽는다. */
  open(): void {
    void this.load();
    if (!this.dialog.open) this.dialog.showModal();
    this.field<HTMLSelectElement>("#provider").focus();
  }

  private async load(): Promise<void> {
    const stored = await chrome.storage.local.get([LLM_STORAGE_KEY, TTS_STORAGE_KEY]);
    const config = stored[LLM_STORAGE_KEY];
    if (isConfig(config)) {
      this.field<HTMLSelectElement>("#provider").value = config.provider;
      this.field<HTMLInputElement>("#model").value = config.model;
      this.field<HTMLInputElement>("#apiKey").value = config.apiKey;
    }

    const ttsConfig = stored[TTS_STORAGE_KEY];
    if (isTTSConfig(ttsConfig)) {
      this.field<HTMLInputElement>("#ttsApiKey").value = ttsConfig.apiKey;
      this.field<HTMLInputElement>("#ttsVoiceId").value = ttsConfig.voiceId;
      this.field<HTMLSelectElement>("#ttsModel").value = ttsConfig.model;
    }
  }

  private async save(): Promise<void> {
    const status = this.field<HTMLElement>("#llmStatus");
    const config: WebGilStoredProviderConfig = {
      provider: this.field<HTMLSelectElement>("#provider").value as WebGilStoredProviderConfig["provider"],
      model: this.field<HTMLInputElement>("#model").value.trim(),
      apiKey: this.field<HTMLInputElement>("#apiKey").value.trim(),
    };
    if (!config.model || !config.apiKey) {
      status.textContent = "모델 ID와 API 키를 입력해 주세요.";
      return;
    }
    await chrome.storage.local.set({ [LLM_STORAGE_KEY]: config });
    status.textContent = "이 기기에 저장했습니다.";
  }

  private async saveTTS(): Promise<void> {
    const status = this.field<HTMLElement>("#ttsStatus");
    const config: WebGilStoredTTSConfig = {
      provider: "elevenlabs",
      apiKey: this.field<HTMLInputElement>("#ttsApiKey").value.trim(),
      voiceId: this.field<HTMLInputElement>("#ttsVoiceId").value.trim(),
      model: "eleven_multilingual_v2",
    };
    if (!config.apiKey || !config.voiceId) {
      status.textContent = "ElevenLabs API 키와 Voice ID를 입력해 주세요.";
      return;
    }
    await chrome.storage.local.set({ [TTS_STORAGE_KEY]: config });
    status.textContent = "ElevenLabs 음성을 이 기기에 저장했습니다.";
  }

  private field<T extends Element>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`설정 화면 요소를 찾지 못했습니다: ${selector}`);
    return element;
  }
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
