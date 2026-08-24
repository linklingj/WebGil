// CaptureSource — 코어가 "페이지에 어떻게 접근하는지" 모르게 하는 유일한 교체 지점.
// 셸(확장/데스크톱/벤치)마다 다른 건 이 인터페이스의 구현체뿐이다. (plan.md §4.1, docs/01_SYSTEM/01)

/** 트리 노드의 안정적 식별자. 하이라이트·액션이 이 id로 노드를 지목한다. */
export type NodeId = string;

/**
 * 원본 DOM 참조. 셸마다 실제 표현이 다르다(확장=Element, CDP=backendNodeId).
 * 코어는 내용을 모르고 불투명 핸들로만 다룬다 — 액션/하이라이트는 셸이 해소한다.
 */
export type NodeHandle = unknown;

/** CDP 기반 셸(데스크톱/벤치)이 반환할 원격 DOM 자리표시자. 확장은 직접 Document를 반환한다. */
export interface RemoteHandle {
  readonly remote: true;
}

/**
 * 접근성 노드. 구조 추출 엔진(02)이 DOM과 병합해 문서 트리를 만든다.
 * MVP 단계에선 확장이 라이브 DOM에서 역할·이름을 뽑아 평평한 목록으로 제공한다.
 */
export interface AXNode {
  id: NodeId;
  role: string; // "heading" | "link" | "button" | "textbox" | landmark 등
  name: string; // 접근 가능한 이름(accessible name)
  level?: number; // heading 등 의미 계층(1~6)
}

/** 코어가 정의하는 액션. 트러스트(신뢰) 확보 방식만 셸마다 다르다. (docs/01_SYSTEM/07) */
export type Action =
  | { type: "click"; nodeId: NodeId }
  | { type: "focus"; nodeId: NodeId }
  | { type: "input"; nodeId: NodeId; value: string }
  | { type: "submit"; nodeId: NodeId };

/** 페이지 접근·관찰·제어의 유일한 인터페이스. (plan.md §4.1) */
export interface CaptureSource {
  /** 라이브 DOM. 확장은 직접 Document, CDP 셸은 원격 핸들. */
  getDOM(): Document | RemoteHandle;
  /** 접근성 트리(노드 목록). 구조 추출 엔진의 입력. */
  getAXTree(): AXNode[];
  /** 트리 노드 id를 원본 DOM 핸들로 해소해 트러스트 이벤트로 실행. */
  execute(action: Action): Promise<void>;
  /** 트리 노드 ↔ 화면 매핑: 해당 노드를 화면에 강조. */
  highlight(nodeId: NodeId): void;
  /** SPA 갱신 감지 → 코어가 재추출하도록 콜백 등록. */
  onMutation(cb: () => void): void;
}
