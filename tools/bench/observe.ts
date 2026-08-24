// 구조 추출 결과를 실제 렌더된 페이지에서 관찰하는 벤치 훅.
// esbuild로 IIFE 번들 → 브라우저 페이지에 주입 → window.__webgilObserve()로 트리 요약을 읽는다.
// 제품 셸이 아니라 개발/관찰용. (docs/00_PLAN §8, tools/bench)
import { extractTree, treeStats, treeToText } from "../../packages/core/src/index.js";

(window as unknown as { __webgilObserve: () => unknown }).__webgilObserve = () => {
  const tree = extractTree(document);
  return { url: location.href, stats: treeStats(tree), outline: treeToText(tree, 3) };
};
