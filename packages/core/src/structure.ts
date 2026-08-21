// 02 구조 추출 엔진 — 라이브 DOM을 의미적 문서 트리로 변환하는 규칙 기반 1차 경로.
// 헤딩·landmark로 계층을 세우고, 상호작용 요소를 가장 가까운 섹션에 붙인 뒤,
// 반복·빈 노드를 정리하고 큰 목록은 묶어 "적당한 개수"로 유지한다.
// 원본 Element를 handle로 보존 → 액션 실행기(07)가 같은 노드를 지목한다. (plan.md §3.1, docs/01_SYSTEM/02·03)
import {
  SIGNIFICANT_SELECTOR,
  TEXT_BLOCK_SELECTOR,
  GENERIC_TEXT_SELECTOR,
  INTERACTIVE_SELECTOR,
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
/** 명시 본문 블록은 한 글자라도 정보일 수 있으므로 보존한다. */
const MIN_PROSE = 1;
/** div/span 폴백은 아이콘 노이즈를 막기 위해 두 글자 이상일 때만 본문으로 인정한다. */
const MIN_GENERIC_PROSE = 2;

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
  if (["textbox", "combobox", "searchbox", "checkbox", "radio", "slider", "spinbutton", "option"].includes(role))
    return "input";
  if (["tab", "menuitem", "menuitemcheckbox", "menuitemradio", "switch", "treeitem", "gridcell"].includes(role))
    return "button";
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

/** 큰 레이아웃 컨테이너는 제외하고, 중첩 후보 중 가장 바깥 본문만 채택한다. */
function isGenericTextBlock(el: Element): boolean {
  if (!el.matches(GENERIC_TEXT_SELECTOR)) return false;
  if (el.querySelector(SIGNIFICANT_SELECTOR)) return false;
  // 카드·문단이 여러 개인 레이아웃 div까지 하나의 거대 문장으로 합치지 않는다.
  const meaningfulGenericChildren = Array.from(el.children).filter(
    (child) =>
      child.matches(GENERIC_TEXT_SELECTOR) &&
      !isHidden(child) &&
      collapse(child.textContent ?? "").length >= MIN_GENERIC_PROSE,
  );
  if (meaningfulGenericChildren.length > 1) return false;
  const parent = el.parentElement?.closest(GENERIC_TEXT_SELECTOR);
  return !parent || !isGenericTextBlock(parent);
}

interface TableCell {
  el: HTMLTableCellElement;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  header: boolean;
}

/** 표의 caption·ARIA 이름을 우선해 낭독 가능한 표 이름을 만든다. */
function tableName(table: HTMLTableElement): string {
  const labelled = table.getAttribute("aria-labelledby");
  if (labelled) {
    const text = labelled
      .split(/\s+/)
      .map((id) => table.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return collapse(text);
  }
  return (
    table.getAttribute("aria-label")?.trim() ||
    collapse(table.caption?.textContent ?? "") ||
    table.getAttribute("title")?.trim() ||
    "표"
  );
}

function overlaps(startA: number, spanA: number, startB: number, spanB: number): boolean {
  return startA < startB + spanB && startB < startA + spanA;
}

/**
 * 실제 셀을 논리 격자에 배치한다. rowspan/colspan으로 채워진 자리는 다음 셀의
 * 시작 열 계산과 헤더 연결에만 쓰고, 낭독 노드는 실제 DOM 셀마다 하나씩 만든다.
 */
function collectTableCells(table: HTMLTableElement): TableCell[][] {
  const occupied = new Map<number, Set<number>>();
  const rows: TableCell[][] = [];

  Array.from(table.rows).forEach((row, rowIndex) => {
    const cells: TableCell[] = [];
    let column = 0;
    for (const el of Array.from(row.cells)) {
      const used = occupied.get(rowIndex) ?? new Set<number>();
      occupied.set(rowIndex, used);
      while (used.has(column)) column++;

      const cell: TableCell = {
        el,
        row: rowIndex,
        column,
        rowSpan: Math.max(1, el.rowSpan || 1),
        colSpan: Math.max(1, el.colSpan || 1),
        header: el.tagName.toLowerCase() === "th",
      };
      cells.push(cell);

      for (let r = rowIndex; r < rowIndex + cell.rowSpan; r++) {
        const usedColumns = occupied.get(r) ?? new Set<number>();
        occupied.set(r, usedColumns);
        for (let c = column; c < column + cell.colSpan; c++) usedColumns.add(c);
      }
      column += cell.colSpan;
    }
    rows.push(cells);
  });

  return rows;
}

/** scope 또는 위치로 데이터 셀에 적용되는 행/열 헤더를 찾는다. */
function headersFor(cell: TableCell, allCells: TableCell[]): string[] {
  const explicit = cell.el.getAttribute("headers")?.trim();
  if (explicit) {
    const byId = new Map(allCells.map((candidate) => [candidate.el.id, candidate]));
    return explicit
      .split(/\s+/)
      .map((id) => byId.get(id))
      .filter((candidate): candidate is TableCell => candidate !== undefined)
      .map((candidate) => collapse(candidate.el.textContent ?? ""))
      .filter(Boolean);
  }

  const rowHeaders: string[] = [];
  const columnHeaders: string[] = [];
  for (const candidate of allCells) {
    if (!candidate.header || candidate === cell) continue;
    const text = collapse(candidate.el.textContent ?? "");
    if (!text) continue;

    const scope = candidate.el.getAttribute("scope")?.toLowerCase();
    const sameLogicalRow = overlaps(candidate.row, candidate.rowSpan, cell.row, cell.rowSpan);
    const sameLogicalColumn = overlaps(candidate.column, candidate.colSpan, cell.column, cell.colSpan);
    const isLeft = candidate.column + candidate.colSpan <= cell.column;
    const isAbove = candidate.row + candidate.rowSpan <= cell.row;

    const appliesToRow =
      (scope === "row" || scope === "rowgroup")
        ? sameLogicalRow && isLeft
        : !scope && sameLogicalRow && isLeft;
    const appliesToColumn =
      (scope === "col" || scope === "colgroup")
        ? isAbove && sameLogicalColumn
        : !scope && isAbove && sameLogicalColumn;

    if (appliesToRow) rowHeaders.push(text);
    if (appliesToColumn) columnHeaders.push(text);
  }
  return [...new Set([...rowHeaders, ...columnHeaders])];
}

/** 표 셀 안의 링크·버튼·입력칸도 셀의 하위 조작 항목으로 보존한다. */
function tableInteractiveChildren(cell: HTMLTableCellElement): DocNode[] {
  const children: DocNode[] = [];
  for (const el of cell.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)) {
    if (isHidden(el)) continue;
    const kind = kindOf(roleOf(el));
    if (!kind || kind === "group" || kind === "heading" || kind === "text") continue;
    const name = clip(accessibleName(el));
    if (!name && kind !== "input") continue;
    children.push({
      id: ensureNodeId(el),
      kind,
      level: 0,
      text: name,
      handle: el,
      table: true,
      children: [],
    });
  }
  return children;
}

/**
 * 의미 있는 HTML 표를 표 → 행 → 셀 트리로 변환한다.
 * 일반 leaf와 달리 표 셀은 같은 값이라도 모두 보존하고, 데이터 셀에는 헤더를 붙인다.
 */
function extractTable(table: HTMLTableElement): DocNode | null {
  const rows = collectTableCells(table);
  const allCells = rows.flat();
  if (allCells.length === 0) return null;

  const tableNode: DocNode = {
    id: ensureNodeId(table),
    kind: "group",
    level: 0,
    text: `표: ${tableName(table)}`,
    handle: table,
    table: true,
    children: [],
  };

  rows.forEach((cells, rowIndex) => {
    if (cells.length === 0) return;
    const rowNode: DocNode = {
      id: `${tableNode.id}-row-${rowIndex + 1}`,
      kind: "group",
      level: 0,
      text: `${rowIndex + 1}행`,
      table: true,
      children: [],
    };
    for (const cell of cells) {
      // 빈 셀도 표의 열 정렬을 이해하는 데 필요한 정보라 생략하지 않는다.
      const value = accessibleName(cell.el) || "비어 있음";
      const headers = cell.header ? [] : headersFor(cell, allCells);
      rowNode.children.push({
        id: ensureNodeId(cell.el),
        kind: "text",
        level: 0,
        text: headers.length ? `${headers.join(", ")}: ${value}` : value,
        handle: cell.el,
        table: true,
        children: tableInteractiveChildren(cell.el),
      });
    }
    if (rowNode.children.length) tableNode.children.push(rowNode);
  });

  return tableNode.children.length ? tableNode : null;
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

  const candidates = `${SIGNIFICANT_SELECTOR},${GENERIC_TEXT_SELECTOR}`;
  for (const el of doc.querySelectorAll<HTMLElement>(candidates)) {
    if (el.closest(`[${UI_ROOT_ATTR}]`)) continue;
    if (isHidden(el)) continue;

    if (el.tagName.toLowerCase() === "table") {
      const table = extractTable(el as HTMLTableElement);
      if (table) top().node.children.push(table);
      continue;
    }
    // 표 셀은 table 전용 경로에서 행·열 헤더와 함께 처리한다.
    if (el.closest("table")) continue;

    const role = roleOf(el);
    const kind = kindOf(role);
    if (!kind) {
      // 명시 본문 블록 또는 의미 태그 없이 작성한 div/span 본문.
      const generic = isGenericTextBlock(el);
      if (!el.matches(TEXT_BLOCK_SELECTOR) && !generic) continue;
      const block = blockText(el);
      // 링크·버튼만 든 목록 껍데기는 버린다. 그 안의 링크는 자기 노드로 이미 들어온다.
      if (block.proseLength < (generic ? MIN_GENERIC_PROSE : MIN_PROSE)) continue;
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
  bucketByKind(n);
}

// 본문 문단은 묶지 않는다 — 한 단계 아래로 숨기면 헤딩에서 내려와도 읽을 게 없는 지금 문제가 그대로다.
// ponytail: 그 대가로 alt 이미지가 많은 페이지는 한 레벨이 길어진다. 버킷 페이징(개선안 A-3) 때 재검토.
const BUCKET_KINDS = new Set<NodeKind>(["link", "button", "input"]);

/** 같은 부모 안 같은 kind leaf가 GROUP_MIN 이상이면 하나의 그룹으로 묶어 현재 레벨을 짧게 유지. */
function bucketByKind(n: DocNode): void {
  if (n.table) return;
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
