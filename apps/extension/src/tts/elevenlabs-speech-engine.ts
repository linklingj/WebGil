import type { TTSEngine, VoiceOptions, VoicePreset } from "@webgil/core";

interface AudioPlayer {
  currentTime: number;
  playbackRate: number;
  onended: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  play(): Promise<void>;
  pause(): void;
}

type SpeechRequester = (text: string) => Promise<string>;
type AudioFactory = (url: string) => AudioPlayer;

/**
 * ElevenLabs에서 생성한 음성을 재생하고, 키가 없거나 네트워크·재생에 실패하면
 * 기존 Web Speech 엔진으로 안전하게 되돌아가는 확장 셸용 TTS 엔진이다.
 */
export class ElevenLabsSpeechEngine implements TTSEngine {
  private requestId = 0;
  private active?: { audio: AudioPlayer; settle: () => void };

  constructor(
    private readonly fallback: TTSEngine,
    private readonly requestSpeech: SpeechRequester = requestElevenLabsSpeech,
    private readonly createAudio: AudioFactory = (url) => new Audio(url),
  ) {}

  async speak(text: string, options: VoiceOptions = {}): Promise<void> {
    if (!text.trim()) return;
    const requestId = ++this.requestId;
    this.stopActiveAudio();
    this.fallback.stop();

    try {
      const audioUrl = await this.requestSpeech(text);
      if (requestId !== this.requestId) return;
      await this.play(audioUrl, options.rate, requestId);
    } catch (error) {
      if (requestId !== this.requestId) return;
      console.warn("[WebGil] ElevenLabs 음성 재생에 실패해 브라우저 음성으로 전환합니다.", error);
      await this.fallback.speak(text, options);
    }
  }

  stop(): void {
    this.requestId++;
    this.stopActiveAudio();
    this.fallback.stop();
  }

  voices(): VoicePreset[] {
    return this.fallback.voices();
  }

  private play(url: string, rate: number | undefined, requestId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = this.createAudio(url);
      audio.playbackRate = rate ?? 1;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (this.active?.audio === audio) this.active = undefined;
        resolve();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        if (this.active?.audio === audio) this.active = undefined;
        reject(new Error("ElevenLabs 오디오를 재생하지 못했습니다."));
      };

      audio.onended = settle;
      audio.onerror = fail;
      this.active = { audio, settle };
      void audio.play().catch(fail);

      if (requestId !== this.requestId) this.stopActiveAudio();
    });
  }

  private stopActiveAudio(): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.audio.onended = null;
    active.audio.onerror = null;
    active.audio.pause();
    active.audio.currentTime = 0;
    active.settle();
  }
}

async function requestElevenLabsSpeech(text: string): Promise<string> {
  const response = await chrome.runtime.sendMessage<ChromeRuntimeMessageResponse>({
    type: "webgil.tts.elevenlabs.speak",
    text,
  });
  if (!response.ok || typeof response.value !== "string") {
    throw new Error(response.error ?? "ElevenLabs 음성 요청에 실패했습니다.");
  }
  return response.value;
}
