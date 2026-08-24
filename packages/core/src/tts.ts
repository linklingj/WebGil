// 05 TTS 엔진 — 코어는 음성을 만드는 방식(브라우저·로컬 모델·API)을 모른다.

/** 사용자가 선택 가능한 음성. 엔진별 내부 식별자는 id로 통일한다. */
export interface VoicePreset {
  id: string;
  name: string;
  lang: string;
  local: boolean;
}

/** 모든 엔진이 공통으로 이해하는 낭독 옵션. */
export interface VoiceOptions {
  voiceId?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

/**
 * 음성 출력의 교체 지점.
 * speak는 현재 요청이 끝나거나 stop으로 취소된 뒤 resolve한다. 새 탐색은 반드시 stop으로 선점한다.
 */
export interface TTSEngine {
  speak(text: string, options?: VoiceOptions): Promise<void>;
  stop(): void;
  voices(): VoicePreset[];
}
