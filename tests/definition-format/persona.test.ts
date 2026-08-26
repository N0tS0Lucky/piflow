import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOne } from "../../src/definition-format/index.js";

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
});
