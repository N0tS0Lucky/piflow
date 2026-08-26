import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadDefinitions,
  type ResolvedDefinitions,
  type ResolvedStep,
} from "../../src/definition-format/index.js";

/** Spec's build-feature example — invokes + a parallel of invokes. */
function validFixture(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // tests/definition-format
  return join(here, "..", "fixtures", "valid", "build-feature");
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Convert one resolved step back into its authored shape: linked objects flatten to names. */
function serializableStep(step: ResolvedStep): unknown {
  switch (step.type) {
    case "node":
    case "interactive":
      return {
        id: step.id,
        type: step.type,
        persona: step.persona.name,
        worktree: step.worktree,
      };
    case "loop":
      return {
        id: step.id,
        type: step.type,
        maxIterations: step.maxIterations,
        ...(step.exitWhen !== undefined ? { exitWhen: step.exitWhen } : {}),
        body: step.body.map(serializableStep),
      };
    case "parallel":
      return {
        id: step.id,
        type: step.type,
        body: step.body.map(serializableStep),
      };
    case "invoke":
      return {
        id: step.id,
        type: step.type,
        workflow: step.workflow.name,
      };
  }
}

/**
 * Serialize a resolved graph back to directory convention:
 * personas/<name>.yaml + workflows/<name>.yaml.
 */
async function serializeDefinitionsToDir(
  defs: ResolvedDefinitions,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-roundtrip-"));
  tempDirs.push(dir);
  await Promise.all([
    mkdir(join(dir, "personas")),
    mkdir(join(dir, "workflows")),
  ]);

  for (const [name, persona] of Object.entries(defs.personas)) {
    await writeFile(
      join(dir, "personas", `${name}.yaml`),
      stringify(persona),
      "utf8",
    );
  }
  for (const [name, workflow] of Object.entries(defs.workflows)) {
    const authored = {
      ...workflow,
      steps: workflow.steps.map(serializableStep),
    };
    await writeFile(
      join(dir, "workflows", `${name}.yaml`),
      stringify(authored),
      "utf8",
    );
  }
  return dir;
}

describe("round-trip (load → serialize → load)", () => {
  it("deep-equals the resolved graph after serialize and reload", async () => {
    // The spec's build-feature example: an interactive step, a loop with
    // exitWhen inside an invoked workflow, and a parallel of invokes.
    const first = await loadDefinitions(validFixture());

    const dir = await serializeDefinitionsToDir(first);
    const second = await loadDefinitions(dir);

    expect(second).toEqual(first);
  });

  it("round-trips a suite-generated directory that relies on schema defaults", async () => {
    // `type` and `worktree` omitted on the session step, no `exitWhen` on
    // the loop — serialization must make defaults explicit or reload drifts.
    const dir = await mkdtemp(join(tmpdir(), "piflow-roundtrip-minimal-"));
    tempDirs.push(dir);
    await Promise.all([
      mkdir(join(dir, "personas")),
      mkdir(join(dir, "workflows")),
    ]);
    await writeFile(
      join(dir, "personas", "planner.yaml"),
      `
apiVersion: piflow/v1
kind: persona
name: planner
description: Drafts plans.
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: You plan.
`,
      "utf8",
    );
    await writeFile(
      join(dir, "workflows", "plan.yaml"),
      `
apiVersion: piflow/v1
kind: workflow
name: plan
steps:
  - id: draft
    persona: planner
  - id: gate
    type: loop
    maxIterations: 2
    body:
      - id: review-plan
        persona: planner
`,
      "utf8",
    );

    const first = await loadDefinitions(dir);
    const serialized = await serializeDefinitionsToDir(first);
    const second = await loadDefinitions(serialized);

    expect(second).toEqual(first);
  });
});
