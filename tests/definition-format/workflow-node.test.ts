import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DefinitionError, loadOne } from "../../src/definition-format/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Write YAML to a unique temp file. The document itself lives in the test. */
async function writeTempYaml(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-workflow-"));
  tempDirs.push(dir);
  const file = join(dir, "workflow.yaml");
  await writeFile(file, contents, "utf8");
  return file;
}

describe("loadOne (workflow node + interactive)", () => {
  it("loads a workflow with node and interactive steps", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: interview
    type: interactive
    persona: interviewer
    worktree: false
  - id: assess-plan
    type: node
    persona: plan-assessor
    worktree: true
`);

    const workflow = await loadOne(file);

    expect(workflow.apiVersion).toBe("piflow/v1");
    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.name).toBe("build-feature");
    expect(workflow.steps).toEqual([
      {
        id: "interview",
        type: "interactive",
        persona: "interviewer",
        worktree: false,
      },
      {
        id: "assess-plan",
        type: "node",
        persona: "plan-assessor",
        worktree: true,
      },
    ]);
  });

  it("defaults omitted type to node", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: assess
steps:
  - id: assess-plan
    persona: plan-assessor
    worktree: false
`);

    const workflow = await loadOne(file);

    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.steps[0]).toMatchObject({
      id: "assess-plan",
      type: "node",
      persona: "plan-assessor",
    });
  });

  it("defaults omitted worktree to false", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: assess
steps:
  - id: assess-plan
    type: node
    persona: plan-assessor
`);

    const workflow = await loadOne(file);

    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.steps[0]?.worktree).toBe(false);
  });

  it("rejects an interactive step missing persona with a path-aware error", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: interview-only
steps:
  - id: interview
    type: interactive
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0].persona");
    expect(definitionError.message).toContain("persona");
  });

  it("rejects an unknown key on a step with a path and a did-you-mean hint", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: assess
steps:
  - id: assess-plan
    type: node
    persona: plan-assessor
    worktre: true
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0]");
    expect(definitionError.message).toContain("worktre");
    expect(definitionError.message).toContain('did you mean "worktree"');
  });
});
