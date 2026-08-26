import { z } from "zod";

/**
 * Persona file (`personas/<name>.yaml`) — SPEC-definition-format.md, Format Design.
 * Types are inferred from this schema; never hand-duplicated elsewhere.
 */
export const PersonaSchema = z.strictObject({
  apiVersion: z.literal("piflow/v1"),
  kind: z.literal("persona"),
  name: z.string(),
  description: z.string(),
  skills: z.array(z.string()),
  tools: z.strictObject({
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  }),
  model: z.string(),
  systemPromptReplace: z.string().optional(),
  systemPromptAppend: z.string().optional(),
});

export type Persona = z.infer<typeof PersonaSchema>;
