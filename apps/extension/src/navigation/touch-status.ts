// 터치 네비게이션 모드가 켜졌는지 알려 주는 페이지 위 표시.
//
// 이 모드는 켜져 있는 동안 마우스 휠까지 가져가므로, 켠 걸 잊으면 "스크롤이 고장 났다"고 느낀다.
// 그래서 켜진 동안에는 화면에도 흔적을 남긴다(음성 안내는 켜고 끌 때 한 번뿐이라 놓치기 쉽다).

/** 원본 페이지에 주입한 UI라는 표식. 구조 추출이 이 요소를 문서 내용으로 착각하지 않게 한다. */
const UI_MARK = "data-webgil-ui";

export interface TouchNavigationStatus {
  /** 켜짐/꺼짐을 화면에 반영한다. 꺼지면 표시도 사라진다. */
  set(enabled: boolean): void;
}

export function createTouchNavigationStatus(doc: Document = document): TouchNavigationStatus {
  const status = doc.createElement("div");
  status.setAttribute(UI_MARK, "touch-navigation-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-enabled", "false");
  Object.assign(status.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647", // 사이트가 아무리 높이 쌓아도 가려지면 안 된다
    padding: "8px 12px",
    borderRadius: "8px",
    color: "#fff",
    background: "#1f6feb",
    font: "14px system-ui, sans-serif",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
    display: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  // 인라인 display는 사이트 CSS가 !important로 덮을 수 있다. 표시 여부만 우리 규칙으로 못 박는다.
  const style = doc.createElement("style");
  style.setAttribute(UI_MARK, "touch-navigation-status-style");
  style.textContent = `[${UI_MARK}="touch-navigation-status"][data-enabled="true"] { display: block !important; }`;

  // body가 아니라 documentElement에 붙인다. body를 갈아끼우는 SPA에서도 살아남는다.
  doc.documentElement.append(style, status);

  return {
    set(enabled: boolean): void {
      status.setAttribute("data-enabled", String(enabled));
      status.textContent = enabled
        ? "WebGil 터치 네비게이션 켜짐 · Alt + Shift + T로 끄기"
        : "WebGil 터치 네비게이션 꺼짐";
    },
  };
}
