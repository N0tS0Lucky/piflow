import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefinitionError,
  loadDefinitions,
  type ResolvedDefinitions,
} from "../../src/definition-format/index.js";

/** Repo-rooted fixture dir for a scenario under tests/fixtures/invalid/. */
function invalidFixture(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url)); // tests/definition-format
  return join(here, "..", "fixtures", "invalid", name);
}

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
      "helper",
      `
apiVersion: piflow/v1
kind: workflow
name: helper
steps: []
`,
    );
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

describe("invoke target resolution", () => {
  it("rejects an invoke step naming a missing workflow", async () => {
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
    workflow: review-loop
`,
    );

    const error = await captureDefinitionError(dir);

    // Authoring UX: the message names the file, the step id, and the
    // missing workflow name, so the author can go straight to the line.
    expect(error.file).toContain("main.yaml");
    expect(error.path).toBe("steps[0]");
    expect(error.message).toContain("implement");
    expect(error.message).toContain('"review-loop"');
  });

  it("rejects a missing invoke target nested in a parallel body", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      "main",
      `
apiVersion: piflow/v1
kind: workflow
name: ship-it-all
steps:
  - id: fan-out
    type: parallel
    body:
      - id: ship
        type: invoke
        workflow: open-pr
`,
    );

    const error = await captureDefinitionError(dir);

    expect(error.path).toBe("steps[0].body[0]");
    expect(error.message).toContain("ship");
    expect(error.message).toContain('"open-pr"');
  });

  it("suggests the closest known workflow name when the reference is misspelled", async () => {
    const dir = await writeDefsDir();
    await writeWorkflow(
      dir,
      "review-loop",
      `
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps: []
`,
    );
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
    workflow: review-lopo
`,
    );

    const error = await captureDefinitionError(dir);

    expect(error.path).toBe("steps[0]");
    expect(error.message).toContain('did you mean "review-loop"');
  });
});

describe("invoke cycle rejection", () => {
  it("rejects a workflow that invokes itself, listing the cycle path", async () => {
    const error = await captureDefinitionError(invalidFixture("self-invoke"));

    expect(error.file).toContain("build-feature.yaml");
    expect(error.path).toBe("steps[0]");
    expect(error.message).toContain("build-feature → build-feature");
  });

  it("rejects a two-workflow cycle with the full path in the message", async () => {
    // Which file reports the error depends on which side resolution reaches
    // first; the path itself is normalized to start at "helper" either way.
    const error = await captureDefinitionError(
      invalidFixture("two-workflow-cycle"),
    );

    expect(error.message).toContain("helper → main → helper");
    expect(
      error.file.endsWith("main.yaml") || error.file.endsWith("helper.yaml"),
    ).toBe(true);
  });

  it("rejects a three-workflow cycle with the full path in the message", async () => {
    const error = await captureDefinitionError(
      invalidFixture("three-workflow-cycle"),
    );

    expect(error.message).toContain("alpha → beta → gamma → alpha");
  });
});
