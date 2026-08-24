// ExtensionSource — CaptureSource의 1차(MVP) 구현. content script 안에서 라이브 DOM을 직접 만진다.
// 사용자 브라우저 세션 그대로 사용하고, 원본 Element 핸들을 보존해 execute/highlight가 같은 노드를 지목한다.
// (plan.md §4.1, docs/01_SYSTEM/01·07)
import type { CaptureSource, AXNode, Action, NodeId } from "@webgil/core";
import {
  SIGNIFICANT_SELECTOR,
  UI_ROOT_ATTR,
  ID_ATTR,
  ensureNodeId,
  roleOf,
  accessibleName,
  headingLevel,
} from "@webgil/core";

export class ExtensionSource implements CaptureSource {
  private readonly doc: Document;
  // 전역 생성자(Event/MutationObserver/HTMLInputElement…)를 올바른 realm에서 얻기 위해
  // Window가 아니라 Window & typeof globalThis로 잡는다.
  private readonly win: Window & typeof globalThis;
  private overlay?: HTMLElement;
  private observer?: MutationObserver;
  /** 지금 강조 중인 노드. 스크롤·리사이즈 때 오버레이를 다시 붙이는 데 쓴다. */
  private highlighted?: HTMLElement;
  private tracking = false;

  // doc 주입은 테스트(jsdom)를 위한 것. 실제 content script에선 전역 document를 쓴다.
  constructor(doc: Document = document) {
    this.doc = doc;
    this.win = doc.defaultView as Window & typeof globalThis;
  }

  getDOM(): Document {
    return this.doc;
  }

  // 라이브 DOM을 훑어 접근성 노드 목록을 만든다. 계층 구성은 구조 추출 엔진(02)의 몫이라 평평한 목록을 낸다.
  // role/name은 규칙 기반 휴리스틱이다(코어 dom-semantics와 공유). 전체 WAI-ARIA 이름 계산은 Phase 3 과제.
  getAXTree(): AXNode[] {
    const out: AXNode[] = [];
    for (const el of this.doc.querySelectorAll<HTMLElement>(SIGNIFICANT_SELECTOR)) {
      if (el.closest(`[${UI_ROOT_ATTR}]`)) continue;
      const id = ensureNodeId(el); // 액션/하이라이트가 이 id로 원본 노드를 되찾는다.
      const node: AXNode = { id, role: roleOf(el), name: accessibleName(el) };
      const level = headingLevel(el);
      if (level) node.level = level;
      out.push(node);
    }
    return out;
  }

  // 트리 노드 id → 원본 Element로 해소해 트러스트 이벤트로 실행. (docs/01_SYSTEM/07)
  async execute(action: Action): Promise<void> {
    const el = this.resolve(action.nodeId);
    if (!el) throw new Error(`알 수 없는 노드: ${action.nodeId}`);
    switch (action.type) {
      case "click":
        // 우선 기본 .click()으로 간다. 이걸 무시하는 사이트가 나오면 chrome.debugger Input.*로 올린다(Phase 4).
        el.click();
        return;
      case "focus":
        el.focus();
        return;
      case "input":
        setNativeValue(el, action.value, this.win);
        return;
      case "submit":
        el.closest("form")?.requestSubmit();
        return;
    }
  }

  // 노드를 화면에 강조. 단일 오버레이 박스를 노드 위치로 옮긴다(getBoundingClientRect).
  // 화면 밖의 노드로 이동했으면 먼저 스크롤해서 눈에 보이게 한다 — 커서가 보이지 않으면
  // 남아 있는 시력을 쓰는 사용자와 옆에서 보는 사람 모두 지금 어디인지 알 수 없다.
  highlight(nodeId: NodeId): void {
    const el = this.resolve(nodeId);
    if (!el) return;
    this.highlighted = el;
    this.scrollIntoViewIfNeeded(el);
    this.paintOverlay(el);
    this.trackViewport();
  }

  /**
   * 노드가 화면 밖이면 가운데로 스크롤한다.
   * 한 화면에 안 들어가는 큰 영역(긴 섹션·본문 전체 group)은 어디로 맞춰도 잘리므로 건드리지 않는다.
   */
  private scrollIntoViewIfNeeded(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const height = this.win.innerHeight || 0;
    const width = this.win.innerWidth || 0;
    if (!height || !width) return;
    if (r.height > height || r.width > width) return;

    const outside = r.top < 0 || r.bottom > height || r.left < 0 || r.right > width;
    // 부드러운 스크롤은 비동기라 바로 뒤의 좌표 측정이 어긋난다. 즉시 스크롤한다.
    // (jsdom에는 scrollIntoView가 없다 — 옵셔널 호출)
    if (outside) el.scrollIntoView?.({ block: "center", inline: "nearest" });
  }

  private paintOverlay(el: HTMLElement): void {
    const box = this.ensureOverlay();
    const r = el.getBoundingClientRect();
    box.style.transform = `translate(${r.left}px, ${r.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.display = "block";
  }

  /** 오버레이는 fixed라 사용자가 직접 스크롤하면 제자리에 남는다. 따라붙게 한 번만 걸어둔다. */
  private trackViewport(): void {
    if (this.tracking) return;
    this.tracking = true;
    const reposition = () => {
      if (this.highlighted?.isConnected) this.paintOverlay(this.highlighted);
    };
    this.win.addEventListener("scroll", reposition, { passive: true, capture: true });
    this.win.addEventListener("resize", reposition, { passive: true });
  }

  // SPA 갱신 감지 → 디바운스 후 콜백. 코어가 재추출하도록 신호만 준다.
  onMutation(cb: () => void): void {
    this.observer?.disconnect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new this.win.MutationObserver(() => {
      clearTimeout(timer);
      // 200ms 고정 디바운스. 바뀐 부분만 다시 뽑는 증분 재추출은 Phase 3.
      timer = setTimeout(cb, 200);
    });
    observer.observe(this.doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: false,
    });
    this.observer = observer;
  }

  private resolve(nodeId: NodeId): HTMLElement | null {
    // id는 우리가 만든 `w<숫자>` 형태라 이스케이프가 필수는 아니지만, 브라우저에선 방어적으로 CSS.escape.
    // (jsdom엔 window.CSS가 없어 폴백)
    const safe = this.win.CSS?.escape(nodeId) ?? nodeId;
    return this.doc.querySelector<HTMLElement>(`[${ID_ATTR}="${safe}"]`);
  }

  private ensureOverlay(): HTMLElement {
    if (this.overlay) return this.overlay;
    const box = this.doc.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      top: "0",
      left: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
      outline: "2px solid #2b6cff",
      background: "rgba(43,108,255,0.15)",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    box.setAttribute(ID_ATTR, "__overlay"); // 오버레이 자신은 재추출 대상에서 제외되도록 표시
    this.doc.body.appendChild(box);
    this.overlay = box;
    return box;
  }
}

// role/accessible name/headingLevel은 코어(dom-semantics)로 이동해 구조 추출 엔진과 공유한다.
// 기존 임포트 경로 호환을 위해 재노출.
export { roleOf, accessibleName } from "@webgil/core";

/**
 * 네이티브 value setter로 값을 넣고 input/change 이벤트를 디스패치.
 * React 등 프레임워크가 합성 setter를 가로채도 상태가 동기화되도록 프로토타입 setter를 직접 호출한다.
 * (docs/01_SYSTEM/07 미결정 항목)
 */
export function setNativeValue(
  el: HTMLElement,
  value: string,
  win: Window & typeof globalThis,
): void {
  // contenteditable은 value 프로퍼티가 없는 편집 영역이므로 텍스트를 직접 갱신한다.
  if (el.getAttribute("contenteditable") !== null && el.getAttribute("contenteditable") !== "false") {
    el.textContent = value;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
    return;
  }
  const proto =
    el instanceof win.HTMLTextAreaElement
      ? win.HTMLTextAreaElement.prototype
      : el instanceof win.HTMLSelectElement
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
  el.dispatchEvent(new win.Event("change", { bubbles: true }));
}
