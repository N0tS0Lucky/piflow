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
});
