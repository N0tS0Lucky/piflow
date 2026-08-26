import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DefinitionError,
  loadDefinitions,
} from "../../src/definition-format/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writeDefsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-defs-"));
  tempDirs.push(dir);
  return dir;
}

describe("loadDefinitions", () => {
  it("is exported and returns a resolved graph for a generated valid directory", async () => {
    const dir = await writeDefsDir();
    const graph = await loadDefinitions(dir);

    expect(graph.personas).toBeDefined();
    expect(graph.workflows).toBeDefined();
  });

  it("returns every persona and workflow from personas/ and workflows/", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "personas"));
    await mkdir(join(dir, "workflows"));
    await writeFile(
      join(dir, "personas", "critic.yaml"),
      `
apiVersion: piflow/v1
kind: persona
name: critic
description: Adversarial reviewer.
skills: []
tools:
  allow: [read]
  deny: []
model: auto
systemPromptAppend: Be hostile.
`,
      "utf8",
    );
    await writeFile(
      join(dir, "personas", "builder.yaml"),
      `
apiVersion: piflow/v1
kind: persona
name: builder
description: Implements the change.
skills: []
tools:
  allow: [read, write]
  deny: []
model: auto
systemPromptAppend: Ship it.
`,
      "utf8",
    );
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

    expect(Object.keys(graph.personas).sort()).toEqual(["builder", "critic"]);
    expect(graph.personas.critic?.kind).toBe("persona");
    expect(graph.personas.critic?.name).toBe("critic");
    expect(graph.personas.builder?.name).toBe("builder");
    expect(Object.keys(graph.workflows)).toEqual(["review-loop"]);
    expect(graph.workflows["review-loop"]?.kind).toBe("workflow");
    expect(graph.workflows["review-loop"]?.steps).toHaveLength(1);
  });

  it("rejects two personas that share a name, naming both files", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "personas"));
    const first = join(dir, "personas", "critic.yaml");
    const second = join(dir, "personas", "reviewer.yaml");
    const yaml = `
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: Be brief.
`;
    await writeFile(first, yaml, "utf8");
    await writeFile(second, yaml, "utf8");

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.message).toContain("critic");
    expect(definitionError.message).toContain("critic.yaml");
    expect(definitionError.message).toContain("reviewer.yaml");
  });

  it("rejects two workflows that share a name, naming both files", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    const first = join(dir, "workflows", "review.yaml");
    const second = join(dir, "workflows", "loop.yaml");
    const yaml = `
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps:
  - id: review
    type: node
    persona: critic
`;
    await writeFile(first, yaml, "utf8");
    await writeFile(second, yaml, "utf8");

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.message).toContain("review-loop");
    expect(definitionError.message).toContain("review.yaml");
    expect(definitionError.message).toContain("loop.yaml");
  });

  it("rejects duplicate step ids in the same top-level list with a path", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    const file = join(dir, "workflows", "dup.yaml");
    await writeFile(
      file,
      `
apiVersion: piflow/v1
kind: workflow
name: dup-ids
steps:
  - id: review
    type: node
    persona: critic
  - id: review
    type: node
    persona: builder
`,
      "utf8",
    );

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toMatch(/steps\[1\]/);
    expect(definitionError.message).toContain("review");
  });

  it("rejects duplicate step ids inside a loop body with a path", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    const file = join(dir, "workflows", "dup-body.yaml");
    await writeFile(
      file,
      `
apiVersion: piflow/v1
kind: workflow
name: dup-body
steps:
  - id: build-review-loop
    type: loop
    maxIterations: 3
    body:
      - id: build
        type: node
        persona: builder
      - id: build
        type: node
        persona: critic
`,
      "utf8",
    );

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toMatch(/steps\[0\]\.body\[1\]/);
    expect(definitionError.message).toContain("build");
  });

  it("rejects duplicate step ids inside a parallel body with a path", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    const file = join(dir, "workflows", "dup-parallel.yaml");
    await writeFile(
      file,
      `
apiVersion: piflow/v1
kind: workflow
name: dup-parallel
steps:
  - id: fan-out
    type: parallel
    body:
      - id: ship
        type: node
        persona: shipper
      - id: ship
        type: node
        persona: writer
`,
      "utf8",
    );

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toMatch(/steps\[0\]\.body\[1\]/);
    expect(definitionError.message).toContain("ship");
  });

  it("allows the same step id in different enclosing lists", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    await writeFile(
      join(dir, "workflows", "reuse.yaml"),
      `
apiVersion: piflow/v1
kind: workflow
name: reuse-ids
steps:
  - id: build
    type: node
    persona: planner
  - id: loop
    type: loop
    maxIterations: 2
    body:
      - id: build
        type: node
        persona: builder
`,
      "utf8",
    );

    const graph = await loadDefinitions(dir);

    expect(graph.workflows["reuse-ids"]?.steps).toHaveLength(2);
  });

  it("rejects a workflow file sitting in personas/", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "personas"));
    const file = join(dir, "personas", "not-a-persona.yaml");
    await writeFile(
      file,
      `
apiVersion: piflow/v1
kind: workflow
name: sneaky
steps:
  - id: review
    type: node
    persona: critic
`,
      "utf8",
    );

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("kind");
    expect(definitionError.message).toMatch(/persona/);
    expect(definitionError.message).toMatch(/workflow/);
  });

  it("rejects a persona file sitting in workflows/", async () => {
    const dir = await writeDefsDir();
    await mkdir(join(dir, "workflows"));
    const file = join(dir, "workflows", "not-a-workflow.yaml");
    await writeFile(
      file,
      `
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: Be brief.
`,
      "utf8",
    );

    const err = await loadDefinitions(dir).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("kind");
    expect(definitionError.message).toMatch(/workflow/);
    expect(definitionError.message).toMatch(/persona/);
  });
});
