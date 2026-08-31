import { describe, expect, it } from "vitest";
import {
  batchProgress,
  candidateReviewComplete,
  canMoveJob,
  estimateGeneration,
  nextRunnableJob,
  pendingFactProposalCount,
  retryDelayMs,
  validateChapterRange,
  type GenerationJob,
  type GenerationPolicy,
} from "../../src/domain/generation";

const policy: GenerationPolicy = {
  startChapter: 11,
  endChapter: 20,
  chapterWords: 3000,
  continuityCheck: true,
  maxRetries: 2,
  approvalMode: "candidate",
  outputTokenBudget: 120000,
};

describe("generation policy", () => {
  it("estimates an inclusive chapter range", () => {
    expect(estimateGeneration(policy)).toEqual({
      chapterCount: 10,
      targetWords: 30000,
      estimatedOutputTokens: 40500,
      estimatedContextTokens: 120000,
    });
  });

  it("rejects a range beyond the planned directory", () => {
    expect(validateChapterRange({ ...policy, endChapter: 101 }, 100)).toBe(
      "结束章节超出当前目录",
    );
  });
});

describe("generation queue", () => {
  const job = (
    position: number,
    status: GenerationJob["status"],
  ): GenerationJob => ({
    id: String(position),
    batchId: "b",
    chapterId: `c${position}`,
    position,
    status,
    attempt: 0,
    candidateId: null,
    inputTokens: 0,
    outputTokens: 0,
    error: "",
    updatedAt: "",
  });
  it("selects the first runnable checkpoint", () => {
    expect(
      nextRunnableJob([job(2, "queued"), job(1, "candidate_ready")])?.id,
    ).toBe("2");
    expect(batchProgress([job(1, "candidate_ready"), job(2, "queued")])).toBe(
      50,
    );
  });
  it("guards invalid state jumps", () => {
    expect(canMoveJob("queued", "building_context")).toBe(true);
    expect(canMoveJob("completed", "queued")).toBe(false);
  });
  it("backs off exponentially and honors Retry-After", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(4)).toBe(8000);
    expect(retryDelayMs(2, 45_000)).toBe(45_000);
    expect(retryDelayMs(2, 999_000)).toBe(120_000);
  });
  it("releases an accepted candidate only after every fact is reviewed", () => {
    const proposals = [{ status: "proposed" }, { status: "accepted" }];
    expect(pendingFactProposalCount(proposals)).toBe(1);
    expect(candidateReviewComplete("accepted", proposals)).toBe(false);
    expect(
      candidateReviewComplete("accepted", [
        { status: "accepted" },
        { status: "rejected" },
      ]),
    ).toBe(true);
    expect(candidateReviewComplete("candidate", [])).toBe(false);
  });
});
