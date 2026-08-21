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

// 02-L LLM 트리 재구성 — 규칙 기반 트리를 재배치만으로 다듬는다(핸들 보존).
export { applyRefinePlan, refineTree } from "./tree-refine.js";
export type { RefineOptions, RefinePlan, RefinePlanNode, RefineResult } from "./tree-refine.js";

// 03 문서 트리 모델 — 코어 전 엔진이 공유하는 스키마 + 읽기 헬퍼.
export { indexById, treeStats, treeToText } from "./tree.js";
export type { DocNode, NodeKind, RegionRole, TreeStats } from "./tree.js";

// 04 기본 네비게이션 엔진.
export { NavigationEngine } from "./navigation.js";
export type { NavigationCommand, NavigationResult } from "./navigation.js";

// 05 TTS 엔진 + 노드 낭독 규칙.
export type { TTSEngine, VoiceOptions, VoicePreset } from "./tts.js";
export { normalizeKoreanNumberSpeech } from "./korean-number.js";
export {
  NarrationController,
  formatNarration,
} from "./narration.js";
export type { NarrationContext, NarrationTarget } from "./narration.js";

// 06 LLM 명령: 자연어 명령을 검증 가능한 계획으로만 변환한다.
export {
  CommandDispatcher,
  createDocumentContext,
  LLMCommandEngine,
  validateCommand,
} from "./llm-command.js";
export type {
  ActionConfirmation,
  CommandDispatchResult,
  CommandRuntime,
  CommandResolution,
  DocumentContext,
  DocumentContextOptions,
  LanguageModel,
  LLMCommand,
  LLMRequest,
  NavigationIntent,
} from "./llm-command.js";

export {
  AnthropicMessagesModel,
  createProviderLanguageModel,
  GeminiOpenAICompatibleModel,
  OpenAIResponsesModel,
} from "./llm-provider.js";
export type { FetchFunction, LLMProvider, ProviderConfig } from "./llm-provider.js";

// 07 액션 실행기 — 네비게이션·LLM 명령의 실행 경로를 하나로 모은다.
export { ActionExecutor } from "./action.js";
export type { ActionResult, NodeLookup } from "./action.js";

// DOM → 의미 규칙(셸과 공유).
export {
  SIGNIFICANT_SELECTOR,
  TEXT_BLOCK_SELECTOR,
  ID_ATTR,
  UI_ROOT_ATTR,
  blockText,
  ensureNodeId,
  headingLevel,
  roleOf,
  accessibleName,
  collapse,
  isHidden,
} from "./dom-semantics.js";
export type { BlockText } from "./dom-semantics.js";
