import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CommandDispatcher,
  createDocumentContext,
  LLMCommandEngine,
  MAX_REPLY_LENGTH,
  toSpokenReply,
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

test("toSpokenReply: 마크다운 서식을 벗겨 말로 읽을 문장만 남긴다", () => {
  const raw = [
    "## 요약",
    "- **가격**은 1만 원입니다.",
    "- 자세한 내용은 [공지](https://example.com/notice)를 보세요.",
    "```js\nconsole.log(1)\n```",
  ].join("\n");

  assert.equal(
    toSpokenReply(raw),
    "요약 가격은 1만 원입니다. 자세한 내용은 공지를 보세요.",
    "제목·목록 기호·강조·링크 주소·코드 블록은 소리로 읽을 게 아니다",
  );
});

test("toSpokenReply: 250자를 넘기면 문장 끝에서 자른다", () => {
  const sentence = "가격 정보를 안내합니다. ";
  const reply = toSpokenReply(sentence.repeat(30));

  assert.ok(reply.length <= MAX_REPLY_LENGTH, `${reply.length}자`);
  assert.ok(reply.endsWith("."), "말이 중간에 끊기지 않는다");
});

test("toSpokenReply: 문장 끝이 없으면 말줄임으로 마무리한다", () => {
  const reply = toSpokenReply("가".repeat(400));

  assert.ok(reply.length <= MAX_REPLY_LENGTH);
  assert.ok(reply.endsWith("…"));
});

test("validateCommand: answer·clarify도 낭독용으로 다듬어 통과시킨다", () => {
  const nodes = indexById(tree);
  const answer = validateCommand({ type: "answer", text: "**로그인** 버튼이 있습니다." }, nodes);
  assert.deepEqual(answer, {
    status: "ready",
    requiresConfirmation: false,
    command: { type: "answer", text: "로그인 버튼이 있습니다." },
  });

  const clarify = validateCommand({ type: "clarify", question: "## 어느 버튼을 누를까요?" }, nodes);
  assert.equal(clarify.status === "ready" && clarify.command.type === "clarify" && clarify.command.question, "어느 버튼을 누를까요?");
  assert.equal(validateCommand({ type: "answer", text: "**  **" }, nodes).status, "rejected", "서식만 남은 답은 빈 응답");
});

test("LLMCommandEngine: 답변 형식 규칙을 프롬프트로 강제한다", async () => {
  let seen = "";
  const model: LanguageModel = {
    async complete(request) {
      seen = request.system;
      return { type: "answer", text: "네." };
    },
  };
  await new LLMCommandEngine(model).interpret("이 페이지 요약해줘", tree);

  assert.match(seen, /read aloud/, "화면이 아니라 소리로 나간다고 알린다");
  assert.match(seen, /no markdown/);
  assert.match(seen, new RegExp(`under ${MAX_REPLY_LENGTH} characters`));
});
