import { DefinitionError } from "./errors.js";
import type { Step, Workflow } from "./schema.js";

/** Step ids must be unique within each enclosing list (top-level or body). */
export function assertUniqueStepIds(file: string, workflow: Workflow): void {
  assertUniqueInList(file, "steps", workflow.steps);
}

function assertUniqueInList(file: string, path: string, steps: Step[]): void {
  const seen = new Map<string, number>();
  for (const [index, step] of steps.entries()) {
    const previous = seen.get(step.id);
    if (previous !== undefined) {
      throw new DefinitionError(
        file,
        `${path}[${index}]`,
        `Duplicate step id "${step.id}" (also ${path}[${previous}]).`,
      );
    }
    seen.set(step.id, index);
    if (step.type === "loop" || step.type === "parallel") {
      assertUniqueInList(file, `${path}[${index}].body`, step.body);
    }
  }
}
