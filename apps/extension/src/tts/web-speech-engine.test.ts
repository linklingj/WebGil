import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSpeechEngine } from "./web-speech-engine.js";

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(readonly text: string) {}
}

class FakeSpeechSynthesis {
  readonly remoteKoreanVoice = { voiceURI: "ko-remote", name: "한국어 원격", lang: "ko-KR", localService: false } as SpeechSynthesisVoice;
  readonly koreanVoice = { voiceURI: "ko", name: "한국어", lang: "ko-KR", localService: true } as SpeechSynthesisVoice;
  availableVoices: SpeechSynthesisVoice[] = [this.remoteKoreanVoice, this.koreanVoice];
  spoken?: FakeUtterance;
  cancels = 0;
  private readonly listeners = new Set<() => void>();

  getVoices(): SpeechSynthesisVoice[] {
    return this.availableVoices;
  }

  speak(utterance: SpeechSynthesisUtterance): void {
    this.spoken = utterance as unknown as FakeUtterance;
  }

  cancel(): void {
    this.cancels++;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener as () => void);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.delete(listener as () => void);
  }

  emitVoicesChanged(): void {
    for (const listener of this.listeners) listener();
  }
}

test("원격 한국어 음성보다 로컬 한국어 음성을 우선 선택하고 옵션을 전달한다", async () => {
  const synthesis = new FakeSpeechSynthesis();
  const engine = new WebSpeechEngine(
    synthesis as unknown as SpeechSynthesis,
    (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  );

  const pending = engine.speak("안녕하세요", { rate: 1.2, pitch: 0.9 });
  assert.equal(synthesis.spoken?.text, "안녕하세요");
  assert.equal(synthesis.spoken?.voice, synthesis.koreanVoice);
  assert.equal(synthesis.spoken?.rate, 1.2);
  synthesis.spoken?.onend?.({} as SpeechSynthesisEvent);
  await pending;
});

test("stop은 진행 중인 낭독을 취소하고 Promise를 끝낸다", async () => {
  const synthesis = new FakeSpeechSynthesis();
  const engine = new WebSpeechEngine(
    synthesis as unknown as SpeechSynthesis,
    (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  );

  const pending = engine.speak("긴 문장");
  engine.stop();
  await pending;
  assert.equal(synthesis.cancels, 1);
});

test("낭독 오류 뒤에는 active 상태를 정리해 다음 낭독을 정상 시작한다", async () => {
  const synthesis = new FakeSpeechSynthesis();
  const engine = new WebSpeechEngine(
    synthesis as unknown as SpeechSynthesis,
    (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  );

  const failed = engine.speak("실패할 문장");
  synthesis.spoken?.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent);
  await assert.rejects(failed, /음성 낭독 실패: network/);

  engine.stop();
  assert.equal(synthesis.cancels, 0, "실패한 요청은 더 이상 취소할 active 낭독이 없다");

  const next = engine.speak("다음 문장");
  assert.equal(synthesis.spoken?.text, "다음 문장");
  synthesis.spoken?.onend?.({} as SpeechSynthesisEvent);
  await next;
});

test("처음 비어 있던 음성 목록이 준비되면 한국어 음성으로 첫 낭독을 시작한다", async () => {
  const synthesis = new FakeSpeechSynthesis();
  synthesis.availableVoices = [];
  const engine = new WebSpeechEngine(
    synthesis as unknown as SpeechSynthesis,
    (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
    1_000,
  );

  const pending = engine.speak("첫 낭독");
  assert.equal(synthesis.spoken, undefined);

  synthesis.availableVoices = [synthesis.koreanVoice];
  synthesis.emitVoicesChanged();
  await Promise.resolve();
  const spoken = synthesis.spoken as FakeUtterance | undefined;
  assert.ok(spoken, "voiceschanged 뒤 첫 발화가 시작된다");
  assert.equal(spoken.voice, synthesis.koreanVoice);
  spoken.onend?.({} as SpeechSynthesisEvent);
  await pending;
});
