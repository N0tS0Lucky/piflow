import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DefinitionError, loadOne } from "../../src/definition-format/index.js";

const fixtures = resolve(import.meta.dirname, "../fixtures");

describe("loadOne (persona)", () => {
  it("loads a valid persona file into a typed object", async () => {
    const critic = await loadOne(
      resolve(fixtures, "valid/personas/critic.yaml"),
    );

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
    const file = resolve(fixtures, "invalid/persona-missing-description.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.path).toBe("description");
    expect(definitionError.message).toContain("description");
  });

  it("rejects an unknown top-level key, hinting the known key it resembles", async () => {
    const file = resolve(fixtures, "invalid/persona-unknown-key-typo.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // top level
    expect(definitionError.message).toContain("descripton");
    expect(definitionError.message).toContain('did you mean "description"');
  });

  it("rejects an unrelated unknown key without inventing a suggestion", async () => {
    const file = resolve(
      fixtures,
      "invalid/persona-unknown-key-unrelated.yaml",
    );

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.message).toContain("zzzqqqxxx");
    expect(definitionError.message).not.toContain("did you mean");
  });

  it("rejects a persona carrying both prompt fields", async () => {
    const file = resolve(fixtures, "invalid/persona-both-prompts.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // whole-file rule
    expect(definitionError.message).toMatch(/exactly one/i);
    expect(definitionError.message).toContain("systemPromptReplace");
    expect(definitionError.message).toContain("systemPromptAppend");
  });

  it("rejects a persona carrying neither prompt field", async () => {
    const file = resolve(fixtures, "invalid/persona-no-prompt.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.path).toBe(""); // whole-file rule
    expect(definitionError.message).toMatch(/exactly one/i);
    expect(definitionError.message).toContain("systemPromptReplace");
    expect(definitionError.message).toContain("systemPromptAppend");
  });

  it("wraps syntactically invalid YAML in a DefinitionError", async () => {
    const file = resolve(fixtures, "invalid/persona-malformed-yaml.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.message).toContain("persona-malformed-yaml.yaml");
  });

  it("wraps unreadable files in a DefinitionError", async () => {
    const file = resolve(fixtures, "invalid/does-not-exist.yaml");

    const err = await loadOne(file).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DefinitionError);
    const definitionError = err as DefinitionError;
    expect(definitionError.file).toBe(file);
    expect(definitionError.message).toContain("does-not-exist.yaml");
  });
});
