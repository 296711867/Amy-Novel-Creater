import {
  normalizeChatCompletionsUrl,
  type ModelConnectionResult,
  type ModelProfile,
} from "@domain/model-profile";

interface CompatibleResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
}
export interface StreamResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}
export async function testOpenAICompatible(
  profile: ModelProfile,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelConnectionResult> {
  const started = Date.now();
  try {
    const response = await fetcher(
      normalizeChatCompletionsUrl(profile.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: profile.modelId,
          messages: [{ role: "user", content: "Reply with OK only." }],
          max_tokens: 8,
          stream: false,
        }),
      },
    );
    if (!response.ok)
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: `连接失败（HTTP ${response.status}）`,
      };
    const data = (await response.json()) as CompatibleResponse;
    if (!data.choices?.[0]?.message)
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: "接口可访问，但响应不是 Chat Completions 格式",
      };
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: "连接成功",
      model: data.model ?? profile.modelId,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : "连接失败",
    };
  }
}

export async function streamOpenAICompatible(
  profile: ModelProfile,
  apiKey: string,
  prompt: string,
  maxOutputTokens: number,
  temperature: number,
  onDelta: (delta: string) => void,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const response = await fetcher(normalizeChatCompletionsUrl(profile.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: profile.modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxOutputTokens,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error("模型接口未返回流式响应");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    inputTokens = 0,
    outputTokens = 0,
    cachedTokens = 0;
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    try {
      const data = JSON.parse(raw) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const delta = data.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        content += delta;
        onDelta(delta);
      }
      if (data.usage) {
        inputTokens = data.usage.prompt_tokens ?? inputTokens;
        outputTokens = data.usage.completion_tokens ?? outputTokens;
        cachedTokens =
          data.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
      }
    } catch {
      /* Ignore provider keep-alive or malformed optional event. */
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return { content, inputTokens, outputTokens, cachedTokens };
}
