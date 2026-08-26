import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { DefinitionError, mapZodError } from "./errors.js";
import { type Persona, PersonaSchema } from "./schema.js";

/** Load and validate a single persona definition file. */
export async function loadOne(filePath: string): Promise<Persona> {
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

  const result = PersonaSchema.safeParse(data);
  if (!result.success) {
    throw mapZodError(filePath, result.error, PersonaSchema);
  }
  return result.data;
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
