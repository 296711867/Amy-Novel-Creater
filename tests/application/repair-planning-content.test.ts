import { describe, expect, it, vi } from "vitest";
import {
  PlanningJsonStructureError,
  repairPlanningContentOnce,
} from "@application/repair-planning-content";

const validateJson = (content: string) => {
  try {
    JSON.parse(content);
  } catch (error) {
    throw new PlanningJsonStructureError(
      error instanceof Error ? error.message : "invalid",
    );
  }
};

describe("planning JSON repair", () => {
  it("repairs an invalid response once and returns the validated result", async () => {
    const repair = vi.fn().mockResolvedValue('{"ok":true}');
    const result = await repairPlanningContentOnce({
      phase: "structure",
      content: '{"broken":',
      validate: validateJson,
      repair,
    });
    expect(result).toEqual({ content: '{"ok":true}', repaired: true });
    expect(repair).toHaveBeenCalledOnce();
    expect(repair.mock.calls[0][0]).toContain("只返回一个可解析的 JSON 对象");
  });

  it("fails after one repair response instead of retrying again", async () => {
    const repair = vi.fn().mockResolvedValue('{"stillBroken":');
    await expect(
      repairPlanningContentOnce({
        phase: "bible",
        content: "not json",
        validate: validateJson,
        repair,
      }),
    ).rejects.toThrow();
    expect(repair).toHaveBeenCalledOnce();
  });
});
