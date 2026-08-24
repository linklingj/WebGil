// ElevenLabs 음성을 내는 확장 셸 전용 엔진. 코어는 이 파일을 모른다(TTSEngine 계약만 안다).
import type { TTSEngine, VoiceOptions, VoicePreset } from "@webgil/core";

/** 재생에 필요한 최소 표면만 추린 타입. 테스트에서 가짜 플레이어를 끼우려고 HTMLAudioElement를 직접 쓰지 않는다. */
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
 *
 * 폴백이 있어야 하는 이유: 키 미설정·요금 소진·오프라인·자동재생 차단 어느 쪽이든
 * **소리가 아예 안 나면 사용자는 화면을 볼 수 없어 상태를 알 방법이 없다.** 품질보다 연속성이 먼저다.
 *
 * API 키는 여기 없다. 합성 요청은 Background로 보내고(`requestSpeech`) 이 파일은 재생만 한다.
 */
export class ElevenLabsSpeechEngine implements TTSEngine {
  /**
   * 요청마다 번호를 매겨 "지금 유효한 낭독"을 가린다. 합성은 네트워크 왕복이라,
   * 응답이 오는 사이 사용자가 이미 다음 항목으로 넘어갔을 수 있다 — 그 응답은 버려야 한다.
   */
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
    // 새 낭독은 이전 낭독을 선점한다. 두 음성이 겹쳐 나오면 둘 다 못 알아듣는다.
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

  /**
   * 재생이 끝나거나 중단될 때까지 기다린다. 이 Promise가 끝나야 낭독기가 다음 문장을 시작한다.
   * 그래서 어떤 경로로 끝나든 반드시 한 번은 resolve/reject한다 — 안 그러면 낭독이 통째로 멈춘다.
   */
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
      // play()는 자동재생 정책에 막히면 거부된다 — 그때도 fail로 폴백 경로를 태운다.
      void audio.play().catch(fail);

      // play()를 기다리는 사이 stop()이 들어왔을 수 있다. 등록 직후 한 번 더 확인한다.
      if (requestId !== this.requestId) this.stopActiveAudio();
    });
  }

  /** 재생을 끊고, 기다리던 Promise도 함께 끝낸다(settle). 둘 중 하나만 하면 호출부가 매달린다. */
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

/** 합성은 Background에서 한다 — API 키가 페이지 컨텍스트에 내려오지 않게 하려는 것. 응답은 data: URL. */
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
