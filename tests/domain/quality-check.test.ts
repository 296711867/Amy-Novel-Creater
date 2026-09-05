import { describe, expect, it } from "vitest";
import {
  assertCandidateAcceptedForCanon,
  checkCandidateQuality,
  rewriteNotesFrom,
  shouldAutoRewrite,
} from "../../src/domain/quality-check";
const now = "2026-01-01T00:00:00.000Z",
  chapter = {
    id: "c",
    novelId: "n",
    volumeId: null,
    position: 2,
    title: "第二章",
    outline: "",
    status: "planned" as const,
    targetWords: 100,
    content: "",
    wordCount: 0,
    updatedAt: now,
  };
describe("candidate quality check", () => {
  it("blocks canon writes until the candidate is accepted", () => {
    expect(() => assertCandidateAcceptedForCanon({ status: "candidate" })).toThrow(
      "请先接受候选稿",
    );
    expect(() => assertCandidateAcceptedForCanon({ status: "accepted" })).not.toThrow();
  });
  it("reports concrete omissions without inventing conflicts", () => {
    const findings = checkCandidateQuality({
      chapter,
      content: "林舟走进舱室。",
      scenes: [
        {
          id: "s",
          chapterId: "c",
          position: 1,
          title: "港口相遇",
          summary: "",
          viewpoint: "林舟",
          location: "月港",
          targetWords: 50,
          createdAt: now,
          updatedAt: now,
        },
      ],
      entities: [
        {
          id: "e",
          novelId: "n",
          type: "character",
          name: "林舟",
          summary: "",
          aliases: ["小林"],
          profile: {},
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      foreshadow: [],
    });
    expect(findings.map((item) => item.category)).toEqual([
      "length",
      "location",
    ]);
    expect(findings.some((item) => item.category === "character")).toBe(false);
  });
  it("flags a planned payoff only when no clue appears", () => {
    const thread = {
      id: "f",
      novelId: "n",
      title: "旧钥匙",
      detail: "钥匙开启密室",
      setupChapterId: null,
      payoffChapterId: "c",
      status: "planted" as const,
      source: "manual" as const,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      checkCandidateQuality({
        chapter,
        content: "这一章足够长".repeat(20),
        scenes: [],
        entities: [],
        foreshadow: [thread],
      }).some((item) => item.category === "foreshadow"),
    ).toBe(true);
  });
  it("无人值守可把字数安全门提高到目标的 90%", () => {
    const findings = checkCandidateQuality({
      chapter,
      content: "字".repeat(85),
      scenes: [],
      entities: [],
      foreshadow: [],
      minimumWordRatio: 0.9,
    });
    expect(findings.find((item) => item.id === "length:short")?.message).toContain("90%");
  });
});

describe("AN-023 审查驱动重写", () => {
  const err = (id: string) => ({
    id,
    severity: "error" as const,
    category: "length" as const,
    message: `${id} 问题`,
    evidence: "依据",
  });
  const warn = {
    id: "w",
    severity: "warning" as const,
    category: "character" as const,
    message: "提醒",
    evidence: "依据",
  };

  it("默认关闭；开启后 error 触发、warning 不触发", () => {
    expect(shouldAutoRewrite([err("e1")], undefined, 0)).toBe(false);
    expect(shouldAutoRewrite([err("e1")], 2, 0)).toBe(true);
    expect(shouldAutoRewrite([warn], 2, 0)).toBe(false);
  });

  it("轮数上限：attempt 达到轮数后不再重写（退回人工审核）", () => {
    expect(shouldAutoRewrite([err("e1")], 2, 1)).toBe(true);
    expect(shouldAutoRewrite([err("e1")], 2, 2)).toBe(false);
  });

  it("修订要求只收 error，逐条编号带依据", () => {
    const notes = rewriteNotesFrom([err("e1"), warn, err("e2")]);
    expect(notes).toContain("1. e1 问题（依据：依据）");
    expect(notes).toContain("2. e2 问题（依据：依据）");
    expect(notes).not.toContain("提醒");
  });
});
