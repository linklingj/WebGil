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

test("기본 이동은 짧게 읽고, 상세 모드에서만 계층·위치를 자연스럽게 안내한다", () => {
  assert.equal(
    formatNarration({ text: "소개", kind: "heading", level: 2 }, { index: 1, count: 3 }),
    "소개. 제목입니다.",
  );
  assert.equal(
    formatNarration({ text: "소개", kind: "heading", level: 3 }, { detail: "full", index: 8, count: 14 }),
    "소개. 제목입니다. 세 번째 계층입니다. 현재 아홉 번째 항목입니다. 이 계층에는 총 열네 개 항목이 있습니다.",
  );
  assert.equal(
    formatNarration({ text: "소개입니다.", kind: "heading", level: 1 }),
    "소개입니다. 제목입니다.",
  );
  assert.equal(
    formatNarration({ text: "목록", kind: "group", level: 1 }, { detail: "full", index: 99, count: 100 }),
    "목록. 그룹입니다. 현재 100 번째 항목입니다. 이 계층에는 총 100 개 항목이 있습니다.",
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
  assert.deepEqual(tts.spoken, ["소식. 제목입니다."]);

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
  assert.equal(
    normalizeKoreanNumberSpeech("C:\\Users\\webgil\\file_name.pdf와 /usr/local/bin/run.sh는 유지"),
    "C:\\Users\\webgil\\file_name.pdf와 /usr/local/bin/run.sh는 유지",
  );
  assert.equal(
    normalizeKoreanNumberSpeech("Alt + Enter, A/B, #공지, ※ 필독, 로그인-회원가입, (선택) [필수]"),
    "Alt 플러스 Enter, A 슬래시 B, 샵 공지, 참고 필독, 로그인 하이픈 회원가입, 선택 필수",
  );

  const tts = new RecordingTTS();
  await new NarrationController(tts).announce({ text: "7", kind: "heading", level: 1 }, { index: 0, count: 12 });
  assert.deepEqual(tts.spoken, ["칠. 제목입니다."]);
});
