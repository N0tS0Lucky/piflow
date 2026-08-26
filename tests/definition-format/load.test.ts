import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDefinitions } from "../../src/definition-format/index.js";

describe("loadDefinitions", () => {
  it("is exported and returns a resolved graph for a generated valid directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "piflow-defs-"));
    const graph = await loadDefinitions(dir);

    expect(graph.personas).toBeDefined();
    expect(graph.workflows).toBeDefined();
  });
});
