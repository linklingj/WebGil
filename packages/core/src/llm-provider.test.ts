import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnthropicMessagesModel,
  GeminiOpenAICompatibleModel,
  OpenAIResponsesModel,
  type FetchFunction,
} from "./llm-provider.js";
import type { LLMRequest } from "./llm-command.js";

const request: LLMRequest = {
  system: "Return JSON.",
  user: "다음으로 이동",
  document: { text: '- id="a" kind="button" text="로그인"', nodeIds: ["a"], truncated: false },
};

function fakeFetch(payload: unknown): { fetch: FetchFunction; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  };
}

function failingFetch(status: number, body: string): FetchFunction {
  return async () => new Response(body, { status });
}

test("OpenAI Responses 어댑터: output_text의 JSON을 명령 객체로 바꾼다", async () => {
  const fake = fakeFetch({ output_text: '{"type":"navigation","intent":"next"}' });
  const model = new OpenAIResponsesModel({ provider: "openai", apiKey: "secret", model: "test-model" }, fake.fetch);

  assert.deepEqual(await model.complete(request), { type: "navigation", intent: "next" });
  assert.equal(fake.calls[0].url, "https://api.openai.com/v1/responses");
  assert.match(String(fake.calls[0].init?.body), /다음으로 이동/);
  assert.match(String(fake.calls[0].init?.body), /UNTRUSTED_PAGE_DATA_START/);
  // OpenAI json_object 형식은 입력 메시지에 "json"이 없으면 400을 낸다(system에만 있으면 거부).
  assert.match(String(JSON.parse(String(fake.calls[0].init?.body)).input), /json/);
});

test("Gemini 호환 어댑터: Chat Completions 형식의 JSON을 읽는다", async () => {
  const fake = fakeFetch({ choices: [{ message: { content: '{"type":"speech","intent":"stop"}' } }] });
  const model = new GeminiOpenAICompatibleModel({ provider: "gemini", apiKey: "secret", model: "test-model" }, fake.fetch);

  assert.deepEqual(await model.complete(request), { type: "speech", intent: "stop" });
  assert.match(fake.calls[0].url, /generativelanguage\.googleapis\.com/);
});

test("Claude 어댑터: Messages content 텍스트의 JSON을 읽는다", async () => {
  const fake = fakeFetch({ content: [{ type: "text", text: '{"type":"answer","text":"확인했습니다."}' }] });
  const model = new AnthropicMessagesModel({ provider: "anthropic", apiKey: "secret", model: "test-model" }, fake.fetch);

  assert.deepEqual(await model.complete(request), { type: "answer", text: "확인했습니다." });
  assert.equal(fake.calls[0].url, "https://api.anthropic.com/v1/messages");
});

test("제공자 어댑터: 429와 JSON이 아닌 오류 응답도 상태 코드와 함께 전달한다", async () => {
  const model = new OpenAIResponsesModel(
    { provider: "openai", apiKey: "secret", model: "test-model" },
    failingFetch(429, "rate limit exceeded"),
  );

  await assert.rejects(model.complete(request), /LLM 요청 실패 \(429\)/);
});
