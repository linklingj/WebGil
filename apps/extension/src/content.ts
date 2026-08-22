// content script — 코어(ExtensionSource + 구조 추출 + 네비게이션 + 낭독)를 실제 페이지에 마운트하는 확장 셸.
// 사이드패널/트랙패드 UI 전 단계에서는 Alt 조합 키로 커서 엔진과 TTS를 검증한다.
import {
  ActionExecutor,
  CommandDispatcher,
  LLMCommandEngine,
  NarrationController,
  extractTree,
  NavigationEngine,
  refineTree,
  toSnapshot,
  treeStats,
  treeToText,
  type DocNode,
  type LanguageModel,
  type LLMRequest,
  type NavigationCommand,
} from "@webgil/core";
import { ExtensionSource } from "./capture/extension-source.js";
import { installCommandPalette } from "./llm/command-palette.js";
import { isAltShiftKey } from "./navigation/shortcuts.js";
import {
  isPanelCommandMessage,
  PANEL_STATE,
  type PanelCommand,
  type PanelReply,
  type PanelState,
} from "./panel/protocol.js";
import { TouchNavigationController } from "./navigation/touch-navigation.js";
import { ElevenLabsSpeechEngine } from "./tts/elevenlabs-speech-engine.js";
import { WebSpeechEngine } from "./tts/web-speech-engine.js";

const source = new ExtensionSource();
const tts = new ElevenLabsSpeechEngine(new WebSpeechEngine());
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

// 07 액션 실행기. 트리는 재추출마다 새로 만들어지므로 조회는 그때그때 네비게이션 인덱스에 묻는다.
const actions = new ActionExecutor(source, (id) => navigation?.nodeById(id) ?? null);

// 하위가 없는 노드에서의 Alt+Enter는 활성화로 해석한다(링크·버튼 클릭, 입력칸 포커스).
// 패널에서 실행한 경우엔 패널이 읽으므로(announce=false) 같은 문장이 두 번 나오지 않는다.
async function activate(node: DocNode, announce = true): Promise<string> {
  const result = await actions.activate(node.id);
  const message =
    result.status === "executed" ? `${node.text || "항목"} 실행` : result.reason;
  console.log(`[WebGil] ${message}`);
  // 실행 결과는 화면을 못 보는 사용자에게 유일한 피드백이라 반드시 소리로 알린다.
  if (announce) {
    void narrator
      .announce({ text: message, kind: "text", level: node.level }, { detail: "brief" })
      .catch((error) => console.warn("[WebGil] 낭독 실패", error));
  }
  return message;
}

// SPA 갱신 시 재추출(디바운스는 ExtensionSource 내부).
source.onMutation(() => {
  console.log("[WebGil] DOM 변경 감지 — 재추출");
  documentTree = scan();
  publish();
});

// --- 08 사이드패널 연결 ---
// 패널은 다른 컨텍스트라 DocNode(핸들 포함)를 그대로 못 받는다. 스냅샷만 보내고 id만 돌려받는다.

/** 패널이 그릴 현재 상태. 트리와 커서를 한 메시지에 묶어 뷰가 항상 일관된 쌍을 보게 한다. */
function panelState(): PanelState {
  const position = navigation?.position ?? { index: -1, count: 0 };
  return {
    title: document.title,
    tree: toSnapshot(documentTree),
    cursorId: navigation?.current?.id ?? null,
    index: position.index,
    count: position.count,
  };
}

let publishTimer: number | undefined;

/** mutation 폭주에도 스냅샷 전송이 늘어지지 않게 한 틱으로 묶는다. 패널이 닫혀 있으면 수신자가 없다(정상). */
function publish(): void {
  if (publishTimer !== undefined) return;
  publishTimer = window.setTimeout(() => {
    publishTimer = undefined;
    void chrome.runtime.sendMessage({ type: PANEL_STATE, state: panelState() }).catch(() => {});
  }, 100);
}

async function handlePanelCommand(command: PanelCommand): Promise<PanelReply> {
  let message: string | undefined;
  let awaitingConfirm = false;
  let speak = false;
  switch (command.type) {
    case "sync":
      break;
    case "navigate":
      handleNavigation(command.command);
      break;
    case "moveTo": {
      const result = navigation!.moveTo(command.id);
      if (result.node) {
        source.highlight(result.node.id);
        void narrator
          .announce(result.node, { index: result.index, count: result.count })
          .catch((error) => console.warn("[WebGil] 낭독 실패", error));
      }
      break;
    }
    case "activate": {
      const node = navigation!.nodeById(command.id);
      // 실행 결과는 패널이 읽는다 — 패널에서 누른 버튼의 결과는 패널에서 들려야 자연스럽다.
      message = node ? await activate(node, false) : "이미 사라진 항목입니다.";
      speak = true;
      break;
    }
    case "refine":
      message = await refineDocumentTree();
      break;
    case "ask":
    case "confirm": {
      const result = command.type === "ask"
        ? await runNaturalLanguageCommand(command.input)
        : await confirmPendingCommand();
      message = describeDispatch(result);
      awaitingConfirm = result.status === "confirmationRequired";
      // 이동·현재 항목 읽기는 dispatch가 이미 낭독했다. 나머지(답변·되묻기·거절·액션 실행)는
      // 아무도 말하지 않으므로 패널이 읽게 넘긴다 — 화면을 못 보면 이게 유일한 피드백이다.
      speak = !(result.status === "executed"
        && (result.command.type === "navigation" || result.command.type === "speech"));
      break;
    }
  }
  return { type: PANEL_STATE, state: panelState(), message, awaitingConfirm, speak };
}

/** 명령 처리 결과를 패널 상태 줄 한 줄로. 확인이 필요한 액션은 문장으로 되묻는다. */
function describeDispatch(result: Awaited<ReturnType<typeof runNaturalLanguageCommand>>): string {
  switch (result.status) {
    case "executed":
      return result.navigation?.node?.text ? `${result.navigation.node.text}(으)로 이동했습니다.` : "명령을 실행했습니다.";
    case "confirmationRequired":
      return `${result.confirmation.summary} — 한 번 더 Enter를 누르면 실행합니다.`;
    case "message":
      return result.text;
    case "rejected":
      return result.reason;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isPanelCommandMessage(message)) return;
  void handlePanelCommand(message.command)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "명령을 처리하지 못했습니다.";
      // 오류 문구도 소리로 나가야 사용자가 실패를 안다.
      sendResponse({
        type: PANEL_STATE,
        state: panelState(),
        message: text,
        awaitingConfirm: false,
        speak: true,
      } satisfies PanelReply);
    });
  return true;
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

// 02-L LLM 트리 재구성. 비용·지연이 있는 원격 호출이라 자동이 아니라 사용자가 부를 때만 돈다.
// ponytail: 다음 mutation의 scan()이 규칙 기반 트리로 되돌린다. 재구성 유지는 UX 결정이 선 뒤에.
async function refineDocumentTree(): Promise<string> {
  const result = await refineTree(documentTree, new ExtensionLanguageModel());
  if (result.status === "refined") {
    documentTree = result.tree;
    const refresh = navigation!.replaceTree(result.tree);
    if (refresh?.node) source.highlight(refresh.node.id);
    const stats = treeStats(result.tree);
    console.log(`[WebGil] 트리 재구성: 최상위 ${stats.topLevel}개 · 노드 ${stats.total}개`, stats.byKind);
    console.log(treeToText(result.tree));
    publish();
    return `문서 구조를 다시 정리했습니다. 최상위 ${stats.topLevel}개 항목입니다.`;
  }
  console.log(`[WebGil] 트리 재구성 건너뜀 — ${result.reason}`);
  return `문서 구조를 그대로 씁니다. ${result.reason}`;
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
  if (isAltShiftKey(event, "KeyL")) {
    event.preventDefault();
    commandPalette.open();
    return;
  }
  if (isAltShiftKey(event, "KeyT")) {
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    toggleTouchNavigation();
    return;
  }
  if (isAltShiftKey(event, "KeyR")) {
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    void refineDocumentTree()
      .then((message) =>
        narrator.announce({ text: message, kind: "group", level: 0 }, { detail: "brief" }),
      )
      .catch((error) => console.warn("[WebGil] 트리 재구성 실패", error));
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
  // 키보드·제스처로 움직여도 패널의 카메라가 따라오게 커서 변화를 알린다.
  publish();

  // 더 들어갈 하위가 없다 = 이 노드가 곧 목적지. 진입 대신 실행한다.
  if (command === "enter" && result.status === "boundary" && result.node) {
    void activate(result.node);
    return;
  }

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
  const current = navigation?.current;
  const message = enabled
    ? current
      ? `터치 네비게이션 켜짐. 현재 ${current.text}`
      : "터치 네비게이션 켜짐. 탐색할 문서 항목이 없습니다."
    : "터치 네비게이션 꺼짐";
  void narrator
    .announce(
      { text: message, kind: "group", level: 0 },
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
  // 버튼은 뺀다. 링크·버튼을 실행하면 포커스가 거기 남는데, 그때부터 Alt 탐색이 죽으면
  // "한 번 누르면 더 못 움직이는" 상태가 된다. Alt+방향키는 버튼에서 하는 일이 없어 가로채도 안전하다.
  // select·listbox 등 방향키가 값을 바꾸는 위젯은 그대로 둔다.
  return (
    target.closest(
      [
        "input",
        "textarea",
        "select",
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
  actions,
  touchNavigation,
  toggleTouchNavigation,
  runNaturalLanguageCommand,
  confirmPendingCommand,
  refineDocumentTree,
  get navigation() {
    return navigation;
  },
};
