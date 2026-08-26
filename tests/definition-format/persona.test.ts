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
  const dir = await mkdtemp(join(tmpdir(), "piflow-persona-"));
  tempDirs.push(dir);
  const file = join(dir, "persona.yaml");
  await writeFile(file, contents, "utf8");
  return file;
}

describe("loadOne (persona)", () => {
  it("loads a valid persona file into a typed object", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Adversarial reviewer; verifies builder output against the diff.
skills:
  - code-review-and-quality
  - doubt-driven-development
tools:
  allow: [read, grep, find, ls]
  deny: []
model: auto
systemPromptAppend: |
  You are a hostile reviewer. Find what would break in production.
`);

    const critic = await loadOne(file);

    expect(critic.apiVersion).toBe("piflow/v1");
    expect(critic.kind).toBe("persona");
    expect(critic.name).toBe("critic");
    expect(critic.description).toContain("Adversarial reviewer");
    expect(critic.skills).toEqual([
      "code-review-and-quality",
      "doubt-driven-development",
    ]);
    expect(critic.tools.allow).toEqual(["read", "grep", "find", "ls"]);
    expect(critic.tools.deny).toEqual([]);
    expect(critic.model).toBe("auto");
    expect(critic.systemPromptAppend).toContain("hostile reviewer");
    expect(critic.systemPromptReplace).toBeUndefined();
  });

  it("rejects a persona missing a required field with an error naming file and field", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: Be brief.
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("description");
    expect(definitionError.message).toContain("description");
  });

  it("rejects an unknown top-level key, hinting the known key it resembles", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
descripton: typo of description
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: Be brief.
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // top level
    expect(definitionError.message).toContain("descripton");
    expect(definitionError.message).toContain('did you mean "description"');
  });

  it("rejects an unrelated unknown key without inventing a suggestion", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
zzzqqqxxx: not a field
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptAppend: Be brief.
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.message).toContain("zzzqqqxxx");
    expect(definitionError.message).not.toContain("did you mean");
  });

  it("rejects a persona carrying both prompt fields", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
skills: []
tools:
  allow: []
  deny: []
model: auto
systemPromptReplace: Replace the prompt.
systemPromptAppend: Append to the prompt.
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // whole-file rule
    expect(definitionError.message).toMatch(/exactly one/i);
    expect(definitionError.message).toContain("systemPromptReplace");
    expect(definitionError.message).toContain("systemPromptAppend");
  });

  it("rejects a persona carrying neither prompt field", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
skills: []
tools:
  allow: []
  deny: []
model: auto
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // whole-file rule
    expect(definitionError.message).toMatch(/exactly one/i);
    expect(definitionError.message).toContain("systemPromptReplace");
    expect(definitionError.message).toContain("systemPromptAppend");
  });

  it("wraps syntactically invalid YAML in a DefinitionError", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: persona
name: critic
description: Reviews diffs.
skills: [code-review-and-quality
tools:
  allow: []
  deny: []
`);

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.message).toContain("persona.yaml");
  });

  it("wraps unreadable files in a DefinitionError", async () => {
    const file = join(tmpdir(), "piflow-does-not-exist.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.message).toContain("piflow-does-not-exist.yaml");
  });
});
