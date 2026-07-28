// 네비게이션·LLM 등이 지목한 노드를 짧고 일관된 낭독 문구로 바꾼다.
import type { TTSEngine, VoiceOptions } from "./tts.js";

/** 문서 트리와 느슨하게 결합된 낭독 대상. 폴백 트리도 같은 형태로 읽을 수 있다. */
export interface NarrationTarget {
  text: string;
  kind: string;
  level: number;
}

export interface NarrationContext {
  index?: number;
  count?: number;
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

/** 현재 노드의 성격과 위치를 포함한 한국어 낭독 문구. */
export function formatNarration(target: NarrationTarget, context: NarrationContext = {}): string {
  const kind = KIND_LABEL[target.kind] ?? "항목";
  const text = target.text.trim() || `이름 없는 ${kind}`;
  if (context.detail === "brief") return text;

  const parts = [text, kind];
  // DocNode.level은 H1~H6 값이 아니라 문서 트리의 깊이다.
  if (target.kind === "heading") parts.push(`계층 ${target.level}`);
  if (context.index !== undefined && context.count !== undefined) {
    parts.push(`${context.index + 1}번 항목, 전체 ${context.count}개`);
  }
  return parts.join(", ");
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
      await this.tts.speak(formatNarration(target, context), options);
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
