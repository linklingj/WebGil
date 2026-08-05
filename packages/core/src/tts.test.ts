import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNarration, NarrationController } from "./narration.js";
import type { TTSEngine, VoiceOptions, VoicePreset } from "./tts.js";

class RecordingTTS implements TTSEngine {
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

test("노드 종류·레벨·같은 레벨 위치를 낭독 문구에 담는다", () => {
  assert.equal(
    formatNarration({ text: "소개", kind: "heading", level: 2 }, { index: 1, count: 3 }),
    "소개, 제목, 계층 2, 2번 항목, 전체 3개",
  );
  assert.equal(
    formatNarration({ text: "로그인", kind: "link", level: 2 }, { detail: "brief" }),
    "로그인",
  );
});

test("새 낭독 전에는 반드시 이전 낭독을 중단한다", async () => {
  const tts = new RecordingTTS();
  const narrator = new NarrationController(tts);

  await narrator.announce({ text: "소식", kind: "heading", level: 1 });
  assert.equal(tts.stops, 1);
  assert.deepEqual(tts.spoken, ["소식, 제목, 계층 1"]);

  narrator.stop();
  assert.equal(tts.stops, 2);
});
