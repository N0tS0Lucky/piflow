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

describe("loadOne (workflow loop + parallel)", () => {
  it("loads a loop whose body is two node steps (Builder⇄Critic)", async () => {
    const file = await writeTempYaml(`
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
`);

    const workflow = await loadOne(file);

    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.name).toBe("review-loop");
    expect(workflow.steps).toEqual([
      {
        id: "build-review-loop",
        type: "loop",
        maxIterations: 6,
        exitWhen: { batonField: "approved", equals: true },
        body: [
          {
            id: "build",
            type: "node",
            persona: "builder",
            worktree: true,
          },
          {
            id: "review",
            type: "node",
            persona: "critic",
            worktree: false,
          },
        ],
      },
    ]);
  });

  it("loads a parallel of two node steps", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: fan-out
steps:
  - id: ship-and-docs
    type: parallel
    body:
      - id: ship
        type: node
        persona: shipper
      - id: docs
        type: node
        persona: writer
`);

    const workflow = await loadOne(file);

    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.steps).toEqual([
      {
        id: "ship-and-docs",
        type: "parallel",
        body: [
          {
            id: "ship",
            type: "node",
            persona: "shipper",
            worktree: false,
          },
          {
            id: "docs",
            type: "node",
            persona: "writer",
            worktree: false,
          },
        ],
      },
    ]);
  });

  it("rejects an empty loop body with a path pointing at the step", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: empty-loop
steps:
  - id: build-review-loop
    type: loop
    maxIterations: 6
    body: []
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0].body");
    expect(definitionError.message).toMatch(/body|1/i);
  });

  it("rejects an empty parallel body with a path pointing at the step", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: empty-parallel
steps:
  - id: ship-and-docs
    type: parallel
    body: []
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0].body");
    expect(definitionError.message).toMatch(/body|1/i);
  });

  it("rejects a loop missing maxIterations with a path pointing at the loop", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: unbounded-loop
steps:
  - id: build-review-loop
    type: loop
    body:
      - id: build
        type: node
        persona: builder
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0].maxIterations");
    expect(definitionError.message).toMatch(/maxIterations|required|undefined/i);
  });

  it("rejects a loop with maxIterations less than 1", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: zero-loop
steps:
  - id: build-review-loop
    type: loop
    maxIterations: 0
    body:
      - id: build
        type: node
        persona: builder
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("steps[0].maxIterations");
    expect(definitionError.message).toMatch(/1|maxIterations/i);
  });
});
