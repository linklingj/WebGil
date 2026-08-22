// ExtensionSource 자가 검증 — jsdom으로 실제 DOM을 세워 핵심 로직만 확인한다.
// 대상: role/accessible name 추출, id 부여로 노드 재식별, input 액션의 네이티브 setter + 이벤트.
// 실행: node --import tsx --test
// (jsdom엔 레이아웃이 없어 getBoundingClientRect가 0이다 — highlight 검증은 좌표를 직접 심어서 한다)
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ActionExecutor, NavigationEngine, extractTree } from "@webgil/core";
import { ExtensionSource, accessibleName, roleOf } from "./extension-source.js";

function setup(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return new ExtensionSource(dom.window.document as unknown as Document);
}

test("getAXTree: heading·link·button의 role/name/level을 뽑는다", () => {
  const src = setup(`
    <h2>제목</h2>
    <a href="/login">로그인</a>
    <button aria-label="메뉴 열기"></button>
  `);
  const ax = src.getAXTree();
  const byRole = Object.fromEntries(ax.map((n) => [n.role, n]));

  assert.equal(byRole.heading.name, "제목");
  assert.equal(byRole.heading.level, 2);
  assert.equal(byRole.link.name, "로그인");
  assert.equal(byRole.button.name, "메뉴 열기"); // aria-label 우선
});

test("accessibleName: input은 연결된 label을, 없으면 placeholder를 쓴다", () => {
  const dom = new JSDOM(
    `<!doctype html><body>
      <label for="q">검색어</label><input id="q">
      <input id="p" placeholder="이메일">
    </body>`,
  );
  const doc = dom.window.document;
  assert.equal(accessibleName(doc.getElementById("q")!), "검색어");
  assert.equal(accessibleName(doc.getElementById("p")!), "이메일");
  assert.equal(roleOf(doc.getElementById("q")!), "textbox");
});

test("execute(input): 네이티브 setter로 값을 넣고 input 이벤트를 발생시킨다", async () => {
  const dom = new JSDOM(`<!doctype html><body><input id="f"></body>`);
  const src = new ExtensionSource(dom.window.document as unknown as Document);
  const ax = src.getAXTree();
  const field = ax.find((n) => n.role === "textbox")!;

  const input = dom.window.document.getElementById("f") as HTMLInputElement;
  let fired = false;
  input.addEventListener("input", () => (fired = true));

  await src.execute({ type: "input", nodeId: field.id, value: "안녕" });
  assert.equal(input.value, "안녕");
  assert.equal(fired, true);
});

test("execute(input): contenteditable 영역에도 값을 넣고 이벤트를 발생시킨다", async () => {
  const dom = new JSDOM(`<!doctype html><body><div id="editor" contenteditable="true"></div></body>`);
  const src = new ExtensionSource(dom.window.document as unknown as Document);
  const field = src.getAXTree()[0];
  const editor = dom.window.document.getElementById("editor")!;
  let fired = false;
  editor.addEventListener("input", () => (fired = true));

  await src.execute({ type: "input", nodeId: field.id, value: "메모" });
  assert.equal(editor.textContent, "메모");
  assert.equal(fired, true);
});

test("execute: 알 수 없는 노드 id는 에러를 던진다", async () => {
  const src = setup(`<button>x</button>`);
  await assert.rejects(() => src.execute({ type: "click", nodeId: "없음" }));
});

// 구조 추출(02)→커서(04)→액션 실행기(07)→셸이 같은 노드를 가리키는지 확인한다.
// 코어가 붙인 id로 셸이 원본 Element를 되찾지 못하면 실행 경로 전체가 조용히 깨진다.
test("액션 실행기: 커서가 가리키는 노드를 실제 페이지에서 클릭한다", async () => {
  const dom = new JSDOM(`<!doctype html><body><h2>계정</h2><button id="b">로그인</button></body>`);
  const doc = dom.window.document as unknown as Document;
  const src = new ExtensionSource(doc);
  const navigation = new NavigationEngine(extractTree(doc));
  const actions = new ActionExecutor(src, (id) => navigation.nodeById(id));

  let clicked = false;
  dom.window.document.getElementById("b")!.addEventListener("click", () => (clicked = true));

  navigation.handle("enter"); // "계정" 헤딩 아래의 로그인 버튼으로
  const current = navigation.current!;
  assert.equal(current.text, "로그인");

  assert.deepEqual(await actions.activate(current.id), {
    status: "executed",
    action: { type: "click", nodeId: current.id },
  });
  assert.equal(clicked, true);
});

/** jsdom엔 레이아웃도 scrollIntoView도 없다. 하이라이트 판단에 필요한 것만 심어 준다. */
function highlightSetup(rect: { top: number; height: number }) {
  const dom = new JSDOM(`<!doctype html><body><p id="target">본문</p></body>`);
  const { window } = dom;
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });

  const target = window.document.querySelector<HTMLElement>("#target")!;
  target.getBoundingClientRect = () =>
    ({ x: 0, y: rect.top, top: rect.top, bottom: rect.top + rect.height, left: 0, right: 300, width: 300, height: rect.height, toJSON: () => ({}) }) as DOMRect;

  const scrolls: unknown[] = [];
  (target as unknown as { scrollIntoView: (options?: unknown) => void }).scrollIntoView = (options) => scrolls.push(options);

  const source = new ExtensionSource(window.document as unknown as Document);
  const id = source.getAXTree().find((node) => node.name === "본문")?.id
    ?? target.getAttribute("data-webgil-id")!;
  return { source, target, scrolls, id: target.getAttribute("data-webgil-id") ?? id };
}

test("highlight: 화면 밖 노드는 보이도록 스크롤한다", () => {
  const { source, scrolls, id } = highlightSetup({ top: 900, height: 40 }); // 뷰포트(600) 아래
  source.highlight(id);
  assert.deepEqual(scrolls, [{ block: "center", inline: "nearest" }]);
});

test("highlight: 이미 보이는 노드는 화면을 흔들지 않는다", () => {
  const { source, scrolls, id } = highlightSetup({ top: 100, height: 40 });
  source.highlight(id);
  assert.deepEqual(scrolls, [], "보이는데 스크롤하면 읽던 위치만 흐트러진다");
});

test("highlight: 한 화면에 안 담기는 큰 영역은 그냥 둔다", () => {
  const { source, scrolls, id } = highlightSetup({ top: -200, height: 2000 });
  source.highlight(id);
  assert.deepEqual(scrolls, [], "어디로 맞춰도 잘리므로 건드리지 않는다");
});
