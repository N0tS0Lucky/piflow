import type { ExitWhen, Persona, Step, Workflow } from "./schema.js";

/** Fully-parsed but not yet reference-resolved directory contents. */
export type RawDefinitions = {
  personas: Record<string, Persona>;
  workflows: Record<string, Workflow>;
};

/**
 * Linked object graph — SPEC-definition-format.md, Validation rules.
 * Personas are attached to session steps; composite bodies stay fully linked.
 */
export type ResolvedSessionStep = {
  id: string;
  type: "node" | "interactive";
  worktree: boolean;
  persona: Persona;
};

export type ResolvedLoopStep = {
  id: string;
  type: "loop";
  maxIterations: number;
  exitWhen?: ExitWhen;
  body: ResolvedStep[];
};

export type ResolvedParallelStep = {
  id: string;
  type: "parallel";
  body: ResolvedStep[];
};

export type ResolvedStep =
  ResolvedSessionStep | ResolvedLoopStep | ResolvedParallelStep;

export type ResolvedWorkflow = Omit<Workflow, "steps"> & {
  steps: ResolvedStep[];
};

export type ResolvedDefinitions = {
  personas: Record<string, Persona>;
  workflows: Record<string, ResolvedWorkflow>;
};

/** Attach the referenced persona to every session step at any nesting depth. */
export function resolveDefinitions(
  loaded: RawDefinitions,
): ResolvedDefinitions {
  return {
    personas: loaded.personas,
    workflows: Object.fromEntries(
      Object.entries(loaded.workflows).map(([name, workflow]) => [
        name,
        resolveWorkflow(workflow, loaded.personas),
      ]),
    ),
  };
}

function resolveWorkflow(
  workflow: Workflow,
  personas: Record<string, Persona>,
): ResolvedWorkflow {
  return { ...workflow, steps: resolveSteps(workflow.steps, personas) };
}

function resolveSteps(
  steps: Step[],
  personas: Record<string, Persona>,
): ResolvedStep[] {
  return steps.map((step) => {
    switch (step.type) {
      case "node":
      case "interactive":
        return { ...step, persona: personas[step.persona]! };
      case "loop":
      case "parallel":
        return { ...step, body: resolveSteps(step.body, personas) };
    }
  });
}
