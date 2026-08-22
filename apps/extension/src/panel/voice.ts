// 08 패널 음성 — 다이얼로그 안에서도 화면을 안 보고 조작할 수 있게 한다.
//
// 패널은 콘텐츠 스크립트와 다른 컨텍스트라 페이지의 NarrationController를 공유할 수 없다.
// 대신 **같은 엔진 클래스**를 패널에서 한 번 더 세운다(ElevenLabs → 실패 시 브라우저 음성).
// 키는 background가 들고 있고 패널은 메시지만 보내므로, 페이지 쪽과 동작·품질이 같다.
// 다이얼로그가 열려 있는 동안에는 페이지 낭독이 돌지 않으므로 두 음성이 겹치지 않는다.
import { NarrationController } from "@webgil/core";
import { ElevenLabsSpeechEngine } from "../tts/elevenlabs-speech-engine.js";
import { WebSpeechEngine } from "../tts/web-speech-engine.js";

// 엔진은 첫 낭독 때 만든다. 모듈을 불러오는 것만으로 window.speechSynthesis를 붙잡지 않게 —
// 그래야 이 파일을 import하는 다른 모듈이 브라우저 밖에서도 로드된다.
let narrator: NarrationController | undefined;

/** 한 문장 낭독. 새 낭독이 이전 낭독을 선점한다(빠르게 이동해도 밀리지 않는다). */
export function speak(text: string): void {
  if (!text.trim()) return;
  try {
    narrator ??= new NarrationController(new ElevenLabsSpeechEngine(new WebSpeechEngine()));
    void narrator
      .announce({ text, kind: "text", level: 0 }, { detail: "brief" })
      .catch((error) => console.warn("[WebGil] 패널 낭독 실패", error));
  } catch (error) {
    // 음성이 안 나오는 것보다 조작이 멈추는 게 나쁘다.
    console.warn("[WebGil] 패널 낭독 엔진을 만들지 못했습니다", error);
  }
}

export interface DialogVoiceOptions {
  /** "설정", "도움말" — 열고 닫을 때 안내에 쓴다. */
  label: string;
  /** 지금 이동할 수 있는 지점들. 화면이 바뀌면 매번 다시 계산한다. */
  stops(): HTMLElement[];
  /** 그 지점을 소리로 어떻게 설명할지. */
  describe(element: HTMLElement): string;
}

export interface DialogVoice {
  /** 창을 열고 안내 + 첫 항목을 한 문장으로 읽는다. showModal도 여기서 부른다. */
  open(): void;
}

/**
 * 다이얼로그에 음성 조작을 붙인다.
 * - `Alt + ↑/↓`로 항목 이동(페이지 쪽 조작과 같은 수식키). 끝에서는 순환하지 않고 경계를 알린다.
 * - 포커스가 옮겨가면 그 항목을 읽는다(Tab·클릭·Alt 이동 모두 같은 경로).
 * - 창을 닫으면 닫혔다고 알린다(Esc·✕·저장 후 닫기 모두 native close 이벤트 하나로 잡힌다).
 */
export function attachDialogVoice(dialog: HTMLDialogElement, options: DialogVoiceOptions): DialogVoice {
  /** 여는 동안의 포커스 이동(브라우저 오토포커스 포함)은 안내 문장에 이미 담기므로 삼킨다. */
  let opening = false;

  dialog.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const stops = options.stops();
    if (!stops.length) return;
    const current = stops.indexOf(document.activeElement as HTMLElement);
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    if (current >= 0 && (next < 0 || next >= stops.length)) {
      speak(event.key === "ArrowDown" ? "마지막 항목입니다." : "첫 번째 항목입니다.");
      return;
    }
    stops[current < 0 ? 0 : next].focus();
  });

  dialog.addEventListener("focusin", (event) => {
    if (opening) return;
    if (event.target instanceof HTMLElement) speak(options.describe(event.target));
  });

  dialog.addEventListener("close", () => speak(`${options.label} 창을 닫았습니다.`));

  return {
    open() {
      // showModal의 오토포커스와 우리 focus()는 모두 동기라, 이 구간만 막으면 새는 안내가 없다.
      opening = true;
      if (!dialog.open) dialog.showModal();
      const first = options.stops()[0];
      first?.focus();
      opening = false;
      // 창 안내와 첫 항목을 한 문장으로 붙인다. 따로 부르면 뒤 낭독이 앞 낭독을 잘라먹는다.
      speak(
        `${options.label} 창입니다. Alt와 위아래 방향키로 항목을 이동합니다. ${first ? options.describe(first) : ""}`,
      );
    },
  };
}

/** 폼 요소 하나를 읽을 문구로. 비밀번호는 값 대신 저장 여부만 말한다. */
export function describeFormControl(dialog: HTMLElement, element: HTMLElement): string {
  if (element instanceof HTMLButtonElement) {
    return `${element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "버튼"} 버튼`;
  }

  const label = dialog.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() ?? element.id;
  if (element instanceof HTMLSelectElement) {
    return `${label}, 현재 ${element.selectedOptions[0]?.textContent?.trim() ?? "선택 없음"}`;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === "password") return `${label}, ${element.value ? "저장된 값 있음" : "비어 있음"}`;
    return `${label}, ${element.value || "비어 있음"}`;
  }
  return element.textContent?.trim() ?? "";
}
