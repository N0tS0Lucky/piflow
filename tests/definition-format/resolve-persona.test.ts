import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
});
