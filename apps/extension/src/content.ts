// content script — 코어(ExtensionSource + 구조 추출 + 네비게이션 + 낭독)를 실제 페이지에 마운트하는 확장 셸.
// 사이드패널/트랙패드 UI 전 단계에서는 Alt 조합 키로 커서 엔진과 TTS를 검증한다.
import {
  ActionExecutor,
  CommandDispatcher,
  LLMCommandEngine,
  NarrationController,
  extractTree,
  NavigationEngine,
  treeStats,
  treeToText,
  type DocNode,
  type LanguageModel,
  type LLMRequest,
  type NavigationCommand,
} from "@webgil/core";
import { ExtensionSource } from "./capture/extension-source.js";
import { installCommandPalette } from "./llm/command-palette.js";
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

// 07 액션 실행기. 트리는 재추출마다 새로 만들어지므로 조회는 그때그때 네비게이션 인덱스에 묻는다.
const actions = new ActionExecutor(source, (id) => navigation?.nodeById(id) ?? null);

// 하위가 없는 노드에서의 Alt+Enter는 활성화로 해석한다(링크·버튼 클릭, 입력칸 포커스).
async function activate(node: DocNode) {
  const result = await actions.activate(node.id);
  const message =
    result.status === "executed" ? `${node.text || "항목"} 실행` : result.reason;
  console.log(`[WebGil] ${message}`);
  // 실행 결과는 화면을 못 보는 사용자에게 유일한 피드백이라 반드시 소리로 알린다.
  void narrator
    .announce({ text: message, kind: "text", level: node.level }, { detail: "brief" })
    .catch((error) => console.warn("[WebGil] 낭독 실패", error));
}

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
  const command = commandFor(event);
  if (!command || isEditableTarget(event.target)) return;

  event.preventDefault();
  const result = navigation!.handle(command);
  if (result.node) source.highlight(result.node.id);

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

// 개발/데모용: 콘솔에서 source·scan·navigation·narrator를 직접 시험.
(window as unknown as { __webgil: unknown }).__webgil = {
  source,
  scan,
  tts,
  narrator,
  actions,
  runNaturalLanguageCommand,
  confirmPendingCommand,
  get navigation() {
    return navigation;
  },
};
