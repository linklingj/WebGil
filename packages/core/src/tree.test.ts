// 03 문서 트리 모델 자가 검증 — 순수 트리 연산(id 조회 인덱스).
// 실행: node --import tsx --test src/tree.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexById, searchTree, toSnapshot, type DocNode } from "./tree.js";

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

test("toSnapshot: handle을 떼어내 전송 가능한 트리로 만든다", () => {
  const element = { tagName: "A" }; // 구조화 복제가 안 되는 DOM 핸들 대역
  const root: DocNode = { ...node("root"), children: [{ ...node("a"), handle: element, children: [node("a1")] }] };
  const snapshot = toSnapshot(root);

  assert.equal("handle" in snapshot.children[0], false, "깊이 1의 handle이 사라진다");
  assert.equal("handle" in snapshot.children[0].children[0], false, "자식도 재귀적으로 벗겨진다");
  assert.equal(snapshot.children[0].id, "a", "id·텍스트 등 나머지는 그대로 남는다");
  assert.equal(root.children[0].handle, element, "원본 트리는 건드리지 않는다");
  assert.doesNotThrow(() => structuredClone(snapshot), "메시지로 보낼 수 있다");
});

test("searchTree: 부분 일치를 접두 우선으로 돌려주고 경로를 채운다", () => {
  const root: DocNode = node("root", [
    node("본문", [node("공지사항"), node("지난 공지")]),
    node("메뉴", [node("로그인")]),
  ]);
  const hits = searchTree(toSnapshot(root), "공지");

  assert.deepEqual(hits.map((h) => h.id), ["공지사항", "지난 공지"], "접두 일치가 먼저");
  assert.deepEqual(hits[0].path, ["본문"], "조상 텍스트가 경로로 붙는다");
  assert.equal(searchTree(toSnapshot(root), "  ").length, 0, "공백만 입력하면 결과 없음");
  assert.equal(searchTree(toSnapshot(root), "로그인")[0].id, "로그인", "본문 밖 노드도 찾는다");
  assert.equal(searchTree(toSnapshot(root), "공지", 1).length, 1, "limit로 자른다");
});
