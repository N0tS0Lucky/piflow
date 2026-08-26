import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOne } from "../../src/definition-format/index.js";

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
});
