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
});
