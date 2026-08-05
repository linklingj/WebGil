// 07 액션 실행기 — 코어가 만든 Action을 셸(CaptureSource.execute)에 넘기기 전 마지막 관문.
// 네비게이션(04)·LLM 명령(06)의 실행 경로를 여기 하나로 모아, 트리 노드 기준 검증을 한 곳에서 한다.
// 트러스트(신뢰) 이벤트 확보 방식은 셸의 몫이고, 코어는 "실행해도 되는 노드인가"만 판단한다. (docs/01_SYSTEM/07)
import type { Action, CaptureSource, NodeId } from "./capture-source.js";
import type { DocNode } from "./tree.js";

export type ActionResult =
  | { status: "executed"; action: Action }
  | { status: "rejected"; reason: string };

/** id → 문서 노드 조회. 재추출마다 트리가 바뀌므로 스냅샷이 아니라 함수로 받는다. */
export type NodeLookup = (id: NodeId) => DocNode | null;

export class ActionExecutor {
  constructor(
    private readonly source: Pick<CaptureSource, "execute" | "highlight">,
    private readonly lookup: NodeLookup,
  ) {}

  /** 검증 후 셸에 위임하고, 성공하면 대상 노드를 하이라이트한다. */
  async execute(action: Action): Promise<ActionResult> {
    const node = this.lookup(action.nodeId);
    if (!node) return rejected("문서에 없는 항목입니다.");
    // 핸들 없는 노드 = 폴백 트리 노드·group 버킷(02·03). 원본 DOM이 없어 조작 불가.
    if (node.handle === undefined) return rejected("조작할 수 없는 항목입니다.");
    // 입력칸이 아닌 노드에 값을 넣으면 프레임워크 상태만 망가진다.
    if (action.type === "input" && node.kind !== "input")
      return rejected("입력할 수 있는 항목이 아닙니다.");

    try {
      await this.source.execute(action);
    } catch (error) {
      // 셸에서 노드가 이미 사라진 경우 등. 호출자(키 입력 처리)를 죽이지 않는다.
      return rejected(error instanceof Error ? error.message : "동작을 실행하지 못했습니다.");
    }
    this.source.highlight(action.nodeId);
    return { status: "executed", action };
  }

  /** 노드 종류에 맞는 기본 동작. 키보드 활성화(04)가 "이 노드를 실행" 한 가지 의도만 보낼 때 쓴다. */
  async activate(nodeId: NodeId): Promise<ActionResult> {
    const node = this.lookup(nodeId);
    if (!node) return rejected("문서에 없는 항목입니다.");
    const action = defaultAction(node);
    if (!action) return rejected("실행할 수 있는 항목이 아닙니다.");
    return this.execute(action);
  }
}

/** 링크·버튼은 클릭, 입력칸은 포커스(값 입력은 사용자가 직접 타이핑). 낭독 전용 노드는 없음. */
function defaultAction(node: DocNode): Action | null {
  switch (node.kind) {
    case "link":
    case "button":
      return { type: "click", nodeId: node.id };
    case "input":
      // ponytail: 체크박스·라디오도 포커스까지만. 포커스 뒤 Space는 브라우저가 처리한다.
      return { type: "focus", nodeId: node.id };
    default:
      return null;
  }
}

function rejected(reason: string): ActionResult {
  return { status: "rejected", reason };
}
