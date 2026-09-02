import type { Chapter } from "./novel";
import type { StoryEntity } from "./story-bible";
import type { ForeshadowThread } from "./continuity";
import type { StoryScene } from "./story-structure";
import type { ChapterCandidate } from "./chapter-generation";

export type FindingSeverity = "error" | "warning" | "info";
export interface ContinuityFinding {
  id: string;
  severity: FindingSeverity;
  category:
    | "length"
    | "structure"
    | "character"
    | "location"
    | "foreshadow"
    | "consistency";
  message: string;
  evidence: string;
}
export interface StoredFinding extends ContinuityFinding {
  candidateId: string;
  chapterId: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  updatedAt: string;
}
export type FactProposalKind = "timeline" | "character_state" | "foreshadow";
export interface FactProposal {
  id: string;
  candidateId: string;
  chapterId: string;
  kind: FactProposalKind;
  title: string;
  payload: Record<string, unknown>;
  status: "proposed" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
}
export interface QualityCheckInput {
  chapter: Chapter;
  content: string;
  scenes: StoryScene[];
  entities: StoryEntity[];
  foreshadow: ForeshadowThread[];
}
export function assertCandidateAcceptedForCanon(
  candidate: Pick<ChapterCandidate, "status"> | null | undefined,
): void {
  if (candidate?.status !== "accepted")
    throw new Error("请先接受候选稿，再把事实建议写入正史");
}

/**
 * AN-023 审查驱动重写：error 级发现自动注入修订要求并重写的轮数上限。
 * 默认关闭（0）；超出轮数后退回人工审核，绝不自动写入正史。
 */
export const DEFAULT_REWRITE_ROUNDS = 2;

/** 是否触发自动重写：开关开启、未超轮数、存在 error 级发现。 */
export function shouldAutoRewrite(
  findings: Pick<ContinuityFinding, "severity">[],
  rounds: number | undefined,
  attempt: number,
): boolean {
  return (
    (rounds ?? 0) > 0 &&
    attempt < rounds! &&
    findings.some((item) => item.severity === "error")
  );
}

/** 把 error 发现转成注入重写上下文的修订要求清单。 */
export function rewriteNotesFrom(
  findings: ContinuityFinding[],
): string {
  return findings
    .filter((item) => item.severity === "error")
    .map((item, index) => `${index + 1}. ${item.message}（依据：${item.evidence}）`)
    .join("\n");
}
const includesAny = (content: string, values: string[]) =>
  values.some((value) => value.trim() && content.includes(value.trim()));
export function checkCandidateQuality(
  input: QualityCheckInput,
): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [],
    words = input.content.replace(/\s+/g, "").length;
  if (words < input.chapter.targetWords * 0.6)
    findings.push({
      id: "length:short",
      severity: "error",
      category: "length",
      message: `正文仅 ${words} 字，低于目标字数的 60%`,
      evidence: `目标 ${input.chapter.targetWords} 字`,
    });
  if (!input.content.trim())
    findings.push({
      id: "structure:empty",
      severity: "error",
      category: "structure",
      message: "模型没有返回正文",
      evidence: "候选稿为空",
    });
  for (const scene of input.scenes) {
    if (scene.viewpoint) {
      const entity = input.entities.find(
          (item) =>
            item.name === scene.viewpoint ||
            item.aliases.includes(scene.viewpoint),
        ),
        names = entity ? [entity.name, ...entity.aliases] : [scene.viewpoint];
      if (!includesAny(input.content, names))
        findings.push({
          id: `scene:${scene.id}:pov`,
          severity: "warning",
          category: "character",
          message: `场景“${scene.title}”指定视角人物未在正文出现`,
          evidence: scene.viewpoint,
        });
    }
    if (scene.location && !input.content.includes(scene.location))
      findings.push({
        id: `scene:${scene.id}:location`,
        severity: "info",
        category: "location",
        message: `场景“${scene.title}”的指定地点未明确出现`,
        evidence: scene.location,
      });
  }
  for (const thread of input.foreshadow.filter(
    (item) =>
      item.payoffChapterId === input.chapter.id && item.status !== "resolved",
  )) {
    const clues = [
      thread.title,
      ...thread.detail
        .split(/[，。；、\s]/)
        .filter((item) => item.length >= 2)
        .slice(0, 4),
    ];
    if (!includesAny(input.content, clues))
      findings.push({
        id: `foreshadow:${thread.id}`,
        severity: "warning",
        category: "foreshadow",
        message: `本章计划回收伏笔“${thread.title}”，正文中未找到相关线索`,
        evidence: thread.detail,
      });
  }
  return findings;
}
