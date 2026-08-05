// 04 기본 네비게이션 엔진 — 문서 트리는 읽기 전용으로 두고 커서만 관리한다.
// 셸은 트랙패드/키 입력을 NavigationCommand로 정규화해 이 엔진에 전달한다.
import type { NodeId } from "./capture-source.js";
import { indexById, type DocNode } from "./tree.js";

/** 셸이 정규화해 전달하는 기본 이동 명령. */
export type NavigationCommand = "next" | "previous" | "enter" | "back";

/** 한 번의 명령 처리 결과. TTS·하이라이트 셸은 node가 바뀐 경우 이를 사용한다. */
export interface NavigationResult {
  status: "moved" | "boundary" | "empty";
  node: DocNode | null;
  previous: DocNode | null;
  /** 현재 같은 레벨에서의 0부터 시작하는 순서. 커서가 없으면 -1. */
  index: number;
  /** 현재 같은 레벨의 전체 노드 수. */
  count: number;
}

interface LocatedNode {
  node: DocNode;
  parent: DocNode;
  index: number;
  ancestors: DocNode[];
}

/**
 * 문서 트리 위의 순수 커서 엔진.
 *
 * root 자신은 사용자에게 노출하지 않는다. 따라서 초기 위치는 root의 첫 자식이며,
 * next/previous는 같은 부모의 형제 사이에서만 이동한다. 경계에서는 순환하지 않아
 * 셸이 효과음·TTS 등으로 "끝"을 알려줄 수 있다.
 */
export class NavigationEngine {
  private root: DocNode;
  private currentId: NodeId | null;
  /** 03 문서 트리 모델의 id 조회 인덱스. 스냅샷마다 한 번만 만든다. */
  private nodeIndex: Map<NodeId, DocNode>;
  /** 부모·형제 위치까지 담은 네비게이션 전용 인덱스. */
  private locationIndex: Map<NodeId, LocatedNode>;

  constructor(root: DocNode) {
    this.root = root;
    this.nodeIndex = new Map();
    this.locationIndex = new Map();
    this.reindex();
    this.currentId = root.children[0]?.id ?? null;
  }

  /** 현재 선택된 문서 노드. 비어 있는 트리에서는 null. */
  get current(): DocNode | null {
    return this.currentId ? this.nodeIndex.get(this.currentId) ?? null : null;
  }

  /** id로 문서 노드를 찾는다. LLM 액션 확인 UI가 대상 설명을 만들 때 사용한다. */
  nodeById(id: NodeId): DocNode | null {
    return this.nodeIndex.get(id) ?? null;
  }

  /** 정규화된 입력 명령 하나를 처리한다. */
  handle(command: NavigationCommand): NavigationResult {
    switch (command) {
      case "next":
        return this.next();
      case "previous":
        return this.previous();
      case "enter":
        return this.enter();
      case "back":
        return this.back();
    }
  }

  /** 같은 레벨의 다음 노드로 이동한다. */
  next(): NavigationResult {
    const current = this.locateCurrent();
    if (!current) return this.emptyResult();
    if (current.index === current.parent.children.length - 1) return this.result("boundary", current.node, current.node);
    return this.setCurrent(current.parent.children[current.index + 1], current.node);
  }

  /** 같은 레벨의 이전 노드로 이동한다. */
  previous(): NavigationResult {
    const current = this.locateCurrent();
    if (!current) return this.emptyResult();
    if (current.index === 0) return this.result("boundary", current.node, current.node);
    return this.setCurrent(current.parent.children[current.index - 1], current.node);
  }

  /** 현재 노드의 첫 자식 레벨로 진입한다. */
  enter(): NavigationResult {
    const current = this.locateCurrent();
    if (!current) return this.emptyResult();
    const child = current.node.children[0];
    if (!child) return this.result("boundary", current.node, current.node);
    return this.setCurrent(child, current.node);
  }

  /** 현재 노드의 부모 레벨로 복귀한다. root 바로 아래에서는 이동하지 않는다. */
  back(): NavigationResult {
    const current = this.locateCurrent();
    if (!current) return this.emptyResult();
    if (current.parent === this.root) return this.result("boundary", current.node, current.node);
    return this.setCurrent(current.parent, current.node);
  }

  /** 첫 최상위 노드로 커서를 되돌린다. */
  reset(): NavigationResult {
    const previous = this.current;
    const first = this.root.children[0];
    if (!first) {
      this.currentId = null;
      return this.emptyResult(previous);
    }
    return this.setCurrent(first, previous);
  }

  /**
   * SPA 갱신으로 새 스냅샷을 받는다. 같은 id의 노드가 남아 있으면 그 위치를 유지하고,
   * 사라졌다면 가장 가까운 살아 있는 조상(없으면 첫 최상위 노드)으로 안전하게 돌아간다.
   */
  replaceTree(root: DocNode): NavigationResult {
    const previous = this.current;
    const lineage = this.locateCurrent()?.ancestors.map((node) => node.id) ?? [];
    this.root = root;
    this.reindex();

    for (let i = lineage.length - 1; i >= 0; i--) {
      const located = this.locationIndex.get(lineage[i]);
      if (located) {
        this.currentId = located.node.id;
        return this.result("moved", located.node, previous);
      }
    }

    this.currentId = this.root.children[0]?.id ?? null;
    return this.currentId ? this.result("moved", this.current!, previous) : this.emptyResult(previous);
  }

  private setCurrent(node: DocNode, previous: DocNode | null): NavigationResult {
    this.currentId = node.id;
    return this.result("moved", node, previous);
  }

  private locateCurrent(): LocatedNode | null {
    return this.currentId ? this.locationIndex.get(this.currentId) ?? null : null;
  }

  private result(
    status: NavigationResult["status"],
    node: DocNode | null,
    previous: DocNode | null,
  ): NavigationResult {
    const located = node ? this.locationIndex.get(node.id) : null;
    return {
      status,
      node,
      previous,
      index: located?.index ?? -1,
      count: located?.parent.children.length ?? 0,
    };
  }

  private emptyResult(previous: DocNode | null = null): NavigationResult {
    return { status: "empty", node: null, previous, index: -1, count: 0 };
  }

  /** 새 트리 스냅샷을 받을 때만 전체 순회한다. 이후 커서 조회는 O(1)이다. */
  private reindex(): void {
    this.nodeIndex = indexById(this.root);
    this.locationIndex.clear();

    const visit = (parent: DocNode, ancestors: DocNode[]): void => {
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        const nodeAncestors = [...ancestors, node];
        this.locationIndex.set(node.id, { node, parent, index, ancestors: nodeAncestors });
        visit(node, nodeAncestors);
      }
    };
    visit(this.root, []);
  }
}
