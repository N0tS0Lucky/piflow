import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefinitions } from "../../src/definition-format/index.js";

describe("loadDefinitions", () => {
  it("is exported and returns a resolved graph for a fixture directory", async () => {
    const dir = resolve(import.meta.dirname, "../fixtures/valid");
    const graph = await loadDefinitions(dir);

    expect(graph.personas).toBeDefined();
    expect(graph.workflows).toBeDefined();
  });
});
