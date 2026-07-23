// content script — 코어(ExtensionSource)를 실제 페이지에 마운트하는 확장 셸.
// MVP 단계에선 사이드패널 뷰어 대신, 로드 시 구조를 스캔해 콘솔에 요약하고
// 디버깅용 핸들을 window.__webgil로 노출한다(네비게이션/TTS UI는 이후 Phase).
import { ExtensionSource } from "./capture/extension-source.js";

const source = new ExtensionSource();

function scan() {
  const ax = source.getAXTree();
  console.log(`[WebGil] 접근성 노드 ${ax.length}개 추출`, ax.slice(0, 30));
  return ax;
}

scan();

// SPA 갱신 시 재스캔(디바운스는 ExtensionSource 내부).
source.onMutation(() => {
  console.log("[WebGil] DOM 변경 감지 — 재스캔");
  scan();
});

// 개발/데모용: 콘솔에서 window.__webgil.source.execute/highlight를 직접 시험.
(window as unknown as { __webgil: unknown }).__webgil = { source, scan };
