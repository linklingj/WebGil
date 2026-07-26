// 03 문서 트리 모델 — 구조 추출(02)의 결과를 담는 정규화된 계층 자료구조.
// 코어의 모든 엔진(네비 04·TTS 05·LLM 06·액션 07·하이라이트)이 공유하는 단일 표현.
// 읽기 전용 스냅샷: 커서 등 가변 상태는 네비게이션 엔진(04)이 별도로 보관한다
// (트리에 가변 상태를 섞지 않는다). (docs/01_SYSTEM/03)
import type { NodeId, NodeHandle } from "./capture-source.js";

/**
 * 노드의 상호작용 종류.
 * - `heading`/`text`: 낭독 전용(계층·본문).
 * - `link`/`button`/`input`: 조작 가능(handle로 액션 실행기(07)가 지목).
 * - `group`: 계층 묶음 — landmark 영역 또는 동종 leaf 버킷. handle 없음.
 */
export type NodeKind = "heading" | "text" | "link" | "button" | "input" | "group";

/**
 * 정규화된 문서 트리의 노드.
 *
 * 설계 결정(docs/03 미결정 항목 해소):
 * - **handle**: `NodeHandle`은 불투명(capture-source.ts). 셸이 실제 표현을 안다
 *   (확장=Element, CDP=backendNodeId). 유무로 조작 가능 vs 낭독 전용을 구분한다.
 * - **group**: children 구조로만 표현하지 않고 명시 노드로 둔다. landmark 영역과
 *   동종 leaf 버킷을 같은 group 노드로 통일 → 탐색·낭독이 "묶음"을 1급으로 다룬다.
 * - **id 안정성**: 같은 Element는 재추출에도 같은 id를 유지(dom-semantics.ensureNodeId).
 *   완전한 SPA 재식별 규칙은 Phase 3.
 */
export interface DocNode {
  /** 안정적 식별자. 하이라이트·액션이 이 id로 노드를 지목한다. */
  id: NodeId;
  kind: NodeKind;
  /** 트리 깊이(root=0, 자식=1…). 시각 크기가 아닌 의미 계층 = 탐색 drill-down 축. */
  level: number;
  /** 낭독·표시용 텍스트(접근 가능한 이름). */
  text: string;
  /** 원본 DOM 참조. 규칙 트리는 채우고, 폴백 트리(02)·group 버킷은 없을 수 있다. */
  handle?: NodeHandle;
  children: DocNode[];
}

// --- id 조회 (커서·하이라이트·액션의 지목 기준) ---

/**
 * id → 노드 조회 인덱스. 하이라이트·액션·네비 커서(04)가 NodeId로 노드를 되짚는 기준.
 *
 * 갱신(재추출) 연동: 트리는 읽기 전용 스냅샷이라 mutation 때마다 새로 추출한다.
 * 그때 인덱스도 다시 만든다 — 같은 Element는 같은 id를 유지하므로(ensureNodeId),
 * 커서가 들고 있던 id가 새 트리에서도 같은 노드로 되짚어진다. 노드가 사라졌으면
 * `get`이 undefined → 커서 폴백은 네비게이션 엔진(04)이 처리한다. (docs/03)
 */
export function indexById(root: DocNode): Map<NodeId, DocNode> {
  const index = new Map<NodeId, DocNode>();
  const walk = (n: DocNode) => {
    index.set(n.id, n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return index;
}

// --- 관찰용 읽기 헬퍼 (콘솔·벤치) ---

export interface TreeStats {
  total: number; // root 제외 전체 노드 수
  topLevel: number; // 최상위(레벨 1) 노드 수
  maxDepth: number;
  byKind: Record<string, number>;
}

export function treeStats(root: DocNode): TreeStats {
  const byKind: Record<string, number> = {};
  let total = 0;
  let maxDepth = 0;
  const walk = (n: DocNode) => {
    for (const c of n.children) {
      total++;
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
      if (c.level > maxDepth) maxDepth = c.level;
      walk(c);
    }
  };
  walk(root);
  return { total, topLevel: root.children.length, maxDepth, byKind };
}

/** 트리를 읽기 쉬운 들여쓰기 텍스트로. maxDepth까지만 펼친다(콘솔 관찰용). */
export function treeToText(root: DocNode, maxDepth = 3): string {
  const lines: string[] = [];
  const walk = (n: DocNode) => {
    for (const c of n.children) {
      const kids = c.children.length ? ` (${c.children.length})` : "";
      lines.push(`${"  ".repeat(c.level - 1)}[${c.kind}] ${c.text}${kids}`);
      if (c.level < maxDepth) walk(c);
    }
  };
  walk(root);
  return lines.join("\n");
}
