import { describe, expect, it } from "vitest";
import {
  entityShortRef,
  nearStoryEntities,
  normalizeAliases,
  remapEntityShortRef,
  resolveStoryEntity,
  type StoryEntity,
} from "../../src/domain/story-bible";

describe("story bible", () => {
  it("normalizes and deduplicates entity aliases", () => {
    expect(normalizeAliases([" 小林 ", "林舟", "", "林舟"])).toEqual([
      "小林",
      "林舟",
    ]);
  });
  it("uses stable short refs and only flags qualified-name matches as near", () => {
    const entity: StoryEntity = {
      id: "abc12345-long-id",
      novelId: "n1",
      type: "character",
      name: "守灯人旧部首脑·崔衡",
      summary: "反派",
      aliases: [],
      profile: {},
      status: "active",
      createdAt: "t",
      updatedAt: "t",
    };
    expect(entityShortRef(entity)).toBe("E-ABC12345");
    expect(resolveStoryEntity([entity], "character", "E-ABC12345", "其他名"))
      .toBe(entity);
    expect(nearStoryEntities([entity], "character", "崔衡")).toEqual([entity]);
    expect(nearStoryEntities([entity], "character", "崔恒")).toEqual([]);
    expect(
      remapEntityShortRef("E-ABC12345", [entity], new Map([[entity.id, "new98765"]])),
    ).toBe("E-NEW98765");
  });
});
