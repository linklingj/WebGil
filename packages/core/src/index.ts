// @webgil/core — 셸을 모르는 순수 로직의 공개 표면.
// MVP 단계에선 CaptureSource 계약만 노출한다. 구조추출·트리·TTS·LLM은 이후 단계에서 추가.
export type {
  CaptureSource,
  AXNode,
  Action,
  NodeId,
  NodeHandle,
  RemoteHandle,
} from "./capture-source.js";
