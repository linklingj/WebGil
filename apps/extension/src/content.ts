// content script — 코어(ExtensionSource + 구조 추출 엔진)를 실제 페이지에 마운트하는 확장 셸.
// MVP 단계에선 사이드패널 뷰어 대신, 로드 시 구조를 문서 트리로 뽑아 콘솔에 요약하고
// 디버깅용 핸들을 window.__webgil로 노출한다(네비게이션/TTS UI는 이후 Phase).
import { NarrationController, extractTree, treeStats, treeToText } from "@webgil/core";
import { ExtensionSource } from "./capture/extension-source.js";
import { WebSpeechEngine } from "./tts/web-speech-engine.js";

const source = new ExtensionSource();
const tts = new WebSpeechEngine();
const narrator = new NarrationController(tts);

function scan() {
  const tree = extractTree(source.getDOM());
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

// 개발/데모용: 콘솔에서 __webgil.narrator.announce(...)로 낭독을 직접 시험.
// 네비게이션 브랜치가 병합되면 이동 결과를 이 narrator에 자동 연결한다.
(window as unknown as { __webgil: unknown }).__webgil = { source, scan, extractTree, tts, narrator };
