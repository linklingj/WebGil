// ExtensionSource — CaptureSource의 1차(MVP) 구현. content script 안에서 라이브 DOM을 직접 만진다.
// 사용자 브라우저 세션 그대로 사용하고, 원본 Element 핸들을 보존해 execute/highlight가 같은 노드를 지목한다.
// (plan.md §4.1, docs/01_SYSTEM/01·07)
import type { CaptureSource, AXNode, Action, NodeId } from "@webgil/core";

/** getAXTree가 수집하는 대상 셀렉터 — heading·상호작용 요소·landmark. */
const AX_SELECTOR =
  "h1,h2,h3,h4,h5,h6,a[href],button,input,textarea,select,[role],nav,main,header,footer,aside,img[alt]";

/** 노드 id를 Element에 심어 두는 데이터 속성(재추출·액션 사이에서 노드를 재식별). */
const ID_ATTR = "data-webgil-id";

export class ExtensionSource implements CaptureSource {
  private readonly doc: Document;
  // 전역 생성자(Event/MutationObserver/HTMLInputElement…)를 올바른 realm에서 얻기 위해
  // Window가 아니라 Window & typeof globalThis로 잡는다.
  private readonly win: Window & typeof globalThis;
  private seq = 0;
  private overlay?: HTMLElement;
  private observer?: MutationObserver;

  // doc 주입은 테스트(jsdom)를 위한 것. 실제 content script에선 전역 document를 쓴다.
  constructor(doc: Document = document) {
    this.doc = doc;
    this.win = doc.defaultView as Window & typeof globalThis;
  }

  getDOM(): Document {
    return this.doc;
  }

  // 라이브 DOM을 훑어 접근성 노드 목록을 만든다. 계층 구성은 구조 추출 엔진(02)의 몫이라 평평한 목록을 낸다.
  // ponytail: 규칙 기반 role/name 휴리스틱. 전체 WAI-ARIA 이름 계산은 dom-accessibility-api로 Phase 3에.
  getAXTree(): AXNode[] {
    this.seq = 0;
    const out: AXNode[] = [];
    for (const el of this.doc.querySelectorAll<HTMLElement>(AX_SELECTOR)) {
      const role = roleOf(el);
      const name = accessibleName(el);
      const id = `w${this.seq++}`;
      el.setAttribute(ID_ATTR, id); // 액션/하이라이트가 이 id로 원본 노드를 되찾는다.
      const node: AXNode = { id, role, name };
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
        el.click(); // ponytail: 기본 .click(). 사이트가 무시하면 chrome.debugger Input.* 승격은 Phase 4에.
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
  highlight(nodeId: NodeId): void {
    const el = this.resolve(nodeId);
    if (!el) return;
    const box = this.ensureOverlay();
    const r = el.getBoundingClientRect();
    box.style.transform = `translate(${r.left}px, ${r.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.display = "block";
  }

  // SPA 갱신 감지 → 디바운스 후 콜백. 코어가 재추출하도록 신호만 준다.
  onMutation(cb: () => void): void {
    this.observer?.disconnect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new this.win.MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(cb, 200); // ponytail: 고정 200ms 디바운스. 증분 재추출은 Phase 3.
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

// --- 순수 헬퍼 (테스트 대상) ---

/** heading 요소면 의미 레벨(1~6), 아니면 undefined. aria-level이 있으면 우선. */
export function headingLevel(el: Element): number | undefined {
  const aria = el.getAttribute("aria-level");
  if (aria && el.getAttribute("role") === "heading") return Number(aria);
  const m = /^h([1-6])$/.exec(el.tagName.toLowerCase());
  return m ? Number(m[1]) : undefined;
}

/** 요소의 접근성 role을 규칙 기반으로 추정. 명시적 role 속성이 최우선. */
export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  switch (tag) {
    case "a":
      return "link";
    case "button":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return "combobox";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    case "aside":
      return "complementary";
    case "img":
      return "image";
    case "input":
      return inputRole(el as HTMLInputElement);
    default:
      return tag;
  }
}

function inputRole(el: HTMLInputElement): string {
  switch (el.type) {
    case "button":
    case "submit":
    case "reset":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    default:
      return "textbox";
  }
}

/**
 * 접근 가능한 이름(accessible name)을 규칙 기반으로 계산.
 * 우선순위: aria-label → aria-labelledby → alt(img) → 연결된 label → placeholder → 본문 텍스트.
 */
export function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  // instanceof(전역 DOM 클래스) 대신 tagName으로 판별 — 브라우저·jsdom 어느 realm에서도 동작한다.
  const tag = el.tagName.toLowerCase();
  if (tag === "img") return (el.getAttribute("alt") ?? "").trim();

  if (tag === "input" || tag === "textarea" || tag === "select") {
    const fromLabel = (el as HTMLInputElement).labels?.[0]?.textContent?.trim();
    if (fromLabel) return fromLabel;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
  }

  return collapse(el.textContent ?? "");
}

/** 연속 공백을 하나로 접고 앞뒤를 다듬는다. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

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
