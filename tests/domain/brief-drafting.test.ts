import { describe, expect, it } from "vitest";
import {
  briefDraftingPrompt,
  parseBriefDraft,
} from "@domain/brief-drafting";

const brief = {
  audience: "喜欢规则怪谈的年轻玄幻读者",
  style: "第三人称限知，短句节奏，章末留钩子",
  boundaries: "不后宫；不洗白反派；主角不死",
  sellingPoint: "点亮灯塔要交出记忆",
  conflict: "点灯人旧部与主角争夺灯约",
  protagonistGoal: "驶出雾海；失败则航路永闭",
  ending: "重定灯约，雾海退去",
};

describe("brief drafting", () => {
  it("embeds field rules and author input into the prompt", () => {
    const prompt = briefDraftingPrompt({
      title: "雾灯航路",
      genre: "玄幻",
      premise: "灯油烧的是记忆",
      notes: "日更一章",
    });
    expect(prompt).toContain("代笔");
    expect(prompt).toContain("禁止形容词堆砌");
    expect(prompt).toContain("死设定");
    expect(prompt).toContain("雾灯航路");
    expect(prompt).toContain("灯油烧的是记忆");
    expect(prompt).toContain("日更一章");
  });
  it("parses a fenced brief draft", () => {
    const parsed = parseBriefDraft(
      "说明文字\n```json\n" + JSON.stringify(brief) + "\n```",
    );
    expect(parsed.sellingPoint).toBe("点亮灯塔要交出记忆");
  });
  it("rejects drafts with missing fields or extra objects", () => {
    expect(() =>
      parseBriefDraft(JSON.stringify({ ...brief, ending: "" })),
    ).toThrow();
    expect(() => parseBriefDraft('{"a":1}\n{"b":2}')).toThrow();
  });
});
