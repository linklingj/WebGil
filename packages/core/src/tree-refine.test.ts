import assert from "node:assert/strict";
import { test } from "node:test";
import type { LanguageModel, LLMRequest } from "./llm-command.js";
import { applyRefinePlan, refineTree } from "./tree-refine.js";
import { indexById, type DocNode } from "./tree.js";

// handle은 구조 추출이 보존하는 원본 DOM 참조. 재구성이 이걸 잃으면 액션 실행기(07)가 죽는다.
function node(id: string, kind: DocNode["kind"], text: string, children: DocNode[] = []): DocNode {
  return { id, kind, level: 1, text, handle: { el: id }, children };
}

function tree(): DocNode {
  return {
    id: "root",
    kind: "group",
    level: 0,
    text: "(문서)",
    children: [
      node("nav", "group", "탐색", [node("nav-home", "link", "홈"), node("nav-ad", "link", "광고")]),
      {
        ...node("main", "group", "본문", [
          node("h-price", "heading", "가격"),
          node("p-price", "text", "월 9,900원부터 시작합니다."),
          node("btn-buy", "button", "구매하기"),
        ]),
        regionRole: "main",
      },
    ],
  };
}

function fakeModel(response: unknown, onRequest?: (request: LLMRequest) => void): LanguageModel {
  return {
    async complete(request) {
      onRequest?.(request);
      return response;
    },
  };
}

test("applyRefinePlan: 계획대로 재배치하고 원본 text·handle·kind를 그대로 가져온다", () => {
  const root = tree();
  const result = applyRefinePlan(root, {
    root: [
      { group: "구매 정보", children: [{ ref: "h-price" }, { ref: "p-price" }, { ref: "btn-buy" }] },
      { ref: "nav-home" },
    ],
  });

  assert.equal(result.status, "refined");
  const index = indexById(result.tree);

  const group = result.tree.children[0];
  assert.equal(group.kind, "group");
  assert.equal(group.text, "구매 정보");
  assert.equal(group.handle, undefined); // 새 그룹은 DOM 대응이 없다.
  assert.deepEqual(group.children.map((c) => c.id), ["h-price", "p-price", "btn-buy"]);

  // 텍스트·핸들은 LLM이 아니라 원본에서 온다.
  assert.equal(index.get("btn-buy")?.text, "구매하기");
  assert.equal(index.get("btn-buy")?.kind, "button");
  assert.deepEqual(index.get("btn-buy")?.handle, { el: "btn-buy" });

  // level은 LLM 값이 아니라 새 트리의 깊이로 다시 매긴다(root=0).
  assert.equal(result.tree.level, 0);
  assert.equal(group.level, 1);
  assert.equal(group.children[0].level, 2);
  assert.equal(index.get("nav-home")?.level, 1);
});

test("applyRefinePlan: children을 생략한 ref는 원본 하위 트리를 그대로 유지한다", () => {
  const root = tree();
  const result = applyRefinePlan(root, { root: [{ ref: "main" }] }, { minKeepRatio: 0 });

  assert.equal(result.status, "refined");
  assert.deepEqual(
    result.tree.children[0].children.map((c) => c.id),
    ["h-price", "p-price", "btn-buy"],
  );
  assert.equal(result.tree.children[0].regionRole, "main", "landmark 의미도 보존한다");
});

test("applyRefinePlan: 원본 트리의 노드를 건드리지 않는다", () => {
  const root = tree();
  const before = JSON.stringify(root);
  applyRefinePlan(root, { root: [{ group: "묶음", children: [{ ref: "main" }] }] });

  assert.equal(JSON.stringify(root), before);
});

test("applyRefinePlan: 없는 id와 중복 참조는 그 항목만 버린다", () => {
  const root = tree();
  const result = applyRefinePlan(
    root,
    {
      root: [
        { ref: "h-price" },
        { ref: "존재하지-않는-id" }, // 할루시네이션
        { ref: "p-price" },
        { ref: "h-price" }, // 중복 — 핸들 1:1을 깨는 복제
        { ref: "btn-buy" },
        { ref: "nav-home" },
      ],
    },
    { minKeepRatio: 0 },
  );

  assert.equal(result.status, "refined");
  assert.deepEqual(
    result.tree.children.map((c) => c.id),
    ["h-price", "p-price", "btn-buy", "nav-home"],
  );
});

test("applyRefinePlan: ref로 이미 딸려온 하위 노드를 다시 참조하지 않는다", () => {
  const root = tree();
  const result = applyRefinePlan(
    root,
    { root: [{ ref: "main" }, { ref: "btn-buy" }] }, // btn-buy는 main 하위로 이미 들어갔다
    { minKeepRatio: 0 },
  );

  assert.equal(result.status, "refined");
  assert.equal(result.tree.children.length, 1);
  assert.equal(indexById(result.tree).get("btn-buy")?.level, 2);
});

test("applyRefinePlan: 내용이 과하게 사라지면 원본 트리를 유지한다", () => {
  const root = tree();
  const result = applyRefinePlan(root, { root: [{ ref: "nav-home" }] });

  assert.equal(result.status, "fallback");
  assert.equal(result.tree, root);
  assert.match(result.status === "fallback" ? result.reason : "", /원본 트리를 유지/);
});

test("applyRefinePlan: 계획 형식이 깨지면 원본 트리를 유지한다", () => {
  const root = tree();
  for (const raw of ["JSON이 아님", { nodes: [] }, 42, null]) {
    const result = applyRefinePlan(root, raw);
    assert.equal(result.status, "fallback", `raw=${JSON.stringify(raw)}`);
    assert.equal(result.tree, root);
  }
});

test("applyRefinePlan: 내용이 남지 않은 그룹은 만들지 않는다", () => {
  const root = tree();
  const result = applyRefinePlan(
    root,
    {
      root: [
        { group: "빈 묶음", children: [{ ref: "없는-id" }] },
        { ref: "main" },
      ],
    },
    { minKeepRatio: 0 },
  );

  assert.equal(result.status, "refined");
  assert.deepEqual(result.tree.children.map((c) => c.text), ["본문"]);
});

test("applyRefinePlan: 그룹 id는 내용 기반이라 같은 계획이면 항상 같다 (02-R P2-G 재발 방지)", () => {
  const plan = {
    root: [
      { group: "구매 정보", children: [{ ref: "btn-buy" }] },
      { group: "구매 정보", children: [{ ref: "p-price" }] }, // 라벨 충돌
      { ref: "main" },
    ],
  };
  const first = applyRefinePlan(tree(), plan, { minKeepRatio: 0 });
  const second = applyRefinePlan(tree(), plan, { minKeepRatio: 0 });

  const ids = (r: typeof first) => r.tree.children.map((c) => c.id);
  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual(ids(first).slice(0, 2), ["refine:root:구매-정보", "refine:root:구매-정보:2"]);
});

test("refineTree: 모델이 JSON 문자열로 답해도 처리한다", async () => {
  const root = tree();
  const result = await refineTree(
    root,
    fakeModel(JSON.stringify({ root: [{ ref: "main" }, { ref: "nav" }] })),
    { minKeepRatio: 0 },
  );

  assert.equal(result.status, "refined");
  assert.deepEqual(result.tree.children.map((c) => c.text), ["본문", "탐색"]);
});

test("refineTree: 모델에 보내는 문서에는 노드 id가 들어간다", async () => {
  let sent: LLMRequest | undefined;
  await refineTree(tree(), fakeModel({ root: [{ ref: "main" }] }, (r) => (sent = r)), {
    minKeepRatio: 0,
  });

  assert.match(sent!.document.text, /id="btn-buy"/);
  assert.match(sent!.system, /Never invent an id/);
});

test("refineTree: 문서가 한도보다 크면 호출 없이 원본을 쓴다", async () => {
  const root = tree();
  let called = false;
  const result = await refineTree(
    root,
    {
      async complete() {
        called = true;
        return { root: [] };
      },
    },
    { maxNodes: 2 },
  );

  assert.equal(called, false);
  assert.equal(result.status, "fallback");
  assert.equal(result.tree, root);
});

test("refineTree: 모델 호출이 실패하면 원본을 쓴다", async () => {
  const root = tree();
  const result = await refineTree(root, {
    async complete() {
      throw new Error("API 키가 없습니다.");
    },
  });

  assert.equal(result.status, "fallback");
  assert.equal(result.tree, root);
  assert.match(result.status === "fallback" ? result.reason : "", /API 키/);
});
