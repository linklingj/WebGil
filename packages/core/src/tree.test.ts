// 03 문서 트리 모델 자가 검증 — 순수 트리 연산(id 조회 인덱스).
// 실행: node --import tsx --test src/tree.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexById, type DocNode } from "./tree.js";

function node(id: string, children: DocNode[] = []): DocNode {
  return { id, kind: "text", level: 0, text: id, children };
}

test("indexById: 모든 노드를 id로 되짚는다 (root 포함, 깊이 무관)", () => {
  const root = node("root", [node("a", [node("a1")]), node("b")]);
  const index = indexById(root);
  assert.equal(index.size, 4, "root+a+a1+b = 4개");
  assert.equal(index.get("a1")!.text, "a1", "깊은 노드도 조회된다");
  assert.equal(index.get("b")!.id, "b");
  assert.equal(index.get("nope"), undefined, "없는 id는 undefined → 커서 폴백 신호");
});
