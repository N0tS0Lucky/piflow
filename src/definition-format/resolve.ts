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
 * Personas are attached to session steps, invoked workflows are attached
 * (and themselves resolved) to invoke steps; composites stay fully linked.
 */
export type ResolvedSessionStep = {
  id: string;
  type: "node" | "interactive";
  worktree: boolean;
  persona: Persona;
};

export type ResolvedInvokeStep = {
  id: string;
  type: "invoke";
  /** The linked, itself-resolved workflow this step invokes. */
  workflow: ResolvedWorkflow;
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
  | ResolvedSessionStep
  | ResolvedInvokeStep
  | ResolvedLoopStep
  | ResolvedParallelStep;

export type ResolvedWorkflow = Omit<Workflow, "steps"> & {
  steps: ResolvedStep[];
};

export type ResolvedDefinitions = {
  personas: Record<string, Persona>;
  workflows: Record<string, ResolvedWorkflow>;
};

/** Attach referenced personas and invoked workflows to every step, any depth. */
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

  const entries = [...Object.entries(raw.workflows)];
  const definitionsByName = new Map(
    entries.map(([name, entry]) => [name, entry] as const),
  );

  /** Memoized results plus the chain currently being resolved. */
  const resolved = new Map<string, ResolvedWorkflow>();
  const resolving = new Set<string>();
  const invocationStack: string[] = [];

  /**
   * Resolve one named workflow, recursing into its invoked targets.
   * Memoized results make diamonds cheap; `resolving` catches re-entry,
   * i.e. a cycle whose closing edge lands on the current stack.
   */
  function getWorkflow(name: string): ResolvedWorkflow {
    const cached = resolved.get(name);
    if (cached) return cached;

    const entry = definitionsByName.get(name);
    if (!entry) {
      throw new Error(`invoked missing workflow "${name}"`);
    }

    resolving.add(name);
    invocationStack.push(name);
    try {
      const steps = resolveSteps(entry.file, "steps", entry.definition.steps);
      const linked: ResolvedWorkflow = { ...entry.definition, steps };
      resolved.set(name, linked);
      return linked;
    } finally {
      invocationStack.pop();
      resolving.delete(name);
    }
  }

  function resolveSteps(
    file: string,
    path: string,
    steps: Step[],
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
            body: resolveSteps(file, `${stepPath}.body`, step.body),
          };
        case "invoke": {
          const entry = definitionsByName.get(step.workflow);
          if (!entry) {
            const nearest = nearestKey(step.workflow, [
              ...definitionsByName.keys(),
            ]);
            throw new DefinitionError(
              file,
              stepPath,
              `Step "${step.id}" invokes missing workflow "${step.workflow}"` +
                (nearest ? ` — did you mean "${nearest}"?` : "."),
            );
          }
          if (resolving.has(step.workflow)) {
            // The listed path always names the whole ring end to end.
            throw new DefinitionError(
              file,
              stepPath,
              `Invocation cycle detected: ${formatCycle(step.workflow)}.`,
            );
          }
          return { ...step, workflow: getWorkflow(step.workflow) };
        }
      }
    });
  }

  /**
   * Cycle path normalized to start at its lexicographically-smallest workflow,
   * closed back on itself — deterministic no matter which edge triggers it.
   */
  function formatCycle(name: string): string {
    const start = invocationStack.indexOf(name);
    const ring = invocationStack.slice(start);
    let anchor = 0;
    for (let i = 1; i < ring.length; i++) {
      if (ring[i] < ring[anchor]) anchor = i;
    }
    const normalized = [
      ...ring.slice(anchor),
      ...ring.slice(0, anchor),
      ring[anchor],
    ];
    return normalized.join(" → ");
  }

  return {
    personas: personasRecord,
    workflows: Object.fromEntries(
      entries.map(([name]) => [name, getWorkflow(name)]),
    ),
  };
}
