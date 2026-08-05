export interface CommandPalette {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export interface CommandPaletteOptions {
  run(input: string): Promise<unknown>;
  confirm(): Promise<unknown>;
}

let paletteSequence = 0;

/** Alt+Shift+L로 열리는 최소 명령 입력창. 페이지 액션은 확인 버튼을 거쳐야 한다. */
export function installCommandPalette(options: CommandPaletteOptions): CommandPalette {
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

  let previousFocus: HTMLElement | null = null;

  async function run(inputText: string): Promise<void> {
    submit.disabled = true;
    confirm.hidden = true;
    message.textContent = "명령을 해석하는 중입니다…";
    try {
      const result = await options.run(inputText);
      const status = readStatus(result);
      if (status === "confirmationRequired") {
        message.textContent = confirmationMessage(result);
        confirm.hidden = false;
      } else {
        message.textContent = messageFor(result);
      }
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "명령 처리에 실패했습니다.";
    } finally {
      submit.disabled = false;
    }
  }

  async function confirmAction(): Promise<void> {
    confirm.disabled = true;
    try {
      message.textContent = messageFor(await options.confirm());
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

function readStatus(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && "status" in value
    && typeof (value as { status?: unknown }).status === "string"
    ? (value as { status: string }).status
    : undefined;
}

function messageFor(value: unknown): string {
  if (typeof value !== "object" || value === null) return "명령을 처리했습니다.";
  const result = value as { status?: unknown; text?: unknown; reason?: unknown };
  if (typeof result.text === "string") return result.text;
  if (typeof result.reason === "string") return result.reason;
  return result.status === "executed" ? "명령을 처리했습니다." : "명령을 처리했습니다.";
}

function confirmationMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) return "페이지 동작을 실행할까요?";
  const confirmation = (value as { confirmation?: { summary?: unknown } }).confirmation;
  const summary = confirmation?.summary;
  return typeof summary === "string"
    ? `${summary} 실행할까요?`
    : "페이지 동작을 실행할까요?";
}
