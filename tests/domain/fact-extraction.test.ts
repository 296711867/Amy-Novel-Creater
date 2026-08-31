import { describe, expect, it } from "vitest";
import {
  normalizeForeshadowStatus,
  parseFactExtraction,
  parseProposalPayload,
} from "../../src/domain/fact-extraction";
import type { FactProposal } from "../../src/domain/quality-check";

function proposal(
  kind: FactProposal["kind"],
  payload: Record<string, unknown>,
): FactProposal {
  return {
    id: "p1",
    candidateId: "c1",
    chapterId: "ch1",
    kind,
    title: "提案标题",
    payload,
    status: "proposed",
    createdAt: "",
    updatedAt: "",
  };
}

describe("fact extraction boundary", () => {
  it("accepts fenced valid JSON", () => {
    expect(
      parseFactExtraction(
        '```json\n{"proposals":[{"kind":"timeline","title":"抵达月港","payload":{"storyTime":"第三日"}}]}\n```',
      )[0],
    ).toMatchObject({ kind: "timeline", title: "抵达月港" });
  });
  it("rejects unknown proposal kinds", () => {
    expect(() =>
      parseFactExtraction(
        '{"proposals":[{"kind":"guess","title":"猜测","payload":{}}]}',
      ),
    ).toThrow();
  });
});

describe("foreshadow status coercion", () => {
  it("maps open / 未回收 to planted", () => {
    expect(normalizeForeshadowStatus("open")).toBe("planted");
    expect(normalizeForeshadowStatus("未回收")).toBe("planted");
    expect(normalizeForeshadowStatus(undefined)).toBe("planted");
  });
  it("maps Chinese lifecycle wording onto the canon enum", () => {
    expect(normalizeForeshadowStatus("进行中")).toBe("developing");
    expect(normalizeForeshadowStatus("已回收")).toBe("resolved");
    expect(normalizeForeshadowStatus("已放弃")).toBe("abandoned");
    expect(normalizeForeshadowStatus("planned")).toBe("planned");
  });
});

describe("tolerant payload parsing", () => {
  it("splits stringified arrays and fills missing summary", () => {
    const parsed = parseProposalPayload(
      proposal("character_state", {
        characterName: "顾行舟",
        knowledge: "知道父亲病危、知道现实之门每天一小时",
        goals: ["活命"],
        inventory: "压缩饼干、矿泉水",
        skills: "无变化",
      }),
    );
    expect(parsed.kind).toBe("character_state");
    if (parsed.kind !== "character_state") return;
    expect(parsed.payload.knowledge).toEqual([
      "知道父亲病危",
      "知道现实之门每天一小时",
    ]);
    expect(parsed.payload.inventory).toEqual(["压缩饼干", "矿泉水"]);
    expect(parsed.payload.skills).toEqual(["无变化"]);
    expect(parsed.payload.summary).toContain("顾行舟");
  });
  it("keeps appearance / outfit / identity evolution fields", () => {
    const parsed = parseProposalPayload(
      proposal("character_state", {
        characterName: "顾行舟",
        summary: "宴会夜",
        appearance: "头发剪短",
        outfit: "礼服，使用假身份",
        identity: "调查组顾问",
      }),
    );
    expect(parsed).toMatchObject({
      kind: "character_state",
      payload: {
        appearance: "头发剪短",
        outfit: "礼服，使用假身份",
        identity: "调查组顾问",
      },
    });
  });
  it("normalizes an invalid foreshadow status instead of throwing raw errors", () => {
    const parsed = parseProposalPayload(
      proposal("foreshadow", { detail: "系统疑似具有人格", status: "open" }),
    );
    expect(parsed).toMatchObject({
      kind: "foreshadow",
      payload: { detail: "系统疑似具有人格", status: "planted" },
    });
  });
  it("throws a friendly error when required fields are missing", () => {
    expect(() => parseProposalPayload(proposal("timeline", {}))).toThrow(
      /无法识别/,
    );
    expect(() =>
      parseProposalPayload(proposal("character_state", { summary: "匿名" })),
    ).toThrow(/无法识别/);
  });
});
