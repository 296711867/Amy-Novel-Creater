export type ModelProvider =
  | "openai-compatible"
  | "openai"
  | "deepseek"
  | "glm"
  | "glm-standard"
  | "ollama";
export interface ModelProfile {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  contextWindow: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  isDefault: boolean;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SaveModelProfileInput {
  id?: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  baseUrl: string;
  contextWindow: number;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  isDefault: boolean;
  apiKey?: string;
}
export interface ModelConnectionResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  model?: string;
}
export type ThinkingMode = "enabled" | "disabled";

const RETRYABLE_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ModelRequestError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`模型请求失败（HTTP ${status}）`);
    this.name = "ModelRequestError";
    this.retryable = RETRYABLE_HTTP_STATUS.has(status);
  }
}

export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, time - now) : null;
}

export function thinkingRequestBody(
  baseUrl: string,
  mode?: ThinkingMode,
): Record<string, unknown> {
  if (!mode) return {};
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return {};
  }
  return host === "bigmodel.cn" || host.endsWith(".bigmodel.cn")
    ? { thinking: { type: mode } }
    : {};
}

export function chatCompletionsRequestBody(
  profile: Pick<ModelProfile, "baseUrl" | "modelId">,
  prompt: string,
  options: {
    maxOutputTokens: number;
    temperature: number;
    stream: boolean;
    thinking?: ThinkingMode;
  },
): Record<string, unknown> {
  return {
    model: profile.modelId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: options.maxOutputTokens,
    temperature: options.temperature,
    stream: options.stream,
    ...(options.stream ? { stream_options: { include_usage: true } } : {}),
    ...thinkingRequestBody(profile.baseUrl, options.thinking),
  };
}
export const PROVIDER_PRESETS: Record<
  ModelProvider,
  { label: string; baseUrl: string; modelId: string; requiresKey: boolean }
> = {
  "openai-compatible": {
    label: "OpenAI 兼容",
    baseUrl: "",
    modelId: "",
    requiresKey: true,
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelId: "gpt-5-mini",
    requiresKey: true,
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-chat",
    requiresKey: true,
  },
  glm: {
    label: "智谱 GLM（Coding Plan 订阅）",
    // GLM Coding Plan 订阅 Key 只能走 /api/coding/paas/v4。
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    modelId: "GLM-5.2",
    requiresKey: true,
  },
  "glm-standard": {
    label: "智谱 GLM（按量付费 API）",
    // 普通按量付费 API Key 走标准端点，模型按账号可用型号填写。
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelId: "glm-4.6",
    requiresKey: true,
  },
  ollama: {
    label: "Ollama 本地",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelId: "qwen3:8b",
    requiresKey: false,
  },
};
export function normalizeChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/$/, "")}/chat/completions`;
}
