// 08 상단 검색창 — 입력창 하나가 두 가지를 처리한다.
//  1) 트리 텍스트 부분 일치(기본): 즉시·오프라인·비용 0.
//  2) `?`로 시작하거나 일치가 없으면 자연어 명령(06 LLM 명령 엔진)으로 넘긴다.
// 페이지에 오버레이로 띄우던 명령 팔레트를 여기로 흡수해, 원본 페이지에 주입하는 UI를 하나 줄인다.
import { searchTree, type SearchHit, type SnapshotNode } from "@webgil/core";
import { speak } from "./voice.js";

/**
 * 이 글자로 시작하면 검색이 아니라 명령이다.
 * 물음표를 고른 건 문서에 있는 단어를 찾을 때 첫 글자로 칠 일이 거의 없고, 물어보는 느낌이라서다.
 */
const ASK_PREFIX = "?";

export interface SearchOptions {
  /** 검색 결과 선택 = 그 노드로 커서 이동. */
  onSelect(id: string): void;
  /** 자연어 명령 실행. 결과 메시지를 상태 줄에 띄운다. */
  onAsk(input: string): void;
  /** Esc — 검색을 접고 트리 조작으로 돌아간다. */
  onDismiss(): void;
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

  /** 명령이 끝나면 입력창을 비운다 — 다음 명령이 앞 명령 위에 겹쳐 쌓이지 않게. */
  clear(): void {
    this.input.value = "";
    this.update();
  }

  setTree(tree: SnapshotNode): void {
    this.tree = tree;
    if (this.input.value) this.update();
  }

  /** 입력이 바뀔 때마다 다시 찾는다. 로컬 검색이라 타이핑마다 돌려도 부담이 없다(LLM 호출 아님). */
  private update(): void {
    const query = this.input.value;
    this.hits = this.tree && !query.startsWith(ASK_PREFIX) ? searchTree(this.tree, query) : [];
    // 결과가 있으면 첫 항목을 미리 골라 둔다 — Enter 한 번으로 가장 그럴듯한 곳에 갈 수 있게.
    this.active = this.hits.length ? 0 : -1;
    this.paint(query);
  }

  /** 지금 입력을 명령으로 해석할 상황인가. `?`로 시작했거나, 쳤는데 문서에 그런 말이 없을 때. */
  private isAsking(query: string): boolean {
    return query.startsWith(ASK_PREFIX) || (query.trim() !== "" && this.hits.length === 0);
  }

  private paint(query: string): void {
    this.list.replaceChildren();
    const asking = this.isAsking(query);
    // 빈 입력이면 목록을 접는다. 명령 모드에서는 결과가 없어도 안내 한 줄을 보여 준다.
    this.list.hidden = query.trim() === "" || (!asking && this.hits.length === 0);
    this.root.dataset.mode = asking ? "ask" : "search";

    if (asking) {
      const hint = document.createElement("li");
      hint.className = "hint";
      hint.textContent = "Enter — 자연어 명령으로 실행";
      this.list.append(hint);
      return;
    }

    // 결과 하나하나가 role="option"이어야 조합 상자(combobox) 패턴이 성립한다.
    // 화면에 보이는 선택 표시(.active)와 보조공학이 읽는 aria-selected는 항상 같이 움직인다.
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
      // 검색어를 지우고 포커스를 트리로 넘긴다 — Esc 한 번으로 다시 방향키 탐색이 된다.
      event.preventDefault();
      this.input.value = "";
      this.update();
      this.options.onDismiss();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const query = this.input.value;
      if (this.active >= 0) this.choose(this.active);
      // 고른 결과가 있으면 그리로 가고, 없으면 친 내용을 그대로 명령으로 넘긴다.
      else if (query.trim()) this.options.onAsk(query.replace(/^\?/, "").trim());
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (!this.hits.length) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    this.active = (this.active + step + this.hits.length) % this.hits.length;
    this.paint(this.input.value);
    // 화면을 못 보면 지금 어느 결과에 와 있는지 알 길이 없다.
    const hit = this.hits[this.active];
    speak(`${hit.text || "이름 없는 항목"}, ${hit.path.length ? `${hit.path.join(" ")} 안` : "최상위"}, ${this.active + 1}번, 전체 ${this.hits.length}개`);
  }

  private choose(index: number): void {
    const hit = this.hits[index];
    if (!hit) return;
    this.input.value = "";
    this.update();
    this.options.onSelect(hit.id);
  }

  /**
   * 지금 고른 결과를 입력창이 가리키게 한다(aria-activedescendant).
   * 포커스는 입력창에 남아 있어야 계속 칠 수 있으므로, 실제 포커스를 옮기는 대신 이 속성으로 알린다.
   */
  private syncActiveDescendant(): void {
    const current = this.hits[this.active];
    if (current) this.input.setAttribute("aria-activedescendant", `hit-${current.id}`);
    else this.input.removeAttribute("aria-activedescendant");
  }
}
