import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNarration, NarrationController } from "./narration.js";
import { normalizeKoreanNumberSpeech } from "./korean-number.js";
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
  assert.deepEqual(tts.spoken, ["소식, 제목, 계층 일"]);

  narrator.stop();
  assert.equal(tts.stops, 2);
});

test("숫자를 엔진에 보내기 전 한자어 수사로 통일한다", async () => {
  assert.equal(normalizeKoreanNumberSpeech("7번 항목, 전체 12개"), "칠 번 항목, 전체 십이 개");
  assert.equal(normalizeKoreanNumberSpeech("2026-08-19, 12,000원, 3.5%, 010-1234-5678"),
    "이천이십육 년 팔 월 십구 일, 만 이천 원, 삼 점 오 퍼센트, 영 일 영, 일 이 삼 사, 오 육 칠 팔");
  assert.equal(normalizeKoreanNumberSpeech("제7조와 7월 일정"), "제칠조와 칠월 일정");
  assert.equal(
    normalizeKoreanNumberSpeech("사업자번호 123-45-67890"),
    "사업자번호 일 이 삼, 사 오, 육 칠 팔 구 영",
  );
  assert.equal(normalizeKoreanNumberSpeech("https://example.com/v1.2.3 과 test@example.com은 유지"),
    "https://example.com/v1.2.3 과 test@example.com은 유지");

  const tts = new RecordingTTS();
  await new NarrationController(tts).announce({ text: "7", kind: "heading", level: 1 }, { index: 0, count: 12 });
  assert.deepEqual(tts.spoken, ["칠, 제목, 계층 일, 일 번 항목, 전체 십이 개"]);
});
