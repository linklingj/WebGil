// 08 부분 렌더 규칙 자가 검증 — "조상 경로 + 형제 + 자식 1단계"만 남는지.
// 실행: node --import tsx --test src/panel/tree-view.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SnapshotNode } from "@webgil/core";
import { prune } from "./tree-view.js";

function node(id: string, children: SnapshotNode[] = []): SnapshotNode {
  return { id, kind: "text", level: 0, text: id, children };
}

/** 트리를 "id(자식,자식)" 문자열로 눌러 비교하기 쉽게 만든다. */
function shape(node: SnapshotNode): string {
  return node.children.length ? `${node.id}(${node.children.map(shape).join(",")})` : node.id;
}

const tree = node("root", [
  node("본문", [
    node("공지", [node("공지-1"), node("공지-2")]),
    node("소식", [node("소식-1")]),
  ]),
  node("메뉴", [node("로그인")]),
]);

test("prune: 커서의 조상 경로·형제·자식 1단계만 남긴다", () => {
  assert.equal(
    shape(prune(tree, "공지")),
    "root(본문(공지(공지-1,공지-2),소식))",
    "조상(본문)은 경로만, 형제(소식)는 자식 없이, 커서(공지)는 자식 1단계까지",
  );
  assert.equal(shape(prune(tree, "공지-1")), "root(본문(공지(공지-1,공지-2)))", "한 단계 내려가면 손자 세대가 보인다");
  assert.equal(shape(prune(tree, "메뉴")), "root(본문,메뉴(로그인))", "최상위 커서는 최상위 형제와 자기 자식");
});

test("prune: 커서가 없거나 사라진 id면 최상위만 보여준다", () => {
  assert.equal(shape(prune(tree, null)), "root(본문,메뉴)");
  assert.equal(shape(prune(tree, "없는-노드")), "root(본문,메뉴)", "스냅샷이 어긋나도 빈 화면이 되지 않는다");
});

test("prune: 형제가 많으면 커서 주변 창(window)만 남긴다", () => {
  const many = node("root", [node("목록", Array.from({ length: 100 }, (_, i) => node(`항목-${i}`)))]);
  const visible = prune(many, "항목-50").children[0].children;

  assert.equal(visible.length, 25, "±12 + 커서");
  assert.equal(visible[0].id, "항목-38");
  assert.equal(visible.at(-1)!.id, "항목-62");
  // 끝쪽 커서에서도 창 크기는 유지된다(잘려서 5개만 남는 일이 없다).
  const atEnd = prune(many, "항목-99").children[0].children;
  assert.equal(atEnd.length, 25);
  assert.equal(atEnd.at(-1)!.id, "항목-99");
});
