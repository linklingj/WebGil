// 08 사이드패널 진입점 — 뷰와 입력만 담당한다.
// 트리·커서·TTS·액션의 소유자는 여전히 콘텐츠 스크립트다. 패널은 스냅샷을 받아 그리고,
// 조작은 id를 실어 되돌려 보낸다. (docs/01_SYSTEM/08)
import type { NavigationCommand, SnapshotNode } from "@webgil/core";
import { isAltKey } from "../navigation/shortcuts.js";
import { createHelpDialog } from "./help.js";
import {
  isPanelStateMessage,
  isPanelView,
  PANEL_COMMAND,
  PANEL_VIEW_KEY,
  type PanelCommand,
  type PanelState,
  type PanelView,
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

// --- 키보드 ---
// 맨손 방향키: 패널은 트리를 눈에 보이게 그리므로 키 방향을 그림과 맞춘다.
// 형제는 좌우로 늘어서 있고 자식은 아래에 있다 → ←/→ = 형제, ↓ = 하위, ↑ = 상위.
const PANEL_KEYS: Record<string, NavigationCommand> = {
  ArrowRight: "next",
  ArrowLeft: "previous",
  ArrowDown: "enter",
  Enter: "enter",
  ArrowUp: "back",
  Backspace: "back",
};

// Alt 조합: 페이지에서 쓰던 키를 패널 안에서도 그대로 받는다.
// 포커스가 패널로 옮겨갔다는 이유로 손에 익은 키가 죽으면 안 된다(페이지 쪽은 목록 은유라 ↓ = 다음).
const PAGE_ALT_KEYS: Record<string, NavigationCommand> = {
  ArrowDown: "next",
  ArrowRight: "next",
  ArrowUp: "previous",
  ArrowLeft: "previous",
  Enter: "enter",
  Backspace: "back",
};

document.addEventListener("keydown", (event) => {
  // Alt + , = 설정, Alt + . = 도움말. 같은 키로 닫는다.
  // macOS는 Option을 누르면 event.key가 합성 문자(≤ ≥)로 바뀌므로 물리 키(code)로 판정한다.
  // 같은 키가 manifest의 commands에도 걸려 있어 패널 밖에서도 동작한다 — 두 경로가 겹쳐도
  // applyIntent가 한 번만 처리한다.
  if (isAltKey(event, "Comma")) {
    event.preventDefault();
    applyIntent("settings");
    return;
  }
  if (isAltKey(event, "Period")) {
    event.preventDefault();
    applyIntent("help");
    return;
  }
  // 다이얼로그가 열려 있으면 그 창이 자기 키를 처리한다(Alt+↑/↓ 항목 이동 등).
  if (document.querySelector("dialog[open]")) return;

  // 검색창 안의 키는 SearchBox가 처리한다(↑↓ = 결과 이동, Esc = 트리로 복귀).
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing) return;

  if (event.key === "Escape") {
    // 어디에 있든 Esc는 그래프로 돌아오는 키다.
    event.preventDefault();
    viewport.focus();
    return;
  }
  if (event.key === "/") {
    event.preventDefault();
    applyIntent("search");
    return;
  }
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Home") {
    event.preventDefault();
    treeView.recenter();
    return;
  }
  // 그래프에 포커스가 있든 하단 버튼에 있든 같은 키로 탐색한다.
  const command = (event.altKey ? PAGE_ALT_KEYS : PANEL_KEYS)[event.key];
  if (!command) return;
  event.preventDefault();
  void send({ type: "navigate", command });
});

// 다이얼로그를 닫으면 포커스를 그래프로 돌려놓는다 — 다음 방향키가 바로 탐색이 되게.
for (const element of document.querySelectorAll("dialog")) {
  element.addEventListener("close", () => viewport.focus());
}

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
  const view = stored[PANEL_VIEW_KEY];
  if (!isPanelView(view)) return;
  await chrome.storage.session.remove(PANEL_VIEW_KEY);
  applyIntent(view);
}

let lastIntentAt = 0;

/**
 * "이 화면을 띄워라" 요청 하나를 처리한다. 들어오는 길이 둘이다 —
 * 패널이 직접 들은 키와, 브라우저 단축키(commands)가 background를 거쳐 남긴 storage 값.
 * 패널에 포커스가 있으면 둘 다 들어올 수 있으므로 짧은 시간 안의 중복은 무시한다.
 * (그냥 두면 열자마자 닫혀서 아무 일도 안 일어난 것처럼 보인다.)
 */
function applyIntent(view: PanelView): void {
  const now = Date.now();
  if (now - lastIntentAt < 400) return;
  lastIntentAt = now;

  // 페이지에서 단축키를 눌렀다면 키보드 포커스가 아직 페이지에 있다. 패널로 끌어온다.
  // (사이드패널을 포커스시키는 API는 없다. 확장 페이지의 window.focus()로 요청만 해보고,
  //  Chrome이 무시해도 아래 focus()들이 activeElement를 맞춰 놓으므로 Tab 한 번이면 이어진다.)
  if (!document.hasFocus()) window.focus();

  if (view === "search") {
    settingsDialog.close();
    helpDialog.close();
    searchBox.focus();
    return;
  }
  // 모달이 겹치지 않게 다른 창은 닫고 연다.
  if (view === "settings") {
    helpDialog.close();
    settingsDialog.toggle();
  } else {
    settingsDialog.close();
    helpDialog.toggle();
  }
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
