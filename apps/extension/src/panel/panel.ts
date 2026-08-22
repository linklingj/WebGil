// 08 사이드패널 진입점 — 뷰와 입력만 담당한다.
// 트리·커서·TTS·액션의 소유자는 여전히 콘텐츠 스크립트다. 패널은 스냅샷을 받아 그리고,
// 조작은 id를 실어 되돌려 보낸다. (docs/01_SYSTEM/08)
import type { NavigationCommand, SnapshotNode } from "@webgil/core";
import "./panel.css";
import { isAltKey } from "../navigation/shortcuts.js";
import { createHelpDialog } from "./help.js";
import {
  isPanelStateMessage,
  PANEL_COMMAND,
  PANEL_VIEW_KEY,
  type PanelCommand,
  type PanelState,
} from "./protocol.js";
import { SearchBox } from "./search.js";
import { SettingsDialog } from "./settings.js";
import { TreeView } from "./tree-view.js";
import { speak } from "./voice.js";

const viewport = required<HTMLElement>("#viewport");
const statusLine = required<HTMLElement>("#status");
const helpDialog = createHelpDialog(required<HTMLDialogElement>("#helpDialog"));
const settingsDialog = new SettingsDialog(required<HTMLDialogElement>("#settingsDialog"));

let tabId: number | null = null;
let state: PanelState | null = null;
let awaitingConfirm = false;

const treeView = new TreeView(viewport, {
  onSelect: (id) => void send({ type: "moveTo", id }),
  onActivate: (id) => void send({ type: "activate", id }),
});
const searchBox = new SearchBox(required<HTMLElement>("#searchBar"), {
  onSelect: (id) => {
    void send({ type: "moveTo", id });
    viewport.focus();
  },
  onAsk: (input) => {
    // 확인이 걸린 액션은 같은 입력에 대한 다음 Enter가 곧 확인이다(07 가드레일).
    // 그래서 되묻는 동안에는 입력창을 비우지도, 포커스를 옮기지도 않는다.
    if (awaitingConfirm) {
      void send({ type: "confirm" }).then(finishCommand);
      return;
    }
    setStatus("명령을 해석하는 중…");
    void send({ type: "ask", input }).then(finishCommand);
  },
  onDismiss: () => viewport.focus(),
});

required<HTMLElement>("#helpButton").addEventListener("click", () => helpDialog.open());
required<HTMLElement>("#settingsButton").addEventListener("click", () => settingsDialog.open());
required<HTMLElement>("#recenter").addEventListener("click", () => {
  treeView.recenter();
  viewport.focus();
});

/** 명령이 끝나면 입력창을 비우고 그래프로 돌아간다. 확인 대기 중이면 그대로 둔다. */
function finishCommand(): void {
  if (awaitingConfirm) return;
  searchBox.clear();
  viewport.focus();
}

// --- 키보드: 패널은 트리를 눈에 보이게 그리므로, 키 방향을 그림과 일치시킨다.
// 형제는 좌우로 늘어서 있고 자식은 아래에 있다 → ←/→ = 형제, ↓ = 하위, ↑ = 상위.
// (페이지 쪽 Alt 조합은 화면이 없는 목록 은유라 ↓ = 다음 항목으로 남는다.)
const KEY_COMMANDS: Record<string, NavigationCommand> = {
  ArrowRight: "next",
  ArrowLeft: "previous",
  ArrowDown: "enter",
  Enter: "enter",
  ArrowUp: "back",
  Backspace: "back",
};

viewport.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "Home") {
    event.preventDefault();
    treeView.recenter();
    return;
  }
  const command = KEY_COMMANDS[event.key];
  if (!command) return;
  event.preventDefault();
  void send({ type: "navigate", command });
});

document.addEventListener("keydown", (event) => {
  // Alt + , = 설정, Alt + . = 도움말. 같은 키로 닫는다.
  // macOS는 Option을 누르면 event.key가 합성 문자(≤ ≥)로 바뀌므로 물리 키(code)로 판정한다.
  if (isAltKey(event, "Comma")) {
    event.preventDefault();
    helpDialog.close();
    settingsDialog.toggle();
    return;
  }
  if (isAltKey(event, "Period")) {
    event.preventDefault();
    settingsDialog.close();
    helpDialog.toggle();
    return;
  }
  if (event.key !== "/" || event.target instanceof HTMLInputElement) return;
  if (document.querySelector("dialog[open]")) return; // 모달 뒤의 검색창을 건드리지 않는다
  event.preventDefault();
  searchBox.focus();
});

// --- 콘텐츠 스크립트 구독 ---
chrome.runtime.onMessage.addListener((message, sender) => {
  // 다른 탭의 브로드캐스트가 패널을 덮어쓰지 않게 보낸 탭을 확인한다.
  if (!isPanelStateMessage(message) || sender.tab?.id !== tabId) return;
  apply(message.state);
});

chrome.tabs.onActivated.addListener(() => void attach());
chrome.tabs.onUpdated.addListener((changedTabId, changeInfo) => {
  if (changedTabId === tabId && changeInfo.status === "complete") void sync();
});

// --- 툴바 아이콘이 남긴 "설정 열기" 의도 ---
// 패널이 방금 열렸으면 부팅 시 읽기가, 이미 열려 있었으면 onChanged가 잡는다.
// 메시지를 쓰지 않으므로 두 경우에 경쟁 조건이 없다. (docs/08 "설정 창 여는 경로")
void consumePendingView();
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes[PANEL_VIEW_KEY]?.newValue) void consumePendingView();
});

void attach();

async function consumePendingView(): Promise<void> {
  const stored = await chrome.storage.session.get(PANEL_VIEW_KEY);
  if (stored[PANEL_VIEW_KEY] !== "settings") return;
  await chrome.storage.session.remove(PANEL_VIEW_KEY);
  settingsDialog.open();
}

async function attach(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  document.title = tab?.title ? `WebGil — ${tab.title}` : "WebGil";
  await sync();
}

async function sync(): Promise<void> {
  await send({ type: "sync" });
}

/** 패널 → 콘텐츠. 콘텐츠 스크립트가 없는 탭(chrome:// 등)에서는 조용히 안내로 끝난다. */
async function send(command: PanelCommand): Promise<unknown> {
  if (tabId === null) {
    unavailable();
    return null;
  }
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: PANEL_COMMAND, command });
    awaitingConfirm = isRecord(response) && response.awaitingConfirm === true;
    // 응답에 갱신된 상태가 함께 온다 — 따로 되묻지 않는다. 명령 결과 문구는 상태 줄을 덮어쓴다.
    if (isPanelStateMessage(response)) apply(response.state);
    if (isRecord(response) && typeof response.message === "string") {
      setStatus(response.message);
      if (response.speak === true) speak(response.message);
    }
    return response;
  } catch {
    unavailable();
    return null;
  }
}

function apply(next: PanelState): void {
  state = next;
  searchBox.setTree(next.tree);
  treeView.render(next.tree, next.cursorId);
  viewport.dataset.empty = String(next.tree.children.length === 0);

  const current = next.cursorId ? findNode(next.tree, next.cursorId) : null;
  viewport.setAttribute("aria-activedescendant", current ? `n-${current.id}` : "");
  if (!next.tree.children.length) {
    setStatus("이 페이지에서 읽을 문서 구조를 찾지 못했습니다.");
    return;
  }
  setStatus(
    current
      ? `${current.text || "(제목 없음)"} · 레벨 ${current.level}${next.count ? ` · ${next.index + 1}/${next.count}` : ""}`
      : "탐색을 시작할 항목을 고르세요.",
  );
}

function unavailable(): void {
  state = null;
  viewport.dataset.empty = "true";
  required<HTMLElement>("#empty").textContent = "이 페이지에서는 WebGil을 사용할 수 없습니다.";
  setStatus("사용할 수 없는 페이지");
}

function setStatus(text: string): void {
  statusLine.textContent = text;
}

function findNode(node: SnapshotNode, id: string): SnapshotNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`패널 요소를 찾지 못했습니다: ${selector}`);
  return element;
}

// 개발용 — 콘솔에서 현재 스냅샷 확인.
(window as unknown as { __webgilPanel: unknown }).__webgilPanel = {
  get state() {
    return state;
  },
  treeView,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
