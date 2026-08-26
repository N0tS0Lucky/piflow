import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DefinitionError, mapZodError } from "./errors.js";
import {
  type Persona,
  PersonaSchema,
  type Workflow,
  WorkflowSchema,
} from "./schema.js";

/** Directory load result. Reference linking is a later task. */
export type LoadedDefinitions = {
  personas: Record<string, Persona>;
  workflows: Record<string, Workflow>;
};

/** Load `personas/*.yaml` and `workflows/*.yaml` from a definitions directory. */
export async function loadDefinitions(
  dir: string,
): Promise<LoadedDefinitions> {
  const personas: Record<string, Persona> = {};
  const workflows: Record<string, Workflow> = {};

  for (const file of await listYaml(join(dir, "personas"))) {
    const loaded = await loadOne(file);
    if (loaded.kind !== "persona") {
      throw new DefinitionError(
        file,
        "kind",
        `Expected kind "persona" in personas/, found "${loaded.kind}".`,
      );
    }
    personas[loaded.name] = loaded;
  }

  for (const file of await listYaml(join(dir, "workflows"))) {
    const loaded = await loadOne(file);
    if (loaded.kind !== "workflow") {
      throw new DefinitionError(
        file,
        "kind",
        `Expected kind "workflow" in workflows/, found "${loaded.kind}".`,
      );
    }
    workflows[loaded.name] = loaded;
  }

  return { personas, workflows };
}

/** Direct `*.yaml` children of `dir`; missing directory → no files. */
async function listYaml(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (cause) {
    if (isMissingDir(cause)) return [];
    throw asDefinitionError(dir, "Cannot read directory", cause);
  }
  return names
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => join(dir, name));
}

function isMissingDir(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

/** Load and validate a single persona or workflow definition file. */
export async function loadOne(filePath: string): Promise<Persona | Workflow> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (cause) {
    throw asDefinitionError(filePath, "Cannot read file", cause);
  }

  let data: unknown;
  try {
    data = parseYaml(contents);
  } catch (cause) {
    throw asDefinitionError(filePath, "Invalid YAML", cause);
  }

  if (kindOf(data) === "workflow") {
    const result = WorkflowSchema.safeParse(data);
    if (!result.success) {
      throw mapZodError(filePath, result.error, WorkflowSchema);
    }
    return result.data;
  }

  const result = PersonaSchema.safeParse(data);
  if (!result.success) {
    throw mapZodError(filePath, result.error, PersonaSchema);
  }
  return result.data;
}

function kindOf(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  return "kind" in data ? data.kind : undefined;
}

/** DefinitionError is the only error type that leaves this module. */
function asDefinitionError(
  file: string,
  summary: string,
  cause: unknown,
): DefinitionError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new DefinitionError(file, "", `${summary}: ${detail}`);
}
