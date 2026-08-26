import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefinitionError,
  loadDefinitions,
  type ResolvedDefinitions,
} from "../../src/definition-format/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeDefsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-invoke-"));
  tempDirs.push(dir);
  await mkdirWorkflowsOnly(dir);
  return dir;
}

async function mkdirWorkflowsOnly(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "workflows"), { recursive: true });
}

async function writeWorkflow(dir: string, name: string, yaml: string) {
  await writeFile(join(dir, "workflows", `${name}.yaml`), yaml, "utf8");
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

describe("invoke schema", () => {
  it("accepts an invoke step naming another workflow", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      "main",
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: implement
    type: invoke
    workflow: helper
`,
    );

    let graph: ResolvedDefinitions | undefined;
    try {
      graph = await loadDefinitions(dir);
    } catch (cause) {
      throw new Error(`expected invoke step to parse, got ${String(cause)}`, {
        cause,
      });
    }
    expect(graph?.workflows["build-feature"]).toBeDefined();
  });

  it("rejects an invoke step with keys outside its closed set", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      "main",
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: implement
    type: invoke
    workflow: helper
    worktree: true
`,
    );

    const error = await captureDefinitionError(dir);

    // Unknown keys are rejected at every level, with a pointer at the step.
    expect(error.file).toContain("main.yaml");
    expect(error.path).toBe("steps[0]");
    expect(error.message).toContain("worktree");
  });

  it("requires the workflow name on an invoke step", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      "main",
      `
apiVersion: piflow/v1
kind: workflow
name: build-feature
steps:
  - id: implement
    type: invoke
`,
    );

    const error = await captureDefinitionError(dir);

    expect(error.file).toContain("main.yaml");
    expect(error.path).toBe("steps[0].workflow");
  });
});
