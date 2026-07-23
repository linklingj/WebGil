// 구조 추출 엔진 자가 검증 — jsdom으로 DOM을 세워 계층·정리 규칙을 확인한다.
// 실행: node --import tsx --test src/structure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { extractTree, treeStats, type DocNode } from "./structure.js";

function tree(html: string): DocNode {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return extractTree(dom.window.document as unknown as Document);
}

function find(n: DocNode, text: string): DocNode | undefined {
  if (n.text === text) return n;
  for (const c of n.children) {
    const hit = find(c, text);
    if (hit) return hit;
  }
  return undefined;
}

test("헤딩 레벨로 계층을 세운다 (H2>H3, 다음 H2는 형제)", () => {
  const root = tree(`
    <h1>문서 제목</h1>
    <h2>가</h2>
      <h3>가-1</h3>
      <p>본문</p>
    <h2>나</h2>
  `);
  const h1 = find(root, "문서 제목")!;
  const ga = find(root, "가")!;
  const ga1 = find(root, "가-1")!;
  assert.equal(h1.children.includes(ga), true, "H2는 H1의 자식");
  assert.equal(ga.children.includes(ga1), true, "H3은 앞 H2의 자식");
  assert.equal(find(root, "나")!.children.length, 0, "다음 H2는 형제라 가-1을 안 품는다");
});

test("leaf는 가장 가까운 열린 섹션(헤딩)에 붙는다 + handle 보존", () => {
  const root = tree(`<h2>로그인</h2><a href="/login">로그인 링크</a>`);
  const h = find(root, "로그인")!;
  const link = h.children.find((c) => c.kind === "link")!;
  assert.equal(link.text, "로그인 링크");
  assert.ok(link.handle, "규칙 경로는 원본 Element handle을 보존한다");
});

test("landmark는 최상위 영역 그룹이 되고 이후 콘텐츠를 담는다", () => {
  const root = tree(`
    <nav><a href="/a">메뉴A</a></nav>
    <main><h2>본문 제목</h2></main>
  `);
  const groups = root.children.filter((c) => c.kind === "group");
  assert.deepEqual(groups.map((g) => g.text), ["탐색", "본문"], "명시 라벨 없으면 role 라벨");
  const main = groups[1];
  assert.equal(main.children[0].text, "본문 제목", "main이 이후 헤딩을 담는다");
});

test("section 안에 중첩된 header는 가짜 영역을 만들지 않는다(캐러셀 스팸 방지)", () => {
  const root = tree(`
    <main>
      <section><header><h2>추천 숙소</h2></header><a href="/a">숙소A</a></section>
      <section><header><h2>인기 레저</h2></header><a href="/b">레저B</a></section>
    </main>
  `);
  const groups = root.children.filter((c) => c.kind === "group");
  assert.equal(groups.length, 1, "landmark 그룹은 main 하나뿐 — 중첩 header는 영역이 아니다");
  assert.equal(groups[0].text, "본문");
  assert.ok(find(root, "추천 숙소") && find(root, "인기 레저"), "두 헤딩 모두 main 아래로");
});

test("같은 kind leaf가 많으면 하나의 그룹으로 묶어 개수를 줄인다", () => {
  const links = Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">상품${i}</a>`).join("");
  const root = tree(`<main>${links}</main>`);
  const main = root.children[0];
  const bucket = main.children.find((c) => c.kind === "group");
  assert.ok(bucket, "12개 링크는 그룹으로 묶인다");
  assert.equal(bucket!.children.length, 12);
  assert.match(bucket!.text, /링크 12개/);
  assert.ok(main.children.length < 12, "최상위 개수가 줄어든다");
});

test("빈 이름 링크·중복 leaf·빈 그룹을 정리한다", () => {
  const root = tree(`
    <main>
      <a href="/x">홈</a>
      <a href="/x">홈</a>
      <a href="/i"></a>
      <nav></nav>
    </main>
  `);
  const main = root.children[0];
  const homes = [];
  const collect = (n: DocNode) => { if (n.text === "홈") homes.push(n); n.children.forEach(collect); };
  collect(main);
  assert.equal(homes.length, 1, "중복 '홈' 링크는 하나만 남는다");
  assert.equal(find(root, "") ?? null, null, "빈 이름 노드는 없다");
});

test("treeStats: 총계·최상위·깊이를 센다", () => {
  const root = tree(`<h1>A</h1><h2>B</h2><a href="/c">C</a>`);
  const s = treeStats(root);
  assert.equal(s.topLevel, 1, "최상위는 H1 하나");
  assert.ok(s.total >= 3);
  assert.ok(s.maxDepth >= 3, "A>B>C 깊이");
});
