import { z } from "zod";

/**
 * Persona file (`personas/<name>.yaml`) — SPEC-definition-format.md, Format Design.
 * Types are inferred from this schema; never hand-duplicated elsewhere.
 */
export const PersonaFields = z.strictObject({
  apiVersion: z.literal("piflow/v1"),
  kind: z.literal("persona"),
  name: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  tools: z.strictObject({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  }),
  model: z.string(),
  systemPromptReplace: z.string().optional(),
  systemPromptAppend: z.string().optional(),
});

/**
 * Exactly one of systemPromptReplace / systemPromptAppend — never both,
 * never neither. Whole-file rule, so the error points at the file root.
 */
function requireExactlyOnePrompt(payload: z.core.ParsePayload<Persona>) {
  const persona = payload.value;
  const hasReplace = persona.systemPromptReplace !== undefined;
  const hasAppend = persona.systemPromptAppend !== undefined;
  if (hasReplace && hasAppend) {
    payload.issues.push({
      code: "custom",
      input: persona,
      message:
        "Exactly one of 'systemPromptReplace' or 'systemPromptAppend' must be provided; found both.",
    });
  } else if (!hasReplace && !hasAppend) {
    payload.issues.push({
      code: "custom",
      input: persona,
      message:
        "Exactly one of 'systemPromptReplace' or 'systemPromptAppend' must be provided; found neither.",
    });
  }
}

export const PersonaSchema = PersonaFields.check(requireExactlyOnePrompt);

export type Persona = z.infer<typeof PersonaFields>;

/**
 * `node` / `interactive` step — SPEC-definition-format.md, Step types.
 * `type` defaults to `node`; `worktree` defaults to `false`.
 * Invoke lands in a later task.
 */
export const SessionStepSchema = z.strictObject({
  id: z.string(),
  type: z.enum(["node", "interactive"]).default("node"),
  persona: z.string(),
  worktree: z.boolean().default(false),
});

/** Deterministic loop exit over the latest baton JSON. */
export const ExitWhenSchema = z.strictObject({
  batonField: z.string(),
  equals: z.unknown(),
});

/** Non-empty nested step list. Lazy so loop/parallel bodies may nest. */
const NestedSteps = z.array(z.lazy(() => StepSchema)).min(1);

/** `loop` step. `maxIterations` >= 1; optional `exitWhen` over the latest baton. */
export const LoopStepSchema = z.strictObject({
  id: z.string(),
  type: z.literal("loop"),
  maxIterations: z.number().int().min(1),
  exitWhen: ExitWhenSchema.optional(),
  body: NestedSteps,
});

/** `parallel` step. Same body rules as loop. */
export const ParallelStepSchema = z.strictObject({
  id: z.string(),
  type: z.literal("parallel"),
  body: NestedSteps,
});

const StepUnionSchema = z.discriminatedUnion("type", [
  SessionStepSchema,
  LoopStepSchema,
  ParallelStepSchema,
]);

function withDefaultNodeType(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("type" in value)
  ) {
    return { ...value, type: "node" };
  }
  return value;
}

/**
 * Discriminated unions require `type`. Omitted `type` still means `node`,
 * so we fill it in before the discriminator runs.
 */
export const StepSchema = z.preprocess(withDefaultNodeType, StepUnionSchema);

export const WorkflowSchema = z.strictObject({
  apiVersion: z.literal("piflow/v1"),
  kind: z.literal("workflow"),
  name: z.string(),
  steps: z.array(StepSchema),
});

export type Workflow = z.infer<typeof WorkflowSchema>;
