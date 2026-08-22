// 08 상단 검색창 — 입력창 하나가 두 가지를 처리한다.
//  1) 트리 텍스트 부분 일치(기본): 즉시·오프라인·비용 0.
//  2) `?`로 시작하거나 일치가 없으면 자연어 명령(06 LLM 명령 엔진)으로 넘긴다.
// 페이지에 오버레이로 띄우던 명령 팔레트를 여기로 흡수해, 원본 페이지에 주입하는 UI를 하나 줄인다.
import { searchTree, type SearchHit, type SnapshotNode } from "@webgil/core";

export interface SearchOptions {
  /** 검색 결과 선택 = 그 노드로 커서 이동. */
  onSelect(id: string): void;
  /** 자연어 명령 실행. 결과 메시지를 상태 줄에 띄운다. */
  onAsk(input: string): void;
}

export class SearchBox {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private hits: SearchHit[] = [];
  private active = -1;
  private tree: SnapshotNode | null = null;

  constructor(private readonly root: HTMLElement, private readonly options: SearchOptions) {
    this.input = root.querySelector<HTMLInputElement>("#search")!;
    this.list = root.querySelector<HTMLElement>("#searchResults")!;

    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.list.addEventListener("click", (event) => {
      const option = (event.target as Element | null)?.closest<HTMLElement>("[data-id]");
      if (option) this.choose(this.hits.findIndex((hit) => hit.id === option.dataset.id));
    });
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  setTree(tree: SnapshotNode): void {
    this.tree = tree;
    if (this.input.value) this.update();
  }

  private update(): void {
    const query = this.input.value;
    this.hits = this.tree && !query.startsWith("?") ? searchTree(this.tree, query) : [];
    this.active = this.hits.length ? 0 : -1;
    this.paint(query);
  }

  private paint(query: string): void {
    this.list.replaceChildren();
    const asking = query.startsWith("?") || (query.trim() !== "" && this.hits.length === 0);
    this.list.hidden = query.trim() === "" || (!asking && this.hits.length === 0);
    this.root.dataset.mode = asking ? "ask" : "search";

    if (asking) {
      const hint = document.createElement("li");
      hint.className = "hint";
      hint.textContent = "Enter — 자연어 명령으로 실행";
      this.list.append(hint);
      return;
    }

    this.hits.forEach((hit, index) => {
      const option = document.createElement("li");
      option.id = `hit-${hit.id}`;
      option.dataset.id = hit.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === this.active));
      option.className = index === this.active ? "active" : "";
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = hit.text;
      const path = document.createElement("span");
      path.className = "path";
      path.textContent = hit.path.length ? hit.path.join(" › ") : "최상위";
      option.append(text, path);
      this.list.append(option);
    });
    this.syncActiveDescendant();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.input.value = "";
      this.update();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const query = this.input.value;
      if (this.active >= 0) this.choose(this.active);
      else if (query.trim()) this.options.onAsk(query.replace(/^\?/, "").trim());
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!this.hits.length) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    this.active = (this.active + step + this.hits.length) % this.hits.length;
    this.paint(this.input.value);
  }

  private choose(index: number): void {
    const hit = this.hits[index];
    if (!hit) return;
    this.input.value = "";
    this.update();
    this.options.onSelect(hit.id);
  }

  private syncActiveDescendant(): void {
    const current = this.hits[this.active];
    if (current) this.input.setAttribute("aria-activedescendant", `hit-${current.id}`);
    else this.input.removeAttribute("aria-activedescendant");
  }
}
