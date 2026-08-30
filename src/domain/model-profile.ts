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
