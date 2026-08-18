// 관찰 하니스 — docs/03_RESEARCH/test_sites.md의 URL을 받아 HTML을 가져와 jsdom에 세우고,
// 구조 추출 엔진(02)을 돌려 트리 요약(개수·깊이·개요)을 콘솔에 찍는다.
// SSR 페이지는 실제 트리가 나오고, JS 렌더 SPA는 얇은 셸만 잡히므로 렌더 경로(확장)로 확인해야 한다.
// 실행: pnpm --filter @webgil/bench observe [url ...]
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { extractTree, treeStats, treeToText } from "@webgil/core";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

function siteUrls(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args;
  const md = readFileSync(new URL("../../docs/03_RESEARCH/test_sites.md", import.meta.url), "utf8");
  return [...md.matchAll(/^\s*-\s*(https?:\/\/\S+)/gm)].map((m) => m[1]);
}

async function observe(url: string): Promise<void> {
  console.log("\n" + "=".repeat(72) + `\n${url}`);
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "ko,en;q=0.9" },
      signal: AbortSignal.timeout(20000),
    });
    html = await res.text();
    console.log(`  HTTP ${res.status} · ${(html.length / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.log(`  ✗ fetch 실패: ${(e as Error).message}`);
    return;
  }
  // jsdom은 스크립트를 실행하지 않는다(runScripts 미설정) — 순수 마크업만 파싱.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const tree = extractTree(dom.window.document as unknown as Document);
  const s = treeStats(tree);
  const kinds = Object.entries(s.byKind)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  console.log(`  노드 ${s.total} · 최상위 ${s.topLevel} · 깊이 ${s.maxDepth} · [${kinds}]`);
  console.log(treeToText(tree, 2).split("\n").slice(0, 40).map((l) => "  " + l).join("\n"));
}

for (const url of siteUrls()) await observe(url);
