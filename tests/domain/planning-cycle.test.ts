import { describe, expect, it } from "vitest";
import {
  composeClosingState,
  planningCycleRange,
} from "@domain/planning-cycle";
import {
  normalizeCycleSize,
  CYCLE_SIZE_DEFAULT,
  CYCLE_SIZE_MAX,
  CYCLE_SIZE_MIN,
} from "@domain/novel";

describe("rolling planning cycle", () => {
  it("advances to the first unplanned ten-chapter range", () => {
    const chapters = Array.from({ length: 25 }, (_, index) => ({
      position: index + 1,
      title: index < 10 ? `第${index + 1}章 已规划` : `第 ${index + 1} 章`,
      outline: index < 10 ? "已有章纲" : "",
    }));
    expect(planningCycleRange(chapters, 25)).toEqual({
      startChapter: 11,
      endChapter: 20,
    });
  });
  it("honors a custom cycle size for the next batch", () => {
    const chapters = Array.from({ length: 25 }, (_, index) => ({
      position: index + 1,
      title: index < 10 ? `第${index + 1}章 已规划` : `第 ${index + 1} 章`,
      outline: index < 10 ? "已有章纲" : "",
    }));
    expect(planningCycleRange(chapters, 25, 5)).toEqual({
      startChapter: 11,
      endChapter: 15,
    });
    expect(planningCycleRange(chapters, 25, 15)).toEqual({
      startChapter: 11,
      endChapter: 25,
    });
    expect(planningCycleRange(chapters, 12, 5)).toEqual({
      startChapter: 11,
      endChapter: 12,
    });
  });
  it("normalizes cycle size into the supported band", () => {
    expect(normalizeCycleSize(undefined)).toBe(CYCLE_SIZE_DEFAULT);
    expect(normalizeCycleSize(null)).toBe(CYCLE_SIZE_DEFAULT);
    expect(normalizeCycleSize(0)).toBe(CYCLE_SIZE_DEFAULT);
    expect(normalizeCycleSize(Number.NaN)).toBe(CYCLE_SIZE_DEFAULT);
    expect(normalizeCycleSize(CYCLE_SIZE_MIN - 3)).toBe(CYCLE_SIZE_MIN);
    expect(normalizeCycleSize(CYCLE_SIZE_MAX + 9)).toBe(CYCLE_SIZE_MAX);
    expect(normalizeCycleSize(7.4)).toBe(7);
  });
  it("composes the closing state from in-range memory only", () => {
    const text = composeClosingState({
      range: { startChapter: 1, endChapter: 10 },
      chapters: [
        { id: "c1", position: 1 },
        { id: "c9", position: 9 },
        { id: "c12", position: 12 },
      ],
      characters: [
        { id: "hero", name: "林昭" },
        { id: "foe", name: "崔衡" },
        { id: "ghost", name: "无状态角色" },
      ],
      characterStates: [
        {
          characterId: "hero",
          chapterId: "c1",
          summary: "旧状态",
          location: "拾灯港",
          goals: ["出海"],
          inventory: ["雾灯"],
          skills: [],
        },
        {
          characterId: "hero",
          chapterId: "c9",
          summary: "最新状态",
          location: "哑言塔",
          goals: ["进塔"],
          inventory: ["雾灯", "铜铃"],
          skills: ["残念引子"],
        },
        {
          characterId: "foe",
          chapterId: "c12",
          summary: "下一批的状态不应进入本批",
          location: "归萤塔",
          goals: [],
          inventory: [],
          skills: [],
        },
      ],
      foreshadow: [
        { title: "母亲的灯芯", status: "developing" },
        { title: "旧灯约全文", status: "resolved" },
      ],
    });
    expect(text).toContain("第 1–10 章实际结束状态");
    expect(text).toContain("林昭（第9章）：位于哑言塔");
    expect(text).toContain("铜铃");
    expect(text).not.toContain("崔衡");
    expect(text).not.toContain("旧状态");
    expect(text).toContain("未决伏笔：母亲的灯芯（developing）");
    expect(text).not.toContain("旧灯约全文");
  });
});
