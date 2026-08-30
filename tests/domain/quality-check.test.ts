import { describe, expect, it } from "vitest";
import {
  assertCandidateAcceptedForCanon,
  checkCandidateQuality,
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
});
