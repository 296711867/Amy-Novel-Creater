import { z } from "zod";
import type { FactProposalKind } from "./quality-check";
import type { FactProposal } from "./quality-check";
import type { ForeshadowStatus } from "./continuity";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";

const proposal = z.object({
  kind: z.enum(["timeline", "character_state", "foreshadow"]),
  title: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
const response = z.object({ proposals: z.array(proposal).max(50) });
export type ExtractedProposal = {
  kind: FactProposalKind;
  title: string;
  payload: Record<string, unknown>;
};
export function factExtractionPrompt(
  content: string,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("fact_extraction", overrides), {
    content,
  }).text;
}
export function parseFactExtraction(raw: string): ExtractedProposal[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return response.parse(JSON.parse(text)).proposals;
}

/**
 * 模型偶尔会把枚举写成 open / 未回收 / 进行中 等自由文案。
 * 统一在这里映射回正史状态机；无法识别时按“本章新埋、尚未回收”处理。
 */
export function normalizeForeshadowStatus(raw: unknown): ForeshadowStatus {
  const text = String(raw ?? "").trim();
  if (!text) return "planted";
  if (/^(planned|planted|developing|resolved|abandoned)$/i.test(text))
    return text.toLowerCase() as ForeshadowStatus;
  if (/未回收|未解决|未兑现|未完成|open|active|ongoing|unresolved/i.test(text))
    return "planted";
  if (/已回收|已兑现|回收|兑现|resolved/i.test(text)) return "resolved";
  if (/发展|推进|进行中|developing/i.test(text)) return "developing";
  if (/放弃|废弃|abandoned/i.test(text)) return "abandoned";
  if (/计划|待埋|未埋|planned/i.test(text)) return "planned";
  return "planted";
}

/** 数组字段经常被模型写成一句话；按中文顿号/分号等切回数组。 */
function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.map((item) => String(item).trim()).filter(Boolean);
  if (typeof raw === "string")
    return raw
      .split(/[；;、，,|/\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  if (raw === null || raw === undefined) return [];
  return [String(raw).trim()].filter(Boolean);
}

function toText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (Array.isArray(raw)) return raw.map(String).join("；");
  return String(raw).trim();
}

function firstOf(
  payload: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) if (key in payload) return payload[key];
  return undefined;
}

function invalid(message: string): never {
  throw new Error(`这条正史建议格式无法识别（${message}），可拒绝后手动录入正史`);
}

const timelinePayload = z.object({
  storyTime: z.string().min(1),
  detail: z.string().min(1),
  participants: z.array(z.string()).default([]),
});
const characterPayload = z.object({
  characterName: z.string().min(1),
  summary: z.string().min(1),
  location: z.string().default(""),
  appearance: z.string().default(""),
  outfit: z.string().default(""),
  identity: z.string().default(""),
  physical: z.string().default(""),
  emotional: z.string().default(""),
  knowledge: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  inventory: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
const foreshadowPayload = z.object({
  detail: z.string().min(1),
  status: z
    .enum(["planned", "planted", "developing", "resolved", "abandoned"])
    .default("planted"),
});
export function parseProposalPayload(proposal: FactProposal) {
  const payload = proposal.payload ?? {};
  if (proposal.kind === "timeline") {
    const storyTime = toText(
        firstOf(payload, ["storyTime", "story_time", "time", "时间"]),
      ),
      detail = toText(
        firstOf(payload, ["detail", "description", "详情"]),
      );
    if (!storyTime || !detail) invalid("时间线缺少 storyTime 或 detail");
    return {
      kind: proposal.kind,
      payload: timelinePayload.parse({
        storyTime,
        detail,
        participants: toStringArray(
          firstOf(payload, ["participants", "参与人物"]),
        ),
      }),
    } as const;
  }
  if (proposal.kind === "character_state") {
    const characterName = toText(
      firstOf(payload, ["characterName", "character", "姓名", "角色"]),
    );
    if (!characterName) invalid("角色状态缺少 characterName");
    const summary =
      toText(firstOf(payload, ["summary", "概要"])) ||
      `${characterName}的状态更新（${proposal.title}）`;
    return {
      kind: proposal.kind,
      payload: characterPayload.parse({
        characterName,
        summary,
        location: toText(firstOf(payload, ["location", "位置", "所在地"])),
        appearance: toText(firstOf(payload, ["appearance", "外貌", "外貌变化"])),
        outfit: toText(firstOf(payload, ["outfit", "衣着", "衣服", "服装"])),
        identity: toText(
          firstOf(payload, ["identity", "身份", "新增身份", "头衔"]),
        ),
        physical: toText(firstOf(payload, ["physical", "身体", "伤势"])),
        emotional: toText(firstOf(payload, ["emotional", "情绪", "心情"])),
        knowledge: toStringArray(firstOf(payload, ["knowledge", "已知", "认知"])),
        goals: toStringArray(firstOf(payload, ["goals", "目标"])),
        inventory: toStringArray(firstOf(payload, ["inventory", "物品", "持有物"])),
        skills: toStringArray(firstOf(payload, ["skills", "技能"])),
      }),
    } as const;
  }
  const detail = toText(firstOf(payload, ["detail", "description", "详情"]));
  if (!detail) invalid("伏笔缺少 detail");
  return {
    kind: proposal.kind,
    payload: foreshadowPayload.parse({
      detail,
      status: normalizeForeshadowStatus(payload.status),
    }),
  } as const;
}
