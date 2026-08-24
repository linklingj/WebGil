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
 * landmark group이 나타내는 페이지 영역. `main`은 기본 낭독 시작점을 고르는 데 쓴다.
 * 이 값은 DOM의 원래 의미를 보존할 뿐, 화면 요소를 삭제하거나 바꾸지는 않는다.
 */
export type RegionRole =
  | "navigation"
  | "main"
  | "banner"
  | "contentinfo"
  | "complementary"
  | "region"
  | "search"
  | "form";

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
  /** landmark group일 때만 원래의 접근성 영역 역할. 일반 노드·버킷에는 없다. */
  regionRole?: RegionRole;
  /** 표 구조(표·행·셀)에 속한 노드. 표는 열 정렬이 의미라서 중복 제거·버킷 묶음에서 제외한다. */
  table?: boolean;
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

// --- 직렬화 경계 (셸 간 전송) ---

/**
 * 핸들을 뗀 전송용 트리. 사이드패널(08)처럼 페이지와 **다른 컨텍스트**에 있는 화면 계층은
 * `handle`(DOM Element)을 구조화 복제할 수 없다 — 보내봐야 빈 객체로 도착한다.
 * 그래서 뷰에는 이 스냅샷만 건네고, 뷰는 `id`로만 노드를 지목한다.
 * 부수 효과로 "화면 계층에 DOM 핸들을 넘기지 않는다"는 원칙도 함께 지켜진다. (docs/01_SYSTEM/08)
 */
export type SnapshotNode = Omit<DocNode, "handle" | "children"> & { children: SnapshotNode[] };

export function toSnapshot(node: DocNode): SnapshotNode {
  const { handle: _handle, children, ...rest } = node;
  return { ...rest, children: children.map(toSnapshot) };
}

// --- 검색 (08 상단 내비게이션 검색) ---

export interface SearchHit {
  id: NodeId;
  text: string;
  kind: NodeKind;
  level: number;
  /** 루트 아래 조상들의 텍스트. "본문 > 공지사항"처럼 위치를 보여주는 데 쓴다. */
  path: string[];
}

/**
 * 트리 텍스트 부분 일치 검색. LLM을 타지 않으므로 즉시·오프라인이다(비용 0).
 * 접두 일치를 먼저, 그다음 문서 순서. DocNode·SnapshotNode 양쪽에 그대로 쓴다.
 */
export function searchTree(root: SnapshotNode, query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const prefix: SearchHit[] = [];
  const rest: SearchHit[] = [];
  const walk = (parent: SnapshotNode, path: string[]) => {
    for (const child of parent.children) {
      const at = child.text.toLowerCase().indexOf(needle);
      if (at >= 0) {
        const hit: SearchHit = { id: child.id, text: child.text, kind: child.kind, level: child.level, path };
        (at === 0 ? prefix : rest).push(hit);
      }
      // 텍스트가 없는 group도 경로에는 남기지 않는다(빈 칸이 경로를 어지럽힌다).
      walk(child, child.text ? [...path, child.text] : path);
    }
  };
  walk(root, []);
  return [...prefix, ...rest].slice(0, limit);
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
