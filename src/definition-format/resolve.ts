import { DefinitionError, nearestKey } from "./errors.js";
import type { ExitWhen, Persona, Step, Workflow } from "./schema.js";

/** Fully-parsed but not yet reference-resolved directory contents. */
export type RawDefinitions = {
  personas: Record<string, PersonaFile>;
  workflows: Record<string, WorkflowFile>;
};

export type PersonaFile = { file: string; definition: Persona };
export type WorkflowFile = { file: string; definition: Workflow };

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
export function resolveDefinitions(raw: RawDefinitions): ResolvedDefinitions {
  // Map lookups — a bare record would consult Object.prototype and let a step
  // referencing e.g. `persona: toString` resolve against an inherited function.
  const personas = new Map<string, Persona>(
    Object.entries(raw.personas).map(([name, entry]) => [
      name,
      entry.definition,
    ]),
  );
  const personasRecord: Record<string, Persona> = Object.assign(
    Object.create(null),
    Object.fromEntries(personas),
  );
  return {
    personas: personasRecord,
    workflows: Object.fromEntries(
      Object.entries(raw.workflows).map(([name, entry]) => [
        name,
        resolveWorkflow(entry.file, entry.definition, personas),
      ]),
    ),
  };
}

function resolveWorkflow(
  file: string,
  workflow: Workflow,
  personas: Map<string, Persona>,
): ResolvedWorkflow {
  return {
    ...workflow,
    steps: resolveSteps(file, "steps", workflow.steps, personas),
  };
}

function resolveSteps(
  file: string,
  path: string,
  steps: Step[],
  personas: Map<string, Persona>,
): ResolvedStep[] {
  return steps.map((step, index) => {
    const stepPath = `${path}[${index}]`;
    switch (step.type) {
      case "node":
      case "interactive": {
        const persona = personas.get(step.persona);
        if (!persona) {
          const nearest = nearestKey(step.persona, [...personas.keys()]);
          throw new DefinitionError(
            file,
            stepPath,
            `Step "${step.id}" references missing persona "${step.persona}"` +
              (nearest ? ` — did you mean "${nearest}"?` : "."),
          );
        }
        return { ...step, persona };
      }
      case "loop":
      case "parallel":
        return {
          ...step,
          body: resolveSteps(file, `${stepPath}.body`, step.body, personas),
        };
    }
  });
}
