import assert from "node:assert/strict";
import { test } from "node:test";
import { isNavigationGuidance, narrationDetailFor } from "./guidance.js";

test("탐색 안내는 기본 간결 모드와 상세 모드만 허용한다", () => {
  assert.equal(isNavigationGuidance("compact"), true);
  assert.equal(isNavigationGuidance("detailed"), true);
  assert.equal(isNavigationGuidance("full"), false);
  assert.equal(narrationDetailFor("compact"), undefined);
  assert.equal(narrationDetailFor("detailed"), "full");
});
