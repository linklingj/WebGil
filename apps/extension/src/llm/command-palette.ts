// 페이지 위에 직접 띄우는 자연어 명령창. 사이드패널이 생기기 전의 입력 경로이며,
// 패널을 열 수 없는 상황(패널 미지원 창, 사용자가 닫아 둔 경우)의 대비책으로 남아 있다.
// 패널 검색창과 역할이 겹친다 — 실사용에서 한쪽만 쓰이는 게 확인되면 지운다.
import type { CommandDispatchResult } from "@webgil/core";

export interface CommandPalette {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface CommandPaletteOptions {
  run(input: string): Promise<CommandDispatchResult>;
  /** 확인이 필요한 액션을 실제로 실행한다. 07 가드레일: 사용자가 한 번 더 눌러야 한다. */
  confirm(): Promise<CommandDispatchResult>;
}

// 같은 페이지에 명령창이 두 번 설치돼도 label-input 연결(htmlFor/id)이 어긋나지 않게 번호를 붙인다.
let paletteSequence = 0;

/** Alt+Shift+L로 열리는 최소 명령 입력창. 페이지 액션은 확인 버튼을 거쳐야 한다. */
export function installCommandPalette(options: CommandPaletteOptions): CommandPalette {
  // 페이지 CSS에 오염되지 않도록 스타일은 전부 인라인으로 박는다. 클래스 이름은 언제든 충돌한다.
  // z-index는 최대값 — 사이트가 아무리 높은 레이어를 써도 명령창이 가려지면 안 된다.
  const root = document.createElement("section");
  root.setAttribute("data-webgil-ui", "command-palette");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "WebGil 자연어 명령");
  root.hidden = true;
  Object.assign(root.style, {
    position: "fixed",
    zIndex: "2147483647",
    top: "20px",
    right: "20px",
    width: "min(360px, calc(100vw - 40px))",
    padding: "16px",
    borderRadius: "12px",
    background: "#111827",
    color: "#ffffff",
    boxShadow: "0 12px 32px rgba(0,0,0,.35)",
    font: "14px system-ui, sans-serif",
  } satisfies Partial<CSSStyleDeclaration>);

  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "WebGil 명령";
  const inputId = `webgil-command-input-${++paletteSequence}`;
  label.htmlFor = inputId;
  const input = document.createElement("input");
  input.id = inputId;
  input.placeholder = "예: 다음 제목으로 이동해 줘";
  input.autocomplete = "off";
  Object.assign(input.style, { width: "100%", marginTop: "8px", padding: "9px", boxSizing: "border-box" });
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "명령 실행";
  Object.assign(submit.style, { marginTop: "8px", padding: "8px" });
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "닫기";
  close.setAttribute("aria-label", "WebGil 명령창 닫기");
  Object.assign(close.style, { margin: "8px 0 0 8px", padding: "8px" });
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "페이지 동작 확인";
  confirm.hidden = true;
  Object.assign(confirm.style, { margin: "8px 0 0 8px", padding: "8px" });
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.style.marginBottom = "0";

  form.append(label, input, submit, close, confirm, message);
  root.append(form);
  // body가 아니라 documentElement에 붙인다. body를 통째로 갈아끼우는 SPA에서도 살아남는다.
  document.documentElement.append(root);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    void run(text);
  });
  confirm.addEventListener("click", () => void confirmAction());
  close.addEventListener("click", () => palette.close());
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      palette.close();
    }
  });

  // 닫을 때 원래 있던 자리로 포커스를 돌려준다 — 명령 한 번 쓰고 읽던 위치를 잃으면 안 된다.
  let previousFocus: HTMLElement | null = null;

  async function run(inputText: string): Promise<void> {
    submit.disabled = true;
    confirm.hidden = true;
    message.textContent = "명령을 해석하는 중입니다…";
    try {
      const result = await options.run(inputText);
      message.textContent = describe(result);
      // 확인 버튼은 필요한 순간에만 나타난다. 늘 떠 있으면 무엇을 확인하는지 알 수 없다.
      confirm.hidden = result.status !== "confirmationRequired";
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "명령 처리에 실패했습니다.";
    } finally {
      submit.disabled = false;
    }
  }

  async function confirmAction(): Promise<void> {
    confirm.disabled = true;
    try {
      message.textContent = describe(await options.confirm());
      confirm.hidden = true;
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "명령 실행에 실패했습니다.";
    } finally {
      confirm.disabled = false;
    }
  }

  const palette: CommandPalette = {
    open() {
      if (!root.hidden) return;
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      root.hidden = false;
      input.focus();
    },
    close() {
      if (root.hidden) return;
      root.hidden = true;
      confirm.hidden = true;
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocus = null;
    },
    isOpen() {
      return !root.hidden;
    },
  };
  return palette;
}

/** 명령 결과 한 줄. 이 문구는 role="status"로 들어가 보조공학이 바로 읽는다. */
function describe(result: CommandDispatchResult): string {
  switch (result.status) {
    case "message":
      return result.text;
    case "rejected":
      return result.reason;
    case "confirmationRequired":
      return `${result.confirmation.summary} 실행할까요?`;
    case "executed":
      return "명령을 처리했습니다.";
  }
}
