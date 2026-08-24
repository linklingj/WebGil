import assert from "node:assert/strict";
import { test } from "node:test";
import type { TTSEngine, VoiceOptions, VoicePreset } from "@webgil/core";
import { ElevenLabsSpeechEngine } from "./elevenlabs-speech-engine.js";

class RecordingFallback implements TTSEngine {
  readonly spoken: string[] = [];
  stops = 0;

  async speak(text: string, _options?: VoiceOptions): Promise<void> {
    this.spoken.push(text);
  }

  stop(): void {
    this.stops++;
  }

  voices(): VoicePreset[] {
    return [];
  }
}

class FakeAudio {
  currentTime = 0;
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pauses = 0;

  async play(): Promise<void> {
    queueMicrotask(() => this.onended?.());
  }

  pause(): void {
    this.pauses++;
  }
}

test("ElevenLabs 음성이 준비되면 브라우저 음성 대신 재생한다", async () => {
  const fallback = new RecordingFallback();
  let audio: FakeAudio | undefined;
  const engine = new ElevenLabsSpeechEngine(
    fallback,
    async () => "data:audio/mpeg;base64,AA==",
    () => (audio = new FakeAudio()),
  );

  await engine.speak("안녕하세요", { rate: 1.1 });
  assert.deepEqual(fallback.spoken, []);
  assert.equal(audio?.playbackRate, 1.1);
});

test("ElevenLabs 요청 실패 시 기존 브라우저 음성으로 폴백한다", async () => {
  const fallback = new RecordingFallback();
  const engine = new ElevenLabsSpeechEngine(fallback, async () => {
    throw new Error("키가 없습니다");
  });

  await engine.speak("대체 음성");
  assert.deepEqual(fallback.spoken, ["대체 음성"]);
});

test("중단하면 재생 중인 ElevenLabs 오디오를 즉시 멈춘다", async () => {
  const fallback = new RecordingFallback();
  let audio: FakeAudio | undefined;
  const engine = new ElevenLabsSpeechEngine(
    fallback,
    async () => "data:audio/mpeg;base64,AA==",
    () => (audio = new FakeAudio()),
  );

  const pending = engine.speak("긴 문장");
  await Promise.resolve();
  engine.stop();
  await pending;
  assert.equal(audio?.pauses, 1);
});
