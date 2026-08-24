import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnthropicMessagesModel,
  GeminiOpenAICompatibleModel,
  listOllamaModels,
  OLLAMA_HOST,
  OllamaChatModel,
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

test("Ollama 어댑터: 로컬 /api/chat에 키 없이 보내고 JSON 명령을 꺼낸다", async () => {
  const fake = fakeFetch({ message: { content: '{"type":"navigation","intent":"back"}' } });
  const model = new OllamaChatModel({ provider: "ollama", apiKey: "", model: "llama3.2" }, fake.fetch);

  assert.deepEqual(await model.complete(request), { type: "navigation", intent: "back" });
  assert.equal(fake.calls[0].url, `${OLLAMA_HOST}/api/chat`);

  const body = JSON.parse(String(fake.calls[0].init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "llama3.2");
  assert.equal(body.stream, false, "한 번에 받아야 JSON을 그대로 파싱한다");
  assert.equal(body.format, "json");
  assert.equal(
    JSON.stringify(fake.calls[0].init?.headers).includes("Authorization"),
    false,
    "로컬 서버에는 보낼 키가 없다",
  );
});

test("Ollama 오류는 {error:\"...\"} 문자열 형태도 그대로 전한다", async () => {
  const model = new OllamaChatModel(
    { provider: "ollama", apiKey: "", model: "없는-모델" },
    failingFetch(404, JSON.stringify({ error: "model '없는-모델' not found" })),
  );
  await assert.rejects(model.complete(request), /not found/);
});

test("listOllamaModels: 설치된 모델 이름만 정리해서 돌려준다", async () => {
  const fake = fakeFetch({
    models: [
      { name: "qwen2.5:7b", size: 1 },
      { name: "llama3.2:latest" },
      { name: "qwen2.5:7b" },
      { size: 2 },
    ],
  });

  assert.deepEqual(await listOllamaModels(fake.fetch), ["llama3.2:latest", "qwen2.5:7b"]);
  assert.equal(fake.calls[0].url, `${OLLAMA_HOST}/api/tags`);
});

test("listOllamaModels: 서버가 꺼져 있으면 실패를 숨기지 않는다", async () => {
  await assert.rejects(listOllamaModels(failingFetch(503, "")), /Ollama 모델 목록/);
});
