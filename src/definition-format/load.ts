import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DefinitionError, mapZodError } from "./errors.js";
import { assertUniqueStepIds } from "./validate.js";
import {
  type Persona,
  PersonaSchema,
  type Workflow,
  WorkflowSchema,
} from "./schema.js";
import {
  resolveDefinitions,
  type RawDefinitions,
  type ResolvedDefinitions,
} from "./resolve.js";

/** Load `personas/*.yaml` + `workflows/*.yaml`, then resolve references. */
export async function loadDefinitions(
  dir: string,
): Promise<ResolvedDefinitions> {
  const raw: RawDefinitions = {
    personas: await loadLibrary(join(dir, "personas"), "persona"),
    workflows: await loadLibrary(join(dir, "workflows"), "workflow"),
  };
  return resolveDefinitions(raw);
}

type Kind = Persona["kind"] | Workflow["kind"];
type DefinitionOf<K extends Kind> = Extract<Persona | Workflow, { kind: K }>;

function isKind<K extends Kind>(
  loaded: Persona | Workflow,
  kind: K,
): loaded is DefinitionOf<K> {
  return loaded.kind === kind;
}

async function loadLibrary<K extends Kind>(
  dir: string,
  expectedKind: K,
): Promise<Record<string, DefinitionOf<K>>> {
  const collected: Record<string, DefinitionOf<K>> = {};
  const filesByName = new Map<string, string>();

  for (const file of await listYaml(dir)) {
    const loaded = await loadOne(file);
    if (!isKind(loaded, expectedKind)) {
      throw new DefinitionError(
        file,
        "kind",
        `Expected kind "${expectedKind}" in ${expectedKind}s/, found "${loaded.kind}".`,
      );
    }
    const previous = filesByName.get(loaded.name);
    if (previous !== undefined) {
      throw new DefinitionError(
        file,
        "name",
        `Duplicate ${expectedKind} name "${loaded.name}" (also defined in ${previous}).`,
      );
    }
    filesByName.set(loaded.name, file);
    collected[loaded.name] = loaded;
  }

  return collected;
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
    assertUniqueStepIds(filePath, result.data);
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
