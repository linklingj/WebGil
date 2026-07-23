// ExtensionSource 자가 검증 — jsdom으로 실제 DOM을 세워 핵심 로직만 확인한다.
// 대상: role/accessible name 추출, id 부여로 노드 재식별, input 액션의 네이티브 setter + 이벤트.
// 실행: node --import tsx --test  (getBoundingClientRect는 jsdom이 0을 반환하므로 highlight는 제외)
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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

test("execute: 알 수 없는 노드 id는 에러를 던진다", async () => {
  const src = setup(`<button>x</button>`);
  await assert.rejects(() => src.execute({ type: "click", nodeId: "없음" }));
});
