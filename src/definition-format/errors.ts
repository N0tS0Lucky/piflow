/**
 * Errors carry location paths — this is the authoring UX, treat it as a feature.
 * This is the only error type that escapes the module.
 */
import { z } from "zod";

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

/** Classic edit-distance DP over two strings. */
export function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(
        row[j] + 1, // deletion
        row[j - 1] + 1, // insertion
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1), // substitution
      );
      diagonal = above;
    }
  }
  return row[b.length];
}

const SUGGESTION_DISTANCE = 2;

/** Closest known key within SUGGESTION_DISTANCE edits, if any. */
function nearestKey(
  key: string,
  knownKeys: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = SUGGESTION_DISTANCE + 1;
  for (const candidate of knownKeys) {
    const distance = levenshtein(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= SUGGESTION_DISTANCE ? best : undefined;
}

/** Object / array schemas we can walk to find the keys valid at a path. */
type WalkableSchema = {
  readonly def: {
    readonly type?: string;
    readonly shape?: Record<string, WalkableSchema>;
    readonly element?: WalkableSchema;
  };
};

/** Keys accepted by the object schema at `path`, or empty if that node is not an object. */
function knownKeysAt(
  schema: WalkableSchema,
  path: readonly PropertyKey[],
): readonly string[] {
  let node: WalkableSchema = schema;
  for (const part of path) {
    if (node.def.type === "array" && node.def.element) {
      node = node.def.element;
      continue;
    }
    const next = node.def.shape?.[String(part)];
    if (!next) return [];
    node = next;
  }
  return node.def.shape ? Object.keys(node.def.shape) : [];
}

/**
 * Wrap a raw zod failure as the module's DefinitionError. Raw zod errors never
 * escape; unrecognized keys get an author-facing message naming the key and a
 * "did you mean" hint against keys valid at the issue path when Levenshtein-close.
 */
export function mapZodError(
  file: string,
  error: z.core.$ZodError,
  schema: WalkableSchema,
): DefinitionError {
  const issue = error.issues[0];
  const path = formatZodPath(issue.path);
  if (issue.code !== "unrecognized_keys") {
    return new DefinitionError(file, path, issue.message);
  }
  const knownKeys = knownKeysAt(schema, issue.path);
  const segments = issue.keys.map((key) => {
    const nearest = nearestKey(String(key), knownKeys);
    return nearest
      ? `${JSON.stringify(String(key))} — did you mean ${JSON.stringify(nearest)}?`
      : JSON.stringify(String(key));
  });
  const message = segments.reduce(
    (acc, segment, index) =>
      index === 0
        ? `Unknown key${segments.length > 1 ? "s" : ""}: ${segment}`
        : `${acc}, ${segment}`,
    "",
  );
  return new DefinitionError(file, path, message);
}
