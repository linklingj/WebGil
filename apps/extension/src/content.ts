// content script — 코어(ExtensionSource + 구조 추출 + 네비게이션 + 낭독)를 실제 페이지에 마운트하는 확장 셸.
// 사이드패널/트랙패드 UI 전 단계에서는 Alt 조합 키로 커서 엔진과 TTS를 검증한다.
import {
  CommandDispatcher,
  LLMCommandEngine,
  NarrationController,
  extractTree,
  NavigationEngine,
  treeStats,
  treeToText,
  type LanguageModel,
  type LLMRequest,
  type NavigationCommand,
} from "@webgil/core";
import { ExtensionSource } from "./capture/extension-source.js";
import { installCommandPalette } from "./llm/command-palette.js";
import { TouchNavigationController } from "./navigation/touch-navigation.js";
import { WebSpeechEngine } from "./tts/web-speech-engine.js";

const source = new ExtensionSource();
const tts = new WebSpeechEngine();
const narrator = new NarrationController(tts);
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

let documentTree = scan();

// SPA 갱신 시 재추출(디바운스는 ExtensionSource 내부).
source.onMutation(() => {
  console.log("[WebGil] DOM 변경 감지 — 재추출");
  documentTree = scan();
});

// 키보드 폴백(Shift/Control/Meta 없이 Alt만 사용):
// Alt+방향키 = 같은 레벨 이동, Alt+Enter = 하위 진입, Alt+Backspace = 상위 복귀.
// 일반 페이지 입력과 브라우저 단축키에 영향을 주지 않도록 조합키·비편집 영역에서만 처리한다.
class ExtensionLanguageModel implements LanguageModel {
  async complete(request: LLMRequest): Promise<unknown> {
    const response = await chrome.runtime.sendMessage<ChromeRuntimeMessageResponse>({
      type: "webgil.llm.complete",
      request,
    });
    if (!response.ok) throw new Error(response.error ?? "LLM 요청에 실패했습니다.");
    return response.value;
  }
}

const commandDispatcher = new CommandDispatcher({
  navigation: navigation!,
  source,
  narrator,
});
const llm = new LLMCommandEngine(new ExtensionLanguageModel());
let pendingCommand: Awaited<ReturnType<typeof llm.interpret>> | undefined;

async function runNaturalLanguageCommand(input: string) {
  const resolution = await llm.interpret(input, documentTree);
  pendingCommand = resolution;
  return commandDispatcher.dispatch(resolution);
}

async function confirmPendingCommand() {
  if (!pendingCommand) throw new Error("확인할 명령이 없습니다.");
  const command = pendingCommand;
  pendingCommand = undefined;
  return commandDispatcher.dispatch(command, true);
}

const commandPalette = installCommandPalette({
  run: runNaturalLanguageCommand,
  confirm: confirmPendingCommand,
});
const touchNavigation = new TouchNavigationController({
  onCommand: handleNavigation,
  shouldIgnoreTarget: isEditableTarget,
});
const touchNavigationStatus = createTouchNavigationStatus();

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && commandPalette.isOpen()) {
    event.preventDefault();
    commandPalette.close();
    return;
  }
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "l") {
    event.preventDefault();
    commandPalette.open();
    return;
  }
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    toggleTouchNavigation();
    return;
  }
  const command = commandFor(event);
  if (!command || isEditableTarget(event.target)) return;

  event.preventDefault();
  handleNavigation(command);
});

function handleNavigation(command: NavigationCommand): void {
  const result = navigation!.handle(command);
  if (result.node) source.highlight(result.node.id);

  if (result.status === "moved" && result.node) {
    console.log(
      `[WebGil] ${result.node.text} — 레벨 ${result.node.level}, ${result.index + 1}/${result.count}`,
    );
    // 낭독 실패가 커서 이동을 막지 않도록 오류는 로그로만 남긴다.
    void narrator
      .announce(result.node, { index: result.index, count: result.count })
      .catch((error) => console.warn("[WebGil] 낭독 실패", error));
  } else if (result.status === "boundary") {
    console.log("[WebGil] 더 이동할 수 없는 경계입니다.");
    void narrator
      .announce({ text: boundaryMessage(command), kind: "group", level: 0 }, { detail: "brief" })
      .catch((error) => console.warn("[WebGil] 경계 안내 낭독 실패", error));
  } else {
    console.log("[WebGil] 탐색할 문서 노드가 없습니다.");
    void narrator
      .announce({ text: "탐색할 문서 항목이 없습니다.", kind: "group", level: 0 }, { detail: "brief" })
      .catch((error) => console.warn("[WebGil] 빈 문서 안내 낭독 실패", error));
  }
}

function boundaryMessage(command: NavigationCommand): string {
  switch (command) {
    case "next":
      return "마지막 항목입니다.";
    case "previous":
      return "첫 번째 항목입니다.";
    case "enter":
      return "하위 항목이 없습니다.";
    case "back":
      return "상위 항목이 없습니다.";
  }
}

function toggleTouchNavigation(): boolean {
  const enabled = touchNavigation.toggle();
  touchNavigationStatus.setAttribute("data-enabled", String(enabled));
  touchNavigationStatus.textContent = enabled
    ? "WebGil 터치 네비게이션 켜짐 · Alt + Shift + T로 끄기"
    : "WebGil 터치 네비게이션 꺼짐";
  void narrator
    .announce(
      { text: `터치 네비게이션 모드 ${enabled ? "켜짐" : "꺼짐"}`, kind: "group", level: 0 },
      { detail: "brief" },
    )
    .catch((error) => console.warn("[WebGil] 모드 안내 낭독 실패", error));
  return enabled;
}

function createTouchNavigationStatus(): HTMLElement {
  const status = document.createElement("div");
  status.setAttribute("data-webgil-ui", "touch-navigation-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("data-enabled", "false");
  Object.assign(status.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: "2147483647",
    padding: "8px 12px",
    borderRadius: "8px",
    color: "#fff",
    background: "#1f6feb",
    font: "14px system-ui, sans-serif",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
    display: "none",
  } satisfies Partial<CSSStyleDeclaration>);
  const style = document.createElement("style");
  style.setAttribute("data-webgil-ui", "touch-navigation-status-style");
  style.textContent = '[data-webgil-ui="touch-navigation-status"][data-enabled="true"] { display: block !important; }';
  document.documentElement.append(style, status);
  return status;
}

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

// 개발/데모용: 콘솔에서 source·scan·navigation·narrator를 직접 시험.
(window as unknown as { __webgil: unknown }).__webgil = {
  source,
  scan,
  tts,
  narrator,
  touchNavigation,
  toggleTouchNavigation,
  runNaturalLanguageCommand,
  confirmPendingCommand,
  get navigation() {
    return navigation;
  },
};
