import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as definitionFormatApi from "../../src/definition-format/index.js";

const MODULE_DIR = "src/definition-format";

/** Sibling modules downstream of definition-format must never be imported. */
const FORBIDDEN_SIBLINGS = ["runtime", "run-state", "live-view"] as const;

/** The frozen public surface — SPEC-definition-format.md, public API. */
const FROZEN_VALUES = ["DefinitionError", "loadDefinitions", "loadOne"];

/** Resolved-graph types the two functions need in their signatures. */
const ALLOWED_TYPES = [
  "ExitWhen",
  "Persona",
  "ResolvedDefinitions",
  "ResolvedInvokeStep",
  "ResolvedLoopStep",
  "ResolvedParallelStep",
  "ResolvedSessionStep",
  "ResolvedStep",
  "ResolvedWorkflow",
  "Workflow",
];

async function moduleSourceFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of await readdir(MODULE_DIR)) {
    if (!name.endsWith(".ts")) continue;
    files.set(name, await readFile(join(MODULE_DIR, name), "utf8"));
  }
  return files;
}

/** First path segment after normalizing away ./ and ../ prefixes. */
function firstSegment(moduleSpecifier: string): string {
  return moduleSpecifier.replace(/^(\.\.?\/)+/, "").split("/")[0] ?? "";
}

describe("dependency-direction purity", () => {
  it("imports nothing from runtime, run-state, or live-view", async () => {
    const sources = await moduleSourceFiles();
    expect(sources.size).toBeGreaterThan(0);

    for (const [file, source] of sources) {
      // Static and dynamic imports alike: any module specifier pointing at a
      // sibling fails the suite, no matter how deep below src/ it sits.
      const imported = [
        ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
        ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ].map((match) => match[1]);
      const offenders = imported.filter((spec) =>
        (FORBIDDEN_SIBLINGS as readonly string[]).includes(firstSegment(spec)),
      );

      expect(offenders, `${file} imports forbidden siblings`).toEqual([]);
    }
  });
});

describe("public API freeze", () => {
  it("exposes exactly the frozen value surface through the barrel", async () => {
    const api = definitionFormatApi;
    expect(Object.keys(api).sort()).toEqual(FROZEN_VALUES.slice().sort());
  });

  it("exports no type beyond the resolved graph types the values need", async () => {
    const source = await readFile(join(MODULE_DIR, "index.ts"), "utf8");

    const exported = [...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)]
      .flatMap((block) =>
        block[1]!.split(",").map((name) =>
          name
            .trim()
            .replace(/^type\s+/, "")
            .replace(/\s+as\s+.*$/, ""),
        ),
      )
      .filter((name) => name.length > 0);
    expect(exported).not.toEqual([]);

    const allowed = [...FROZEN_VALUES, ...ALLOWED_TYPES];
    expect(exported.sort()).toEqual(allowed.slice().sort());
  });
});
