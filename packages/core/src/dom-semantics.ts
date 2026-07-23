// DOM → 의미(role·이름·헤딩레벨) 규칙. 셸 독립 순수 함수라 코어가 소유하고,
// 구조 추출 엔진(02)과 ExtensionSource(01)가 함께 쓴다. (docs/01_SYSTEM/01·02)

/** 구조 추출·AX 수집이 훑는 대상 — 헤딩·상호작용 요소·landmark·alt 이미지. */
export const SIGNIFICANT_SELECTOR =
  "h1,h2,h3,h4,h5,h6,[role=heading]," +
  "a[href],button,[role=button],[role=link]," +
  "input,textarea,select,[role=textbox],[role=combobox],[role=searchbox],[role=checkbox],[role=radio]," +
  "nav,main,header,footer,aside," +
  "[role=navigation],[role=main],[role=banner],[role=contentinfo],[role=complementary],[role=region],[role=search],[role=form]," +
  "img[alt]";

/** 노드 id를 Element에 심어 두는 데이터 속성(재추출·액션 사이에서 노드를 재식별). */
export const ID_ATTR = "data-webgil-id";

// ponytail: 모듈 전역 시퀀스. 같은 Element는 한 번 받은 id를 계속 유지(재스캔에도 안정) —
// SPA에서 동일 노드 추적(docs/03)의 최소 보장. 완전한 안정 id 규칙은 Phase 3.
let seq = 0;

/** Element에 안정적 노드 id를 부여(있으면 재사용)하고 반환. */
export function ensureNodeId(el: Element): string {
  const existing = el.getAttribute(ID_ATTR);
  if (existing) return existing;
  const id = `w${seq++}`;
  el.setAttribute(ID_ATTR, id);
  return id;
}

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
    // header/footer는 최상위에서만 landmark(banner/contentinfo). article·section 등 안에 있으면
    // 일반 요소다(ARIA). 이 규칙이 없으면 캐러셀·카드마다 header가 가짜 영역으로 쪼개진다.
    case "header":
      return nestedInSectioning(el) ? "generic" : "banner";
    case "footer":
      return nestedInSectioning(el) ? "generic" : "contentinfo";
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

/** header/footer가 sectioning content(article·aside·main·nav·section) 안에 중첩됐는지. */
function nestedInSectioning(el: Element): boolean {
  return el.parentElement?.closest("article,aside,main,nav,section") != null;
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
    case "hidden":
      return "none";
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
    const val = (el as HTMLInputElement).value?.trim();
    if (val) return val;
  }

  return collapse(el.textContent ?? "");
}

/** 연속 공백을 하나로 접고 앞뒤를 다듬는다. */
export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * 화면에서 숨겨진 노드인지 규칙 기반 판정. 실사이트의 접힌 메뉴·숨은 폼이 트리를 오염시키는 걸 막는다.
 * 레이아웃이 있는 브라우저에선 checkVisibility로 정확히, jsdom(레이아웃 없음)에선 속성만으로 판정한다.
 */
export function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = (el as HTMLElement).style;
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  const check = (el as unknown as { checkVisibility?: (o: object) => boolean })
    .checkVisibility;
  if (typeof check === "function") {
    return !check.call(el, { contentVisibilityAuto: true, visibilityProperty: true });
  }
  return false; // 레이아웃 없는 환경(jsdom): 속성 기반 판정만 신뢰.
}
