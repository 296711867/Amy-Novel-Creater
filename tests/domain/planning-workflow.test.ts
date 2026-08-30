import { describe, expect, it } from "vitest";
import {
  confirmPlanningStep,
  defaultPlanningWorkflow,
  invalidatePlanningFrom,
  nextPlanningStep,
  normalizePlanningWorkflow,
} from "@domain/planning-workflow";

describe("planning workflow", () => {
  it("keeps confirmations contiguous and invalidates downstream reviews", () => {
    const empty = defaultPlanningWorkflow("n1", "t0");
    expect(() => confirmPlanningStep(empty, 2)).toThrow("请先确认第 1 步");

    const first = confirmPlanningStep(empty, 1, "t1"),
      second = confirmPlanningStep(first, 2, "t2"),
      third = confirmPlanningStep(second, 3, "t3");
    expect(nextPlanningStep(third)).toBe(4);
    expect(invalidatePlanningFrom(third, 2, "t4").confirmedSteps).toEqual([1]);

    expect(
      normalizePlanningWorkflow({
        ...empty,
        confirmedSteps: [1, 3],
      }).confirmedSteps,
    ).toEqual([1]);
  });
});
