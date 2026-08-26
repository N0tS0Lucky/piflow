import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { DefinitionError, formatZodPath } from "./errors.js";
import { type Persona, PersonaSchema } from "./schema.js";

/** Load and validate a single persona definition file. */
export async function loadOne(filePath: string): Promise<Persona> {
  const contents = await readFile(filePath, "utf8");
  const data: unknown = parseYaml(contents);
  const result = PersonaSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new DefinitionError(
      filePath,
      formatZodPath(issue.path),
      issue.message,
    );
  }
  return result.data;
}
