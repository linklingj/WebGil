import assert from "node:assert/strict";
import { test } from "node:test";
import { NavigationEngine } from "./navigation.js";
import type { DocNode } from "./tree.js";

function node(
  id: string,
  text: string,
  children: DocNode[] = [],
  regionRole?: DocNode["regionRole"],
): DocNode {
  return { id, kind: "heading", level: 0, text, children, regionRole };
}

function sampleTree(): DocNode {
  return node("root", "(문서)", [
    node("intro", "소개", [node("history", "연혁"), node("team", "팀")]),
    node("news", "소식"),
  ]);
}

test("초기 위치에서 같은 레벨을 순회하고 경계에서는 멈춘다", () => {
  const nav = new NavigationEngine(sampleTree());
  assert.equal(nav.current?.id, "intro");

  const next = nav.next();
  assert.deepEqual({ status: next.status, id: next.node?.id, index: next.index, count: next.count }, {
    status: "moved", id: "news", index: 1, count: 2,
  });

  const end = nav.next();
  assert.equal(end.status, "boundary");
  assert.equal(end.node?.id, "news");

  assert.equal(nav.previous().node?.id, "intro");
  assert.equal(nav.previous().status, "boundary");
});

test("semantic main이 있으면 본문의 첫 항목에서 시작하고 reset도 그 위치로 돌아간다", () => {
  const root = node("root", "(문서)", [
    node("nav", "탐색", [node("nav-home", "홈")], "navigation"),
    node("main", "본문", [node("title", "서비스 소개"), node("body", "본문 내용")], "main"),
    node("footer", "바닥글", [node("terms", "이용 약관")], "contentinfo"),
  ]);
  const nav = new NavigationEngine(root);

  assert.equal(nav.current?.id, "title", "사용자는 메뉴가 아니라 본문 첫 항목을 먼저 만난다");
  assert.equal(nav.next().node?.id, "body");
  assert.equal(nav.back().node?.id, "main", "본문 영역으로 돌아가 다른 최상위 영역도 탐색할 수 있다");
  assert.equal(nav.reset().node?.id, "title");
});

test("LLM 재구성이 main을 그룹으로 감싸도 본문의 첫 항목에서 시작한다", () => {
  const root = node("root", "(문서)", [
    node("page-content", "페이지 내용", [
      node("main", "본문", [node("title", "서비스 소개")], "main"),
    ]),
    node("nav", "탐색", [node("nav-home", "홈")], "navigation"),
  ]);

  assert.equal(new NavigationEngine(root).current?.id, "title");
});

test("enter와 back은 자식의 첫 노드와 부모 노드 사이를 이동한다", () => {
  const nav = new NavigationEngine(sampleTree());
  assert.equal(nav.enter().node?.id, "history");
  assert.equal(nav.next().node?.id, "team");
  assert.equal(nav.back().node?.id, "intro");
  assert.equal(nav.back().status, "boundary", "최상위에서는 root를 노출하지 않는다");
});

test("자식이 없는 노드는 진입할 수 없고 빈 트리는 항상 empty 결과를 낸다", () => {
  const nav = new NavigationEngine(sampleTree());
  nav.next();
  assert.equal(nav.enter().status, "boundary");

  const empty = new NavigationEngine(node("root", "(문서)"));
  const result = empty.handle("next");
  assert.deepEqual(result, { status: "empty", node: null, previous: null, index: -1, count: 0 });
});

test("새 스냅샷에도 같은 id가 있으면 현재 위치를 유지한다", () => {
  const nav = new NavigationEngine(sampleTree());
  nav.enter();
  nav.next();
  const refreshed = node("root2", "(문서)", [
    node("intro", "소개", [node("history", "연혁"), node("team", "팀 (갱신)")]),
  ]);

  const result = nav.replaceTree(refreshed);
  assert.equal(result.node?.id, "team");
  assert.equal(result.node?.text, "팀 (갱신)");
});

test("현재 노드가 사라지면 가장 가까운 조상으로 복귀한다", () => {
  const nav = new NavigationEngine(sampleTree());
  nav.enter();
  nav.next();
  const refreshed = node("root2", "(문서)", [node("intro", "소개", [node("history", "연혁")])]);

  assert.equal(nav.replaceTree(refreshed).node?.id, "intro");
});
