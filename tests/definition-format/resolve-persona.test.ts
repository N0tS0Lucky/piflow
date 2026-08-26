import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefinitionError,
  loadDefinitions,
  type Persona,
} from "../../src/definition-format/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeDefsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-resolve-"));
  tempDirs.push(dir);
  await mkdir(join(dir, "personas"), { recursive: true });
  await mkdir(join(dir, "workflows"), { recursive: true });
  return dir;
}

async function writePersona(dir: string, name: string): Promise<void> {
  await writeFile(
    join(dir, "personas", `${name}.yaml`),
    `
apiVersion: piflow/v1
kind: persona
name: ${name}
description: Test persona ${name}.
skills: []
tools:
  allow: [read]
  deny: []
model: auto
systemPromptAppend: You are ${name}.
`,
    "utf8",
  );
}

async function writeWorkflow(dir: string, yaml: string): Promise<void> {
  await writeFile(join(dir, "workflows", "main.yaml"), yaml, "utf8");
}

/** Load definitions expecting exactly one DefinitionError; surfaces it on failure. */
async function captureDefinitionError(dir: string): Promise<DefinitionError> {
  try {
    await loadDefinitions(dir);
  } catch (cause) {
    if (cause instanceof DefinitionError) return cause;
    throw new Error(`expected DefinitionError, got ${String(cause)}`, {
      cause,
    });
  }
  throw new Error("expected loadDefinitions to throw, but it resolved");
}

describe("loadDefinitions persona resolution", () => {
  it("attaches the linked persona object to top-level node and interactive steps", async () => {
    const dir = await writeDefsDir();
    await writePersona(dir, "critic");
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: interview
    type: interactive
    persona: critic
  - id: assess-plan
    persona: critic
`,
    );

    const graph = await loadDefinitions(dir);
    const steps = graph.workflows["build-feature"]?.steps;
    expect(steps).toBeDefined();
    if (!steps) return;

    const interview = steps[0];
    if (interview.type !== "interactive") return;
    const assessPlan = steps[1];
    if (assessPlan.type !== "node") return;

    // The persona field is no longer a bare name string: it is the linked persona.
    const expected: Persona | undefined = graph.personas.critic;
    expect(expected).toBeDefined();
    expect(interview.persona.name).toBe("critic");
    expect(interview.persona.model).toBe(expected?.model);
    expect(assessPlan.persona.name).toBe("critic");
    expect(interview.persona).toBe(graph.personas.critic);
  });

  it("attaches personas to node steps nested inside loop and parallel bodies", async () => {
    const dir = await writeDefsDir();
    await writePersona(dir, "builder");
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps:
  - id: gate-loop
    type: loop
    maxIterations: 6
    body:
      - id: build
        persona: builder
  - id: fan-out
    type: parallel
    body:
      - id: build-again
        type: node
        persona: builder
        worktree: true
`,
    );

    const graph = await loadDefinitions(dir);
    const steps = graph.workflows["review-loop"]?.steps;
    expect(steps).toBeDefined();
    if (!steps) return;

    const gateLoop = steps[0];
    if (gateLoop.type !== "loop") return;
    const build = gateLoop.body[0];
    if (build.type !== "node") return;
    expect(build.persona).toBe(graph.personas.builder);

    const fanOut = steps[1];
    if (fanOut.type !== "parallel") return;
    const buildAgain = fanOut.body[0];
    if (buildAgain.type !== "node") return;
    expect(buildAgain.persona).toBe(graph.personas.builder);
    expect(buildAgain.worktree).toBe(true);
  });

  it("rejects a workflow step that names a missing persona", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: assess-plan
    persona: plan-assessor
`,
    );

    let error: DefinitionError | undefined;
    try {
      await loadDefinitions(dir);
    } catch (cause) {
      error = cause as DefinitionError;
    }

    expect(error).toBeInstanceOf(DefinitionError);
    // Authoring UX: the message names the workflow file, the step id, and the
    // persona name, so the author can go straight to the offending line.
    expect(error?.file).toContain("main.yaml");
    expect(error?.path).toBe("steps[0]");
    expect(error?.message).toContain("assess-plan");
    expect(error?.message).toContain("plan-assessor");
  });

  it("rejects a persona reference colliding with an inherited Object property", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: assess-plan
    persona: toString
`,
    );

    const error = await captureDefinitionError(dir);

    // `personas.toString` must not resolve via Object.prototype — a dangling
    // reference stays dangling no matter what it names.
    expect(error.path).toBe("steps[0]");
    expect(error.message).toContain("assess-plan");
    expect(error.message).toContain('"toString"');
  });

  it("rejects a missing persona inside a loop body, naming the nested path", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps:
  - id: gate-loop
    type: loop
    maxIterations: 3
    body:
      - id: build
        persona: ghost-builder
`,
    );

    const error = await captureDefinitionError(dir);

    expect(error.path).toBe("steps[0].body[0]");
    expect(error.message).toContain("build");
    expect(error.message).toContain("ghost-builder");
  });

  it("rejects a missing persona inside a parallel body, naming the nested path", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      `
apiVersion: piflow/v1
kind: workflow
name: fan-out
steps:
  - id: workers
    type: parallel
    body:
      - id: spin-up
        type: node
        persona: ghost-worker
        worktree: true
`,
    );

    const error = await captureDefinitionError(dir);

    expect(error.path).toBe("steps[0].body[0]");
    expect(error.message).toContain("spin-up");
    expect(error.message).toContain("ghost-worker");
  });

  it("resolves the spec's review-loop example against critic/builder personas", async () => {
    const dir = await writeDefsDir();
    await writePersona(dir, "critic");
    await writePersona(dir, "builder");
    await writeFile(
      join(dir, "workflows", "review-loop.yaml"),
      `
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps:
  - id: build-review-loop
    type: loop
    maxIterations: 6
    exitWhen:
      batonField: approved
      equals: true
    body:
      - id: build
        type: node
        persona: builder
        worktree: true
      - id: review
        type: node
        persona: critic
`,
      "utf8",
    );

    const graph = await loadDefinitions(dir);

    expect(graph.personas.critic?.name).toBe("critic");
    expect(graph.personas.builder?.name).toBe("builder");
    const steps = graph.workflows["review-loop"]?.steps;
    if (!steps) return;
    const gateLoop = steps[0];
    if (gateLoop.type !== "loop") return;
    // Loop structure survives resolution untouched...
    expect(gateLoop.maxIterations).toBe(6);
    expect(gateLoop.exitWhen).toEqual({
      batonField: "approved",
      equals: true,
    });
    // ...while both body steps carry their linked personas.
    const build = gateLoop.body[0];
    if (build.type !== "node") return;
    expect(build.persona).toBe(graph.personas.builder);
    expect(build.worktree).toBe(true);
    const review = gateLoop.body[1];
    if (review.type !== "node") return;
    expect(review.persona).toBe(graph.personas.critic);
  });
});
