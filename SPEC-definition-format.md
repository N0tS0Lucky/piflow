# Spec: definition-format

**Module:** `definition-format` (see `CAPABILITY-MAP.md`)
**Status:** APPROVED (human gate passed)

ASSUMPTIONS I'M MAKING (correct now or they're carried):
1. TypeScript (ESM, strict), built directly against pi's SDK ecosystem.
2. Definitions are YAML files validated by zod schemas; types are derived from schemas, never hand-duplicated.
3. Test runner is vitest. Implementation of this module follows `test-driven-development` (RED → GREEN → REFACTOR) — tests are written first and *are* the executable specification of the validation rules.
4. Unknown top-level keys are **rejected**, not ignored — typo protection beats forward-compat at this scale.

---

## Objective

Define and validate piflow's two-layer structured definitions — the replacement for markdown charters:

1. **Persona library** — named, versioned agent identities referenced by workflows: prompt posture, loaded skills, tool allowlist/denylist, model preference.
2. **Workflow definitions** — executable graphs composed of steps referencing personas (or other workflows) by name: headless nodes, interactive nodes, loops, parallel fan-out, and `invoke` of reusable workflows.

This module is a **pure data library**: parse → validate → resolve references → return a typed object graph. It executes nothing, touches nothing outside its input files. Every downstream module (runtime, live-view, cli) consumes its output types.

The schema *is* the product contract. Getting it right here is getting the whole product's authoring experience right.

## Format Design

### Persona file (`personas/<name>.yaml`)

```yaml
apiVersion: piflow/v1
kind: persona
name: critic
description: Adversarial reviewer; verifies builder output against the diff.
skills:
  - code-review-and-quality      # loaded via "load and follow X" instruction
  - doubt-driven-development
tools:
  allow: [read, grep, find, ls]  # structurally read-only Critic
  deny: []
model: auto                       # or an exact provider/model key
systemPromptAppend: |
  You are a hostile reviewer. Find what would break in production.
```

Fields: `apiVersion`, `kind`, `name` (unique), `description`, `skills[]`, `tools.allow[]`, `tools.deny[]`, `model`, `systemPromptReplace?` / `systemPromptAppend?` (exactly one of the two). Tool names are strings; unknown-but-plausible names warn (extensions can register tools), known-typo patterns error.

### Workflow file (`workflows/<name>.yaml`)

```yaml
apiVersion: piflow/v1
kind: workflow
name: build-feature

steps:
  - id: interview
    type: interactive             # pauses for human attach (entry interview)
    persona: interviewer
  - id: assess-plan
    type: node                    # default type, may be omitted
    persona: plan-assessor
  - id: implement
    type: invoke                  # reusable flow, defined once, called here
    workflow: review-loop
  - id: ship-and-docs
    type: parallel                # fan-out; same construct at any nesting depth
    body:
      - id: ship
        type: invoke
        workflow: open-pr
      - id: docs
        type: invoke
        workflow: write-docs
```

Reusable loop, invoked above:

```yaml
# workflows/review-loop.yaml
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
```

### Step types (closed set for v1)

| `type` | Required fields | Meaning |
|---|---|---|
| `node` (default) | `persona` | Headless session. Optional `worktree: true`. |
| `interactive` | `persona` | Same as `node` but the run pauses for human attach. A type, not a flag. |
| `loop` | `maxIterations` (≥1), `body` (non-empty step list) | Iterate `body` until `maxIterations` or optional `exitWhen` predicate over the latest baton. |
| `parallel` | `body` (non-empty step list) | Run body steps concurrently. Same construct whether the body is `node`s or `invoke`s — workflow-level parallelism is just a workflow whose steps are a `parallel` of `invoke`s. |
| `invoke` | `workflow` (name) | Run another named workflow as this step. Baton from the previous sibling is the invoked workflow's input; its final baton is this step's output. |

Design notes:
- **A workflow is a named step list.** That's why composition and parallelism don't need a second syntax at "workflow level" — `invoke` + `parallel` already express "run these two reusable flows at once."
- **Isolation:** `worktree: true|false` per `node`/`interactive` (default `false`). Capability constraints live on the *persona* (tools allow/deny) because they're identity properties. Fresh context per leg is unconditional and therefore not configurable.
- **Exit conditions** are deterministic predicates over the latest baton JSON (`batonField`/`equals`). LLM-judged gates are a runtime concern, not expressible here in v1.
- **Baton contents are free-form** (markdown + optional YAML frontmatter). Per-node output schemas deferred to the runtime spec.
- **No persona inheritance (`extends:`)** until three real workflows prove the need. Duplication is cheaper than a hierarchy we invent now.

### Validation rules (each produces path-aware errors)

- Required fields present; `apiVersion` starts with `piflow/`; `kind` matches directory convention.
- Step/loop/parallel ids unique within their enclosing list; persona refs resolve against the persona library; `invoke.workflow` refs resolve against the workflow library. Errors name file, step id, and the missing name.
- `invoke` graph is a DAG: A→B→A (or longer cycles) is rejected with the cycle path listed.
- `systemPromptReplace` XOR `systemPromptAppend`; loop/parallel bodies non-empty; `maxIterations >= 1`.
- Unknown keys rejected at every level with a pointer ("workflows/build-feature.yaml → steps[2].body[0] → 'worktre' did you mean 'worktree'?").
- Resolution result: fully-linked typed object graph — personas attached to node steps, invoked workflows attached (and themselves resolved) to invoke steps. No dangling names.

## Tech Stack

- TypeScript (ESM, `strict: true`), zod for schemas, `yaml` package for parsing, vitest for tests.

## Commands

```
Build:     npm run build          # tsc -> dist/
Test:      npm test               # vitest run  (full suite — use before calling a module done)
Focused:   npx vitest run path/to/file.test.ts   # RED/GREEN loop
Lint:      npm run lint           # eslint + prettier check
Validate:  npx tsx src/cli.ts validate <file>   # once cli module wires this module in
```

These commands do not exist yet. They will be introduced with the first RED test of this module (package scaffolding is part of task 1). Until then the repository has no test runner — TDD's "discover the stack first" rule will be satisfied by *creating* that stack, then never assuming a different command.

## Project Structure

```
src/definition-format/
  schema.ts       # zod schemas: persona, workflow, every nested shape
  load.ts         # file discovery + YAML parse + apiVersion/kind dispatch
  validate.ts     # cross-file rules: uniqueness, reference resolution, cycle detection
  resolve.ts      # linked object graph builder (personas + invoked workflows attached)
  index.ts        # public API: loadDefinitions(dir), loadOne(file)
tests/definition-format/
  ...mirrors src/ — tests generate their own YAML under the OS temp dir; no fixture tree
```

## Code Style

You don't need to judge TypeScript idiom — judge whether the *intent* of these rules matches how you want the codebase to feel. I'll own the syntax.

**What "good TypeScript" means here, in English:**

1. **The compiler is a collaborator, not a suggestion.** `strict: true`, no `any`, no silenced errors. If a value might be missing, the type says so and callers handle it.
2. **Types come from the schema, once.** We write the zod schema; TypeScript types are inferred (`z.infer<typeof PersonaSchema>`). Two handwritten copies of the same shape will drift; one source of truth cannot.
3. **Step kinds are a closed list the compiler understands.** A `loop` step cannot be accessed as if it had a `persona` field — that's a type error, not a runtime surprise. (This is a "discriminated union" — `type` is the tag.)
4. **Errors tell the author where they went wrong.** File + path + message, always. Raw library errors never escape the module.
5. **The public surface is tiny.** Two functions. Everything else stays inside the module.

```typescript
// Errors carry location paths — this is the authoring UX, treat it as a feature.
export class DefinitionError extends Error {
  constructor(
    readonly file: string,
    readonly path: string,      // e.g. "steps[2].body[0]"
    message: string,
  ) {
    super(`${file} → ${path}: ${message}`);
  }
}

// Public API surface stays tiny; everything else module-private.
export async function loadDefinitions(dir: string): Promise<ResolvedDefinitions>;
export async function loadOne(file: string): Promise<ResolvedDefinitions>;
```

Conventions I'll hold myself to (you don't have to memorize them): exported functions noun-ish and pure; never throw raw zod errors — wrap in `DefinitionError`; no default exports.

## Testing Strategy

This module is implemented under `test-driven-development`. The tests *are* the specification of the validation rules. Each test constructs the document it loads: minimal YAML inline in the test itself, written to a fresh file under the OS temp dir at runtime and read back through the real parser. Input and expected output live together, so no shared example files can drift out from under the assertions.

**Cycle (every behavior, no exceptions):**
1. **RED** — write one test that describes the behavior and watch it fail for the right reason (missing function, or assertion fail — not a typo in the test).
2. **GREEN** — write the minimum code that makes that test pass.
3. **REFACTOR** — clean up with the suite green. No behavior changes during cleanup.

**Prove-it for bugs:** a reported parse/validation bug starts as a failing test + assertion, then the fix, then the same test passing.

**What to test (this module is almost entirely small/unit tests):**

| Kind | Share | What |
|---|---|---|
| Small / unit | ~95% | Each validation rule, each step type, each error path. Pure functions, no network, no subprocesses. |
| Medium / integration | ~5% | `loadDefinitions` over a generated temporary directory of real files (real YAML written by the test, real `yaml` parser — no mocks). |
| Large / e2e | 0% here | Belongs to runtime + cli later. |

**Rules of the tests themselves:**

- Test **state, not interactions** — assert on the resolved graph or the `DefinitionError` message, never on "zod.parse was called."
- **DAMP over DRY** — each test tells a complete story. Duplicated 8-line YAML in two tests is better than a shared helper the reader has to chase.
- **Real implementations over mocks.** The only I/O is real files: each test writes its own YAML to a unique temp path and reads it back. Do not mock `yaml`, zod, or the filesystem.
- **Self-contained test data.** No shared fixture directories. Editing one case never breaks another; deleting a case deletes its data with it.
- **Arrange–Act–Assert**, one concept per test, names that read as specifications (`it('rejects an invoke that names a missing workflow')`, not `it('works')`).
- Message quality is tested: every invalid-case assertion checks the error contains the expected file + path fragment. Authoring UX is a feature.
- **Purity / dependency-direction test:** this module imports nothing from `runtime`, `run-state`, or `live-view`. That's a test, not a hope.
- Coverage target ≥90% lines. This is pure logic; gaps are untested rules.

**Commands during the loop:** focused file for RED/GREEN (`npx vitest run tests/definition-format/<file>.test.ts`); full `npm test` before calling the module done. Never re-run the same command on unchanged code for reassurance.

## Boundaries

- **Always:** write the failing test first; reject unknown keys; include file+path in every error; keep the module free of I/O beyond reading definition files; version via `apiVersion` from day one.
- **Ask first:** any change to field names/shapes (this is the product contract — breaking changes ripple into runtime, view, and every authored workflow); adding a new step type beyond the closed set above.
- **Never:** execute anything (no session spawns, no subprocesses, no network); write files; silently coerce or ignore malformed input; skip or delete a failing test to go green; mock the YAML parser or the filesystem for happy-path loads.

## Success Criteria

1. `loadDefinitions(<generated valid dir>)` returns a resolved graph where every `node`/`interactive` step carries its linked persona, and every `invoke` step carries its linked (and itself resolved) workflow; zero dangling references.
2. A workflow referencing a missing persona fails with an error naming the workflow file, step id, and persona name.
3. An `invoke` referencing a missing workflow fails the same way, naming the missing workflow.
4. A cycle `A invoke B invoke A` fails with an error listing the cycle path.
5. A typo'd key at any depth fails with that key's full path in the message.
6. A loop missing `maxIterations` or with an empty body, and a parallel with an empty body, fail with a path pointing at the offending step.
7. All valid documents generated by the suite — including at least one that `invoke`s another workflow and one that uses `parallel` of `invoke`s — round-trip through load→serialize→load.
8. Dependency-direction test passes (no imports from sibling modules).
9. `npm test && npm run lint && npm run build` all green.
10. Every success criterion above is witnessed by a test that was RED before the code that satisfies it existed.

## Resolved questions (from review)

1. **Persona inheritance (`extends:`)** — deferred until necessary. Agreed.
2. **Multi-file / composable workflows** — **in scope.** `type: invoke` is first-class. Cycles rejected at resolve time. Input-mapping syntax deferred until a real workflow needs more than "previous baton in, final baton out."
3. **`interactive` is a `type`, not a flag.** Agreed.

## Still open (minor)

- Input/output mapping on `invoke` (named parameters vs implicit baton). Default: implicit baton. Revisit when a reusable flow needs two distinct inputs.
- Comparator set on `exitWhen` beyond `equals`. Add when a real loop needs `exists` / `notEquals` / numeric compare.
