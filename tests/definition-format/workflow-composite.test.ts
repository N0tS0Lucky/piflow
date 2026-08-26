import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOne } from "../../src/definition-format/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Write YAML to a unique temp file. The document itself lives in the test. */
async function writeTempYaml(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "piflow-workflow-"));
  tempDirs.push(dir);
  const file = join(dir, "workflow.yaml");
  await writeFile(file, contents, "utf8");
  return file;
}

describe("loadOne (workflow loop + parallel)", () => {
  it("loads a loop whose body is two node steps (Builder⇄Critic)", async () => {
    const file = await writeTempYaml(`
apiVersion: piflow/v1
kind: workflow
name: review-loop
steps:
  - id: build-review-loop
    type: loop
    maxIterations: 6
    exitWhen:
      batonField: approved
      equals: true
    body:
      - id: build
        type: node
        persona: builder
        worktree: true
      - id: review
        type: node
        persona: critic
`);

    const workflow = await loadOne(file);

    expect(workflow.kind).toBe("workflow");
    if (workflow.kind !== "workflow") return;
    expect(workflow.name).toBe("review-loop");
    expect(workflow.steps).toEqual([
      {
        id: "build-review-loop",
        type: "loop",
        maxIterations: 6,
        exitWhen: { batonField: "approved", equals: true },
        body: [
          {
            id: "build",
            type: "node",
            persona: "builder",
            worktree: true,
          },
          {
            id: "review",
            type: "node",
            persona: "critic",
            worktree: false,
          },
        ],
      },
    ]);
  });
});
