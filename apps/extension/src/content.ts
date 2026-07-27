// content script — 코어(ExtensionSource + 구조 추출 + 네비게이션)를 실제 페이지에 마운트하는 확장 셸.
// 사이드패널/트랙패드 UI 전 단계에서는 Alt 조합 키로 커서 엔진을 검증한다.
import {
  extractTree,
  NavigationEngine,
  treeStats,
  treeToText,
  type NavigationCommand,
} from "@webgil/core";
import { ExtensionSource } from "./capture/extension-source.js";

const source = new ExtensionSource();
let navigation: NavigationEngine | undefined;

function scan() {
  const tree = extractTree(source.getDOM());
  const refresh = navigation?.replaceTree(tree);
  if (!navigation) navigation = new NavigationEngine(tree);

  // SPA 갱신 뒤에도 같은 커서를 유지했거나 폴백 위치로 옮겼다면,
  // 새 레이아웃 기준으로 오버레이 위치를 다시 계산한다.
  if (refresh?.node) source.highlight(refresh.node.id);
  const stats = treeStats(tree);
  console.log(
    `[WebGil] 문서 트리: 노드 ${stats.total}개 · 최상위 ${stats.topLevel}개 · 최대깊이 ${stats.maxDepth}`,
    stats.byKind,
  );
  console.log(treeToText(tree));
  return tree;
}

scan();

// SPA 갱신 시 재추출(디바운스는 ExtensionSource 내부).
source.onMutation(() => {
  console.log("[WebGil] DOM 변경 감지 — 재추출");
  scan();
});

// 키보드 폴백(Shift/Control/Meta 없이 Alt만 사용):
// Alt+방향키 = 같은 레벨 이동, Alt+Enter = 하위 진입, Alt+Backspace = 상위 복귀.
// 일반 페이지 입력과 브라우저 단축키에 영향을 주지 않도록 조합키·비편집 영역에서만 처리한다.
document.addEventListener("keydown", (event) => {
  const command = commandFor(event);
  if (!command || isEditableTarget(event.target)) return;

  event.preventDefault();
  const result = navigation!.handle(command);
  if (result.node) source.highlight(result.node.id);

  if (result.status === "moved" && result.node) {
    console.log(
      `[WebGil] ${result.node.text} — 레벨 ${result.node.level}, ${result.index + 1}/${result.count}`,
    );
  } else if (result.status === "boundary") {
    console.log("[WebGil] 더 이동할 수 없는 경계입니다.");
  } else {
    console.log("[WebGil] 탐색할 문서 노드가 없습니다.");
  }
});

function commandFor(event: KeyboardEvent): NavigationCommand | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    case "ArrowUp":
    case "ArrowLeft":
      return "previous";
    case "Enter":
      return "enter";
    case "Backspace":
      return "back";
    default:
      return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        '[contenteditable]:not([contenteditable="false"])',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="spinbutton"]',
        '[role="listbox"]',
      ].join(", "),
    ) !== null
  );
}

// 개발/데모용: 콘솔에서 source·scan·navigation을 직접 시험.
(window as unknown as { __webgil: unknown }).__webgil = {
  source,
  scan,
  get navigation() {
    return navigation;
  },
};
