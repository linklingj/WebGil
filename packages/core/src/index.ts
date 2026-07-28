// @webgil/core — 셸을 모르는 순수 로직의 공개 표면.
export type {
  CaptureSource,
  AXNode,
  Action,
  NodeId,
  NodeHandle,
  RemoteHandle,
} from "./capture-source.js";

// 02 구조 추출 엔진 + 03 문서 트리 모델.
export { extractTree, treeStats, treeToText } from "./structure.js";
export type { DocNode, NodeKind, TreeStats } from "./structure.js";

// 05 TTS 엔진 + 노드 낭독 규칙.
export type { TTSEngine, VoiceOptions, VoicePreset } from "./tts.js";
export {
  NarrationController,
  formatNarration,
} from "./narration.js";
export type { NarrationContext, NarrationTarget } from "./narration.js";

// DOM → 의미 규칙(셸과 공유).
export {
  SIGNIFICANT_SELECTOR,
  ID_ATTR,
  ensureNodeId,
  headingLevel,
  roleOf,
  accessibleName,
  collapse,
  isHidden,
} from "./dom-semantics.js";
