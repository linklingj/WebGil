// 02 구조 추출 엔진 — 라이브 DOM을 의미적 문서 트리로 변환하는 규칙 기반 1차 경로.
// 헤딩·landmark로 계층을 세우고, 상호작용 요소를 가장 가까운 섹션에 붙인 뒤,
// 반복·빈 노드를 정리하고 큰 목록은 묶어 "적당한 개수"로 유지한다.
// 원본 Element를 handle로 보존 → 액션 실행기(07)가 같은 노드를 지목한다. (plan.md §3.1, docs/01_SYSTEM/02·03)
import {
  SIGNIFICANT_SELECTOR,
  TEXT_BLOCK_SELECTOR,
  UI_ROOT_ATTR,
  blockText,
  ensureNodeId,
  roleOf,
  accessibleName,
  headingLevel,
  collapse,
  isHidden,
} from "./dom-semantics.js";
import type { DocNode, NodeKind, RegionRole } from "./tree.js"; // 03 문서 트리 스키마

// --- 규칙 상수 (실사이트 튜닝 노브) ---
/** 한 부모 안에서 같은 kind의 leaf가 이 수 이상이면 하나의 그룹으로 묶는다. */
const GROUP_MIN = 6;
/** 낭독·표시용 이름 최대 길이. 본문 블록은 잘리면 내용이 사라지므로 적용하지 않는다. */
const MAX_NAME = 200;
/** 본문 블록으로 인정할 최소 문장 길이. 이보다 짧으면 링크·아이콘 껍데기로 본다. */
const MIN_PROSE = 2;

const LANDMARK_ROLES = new Set([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "search",
  "form",
]);

const REGION_LABEL: Record<string, string> = {
  navigation: "탐색",
  main: "본문",
  banner: "머리말",
  contentinfo: "바닥글",
  complementary: "보조 정보",
  region: "영역",
  search: "검색",
  form: "양식",
};

const REGION_ROLES = new Set<RegionRole>([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "search",
  "form",
]);

const KIND_LABEL: Record<string, string> = {
  link: "링크",
  button: "버튼",
  input: "입력",
  text: "항목",
};

/** role → 문서 트리 kind. 트리에 담지 않을 요소는 null. */
function kindOf(role: string): NodeKind | null {
  if (role === "heading") return "heading";
  if (role === "link") return "link";
  if (role === "button") return "button";
  if (["textbox", "combobox", "searchbox", "checkbox", "radio"].includes(role))
    return "input";
  if (role === "image") return "text";
  if (LANDMARK_ROLES.has(role)) return "group";
  return null;
}

let groupSeq = 0;

function clip(s: string): string {
  const c = collapse(s);
  return c.length > MAX_NAME ? c.slice(0, MAX_NAME - 1) + "…" : c;
}

// landmark 이름은 명시 라벨(aria-label/labelledby/title)만 쓴다.
// textContent 폴백을 쓰면 <main> 전체 본문이 이름이 되어버린다.
function regionName(el: Element): string {
  const label = el.getAttribute("aria-label")?.trim();
  if (label) return label;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (t) return t;
  }
  return el.getAttribute("title")?.trim() ?? "";
}

function leafNode(
  el: Element,
  kind: NodeKind,
  text: string,
  regionRole?: RegionRole,
): DocNode {
  return { id: ensureNodeId(el), kind, level: 0, text, handle: el, regionRole, children: [] };
}

function bucketNode(text: string): DocNode {
  return { id: `g${groupSeq++}`, kind: "group", level: 0, text, children: [] };
}

/**
 * 라이브 DOM(Document)을 규칙 기반으로 의미적 문서 트리로 변환한다.
 * 브라우저에선 실제 document, 벤치/테스트에선 jsdom Document를 넘긴다.
 */
export function extractTree(doc: Document): DocNode {
  const root = bucketNode("(문서)");

  // 헤딩 스택으로 계층을 세운다. sl(section level): root=-1, landmark=0.5, heading=1~6.
  // leaf는 스택에 쌓지 않고 현재 열린 섹션(top)에 붙인다.
  const stack: { node: DocNode; sl: number }[] = [{ node: root, sl: -1 }];
  const top = () => stack[stack.length - 1];

  for (const el of doc.querySelectorAll<HTMLElement>(SIGNIFICANT_SELECTOR)) {
    if (el.closest(`[${UI_ROOT_ATTR}]`)) continue;
    if (isHidden(el)) continue;
    const role = roleOf(el);
    const kind = kindOf(role);
    if (!kind) {
      // 본문 블록(p·li·td…). 명시 role이 없을 때만 — `<li role=button>`은 위에서 버튼으로 잡힌다.
      if (!el.matches(TEXT_BLOCK_SELECTOR)) continue;
      const block = blockText(el);
      // 링크·버튼만 든 목록 껍데기는 버린다. 그 안의 링크는 자기 노드로 이미 들어온다.
      if (block.proseLength < MIN_PROSE) continue;
      top().node.children.push(leafNode(el, "text", block.text));
      continue;
    }

    if (kind === "group") {
      // landmark: 페이지 최상위 영역. root 아래에 붙이고 이후 콘텐츠의 열린 섹션으로 리셋.
      const regionRole = REGION_ROLES.has(role as RegionRole) ? (role as RegionRole) : undefined;
      const g = leafNode(
        el,
        "group",
        clip(regionName(el)) || REGION_LABEL[role] || "영역",
        regionRole,
      );
      root.children.push(g);
      stack.length = 1;
      stack.push({ node: g, sl: 0.5 });
      continue;
    }

    const name = clip(accessibleName(el));
    if (kind === "heading") {
      if (!name) continue; // 낭독할 게 없는 빈 헤딩은 버린다.
      const level = headingLevel(el) ?? 2;
      while (stack.length > 1 && top().sl >= level) stack.pop();
      const h = leafNode(el, "heading", name);
      top().node.children.push(h);
      stack.push({ node: h, sl: level });
    } else {
      if (!name && kind !== "input") continue; // 이름 없는 링크/버튼(아이콘 등)은 낭독 불가 → 버린다.
      top().node.children.push(leafNode(el, kind, name));
    }
  }

  prune(root);
  prioritizePrimaryContent(root);
  assignDepth(root, 0);
  return root;
}

/**
 * 페이지 상단 chrome이 DOM 앞에 놓이는 것은 정상이나, 낭독의 시작점으로는 좋지 않다.
 * semantic `main` 영역만 안정적으로 판별할 수 있으므로 그것을 첫 최상위 항목으로 옮긴다.
 * 나머지 영역은 DOM 순서와 내용을 그대로 보존한다.
 */
function prioritizePrimaryContent(root: DocNode): void {
  const mainGroups = root.children.filter((node) => node.regionRole === "main");
  if (mainGroups.length === 0) return;
  root.children = [...mainGroups, ...root.children.filter((node) => node.regionRole !== "main")];
}

// --- 정리: "적당한 개수" 유지 ---

function prune(n: DocNode): void {
  for (const c of n.children) prune(c);
  // 빈 그룹(내용 없는 landmark) 제거.
  n.children = n.children.filter((c) => !(c.kind === "group" && c.children.length === 0));
  dedupeLeaves(n);
  bucketByKind(n);
}

const LEAF_KINDS = new Set<NodeKind>(["link", "button", "input", "text"]);
// 본문 문단은 묶지 않는다 — 한 단계 아래로 숨기면 헤딩에서 내려와도 읽을 게 없는 지금 문제가 그대로다.
// ponytail: 그 대가로 alt 이미지가 많은 페이지는 한 레벨이 길어진다. 버킷 페이징(개선안 A-3) 때 재검토.
const BUCKET_KINDS = new Set<NodeKind>(["link", "button", "input"]);

/** 같은 부모 안 (kind, text)가 완전히 같은 leaf 중복 제거(첫 개만 유지). 반복 내비·중복 링크 정리. */
function dedupeLeaves(n: DocNode): void {
  const seen = new Set<string>();
  n.children = n.children.filter((c) => {
    if (!LEAF_KINDS.has(c.kind)) return true;
    const key = `${c.kind} ${c.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 같은 부모 안 같은 kind leaf가 GROUP_MIN 이상이면 하나의 그룹으로 묶어 현재 레벨을 짧게 유지. */
function bucketByKind(n: DocNode): void {
  const counts: Record<string, number> = {};
  for (const c of n.children) if (BUCKET_KINDS.has(c.kind)) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  const grouped = new Set(Object.keys(counts).filter((k) => counts[k] >= GROUP_MIN));
  if (grouped.size === 0) return;

  // ponytail: 버킷은 평평. 한 버킷이 수백 개면 ~20개 페이지로 쪼개기는 Phase 3.
  const buckets: Record<string, DocNode> = {};
  const out: DocNode[] = [];
  for (const c of n.children) {
    if (BUCKET_KINDS.has(c.kind) && grouped.has(c.kind)) {
      let b = buckets[c.kind];
      if (!b) {
        b = bucketNode(`${KIND_LABEL[c.kind] ?? c.kind} ${counts[c.kind]}개`);
        buckets[c.kind] = b;
        out.push(b); // 첫 등장 위치에 그룹을 둔다.
      }
      b.children.push(c);
    } else {
      out.push(c);
    }
  }
  n.children = out;
}

/** 출력 level = 트리 깊이(root=0, 자식=1…). 탐색 축. */
function assignDepth(n: DocNode, depth: number): void {
  n.level = depth;
  for (const c of n.children) assignDepth(c, depth + 1);
}
