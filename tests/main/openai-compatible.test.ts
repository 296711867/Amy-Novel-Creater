import { describe, expect, it, vi } from "vitest";
import {
  streamOpenAICompatible,
  testOpenAICompatible,
  thinkingRequestBody,
} from "../../src/main/model/openai-compatible";
import {
  chatCompletionsRequestBody,
} from "../../src/domain/model-profile";

const profile = {
  id: "p",
  name: "Test",
  provider: "openai-compatible" as const,
  modelId: "test-model",
  baseUrl: "https://example.test/v1",
  contextWindow: 128000,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
  isDefault: true,
  hasSecret: true,
  createdAt: "",
  updatedAt: "",
};
describe("OpenAI-compatible adapter", () => {
  it("uses chat completions without exposing key in result", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "test-model",
            choices: [{ message: { content: "OK" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await testOpenAICompatible(
      profile,
      "super-secret",
      fetcher as typeof fetch,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toMatchObject({ ok: true, model: "test-model" });
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });
  it("returns a sanitized HTTP failure", async () => {
    const result = await testOpenAICompatible(
      profile,
      "secret",
      async () => new Response("private provider body", { status: 401 }),
    );
    expect(result.message).toBe("连接失败（HTTP 401）");
    expect(result.message).not.toContain("private provider body");
  });
  it("parses SSE deltas and final usage", async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"长夜"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"将尽"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":20}}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const deltas: string[] = [];
    const result = await streamOpenAICompatible(
      profile,
      "key",
      "prompt",
      100,
      0.7,
      (d) => deltas.push(d),
      async () => new Response(body, { status: 200 }),
    );
    expect(deltas).toEqual(["长夜", "将尽"]);
    expect(result).toEqual({
      content: "长夜将尽",
      inputTokens: 120,
      outputTokens: 8,
      cachedTokens: 20,
    });
  });
  it("preserves retry timing without exposing provider response bodies", async () => {
    await expect(
      streamOpenAICompatible(
        profile,
        "key",
        "prompt",
        100,
        0.7,
        () => {},
        async () =>
          new Response("private", {
            status: 429,
            headers: { "retry-after": "3" },
          }),
      ),
    ).rejects.toMatchObject({
      status: 429,
      retryable: true,
      retryAfterMs: 3000,
      message: "模型请求失败（HTTP 429）",
    });
  });
});

describe("thinkingRequestBody", () => {
  it("emits thinking param only for bigmodel.cn hosts", async () => {
    expect(
      thinkingRequestBody("https://open.bigmodel.cn/api/paas/v4", "disabled"),
    ).toEqual({
      thinking: { type: "disabled" },
    });
    expect(thinkingRequestBody("https://open.bigmodel.cn/api/paas/v4")).toEqual(
      {},
    );
    expect(
      thinkingRequestBody("https://api.openai.com/v1", "disabled"),
    ).toEqual({});
    expect(thinkingRequestBody("not a url", "disabled")).toEqual({});
  });
  it("builds the same provider-safe body for every host", () => {
    expect(
      chatCompletionsRequestBody(profile, "规划", {
        maxOutputTokens: 1000,
        temperature: 0.7,
        stream: false,
        thinking: "disabled",
      }),
    ).not.toHaveProperty("thinking");
    expect(
      chatCompletionsRequestBody(
        { ...profile, baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
        "规划",
        {
          maxOutputTokens: 1000,
          temperature: 0.7,
          stream: false,
          thinking: "disabled",
        },
      ),
    ).toHaveProperty("thinking.type", "disabled");
  });
});
