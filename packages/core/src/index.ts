// @webgil/core — 셸을 모르는 순수 로직의 공개 표면.
export type {
  CaptureSource,
  AXNode,
  Action,
  NodeId,
  NodeHandle,
  RemoteHandle,
} from "./capture-source.js";

// 02 구조 추출 엔진.
export { extractTree } from "./structure.js";

// 03 문서 트리 모델 — 코어 전 엔진이 공유하는 스키마 + 읽기 헬퍼.
export { treeStats, treeToText } from "./tree.js";
export type { DocNode, NodeKind, TreeStats } from "./tree.js";

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
