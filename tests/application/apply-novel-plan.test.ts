import { describe, expect, it } from "vitest";
import { renderChapterPlan } from "@application/apply-novel-plan";

describe("rolling chapter plan persistence", () => {
  it("keeps explicit people, scene, item and skill references", () => {
    expect(
      renderChapterPlan({
        position: 1,
        volumeTitle: "第一卷",
        title: "第一章",
        outline: "主角进入灰塔。",
        viewpoint: "林舟",
        characters: ["林舟", "沈岚"],
        scenes: ["灰塔"],
        items: ["旧钥匙"],
        skills: ["星图导航"],
      }),
    ).toContain("【技能】星图导航");
  });
});
