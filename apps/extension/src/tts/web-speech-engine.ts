// Chrome/OS가 제공하는 Web Speech API 기반 1차 TTS 구현.
import type { TTSEngine, VoiceOptions, VoicePreset } from "@webgil/core";

interface ActiveSpeech {
  utterance: SpeechSynthesisUtterance;
  settle: () => void;
}

/**
 * 별도 모델 설치 없이 즉시 쓸 수 있는 확장 MVP 엔진.
 * 로컬 한국어 음성을 우선 선택한다. 로컬 음성이 없을 때의 시스템 음성은 OS 제공자에 따라 원격일 수 있다.
 */
export class WebSpeechEngine implements TTSEngine {
  private active?: ActiveSpeech;
  private requestId = 0;
  private waitedForInitialVoices = false;

  constructor(
    private readonly synthesis: SpeechSynthesis = window.speechSynthesis,
    private readonly createUtterance: (text: string) => SpeechSynthesisUtterance =
      (text) => new SpeechSynthesisUtterance(text),
    private readonly initialVoiceWaitMs = 250,
  ) {}

  speak(text: string, options: VoiceOptions = {}): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    const requestId = ++this.requestId;
    this.cancelActive();

    // Chrome은 첫 getVoices()에서 빈 배열을 돌려주고 뒤늦게 voiceschanged를 발생시킬 수 있다.
    // 첫 낭독에만 짧게 기다려 한국어 음성을 선택할 기회를 준다.
    if (this.synthesis.getVoices().length === 0 && !this.waitedForInitialVoices) {
      this.waitedForInitialVoices = true;
      return this.waitForVoices().then(() => this.startSpeech(text, options, requestId));
    }
    return this.startSpeech(text, options, requestId);
  }

  stop(): void {
    this.requestId++;
    this.cancelActive();
  }

  voices(): VoicePreset[] {
    return this.synthesis.getVoices().map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      local: voice.localService,
    }));
  }

  private startSpeech(text: string, options: VoiceOptions, requestId: number): Promise<void> {
    // 음성 목록을 기다리는 사이 새 탐색 또는 stop()이 발생한 요청은 무시한다.
    if (requestId !== this.requestId) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const utterance = this.createUtterance(text);
      const voice = options.voiceId
        ? this.synthesis.getVoices().find((candidate) => candidate.voiceURI === options.voiceId)
        : preferredKoreanVoice(this.synthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.rate = options.rate ?? 1;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;

      let settled = false;
      const release = () => {
        if (this.active?.utterance === utterance) this.active = undefined;
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        release();
        resolve();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        release();
        reject(error);
      };
      utterance.onend = settle;
      utterance.onerror = (event) => {
        if (event.error === "canceled" || event.error === "interrupted") settle();
        else fail(new Error(`음성 낭독 실패: ${event.error}`));
      };

      this.active = { utterance, settle };
      try {
        this.synthesis.speak(utterance);
      } catch (error) {
        fail(error);
      }
    });
  }

  private cancelActive(): void {
    const active = this.active;
    if (!active) return;
    active.settle();
    this.synthesis.cancel();
  }

  private waitForVoices(): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        this.synthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve();
      };
      const onVoicesChanged = () => finish();
      const timeoutId = setTimeout(finish, this.initialVoiceWaitMs);
      this.synthesis.addEventListener("voiceschanged", onVoicesChanged);
    });
  }
}

function preferredKoreanVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const korean = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko"));
  return korean.find((voice) => voice.localService) ?? korean[0];
}
