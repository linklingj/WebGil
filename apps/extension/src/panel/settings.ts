// 08 설정 다이얼로그 — popup.ts에서 그대로 이관.
// 저장 키·스키마를 바꾸지 않는다 → background는 손대지 않아도 되고 기존 설정도 살아남는다.
// 사이드패널도 popup과 같은 신뢰된 확장 컨텍스트라 storage.local(TRUSTED_CONTEXTS)을 그대로 읽는다.
import { attachDialogVoice, describeFormControl, setPanelVoiceRate, speak, type DialogVoice } from "./voice.js";
import { NAVIGATION_GUIDANCE_STORAGE_KEY, type NavigationGuidance } from "../navigation/guidance.js";
import {
  DEFAULT_VOICE_RATE,
  VOICE_RATE_LABEL,
  VOICE_RATE_STORAGE_KEY,
  isVoiceRate,
  type VoiceRate,
} from "../tts/voice-rate.js";

const LLM_STORAGE_KEY = "webgil.llm.provider";
const TTS_STORAGE_KEY = "webgil.tts.elevenlabs";

export class SettingsDialog {
  private readonly form: HTMLFormElement;
  private readonly ttsForm: HTMLFormElement;
  private readonly narrationForm: HTMLFormElement;
  private readonly voiceRateForm: HTMLFormElement;
  private readonly providerField: HTMLSelectElement;
  private readonly voice: DialogVoice;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.form = dialog.querySelector<HTMLFormElement>("#settings")!;
    this.ttsForm = dialog.querySelector<HTMLFormElement>("#ttsSettings")!;
    this.narrationForm = dialog.querySelector<HTMLFormElement>("#narrationSettings")!;
    this.voiceRateForm = dialog.querySelector<HTMLFormElement>("#voiceRateSettings")!;
    this.providerField = dialog.querySelector<HTMLSelectElement>("#provider")!;
    this.voice = attachDialogVoice(dialog, {
      label: "설정",
      stops: () =>
        [...dialog.querySelectorAll<HTMLElement>("select, input, button")]
          .filter((element) => !element.hidden && !element.closest("[hidden]")),
      describe: (element) => describeFormControl(dialog, element),
    });

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save();
    });
    this.providerField.addEventListener("change", () => void this.applyProvider());
    this.field<HTMLButtonElement>("#ollamaRefresh").addEventListener("click", () => {
      void this.loadOllamaModels({ announce: true });
    });
    this.ttsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveTTS();
    });
    this.narrationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveNarration();
    });
    this.voiceRateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveVoiceRate();
    });
    void this.load();
  }

  /** 툴바 아이콘·⚙ 버튼 양쪽이 부르는 진입점. 열 때마다 저장값을 다시 읽는다. */
  open(): void {
    // 값을 먼저 채우고 열어야 "API 키, 저장된 값 있음" 안내가 실제 상태와 맞는다.
    void this.load().then(() => this.voice.open());
  }

  /** 같은 단축키(Alt + ,)로 열고 닫는다. */
  toggle(): void {
    if (this.dialog.open) this.dialog.close();
    else this.open();
  }

  /** 도움말을 열기 전에 부른다 — 모달 두 개가 겹치지 않게. */
  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private async load(): Promise<void> {
    const stored = await chrome.storage.local.get([
      LLM_STORAGE_KEY,
      TTS_STORAGE_KEY,
      NAVIGATION_GUIDANCE_STORAGE_KEY,
      VOICE_RATE_STORAGE_KEY,
    ]);
    const config = stored[LLM_STORAGE_KEY];
    if (isConfig(config)) {
      this.providerField.value = config.provider;
      if (config.provider === "ollama") this.setOllamaOptions([config.model], config.model);
      else {
        this.field<HTMLInputElement>("#model").value = config.model;
        this.field<HTMLInputElement>("#apiKey").value = config.apiKey;
      }
    }
    await this.applyProvider();

    const ttsConfig = stored[TTS_STORAGE_KEY];
    if (isTTSConfig(ttsConfig)) {
      this.field<HTMLInputElement>("#ttsApiKey").value = ttsConfig.apiKey;
      this.field<HTMLInputElement>("#ttsVoiceId").value = ttsConfig.voiceId;
      this.field<HTMLSelectElement>("#ttsModel").value = ttsConfig.model;
    }

    this.field<HTMLInputElement>("#navigationGuidance").checked =
      stored[NAVIGATION_GUIDANCE_STORAGE_KEY] === "detailed";

    const rate = stored[VOICE_RATE_STORAGE_KEY];
    const current = isVoiceRate(rate) ? rate : DEFAULT_VOICE_RATE;
    this.field<HTMLSelectElement>("#voiceRate").value = current;
    // 저장값이 곧 패널 안내 속도다 — 설정 창을 열자마자 같은 속도로 들린다.
    setPanelVoiceRate(current);
  }

  /** 제공자에 따라 필요한 칸만 보여 준다. Ollama는 키가 없고 모델을 목록에서 고른다. */
  private async applyProvider(): Promise<void> {
    const ollama = this.providerField.value === "ollama";
    this.field<HTMLElement>("#remoteFields").hidden = ollama;
    this.field<HTMLElement>("#ollamaFields").hidden = !ollama;
    if (ollama && this.field<HTMLSelectElement>("#ollamaModel").options.length <= 1) {
      await this.loadOllamaModels();
    }
  }

  /** 설치된 로컬 모델을 Background를 통해 받아 온다(로컬 서버 호출도 신뢰된 컨텍스트에서만). */
  private async loadOllamaModels(options: { announce?: boolean } = {}): Promise<void> {
    const status = this.field<HTMLElement>("#llmStatus");
    const selected = this.field<HTMLSelectElement>("#ollamaModel").value;
    try {
      const response = await chrome.runtime.sendMessage<ChromeRuntimeMessageResponse>({
        type: "webgil.ollama.models",
      });
      if (!response.ok) throw new Error(response.error ?? "Ollama에 연결하지 못했습니다.");
      const models = Array.isArray(response.value)
        ? response.value.filter((name): name is string => typeof name === "string")
        : [];
      this.setOllamaOptions(models, selected);
      if (models.length === 0) {
        this.report(status, "설치된 Ollama 모델이 없습니다. 터미널에서 ollama pull 로 모델을 받아 주세요.");
        return;
      }
      if (options.announce) this.report(status, `Ollama 모델 ${models.length}개를 불러왔습니다.`);
    } catch {
      this.setOllamaOptions([], selected);
      // 로컬 서버가 꺼져 있는 게 가장 흔한 원인이라, 다음에 뭘 하면 되는지까지 말한다.
      this.report(status, "Ollama에 연결하지 못했습니다. ollama serve 가 실행 중인지 확인해 주세요.");
    }
  }

  private setOllamaOptions(models: string[], selected: string): void {
    const select = this.field<HTMLSelectElement>("#ollamaModel");
    select.replaceChildren();
    const names = models.length ? models : selected ? [selected] : [];
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    if (names.includes(selected)) select.value = selected;
  }

  private async save(): Promise<void> {
    const status = this.field<HTMLElement>("#llmStatus");
    const provider = this.providerField.value as WebGilStoredProviderConfig["provider"];
    const ollama = provider === "ollama";
    const config: WebGilStoredProviderConfig = {
      provider,
      model: ollama
        ? this.field<HTMLSelectElement>("#ollamaModel").value
        : this.field<HTMLInputElement>("#model").value.trim(),
      // 로컬 서버는 키가 없다. 빈 문자열로 저장해 스키마를 그대로 유지한다.
      apiKey: ollama ? "" : this.field<HTMLInputElement>("#apiKey").value.trim(),
    };
    if (!config.model) {
      this.report(status, ollama ? "사용할 Ollama 모델을 골라 주세요." : "모델 ID를 입력해 주세요.");
      return;
    }
    if (!ollama && !config.apiKey) {
      this.report(status, "API 키를 입력해 주세요.");
      return;
    }
    await chrome.storage.local.set({ [LLM_STORAGE_KEY]: config });
    this.report(status, "이 기기에 저장했습니다.");
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
      this.report(status, "ElevenLabs API 키와 Voice ID를 입력해 주세요.");
      return;
    }
    await chrome.storage.local.set({ [TTS_STORAGE_KEY]: config });
    this.report(status, "ElevenLabs 음성을 이 기기에 저장했습니다.");
  }

  private async saveNarration(): Promise<void> {
    const status = this.field<HTMLElement>("#narrationStatus");
    const guidance: NavigationGuidance = this.field<HTMLInputElement>("#navigationGuidance").checked
      ? "detailed"
      : "compact";
    await chrome.storage.local.set({ [NAVIGATION_GUIDANCE_STORAGE_KEY]: guidance });
    this.report(status, guidance === "detailed" ? "탐색 안내를 켰습니다." : "탐색 안내를 껐습니다.");
  }

  private async saveVoiceRate(): Promise<void> {
    const status = this.field<HTMLElement>("#voiceRateStatus");
    const value = this.field<HTMLSelectElement>("#voiceRate").value;
    const rate: VoiceRate = isVoiceRate(value) ? value : DEFAULT_VOICE_RATE;
    await chrome.storage.local.set({ [VOICE_RATE_STORAGE_KEY]: rate });
    // 페이지 쪽은 Background가 전파한다. 패널은 바로 바꿔 안내부터 새 속도로 들려준다.
    setPanelVoiceRate(rate);
    this.report(status, `낭독 속도를 ${VOICE_RATE_LABEL[rate]}으로 저장했습니다.`);
  }

  /** 저장 결과는 화면을 못 보는 사용자에게 유일한 피드백이라 소리로도 알린다. */
  private report(status: HTMLElement, message: string): void {
    status.textContent = message;
    speak(message);
  }

  private field<T extends Element>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`설정 화면 요소를 찾지 못했습니다: ${selector}`);
    return element;
  }
}

function isConfig(value: unknown): value is WebGilStoredProviderConfig {
  return typeof value === "object" && value !== null
    && ["openai", "gemini", "anthropic", "ollama"].includes((value as { provider?: string }).provider ?? "")
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
