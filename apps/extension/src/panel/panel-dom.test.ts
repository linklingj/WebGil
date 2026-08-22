// 08 패널 배선 스모크 테스트 — 진짜 panel.html을 띄워 뷰가 실제로 그려지는지 본다.
// 목적은 로직이 아니라 **HTML과 코드의 선택자·역할 속성이 어긋나지 않는 것**이다
// (조용히 깨지고 typecheck는 통과하는 유일한 지점).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { SnapshotNode } from "@webgil/core";
import { JSDOM } from "jsdom";
import { SearchBox } from "./search.js";
import { TreeView } from "./tree-view.js";

const html = readFileSync(fileURLToPath(new URL("./panel.html", import.meta.url)), "utf8");

function node(id: string, children: SnapshotNode[] = []): SnapshotNode {
  return { id, kind: "text", level: 1, text: id, children };
}

const tree = node("root", [node("본문", [node("공지"), node("소식")]), node("메뉴")]);

function withPanel(run: (dom: JSDOM) => void): void {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  // d3-zoom은 확대 범위를 정할 때 전역 SVGElement를 본다(브라우저엔 늘 있다).
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
  };
  const saved = Object.fromEntries(Object.keys(globals).map((key) => [key, (globalThis as never)[key]]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  try {
    run(dom);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
}

test("트리 뷰: 스냅샷을 treeitem 버튼으로 그리고 커서를 표시한다", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const view = new TreeView(viewport, { onSelect: () => {}, onActivate: () => {} });
    view.render(tree, "본문");

    const items = [...viewport.querySelectorAll('[role="treeitem"]')];
    assert.deepEqual(
      items.map((item) => item.getAttribute("data-id")).sort(),
      ["공지", "메뉴", "본문", "소식"],
      "커서의 형제(메뉴)와 자식(공지·소식)이 함께 보인다",
    );
    assert.equal(items[0].querySelector(".text")?.textContent, "본문", "노드에 텍스트가 실린다");
    const current = viewport.querySelector('[aria-selected="true"]')!;
    assert.equal(current.id, "n-본문");
    assert.equal(current.getAttribute("aria-expanded"), "true", "커서는 펼쳐진 상태");
    assert.equal(viewport.querySelectorAll(".edges path").length, 2, "커서→자식 연결선만 그린다");
  });
});

test("트리 뷰: 커서 노드를 다시 누르면 실행, 다른 노드는 이동", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const calls: string[] = [];
    const view = new TreeView(viewport, {
      onSelect: (id) => calls.push(`select:${id}`),
      onActivate: (id) => calls.push(`activate:${id}`),
    });
    view.render(tree, "본문");

    viewport.querySelector<HTMLElement>("#n-공지")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    viewport.querySelector<HTMLElement>("#n-본문")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(calls, ["select:공지", "activate:본문"]);
  });
});

test("트리 뷰: 형제 사이를 오가면 카메라가 새 커서를 따라간다", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const camera = viewport.querySelector<HTMLElement>(".camera")!;
    const view = new TreeView(viewport, { onSelect: () => {}, onActivate: () => {} });

    view.render(tree, "공지");
    const atFirst = camera.style.transform;
    view.render(tree, "소식");
    const atSecond = camera.style.transform;

    assert.match(atFirst, /^translate\(/, "카메라는 transform으로 움직인다");
    assert.notEqual(atSecond, atFirst, "옆 형제로 옮기면 화면도 그만큼 따라 움직인다");
    view.render(tree, "공지");
    assert.equal(camera.style.transform, atFirst, "되돌아오면 같은 자리");
  });
});

test("트리 뷰: 직접 줌하면 추적을 멈추되, 커서가 움직이면 다시 따라간다", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const camera = viewport.querySelector<HTMLElement>(".camera")!;
    const view = new TreeView(viewport, { onSelect: () => {}, onActivate: () => {} });
    view.render(tree, "공지");
    assert.equal(view.isFollowing, true);

    // 트랙패드 두 손가락 스크롤도 휠로 들어온다 — 그 순간 자동 추적을 놓아준다.
    viewport.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -400, clientX: 200, clientY: 300, bubbles: true }));
    assert.equal(view.isFollowing, false, "직접 보고 있는 화면을 뺏지 않는다");

    const parked = camera.style.transform;
    view.render(tree, "공지");
    assert.equal(camera.style.transform, parked, "같은 커서로 다시 그려도 화면은 그대로");

    view.render(tree, "소식");
    assert.equal(view.isFollowing, true, "커서가 움직이면 카메라가 되돌아온다");
    assert.notEqual(camera.style.transform, parked);
  });
});

test("트리 뷰: 커서는 그대로여도 트리가 바뀌면 카메라가 새 자리를 잡는다", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const camera = viewport.querySelector<HTMLElement>(".camera")!;
    const view = new TreeView(viewport, { onSelect: () => {}, onActivate: () => {} });

    view.render(tree, "공지");
    // 사용자가 직접 화면을 잡아 자동 추적이 꺼진 상태를 만든다.
    viewport.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -300, clientX: 200, clientY: 300, bubbles: true }));
    const parked = camera.style.transform;
    assert.equal(view.isFollowing, false);

    // SPA 갱신으로 앞에 형제가 하나 늘면, 같은 "공지"도 다른 좌표에 놓인다.
    const grown = node("root", [node("본문", [node("새 글"), node("공지"), node("소식")]), node("메뉴")]);
    view.render(grown, "공지");

    assert.equal(view.isFollowing, true, "멈춰 있던 카메라가 엉뚱한 자리를 비추게 두지 않는다");
    assert.notEqual(camera.style.transform, parked);
  });
});

test("트리 뷰: 스냅샷에 없는 커서면 카메라를 아무 데나 옮기지 않는다", () => {
  withPanel((dom) => {
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const camera = viewport.querySelector<HTMLElement>(".camera")!;
    const view = new TreeView(viewport, { onSelect: () => {}, onActivate: () => {} });

    view.render(tree, "공지");
    const before = camera.style.transform;
    view.render(tree, "사라진-노드");
    assert.equal(camera.style.transform, before, "다음 스냅샷이 맞춰줄 때까지 그대로 둔다");
  });
});

test("검색창: 일치 결과는 목록으로, ?로 시작하면 자연어 명령으로 넘긴다", () => {
  withPanel((dom) => {
    const header = dom.window.document.querySelector<HTMLElement>("#searchBar")!;
    const picked: string[] = [];
    const asked: string[] = [];
    const search = new SearchBox(header, {
      onSelect: (id) => picked.push(id),
      onAsk: (text) => asked.push(text),
      onDismiss: () => {},
    });
    search.setTree(tree);

    const input = header.querySelector<HTMLInputElement>("#search")!;
    input.value = "공지";
    input.dispatchEvent(new dom.window.Event("input"));
    const options = [...header.querySelectorAll('[role="option"]')];
    assert.deepEqual(options.map((option) => option.getAttribute("data-id")), ["공지"]);
    assert.match(options[0].textContent ?? "", /본문/, "결과에 조상 경로를 함께 보여준다");

    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(picked, ["공지"], "Enter는 그 노드로 커서 이동");

    input.value = "?로그인 눌러줘";
    input.dispatchEvent(new dom.window.Event("input"));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(asked, ["로그인 눌러줘"], "?는 떼고 명령으로 넘긴다");
  });
});

test("검색창: Esc는 검색어를 비우고 트리 조작으로 돌려보낸다", () => {
  withPanel((dom) => {
    const header = dom.window.document.querySelector<HTMLElement>("#searchBar")!;
    const viewport = dom.window.document.querySelector<HTMLElement>("#viewport")!;
    const search = new SearchBox(header, { onSelect: () => {}, onAsk: () => {}, onDismiss: () => viewport.focus() });
    search.setTree(tree);

    const input = header.querySelector<HTMLInputElement>("#search")!;
    search.focus();
    input.value = "공지";
    input.dispatchEvent(new dom.window.Event("input"));
    assert.equal(header.querySelector("#searchResults")?.hasAttribute("hidden"), false, "결과가 펼쳐진 상태");

    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(input.value, "", "검색어가 비워진다");
    assert.equal(header.querySelector("#searchResults")?.hasAttribute("hidden"), true, "결과 목록이 접힌다");
    assert.equal(dom.window.document.activeElement, viewport, "포커스가 트리로 돌아간다");
  });
});
