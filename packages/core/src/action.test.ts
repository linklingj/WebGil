// 액션 실행기 자가 검증 — 셸은 가짜로 두고 "무엇을 막고 무엇을 넘기는가"만 확인한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionExecutor } from "./action.js";
import type { Action } from "./capture-source.js";
import type { DocNode } from "./tree.js";

function node(id: string, kind: DocNode["kind"], handle?: unknown): DocNode {
  return { id, kind, level: 1, text: id, handle, children: [] };
}

function setup(nodes: DocNode[], fail?: string) {
  const executed: Action[] = [];
  const highlighted: string[] = [];
  const index = new Map(nodes.map((n) => [n.id, n]));
  const executor = new ActionExecutor(
    {
      async execute(action) {
        if (fail) throw new Error(fail);
        executed.push(action);
      },
      highlight(id) {
        highlighted.push(id);
      },
    },
    (id) => index.get(id) ?? null,
  );
  return { executor, executed, highlighted };
}

test("execute: 검증을 통과하면 셸에 위임하고 대상을 하이라이트한다", async () => {
  const { executor, executed, highlighted } = setup([node("b1", "button", {})]);

  const result = await executor.execute({ type: "click", nodeId: "b1" });

  assert.equal(result.status, "executed");
  assert.deepEqual(executed, [{ type: "click", nodeId: "b1" }]);
  assert.deepEqual(highlighted, ["b1"]);
});

test("execute: 핸들 없는 노드(그룹 버킷·폴백)와 미지의 id는 실행하지 않는다", async () => {
  const { executor, executed } = setup([node("g0", "group")]);

  assert.equal((await executor.execute({ type: "click", nodeId: "g0" })).status, "rejected");
  assert.equal((await executor.execute({ type: "click", nodeId: "없음" })).status, "rejected");
  assert.deepEqual(executed, []);
});

test("execute: 입력칸이 아닌 노드에는 값을 넣지 않는다", async () => {
  const { executor, executed } = setup([node("h1", "heading", {})]);

  const result = await executor.execute({ type: "input", nodeId: "h1", value: "x" });

  assert.equal(result.status, "rejected");
  assert.deepEqual(executed, []);
});

test("execute: 셸 오류는 던지지 않고 rejected로 돌려준다", async () => {
  const { executor, highlighted } = setup([node("b1", "button", {})], "사라진 노드");

  const result = await executor.execute({ type: "click", nodeId: "b1" });

  assert.deepEqual(result, { status: "rejected", reason: "사라진 노드" });
  assert.deepEqual(highlighted, []);
});

test("activate: 링크·버튼은 클릭, 입력칸은 포커스, 낭독 전용은 거부", async () => {
  const { executor, executed } = setup([
    node("a1", "link", {}),
    node("i1", "input", {}),
    node("t1", "text", {}),
  ]);

  assert.equal((await executor.activate("a1")).status, "executed");
  assert.equal((await executor.activate("i1")).status, "executed");
  assert.equal((await executor.activate("t1")).status, "rejected");
  assert.deepEqual(executed, [
    { type: "click", nodeId: "a1" },
    { type: "focus", nodeId: "i1" },
  ]);
});
