// 구조 추출 엔진 자가 검증 — jsdom으로 DOM을 세워 계층·정리 규칙을 확인한다.
// 실행: node --import tsx --test src/structure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { extractTree } from "./structure.js";
import { treeStats, type DocNode } from "./tree.js";

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

test("본문 landmark를 첫 최상위 영역으로 두고 이후 콘텐츠를 담는다", () => {
  const root = tree(`
    <nav><a href="/a">메뉴A</a></nav>
    <main><h2>본문 제목</h2></main>
  `);
  const groups = root.children.filter((c) => c.kind === "group");
  assert.deepEqual(groups.map((g) => g.text), ["본문", "탐색"], "본문을 chrome보다 먼저 둔다");
  const main = groups[0];
  assert.equal(main.regionRole, "main", "원래 landmark 역할도 보존한다");
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

test("빈 이름 링크·빈 그룹은 정리하고, 같은 이름의 조작 항목은 보존한다", () => {
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
  assert.equal(homes.length, 2, "서로 다른 위치의 '홈' 링크는 모두 남는다");
  assert.equal(find(root, "") ?? null, null, "빈 이름 노드는 없다");
});

test("div/span만으로 만든 본문도 한 번만 추출한다", () => {
  const root = tree(`<main><div class="article"><span>의미 태그 없이 작성한 본문입니다.</span></div></main>`);
  const main = root.children[0];
  const texts = main.children.filter((node) => node.kind === "text");

  assert.deepEqual(texts.map((node) => node.text), ["의미 태그 없이 작성한 본문입니다."]);
});

test("여러 div 본문은 하나의 거대 문장으로 합치지 않는다", () => {
  const root = tree(`
    <main><div class="layout"><div>첫 번째 안내입니다.</div><div>두 번째 안내입니다.</div></div></main>
  `);
  const texts = root.children[0].children.filter((node) => node.kind === "text");

  assert.deepEqual(texts.map((node) => node.text), ["첫 번째 안내입니다.", "두 번째 안내입니다."]);
});

test("한 글자 본문과 ARIA 조작 요소를 생략하지 않는다", () => {
  const root = tree(`
    <main>
      <p>A</p><p>7</p>
      <button role="tab">개요</button>
      <div role="switch" aria-label="알림"></div>
      <div contenteditable="true" aria-label="메모"></div>
    </main>
  `);
  const main = root.children[0];
  const collect = (kind: DocNode["kind"]) => main.children.filter((node) => node.kind === kind);

  assert.deepEqual(collect("text").map((node) => node.text), ["A", "7"]);
  assert.deepEqual(collect("button").map((node) => node.text), ["개요", "알림"]);
  assert.deepEqual(collect("input").map((node) => node.text), ["메모"]);
});

test("본문 문단이 헤딩 아래 텍스트 노드로 들어간다", () => {
  const root = tree(`
    <h2>소개</h2>
    <p>스크린 리더는 화면 낭독 소프트웨어다.</p>
    <p>두 번째 문단이다.</p>
  `);
  const section = find(root, "소개")!;
  const texts = section.children.filter((c) => c.kind === "text");

  assert.deepEqual(texts.map((t) => t.text), [
    "스크린 리더는 화면 낭독 소프트웨어다.",
    "두 번째 문단이다.",
  ]);
  assert.ok(texts[0].handle, "본문도 원본 Element handle을 보존한다");
});

test("문단 중간의 링크는 문장에 포함해 읽고, 링크 노드로도 따로 남는다", () => {
  const root = tree(`<main><p>자세한 내용은 <a href="/docs">문서</a>를 보라.</p></main>`);
  const main = root.children[0];

  assert.equal(find(main, "자세한 내용은 문서를 보라.")?.kind, "text", "문장이 끊기지 않는다");
  assert.ok(
    main.children.some((c) => c.kind === "link" && c.text === "문서"),
    "링크는 조작 가능한 노드로 따로 남는다",
  );
});

test("본문 안에서 숨겨진 자식 텍스트는 읽지 않는다", () => {
  const root = tree(`<main><p>보이는 내용<span aria-hidden="true">숨겨진 내용</span>입니다.</p></main>`);

  assert.equal(root.children[0].children[0].text, "보이는 내용입니다.");
});

test("링크만 든 목록 껍데기는 버리고 설명이 있는 항목은 남긴다", () => {
  const root = tree(`
    <main>
      <ul>
        <li><a href="/a">메뉴A</a></li>
        <li><a href="/b">메뉴B</a></li>
        <li>준비 중인 항목</li>
      </ul>
    </main>
  `);
  const main = root.children[0];
  const texts: DocNode[] = [];
  const collect = (n: DocNode) => { if (n.kind === "text") texts.push(n); n.children.forEach(collect); };
  collect(main);

  assert.deepEqual(texts.map((t) => t.text), ["준비 중인 항목"]);
});

test("중첩 블록은 안쪽 노드로만 들어간다(같은 문장 중복 금지)", () => {
  const root = tree(`<main><li>바깥 항목<p>안쪽 문단</p></li></main>`);
  const texts: DocNode[] = [];
  const collect = (n: DocNode) => { if (n.kind === "text") texts.push(n); n.children.forEach(collect); };
  collect(root);

  assert.deepEqual(texts.map((t) => t.text).sort(), ["바깥 항목", "안쪽 문단"]);
});

test("긴 본문은 자르지 않는다(낭독 분할은 TTS의 몫)", () => {
  const long = "가".repeat(500);
  const root = tree(`<main><p>${long}</p></main>`);

  assert.equal(find(root, long)?.text.length, 500);
});

test("본문 문단은 그룹 버킷으로 묶지 않는다", () => {
  const paras = Array.from({ length: 12 }, (_, i) => `<p>문단 ${i} 내용</p>`).join("");
  const root = tree(`<main>${paras}</main>`);
  const main = root.children[0];

  assert.equal(main.children.filter((c) => c.kind === "text").length, 12);
  assert.equal(main.children.some((c) => c.kind === "group"), false, "문단은 버킷에 숨지 않는다");
});

test("표는 별도 계층 없이 헤더·셀을 DOM 읽기 순서대로 남긴다", () => {
  const root = tree(`
    <main>
      <table>
        <caption>공모전 상금 안내</caption>
        <thead>
          <tr><th scope="col">과제</th><th scope="colgroup" colspan="2">상점</th></tr>
          <tr><th scope="col">구분</th><th scope="col">학생</th><th scope="col">일반</th></tr>
        </thead>
        <tbody>
          <tr><th scope="row" rowspan="2">자유과제</th><td>1점</td><td>1점</td></tr>
          <tr><td>1점</td><td>1점</td></tr>
        </tbody>
      </table>
    </main>
  `);
  const main = root.children.find((node) => node.regionRole === "main")!;
  const text = main.children.filter((node) => node.kind === "text");

  assert.deepEqual(
    text.map((node) => node.text),
    ["과제", "상점", "구분", "학생", "일반", "자유과제", "1점", "1점", "1점", "1점"],
  );
  assert.equal(text.filter((node) => node.text === "1점").length, 4, "반복된 값도 모두 보존한다");
  assert.ok(text.every((node) => node.handle), "표 셀도 하이라이트할 원본 handle을 보존한다");
});

test("표의 빈 셀은 건너뛰고 셀 안 조작 항목은 일반 링크로 남긴다", () => {
  const root = tree(`
    <main>
      <table aria-label="신청 현황">
        <tr><th scope="col">상태</th><th scope="col">상세</th></tr>
        <tr><td></td><td><a href="/detail">자세히 보기</a></td></tr>
      </table>
    </main>
  `);
  const main = root.children.find((node) => node.regionRole === "main")!;
  assert.deepEqual(main.children.map((node) => [node.kind, node.text]), [
    ["text", "상태"],
    ["text", "상세"],
    ["link", "자세히 보기"],
  ]);
  assert.ok(find(root, "자세히 보기")?.handle, "표 안 링크도 실행할 원본 handle을 보존한다");
});

test("treeStats: 총계·최상위·깊이를 센다", () => {
  const root = tree(`<h1>A</h1><h2>B</h2><a href="/c">C</a>`);
  const s = treeStats(root);
  assert.equal(s.topLevel, 1, "최상위는 H1 하나");
  assert.ok(s.total >= 3);
  assert.ok(s.maxDepth >= 3, "A>B>C 깊이");
});

test("버튼 안의 글은 형제가 아니라 버튼 자신의 내용이다", () => {
  const root = tree(`
    <h2>안내</h2>
    <button type="button"><div class="label">대회 운영 규정</div></button>
  `);
  const section = find(root, "안내")!;
  const button = section.children.find((c) => c.kind === "button")!;

  assert.equal(button.text, "대회 운영 규정");
  assert.equal(
    section.children.filter((c) => c.kind === "text").length,
    0,
    "버튼 옆에 같은 글이 또 놓이지 않는다",
  );
  assert.equal(button.children.length, 0, "라벨을 되풀이하는 한 덩어리는 자식으로도 두지 않는다");
});

test("여러 덩어리를 품은 링크는 그 덩어리들을 자식으로 가진다", () => {
  const root = tree(`
    <h2>안내</h2>
    <a href="/rules">
      <h3>대회 운영 규정</h3>
      <p>참가 자격과 심사 기준을 안내합니다.</p>
    </a>
    <p>문의는 메일로 받습니다.</p>
  `);
  const section = find(root, "안내")!;
  const link = section.children.find((c) => c.kind === "link")!;

  assert.deepEqual(
    link.children.map((c) => c.text),
    ["대회 운영 규정", "참가 자격과 심사 기준을 안내합니다."],
    "제목과 설명이 링크 아래로 들어간다",
  );
  assert.equal(find(section, "문의는 메일로 받습니다.")!.level, link.level, "링크 밖 본문은 그대로 형제");
  assert.equal(
    link.children.some((c) => c.text === "문의는 메일로 받습니다."),
    false,
    "링크 안 헤딩이 섹션을 열어 뒷 내용을 빨아들이지 않는다",
  );
});
