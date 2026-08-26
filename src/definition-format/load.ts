import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { DefinitionError, mapZodError } from "./errors.js";
import {
  type Persona,
  PersonaSchema,
  type Workflow,
  WorkflowSchema,
} from "./schema.js";

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
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  return (data as { kind?: unknown }).kind;
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
