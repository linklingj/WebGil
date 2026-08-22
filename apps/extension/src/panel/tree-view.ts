// 08 트리 그래프 뷰 — d3-hierarchy로 좌표만 계산하고, 노드는 HTML 버튼으로 그린다.
// SVG <text>·캔버스는 보조공학 지원이 고르지 않다. 스크린리더 도구의 UI가 스크린리더에
// 안 읽히면 그 자체로 실패라, 접근성 트리는 진짜 role="tree"/"treeitem" DOM으로 만든다.
// SVG는 연결선 전용(aria-hidden). (docs/01_SYSTEM/08)
import type { SnapshotNode } from "@webgil/core";
import { hierarchy, tree as tidyTree, type HierarchyPointNode } from "d3-hierarchy";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";

const NODE_WIDTH = 168;
const NODE_GAP_X = 188;
const NODE_GAP_Y = 92;
const FOCUS_SCALE = 1;
/** 형제가 수백 개인 목록에서 전부 그리지 않는다. 커서 주변만 보여주고 나머지는 잘라낸다. */
// ponytail: 고정 창(window). 이걸로 부족하면 그때 가상화.
const SIBLING_WINDOW = 12;

export interface TreeViewOptions {
  /** 노드 클릭 = 그 노드로 커서 이동. */
  onSelect(id: string): void;
  /** 이미 커서가 놓인 노드를 다시 누르면 실행(링크·버튼). */
  onActivate(id: string): void;
}

interface Rendered {
  node: SnapshotNode;
  x: number;
  y: number;
}

export class TreeView {
  private readonly viewport: HTMLElement;
  private readonly camera: HTMLElement;
  private readonly edges: SVGSVGElement;
  private readonly nodes: HTMLElement;
  private readonly zoomBehavior: ZoomBehavior<HTMLElement, unknown>;
  private positions = new Map<string, Rendered>();
  private cursorId: string | null = null;
  /** 사용자가 직접 팬·줌하면 자동 카메라를 놓아준다. Home으로 되찾는다. */
  private following = true;

  constructor(viewport: HTMLElement, private readonly options: TreeViewOptions) {
    this.viewport = viewport;
    this.camera = viewport.querySelector<HTMLElement>(".camera")!;
    this.edges = viewport.querySelector<SVGSVGElement>(".edges")!;
    this.nodes = viewport.querySelector<HTMLElement>(".nodes")!;

    this.zoomBehavior = zoom<HTMLElement, unknown>()
      .scaleExtent([0.35, 2.5])
      .on("start", (event) => {
        // 손으로 끄는 동안 CSS 트랜지션이 끼면 질질 끌린다. 사용자 제스처면 즉시 반응.
        if (event.sourceEvent) {
          this.camera.classList.remove("animated");
          this.setFollowing(false);
        }
      })
      .on("zoom", (event) => {
        this.camera.style.transform = `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
      });
    select(this.viewport).call(this.zoomBehavior);

    this.nodes.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLElement>("[data-id]");
      if (!button) return;
      const id = button.dataset.id!;
      if (id === this.cursorId) this.options.onActivate(id);
      else this.options.onSelect(id);
    });
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** 자동 카메라를 다시 켜고 현재 노드로 되돌아간다. (Home / "현재 위치로" 버튼) */
  recenter(): void {
    this.setFollowing(true);
    this.centerOnCursor();
  }

  render(root: SnapshotNode, cursorId: string | null): void {
    const moved = cursorId !== this.cursorId;
    this.cursorId = cursorId;
    const visible = prune(root, cursorId);
    const layout = tidyTree<SnapshotNode>().nodeSize([NODE_GAP_X, NODE_GAP_Y])(hierarchy(visible, (d) => d.children));

    this.positions.clear();
    for (const point of layout.descendants()) {
      if (point.data.id !== root.id) this.positions.set(point.data.id, { node: point.data, x: point.x, y: point.y });
    }

    this.paintNodes(layout, root);
    this.paintEdges(layout, root.id);

    // 커서가 움직였으면 카메라도 반드시 따라간다.
    // 직접 팬·줌한 화면은 "그 자리를 들여다보는 동안"만 유지된다 — 다음 이동에서 되돌아온다.
    // (트랙패드 두 손가락 스크롤이 휠로 들어와 추적이 꺼지는 일이 잦아서, 이동이 곧 복귀 신호다.)
    if (moved) this.setFollowing(true);
    if (this.following) this.centerOnCursor();
  }

  private paintNodes(layout: HierarchyPointNode<SnapshotNode>, root: SnapshotNode): void {
    this.nodes.replaceChildren();
    for (const point of layout.descendants()) {
      if (point.data.id === root.id) continue; // root는 사용자에게 노출하지 않는다(04와 동일 규칙)
      const item = document.createElement("button");
      item.type = "button";
      item.className = "node";
      item.id = `n-${point.data.id}`;
      item.dataset.id = point.data.id;
      item.dataset.kind = point.data.kind;
      item.setAttribute("role", "treeitem");
      item.setAttribute("aria-level", String(point.depth));
      item.setAttribute("aria-selected", String(point.data.id === this.cursorId));
      // 하위가 있는지는 원본 스냅샷 기준이다. 창(window) 렌더로 잘려도 사용자에겐 "펼칠 수 있음"이 맞다.
      if (point.data.children.length) item.setAttribute("aria-expanded", String(point.data.id === this.cursorId));
      const siblings = point.parent?.children ?? [];
      item.setAttribute("aria-setsize", String(siblings.length));
      item.setAttribute("aria-posinset", String(siblings.indexOf(point) + 1));
      item.tabIndex = -1;

      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = KIND_LABEL[point.data.kind] ?? "";
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = point.data.text || "(제목 없음)";
      item.append(kind, text);

      item.style.left = `${point.x - NODE_WIDTH / 2}px`;
      item.style.top = `${point.y}px`;
      if (point.data.id === this.cursorId) item.classList.add("current");
      this.nodes.append(item);
    }
  }

  private paintEdges(layout: HierarchyPointNode<SnapshotNode>, rootId: string): void {
    const paths: string[] = [];
    for (const link of layout.links()) {
      if (link.source.data.id === rootId) continue; // 보이지 않는 root로 가는 선은 그리지 않는다
      const [sx, sy] = [link.source.x, link.source.y + 34];
      const [tx, ty] = [link.target.x, link.target.y];
      const mid = (sy + ty) / 2;
      paths.push(`M${sx},${sy}C${sx},${mid} ${tx},${mid} ${tx},${ty}`);
    }
    // d3-shape를 더 붙이지 않는다. 세로 링크의 3차 베지어는 한 줄이면 끝난다.
    this.edges.replaceChildren();
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      this.edges.append(path);
    }
  }

  private centerOnCursor(): void {
    const target = this.cursorId ? this.positions.get(this.cursorId) : undefined;
    const spot = target ?? this.positions.values().next().value;
    if (!spot) return;

    const { width, height } = this.viewport.getBoundingClientRect();
    const next = zoomIdentity
      .translate(width / 2 - spot.x * FOCUS_SCALE, height / 2 - (spot.y + 20) * FOCUS_SCALE)
      .scale(FOCUS_SCALE);
    // 200ms 이징은 CSS가 한다(prefers-reduced-motion이면 CSS가 알아서 끈다).
    // d3-transition을 끌어오지 않는 대신, 자동 이동일 때만 트랜지션 클래스를 켠다.
    this.camera.classList.add("animated");
    select(this.viewport).call(this.zoomBehavior.transform, next);
  }

  private setFollowing(value: boolean): void {
    if (this.following === value) return;
    this.following = value;
    this.viewport.dataset.following = String(value);
  }
}

const KIND_LABEL: Record<string, string> = {
  heading: "제목",
  text: "본문",
  link: "링크",
  button: "버튼",
  input: "입력",
  group: "묶음",
};

/**
 * 화면에 그릴 부분만 남긴다: 커서까지의 조상 경로 + 커서의 형제 + 커서의 자식 1단계.
 * 수천 노드짜리 페이지를 통째로 레이아웃하지 않기 위한 의도적 제한이다. (docs/08)
 */
export function prune(root: SnapshotNode, cursorId: string | null): SnapshotNode {
  const path = cursorId ? pathTo(root, cursorId) : null;
  if (cursorId === null || path === null) {
    // 커서가 없으면 최상위만 훑어보게 한다.
    return { ...root, children: root.children.map((child) => ({ ...child, children: [] })) };
  }

  const onPath = new Set(path.map((node) => node.id));
  const parent = path.length >= 2 ? path[path.length - 2] : root;

  const copy = (node: SnapshotNode): SnapshotNode => {
    let children: SnapshotNode[] = [];
    if (node.id === cursorId) children = node.children;
    else if (node.id === parent.id) children = windowed(node.children, cursorId);
    else if (onPath.has(node.id) || node.id === root.id) children = node.children.filter((child) => onPath.has(child.id));
    return { ...node, children: children.map(copy) };
  };
  return copy(root);
}

function windowed(children: SnapshotNode[], cursorId: string): SnapshotNode[] {
  if (children.length <= SIBLING_WINDOW * 2 + 1) return children;
  const at = children.findIndex((child) => child.id === cursorId);
  const start = Math.max(0, Math.min(at - SIBLING_WINDOW, children.length - (SIBLING_WINDOW * 2 + 1)));
  return children.slice(start, start + SIBLING_WINDOW * 2 + 1);
}

/** root부터 대상까지의 경로(대상 포함). 없으면 null. */
function pathTo(root: SnapshotNode, id: string): SnapshotNode[] | null {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const found = pathTo(child, id);
    if (found) return [root, ...found];
  }
  return null;
}
