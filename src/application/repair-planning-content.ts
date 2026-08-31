import { planningJsonRepairPrompt, type PlanPhase } from "@domain/planning";

export class PlanningJsonStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningJsonStructureError";
  }
}

export async function repairPlanningContentOnce(input: {
  phase: PlanPhase;
  content: string;
  validate: (content: string) => void;
  repair: (prompt: string) => Promise<string>;
}): Promise<{ content: string; repaired: boolean }> {
  try {
    input.validate(input.content);
    return { content: input.content, repaired: false };
  } catch (error) {
    if (!(error instanceof PlanningJsonStructureError)) throw error;
    const repaired = await input.repair(
      planningJsonRepairPrompt({
        phase: input.phase,
        rawResponse: input.content,
        parseError: error instanceof Error ? error.message : "结构解析失败",
      }),
    );
    input.validate(repaired);
    return { content: repaired, repaired: true };
  }
}
