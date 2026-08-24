// 08 사이드패널 ↔ 콘텐츠 스크립트 메시지 규약.
// 패널은 페이지와 다른 컨텍스트라 DOM 핸들을 주고받을 수 없다. 오가는 건 스냅샷과 id뿐이다.
// (docs/01_SYSTEM/08 "패널 ↔ 페이지 통신")
import type { NavigationCommand, SnapshotNode } from "@webgil/core";
import type { NavigationGuidance } from "../navigation/guidance.js";
import type { VoiceRate } from "../tts/voice-rate.js";

/** 패널 → 콘텐츠. 전부 id 아니면 열거값이다 — 노드 객체는 넘어가지 않는다. */
export type PanelCommand =
  | { type: "sync" }
  | { type: "navigate"; command: NavigationCommand }
  | { type: "setNavigationGuidance"; guidance: NavigationGuidance; announce?: boolean }
  | { type: "setVoiceRate"; rate: VoiceRate }
  | { type: "moveTo"; id: string }
  | { type: "activate"; id: string }
  | { type: "refine" }
  | { type: "ask"; input: string }
  | { type: "confirm" };

/** 콘텐츠 → 패널. 트리 스냅샷 + 커서. 한 메시지에 묶어 보내 뷰가 항상 일관된 쌍을 본다. */
export interface PanelState {
  title: string;
  tree: SnapshotNode;
  cursorId: string | null;
  index: number;
  count: number;
}

/** 명령 하나에 대한 응답. 갱신된 상태를 함께 실어 패널이 따로 되묻지 않게 한다. */
export interface PanelReply {
  type: typeof PANEL_STATE;
  state: PanelState;
  /** 상태 줄에 띄울 한 줄(명령 결과·오류). */
  message?: string;
  /** true면 같은 입력에 대한 다음 Enter는 실행 확인으로 해석한다(07 가드레일). */
  awaitingConfirm?: boolean;
  /**
   * true면 패널이 `message`를 소리로도 읽는다.
   * 페이지 쪽 낭독기가 이미 말한 결과(노드 이동·현재 항목 읽기)는 false로 와서 겹치지 않는다.
   */
  speak?: boolean;
}

export const PANEL_COMMAND = "webgil.panel.command";
export const PANEL_STATE = "webgil.panel.state";
/** background가 "이 화면을 띄워라"를 남기는 자리. storage.session은 신뢰된 컨텍스트 전용. */
export const PANEL_VIEW_KEY = "webgil.panel.view";

/** 툴바 아이콘·브라우저 단축키가 패널에 보낼 수 있는 요청. */
export type PanelView = "settings" | "help" | "search";

export function isPanelView(value: unknown): value is PanelView {
  return value === "settings" || value === "help" || value === "search";
}

export function isPanelCommandMessage(value: unknown): value is { type: typeof PANEL_COMMAND; command: PanelCommand } {
  return isRecord(value) && value.type === PANEL_COMMAND && isRecord(value.command) && typeof value.command.type === "string";
}

export function isPanelStateMessage(value: unknown): value is { type: typeof PANEL_STATE; state: PanelState } {
  if (!isRecord(value) || value.type !== PANEL_STATE || !isRecord(value.state)) return false;
  return isRecord(value.state.tree);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
