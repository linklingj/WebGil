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
  private readonly voice: DialogVoice;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.form = dialog.querySelector<HTMLFormElement>("#settings")!;
    this.ttsForm = dialog.querySelector<HTMLFormElement>("#ttsSettings")!;
    this.narrationForm = dialog.querySelector<HTMLFormElement>("#narrationSettings")!;
    this.voiceRateForm = dialog.querySelector<HTMLFormElement>("#voiceRateSettings")!;
    this.voice = attachDialogVoice(dialog, {
      label: "설정",
      stops: () => [...dialog.querySelectorAll<HTMLElement>("select, input, button")],
      describe: (element) => describeFormControl(dialog, element),
    });

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.save();
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

    this.field<HTMLInputElement>("#navigationGuidance").checked =
      stored[NAVIGATION_GUIDANCE_STORAGE_KEY] === "detailed";

    const rate = stored[VOICE_RATE_STORAGE_KEY];
    const current = isVoiceRate(rate) ? rate : DEFAULT_VOICE_RATE;
    this.field<HTMLSelectElement>("#voiceRate").value = current;
    // 저장값이 곧 패널 안내 속도다 — 설정 창을 열자마자 같은 속도로 들린다.
    setPanelVoiceRate(current);
  }

  private async save(): Promise<void> {
    const status = this.field<HTMLElement>("#llmStatus");
    const config: WebGilStoredProviderConfig = {
      provider: this.field<HTMLSelectElement>("#provider").value as WebGilStoredProviderConfig["provider"],
      model: this.field<HTMLInputElement>("#model").value.trim(),
      apiKey: this.field<HTMLInputElement>("#apiKey").value.trim(),
    };
    if (!config.model || !config.apiKey) {
      this.report(status, "모델 ID와 API 키를 입력해 주세요.");
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
