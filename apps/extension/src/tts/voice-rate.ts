// 낭독 속도 설정. 탐색 안내(guidance)와 같은 방식으로 다룬다 — 저장소 접근은 Background가 맡고,
// content script는 부팅 때 물어보고 이후 변경은 메시지로 받는다.
//
// 스크린리더 사용자는 익숙해질수록 빠르게 듣는다. 배속은 두 엔진에 그대로 전달된다
// (Web Speech는 utterance.rate, ElevenLabs는 audio.playbackRate).
export const VOICE_RATE_STORAGE_KEY = "webgil.tts.rate";

export type VoiceRate = "slow" | "normal" | "fast" | "veryFast";

export const DEFAULT_VOICE_RATE: VoiceRate = "normal";

/** 화면·음성 안내에 쓰는 이름. 설정 화면과 낭독 문구가 같은 말을 쓰게 한 곳에서 관리한다. */
export const VOICE_RATE_LABEL: Record<VoiceRate, string> = {
  slow: "느림",
  normal: "일반",
  fast: "빠름",
  veryFast: "매우 빠름",
};

/**
 * 배속 값. 2배를 넘기면 ElevenLabs 음성이 알아듣기 어려워져 상한을 2로 둔다.
 * 4단계로 고정했다. 슬라이더로 세밀하게 맞추는 건 실사용 피드백을 본 뒤에.
 */
const VOICE_RATE_VALUE: Record<VoiceRate, number> = {
  slow: 0.75,
  normal: 1,
  fast: 1.5,
  veryFast: 2,
};

export function isVoiceRate(value: unknown): value is VoiceRate {
  return value === "slow" || value === "normal" || value === "fast" || value === "veryFast";
}

export function speechRateFor(rate: VoiceRate): number {
  return VOICE_RATE_VALUE[rate];
}
