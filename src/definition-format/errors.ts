/**
 * Errors carry location paths — this is the authoring UX, treat it as a feature.
 * This is the only error type that escapes the module.
 */
export class DefinitionError extends Error {
  constructor(
    readonly file: string,
    readonly path: string, // e.g. "steps[2].body[0]"; empty means the whole file
    message: string,
  ) {
    super(path ? `${file} → ${path}: ${message}` : `${file}: ${message}`);
    this.name = "DefinitionError";
  }
}

/** Format a zod issue path as an author-facing pointer: steps[2].body[0]. */
export function formatZodPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number" || /^[0-9]+$/u.test(String(part))) {
      out += `[${String(part)}]`;
    } else {
      out += out.length > 0 ? `.${String(part)}` : String(part);
    }
  }
  return out;
}
