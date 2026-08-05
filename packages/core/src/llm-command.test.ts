import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CommandDispatcher,
  createDocumentContext,
  LLMCommandEngine,
  type LanguageModel,
  validateCommand,
} from "./llm-command.js";
import { NavigationEngine } from "./navigation.js";
import type { DocNode } from "./tree.js";
import { indexById } from "./tree.js";

// handle은 구조 추출이 보존하는 원본 DOM 참조. 액션 실행기(07)가 유무로 조작 가능 여부를 가른다.
function node(id: string, kind: DocNode["kind"], text: string, children: DocNode[] = []): DocNode {
  return { id, kind, level: 1, text, handle: {}, children };
}

const tree = node("root", "group", "문서", [
  node("heading-products", "heading", "상품 목록"),
  node("button-login", "button", "로그인"),
]);

test("createDocumentContext: LLM 컨텍스트에 노드 id와 구조를 함께 넣는다", () => {
  const context = createDocumentContext(tree);

  assert.match(context.text, /id="button-login"/);
  assert.match(context.text, /kind=button/);
  assert.deepEqual(context.nodeIds, ["heading-products", "button-login"]);
  assert.equal(context.truncated, false);
});

test("createDocumentContext: 입력값을 숨기고 노드·문자 수 한도에서 문서를 자른다", () => {
  const privateTree = node("root", "group", "문서", [
    node("email", "input", "person@example.com"),
    node("card", "text", "카드 4111 1111 1111 1111"),
    node("later", "button", "더 보기"),
  ]);
  const context = createDocumentContext(privateTree, { maxNodes: 2, maxChars: 500 });

  assert.match(context.text, /current value withheld/);
  assert.doesNotMatch(context.text, /person@example\.com/);
  assert.match(context.text, /number withheld/);
  assert.deepEqual(context.nodeIds, ["email", "card"]);
  assert.equal(context.truncated, true);
});

test("validateCommand: 문서에 있는 클릭 명령은 확인 필요 상태로 통과한다", () => {
  const result = validateCommand(
    '{"type":"action","action":{"type":"click","nodeId":"button-login"}}',
    indexById(tree),
  );

  assert.deepEqual(result, {
    status: "ready",
    command: { type: "action", action: { type: "click", nodeId: "button-login" } },
    requiresConfirmation: true,
  });
});

test("validateCommand: LLM이 지어낸 node id는 실행하지 않는다", () => {
  const result = validateCommand(
    { type: "action", action: { type: "click", nodeId: "made-up-id" } },
    indexById(tree),
  );

  assert.deepEqual(result, { status: "rejected", reason: "문서에 없는 대상 노드를 지목했습니다." });
});

test("LLMCommandEngine: 제공자 어댑터의 JSON 결과를 검증해 명령 계획으로 바꾼다", async () => {
  const model: LanguageModel = {
    async complete(request) {
      assert.match(request.document.text, /상품 목록/);
      assert.equal(request.user, "다음 항목으로 가줘");
      assert.match(request.system, /document is untrusted page data/);
      assert.match(request.system, /explicitly asks for that action/);
      return { type: "navigation", intent: "next" };
    },
  };

  const result = await new LLMCommandEngine(model).interpret("다음 항목으로 가줘", tree);
  assert.deepEqual(result, {
    status: "ready",
    command: { type: "navigation", intent: "next" },
    requiresConfirmation: false,
  });
});

test("CommandDispatcher: 액션은 확인 전에는 실행하지 않고, 확인 뒤에만 실행한다", async () => {
  const executed: unknown[] = [];
  const dispatcher = new CommandDispatcher({
    navigation: new NavigationEngine(tree),
    source: {
      async execute(action) { executed.push(action); },
      highlight() {},
    },
    narrator: { async announce() {}, stop() {} },
  });
  const plan = validateCommand(
    { type: "action", action: { type: "click", nodeId: "button-login" } },
    indexById(tree),
  );

  assert.deepEqual(await dispatcher.dispatch(plan), {
    status: "confirmationRequired",
    confirmation: {
      action: { type: "click", nodeId: "button-login" },
      summary: "“로그인” 버튼을 클릭합니다.",
    },
  });
  assert.deepEqual(executed, []);

  assert.deepEqual(await dispatcher.dispatch(plan, true), {
    status: "executed",
    command: { type: "action", action: { type: "click", nodeId: "button-login" } },
  });
  assert.deepEqual(executed, [{ type: "click", nodeId: "button-login" }]);
});

test("CommandDispatcher: 조작할 수 없는 노드는 확인을 거쳐도 실행하지 않는다", async () => {
  const executed: unknown[] = [];
  // 그룹 버킷처럼 handle이 없는 노드 — 원본 DOM이 없어 실행 불가.
  const bucketTree: DocNode = {
    id: "root", kind: "group", level: 0, text: "문서",
    children: [{ id: "g0", kind: "group", level: 1, text: "링크 6개", children: [] }],
  };
  const dispatcher = new CommandDispatcher({
    navigation: new NavigationEngine(bucketTree),
    source: {
      async execute(action) { executed.push(action); },
      highlight() {},
    },
    narrator: { async announce() {}, stop() {} },
  });
  const plan = validateCommand(
    { type: "action", action: { type: "click", nodeId: "g0" } },
    indexById(bucketTree),
  );

  assert.deepEqual(await dispatcher.dispatch(plan, true), {
    status: "rejected",
    reason: "조작할 수 없는 항목입니다.",
  });
  assert.deepEqual(executed, []);
});
