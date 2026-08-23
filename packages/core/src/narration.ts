// 네비게이션·LLM 등이 지목한 노드를 짧고 일관된 낭독 문구로 바꾼다.
import type { TTSEngine, VoiceOptions } from "./tts.js";
import { normalizeKoreanNumberSpeech } from "./korean-number.js";

/** 문서 트리와 느슨하게 결합된 낭독 대상. 폴백 트리도 같은 형태로 읽을 수 있다. */
export interface NarrationTarget {
  text: string;
  kind: string;
  level: number;
}

export interface NarrationContext {
  index?: number;
  count?: number;
  /** brief는 원문만, full은 계층·위치를 포함한 상세 안내다. 기본은 반복 없는 일반 안내다. */
  detail?: "brief" | "full";
}

const KIND_LABEL: Record<string, string> = {
  heading: "제목",
  text: "텍스트",
  link: "링크",
  button: "버튼",
  input: "입력창",
  group: "그룹",
};

/** 현재 노드를 자연스러운 한국어 낭독 문구로 만든다. */
export function formatNarration(target: NarrationTarget, context: NarrationContext = {}): string {
  const kind = KIND_LABEL[target.kind] ?? "항목";
  const text = target.text.trim() || `이름 없는 ${kind}`;
  if (context.detail === "brief") return text;

  // 기본 이동은 내용 중심으로 짧게 읽는다. 위치 정보는 필요할 때만 full로 요청한다.
  const sentences = [`${withSentenceEnding(text)} ${kind}입니다.`];
  if (context.detail === "full") {
    // DocNode.level은 H1~H6 값이 아니라 문서 트리의 깊이다.
    if (target.kind === "heading") sentences.push(`${nativeOrdinal(target.level)} 계층입니다.`);
    if (context.index !== undefined && context.count !== undefined) {
      sentences.push(`현재 ${nativeOrdinal(context.index + 1)} 항목입니다.`);
      sentences.push(`이 계층에는 총 ${nativeCount(context.count)} 개 항목이 있습니다.`);
    }
  }
  return sentences.join(" ");
}

const NATIVE_UNITS = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉"];
const NATIVE_TENS = ["", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"];

function nativeCount(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) return String(value);
  if (value < 10) return NATIVE_UNITS[value];
  const tens = Math.floor(value / 10);
  const units = value % 10;
  const tensText = value === 20 ? "스무" : NATIVE_TENS[tens];
  return `${tensText}${units ? NATIVE_UNITS[units] : ""}`;
}

function nativeOrdinal(value: number): string {
  if (value === 1) return "첫 번째";
  const count = nativeCount(value);
  // 100 이상은 한자어 수사 정규화 단계로 넘긴다. 띄어쓰기를 남겨야 "백 번째"처럼 읽힌다.
  return count === String(value) ? `${value} 번째` : `${count} 번째`;
}

/** 제목 자체에 문장부호가 있어도 ".. 제목입니다"가 되지 않게 한다. */
function withSentenceEnding(text: string): string {
  return /[.!?…。！？]$/.test(text) ? text : `${text}.`;
}

/**
 * 새 낭독 요청이 기존 낭독을 선점하도록 보장하는 얇은 조정 계층.
 * NavigationEngine은 이 클래스를 몰라도 되므로 커서 로직을 순수하게 유지한다.
 */
export class NarrationController {
  private requestId = 0;

  constructor(private readonly tts: TTSEngine) {}

  async announce(
    target: NarrationTarget,
    context: NarrationContext = {},
    options?: VoiceOptions,
  ): Promise<void> {
    const requestId = ++this.requestId;
    this.tts.stop();
    try {
      // 원문 트리는 그대로 보존하고, 실제 음성으로 나가는 문구에만 발음 정규화를 적용한다.
      await this.tts.speak(normalizeKoreanNumberSpeech(formatNarration(target, context)), options);
    } catch (error) {
      // stop() 이후 늦게 도착한 취소 오류는 새 낭독을 방해하지 않는다.
      if (requestId !== this.requestId) return;
      throw error;
    }
  }

  stop(): void {
    this.requestId++;
    this.tts.stop();
  }
}
