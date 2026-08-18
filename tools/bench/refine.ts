// 02-L LLM 트리 재구성 벤치 — 테스트 사이트에서 규칙 기반 트리(02)와 재구성 트리를 나란히 본다.
//
// 제공자 설정(WEBGIL_PROVIDER/WEBGIL_MODEL/WEBGIL_API_KEY)이 있으면 실제 LLM을 호출하고,
// 없으면 드라이런 — 실제 페이지가 재구성 한도(maxNodes/maxChars) 안에 들어오는지만 측정한다.
// 한도를 넘으면 refineTree가 원본을 그대로 쓰므로, 이 숫자가 곧 "이 사이트에서 기능이 도느냐"다.
//
// 실행: pnpm --filter @webgil/bench refine [url ...]
//   WEBGIL_PROVIDER=anthropic WEBGIL_MODEL=claude-sonnet-5 WEBGIL_API_KEY=... pnpm --filter @webgil/bench refine
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  createDocumentContext,
  createProviderLanguageModel,
  extractTree,
  refineTree,
  treeStats,
  treeToText,
  type DocNode,
  type LLMProvider,
} from "@webgil/core";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// 목록 파일 두 곳을 모두 읽는다. `- https://…` 형식과 맨 URL 한 줄 형식을 함께 받는다.
const SITE_FILES = [
  new URL("./test-sites.md", import.meta.url),
  new URL("../../docs/03_RESEARCH/test_sites.md", import.meta.url),
];

function siteUrls(): string[] {
  const args = process.argv.slice(2);
  if (args.length) return args;
  const urls = SITE_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^\s*(?:-\s*)?(https?:\/\/\S+)/gm)].map((m) => m[1]),
  );
  return [...new Set(urls)];
}

function providerModel() {
  const provider = process.env.WEBGIL_PROVIDER as LLMProvider | undefined;
  const apiKey = process.env.WEBGIL_API_KEY;
  const model = process.env.WEBGIL_MODEL;
  if (!provider || !apiKey || !model) return undefined;
  return createProviderLanguageModel({ provider, apiKey, model });
}

function summary(tree: DocNode): string {
  const s = treeStats(tree);
  const kinds = Object.entries(s.byKind)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
  return `노드 ${s.total} · 최상위 ${s.topLevel} · 깊이 ${s.maxDepth} · [${kinds}]`;
}

/** 최상위 항목 이름 — 02-R P1-E("최상위가 페이지 chrome으로 채워진다")를 눈으로 보는 지표. */
function topLevel(tree: DocNode): string {
  return tree.children.map((c) => c.text || `(${c.kind})`).join(" | ") || "(없음)";
}

async function bench(url: string, model: ReturnType<typeof providerModel>): Promise<void> {
  console.log("\n" + "=".repeat(72) + `\n${url}`);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "ko,en;q=0.9" },
      signal: AbortSignal.timeout(20000),
    });
    html = await res.text();
  } catch (e) {
    console.log(`  ✗ fetch 실패: ${(e as Error).message}`);
    return;
  }

  // jsdom은 스크립트를 실행하지 않는다 — JS 렌더 SPA는 여기서 노드가 거의 안 잡힌다(02-R §4.4).
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const before = extractTree(dom.window.document as unknown as Document);
  console.log(`  [규칙]   ${summary(before)}`);
  console.log(`  최상위:  ${topLevel(before)}`);

  const context = createDocumentContext(before, { maxDepth: 6, maxNodes: 400, maxChars: 24_000 });
  console.log(
    `  컨텍스트: 노드 ${context.nodeIds.length} · ${context.text.length}자` +
      (context.truncated ? " · ⚠ 한도 초과 → 재구성 건너뜀" : ""),
  );

  if (!model) return;

  const started = Date.now();
  const result = await refineTree(before, model);
  const elapsed = Date.now() - started;
  if (result.status === "fallback") {
    console.log(`  [재구성] 폴백(${elapsed}ms) — ${result.reason}`);
    return;
  }
  console.log(`  [재구성] ${summary(result.tree)} · ${elapsed}ms`);
  console.log(`  최상위:  ${topLevel(result.tree)}`);
  console.log(treeToText(result.tree, 2).split("\n").slice(0, 40).map((l) => "    " + l).join("\n"));
}

const model = providerModel();
if (!model) {
  console.log("WEBGIL_PROVIDER/WEBGIL_MODEL/WEBGIL_API_KEY 미설정 — 드라이런(한도 측정)만 실행합니다.");
}
for (const url of siteUrls()) await bench(url, model);
