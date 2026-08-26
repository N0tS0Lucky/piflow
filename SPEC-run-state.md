# Spec: run-state

**Module:** `run-state` (see `CAPABILITY-MAP.md`)
**Status:** APPROVED (human gate passed)

ASSUMPTIONS I'M MAKING (correct now or they're carried):
1. TypeScript (ESM, `strict: true`), vitest, mandatory TDD (`test-driven-development`) — identical discipline to `definition-format`.
2. State persists as plain JSON files under one directory per run. No database, no markdown artifacts, no hidden formats. Local files are the only source of truth.
3. Single-writer model: the piflow runtime holds the only writing handle to a run directory; live-view and humans are concurrent readers. Durability + crash safety come from atomic temp-file-then-rename writes, not locks.
4. `definition-format` is consumed as **types only**. run-state never parses YAML, never validates definitions, never executes anything.
5. Scheduling ("which leg runs next") is the **runtime's** job. run-state answers questions ("what completed, what's pending, what was the last verdict") with reads that survive any crash; it does not interpret the workflow graph.
6. Tracker adapters are out of scope forever — tickets in run-state are generic records; mirroring is an edge concern.

**Governing design principle — enforce, don't request:** anything a workflow needs from an agent (a verdict, a claimed path, a staged ticket) exists as a structurally validated record written through module machinery. Agent-authored freeform prose is never a load-bearing channel, so no part of this module depends on persona compliance, and nothing needs brevity instructions duplicated into personas. Agents' *detailed* work product lives where it always lives — the code, the diff, the branches, the session traces — and consumers pull it via pointers when they want it.

---

## Objective

The durable state spine of every piflow run (intent decision 5): a local store that
records, per run, **what has happened and where the run stands** — leg statuses,
handoff records (including loop exit-verdicts), iteration counters, retry counts,
touch-manifests (paths/branches observed per leg), and intake tickets.

Two properties make it the spine rather than a log:

1. **Write-before-handoff (Relay lesson).** A handoff cannot be recorded until the
   producing leg's completion is durably on disk. Every call returns only after the
   data survives a kill.
2. **Crash-recovery reads.** At any moment — including mid-write, mid-loop, mid-parallel
   fan-out — reopening the run directory yields the exact standing state, from which the
   runtime can resume without losing work and live-view can render without asking the engine.

Success looks like: kill -9 a run anywhere, reopen, and the store reports precisely which
legs completed, what the last handoff carried, and what each leg had touched — with zero
corrupted files and zero lost transitions. Everything the store exposes is plain serializable
data, because live-view's view-model builder consumes it (`definitions + run-state snapshot → JSON`).

## What crosses a handoff (and what doesn't)

A handoff record is **machine-assembled metadata only** — stamped by the runtime from
facts it already holds. Personas never author handoffs. There is no narrative payload:

```
handoffs/000017.json
{
  "apiVersion": "piflow/v1",
  "ordinal": 17,
  "fromLeg": "build@iter2",
  "toLeg": "review@iter3",
  "verdicts": { "approved": false },        // typed fields read by exitWhen
  "touchRefs": ["build@iter2"],             // pointer into touches/
  "ticketRefs": []                          // pointer into tickets/
}
```

- **What changed** is not recorded here at all — it *is* the working tree / branch /
  diff, pulled by the successor via its tools. Pointers over prose.
- **Position** (step, iteration, attempt) is derivable from leg records alone.
- **Exit-verdicts** (`approved`, …) are structured values the producer submits through a
  runtime-defined mechanism (e.g. a typed final tool call — mechanism specified by the
  `runtime` module later; misspelled or missing required verdict keys fail construction).
- Loop control pays only for this record: `exitWhen` predicates read named verdict
  fields off the latest handoff — deterministic, token-free, unchanged in spirit from
  the locked definition-format semantics ("the latest baton" ≡ "the latest handoff record").

Detail belongs to traces and files, referenced by path; run-state persists facts, not prose.

## Data Model

### Run directory layout

```
<runRoot>/<runId>/
  run.json                   # { apiVersion, runId, workflowName, status, startedAt }
  legs/<legKey>.json         # one durable record per leg (status, attempts, timestamps)
  handoffs/000017.json       # append-only, zero-padded ordinals; machine-stamped records above
  loops/<loopKey>.json       # { loopKey, iterations, maxIterations?, lastVerdictField? }
  touches/<legKey>.json      # touch-manifest: paths / git branches claimed per leg
  tickets/<ticketId>.json    # generic intake tickets (intent decision 9)
```

### Records

- **Leg** `{ legKey, stepPath, stepKind, personaName?, status, attempts, startedAt?,
  endedAt?, error? }` — closed status set `pending | running | waiting-human | completed
  | failed` (`waiting-human` reserved now so `interaction` lands later without migration).
- **Handoff** as shown above — closed key set, all references resolvable inside the run dir.
- **Ticket** `{ ticketId, status, ...passthrough }` — only `ticketId` and `status` are
  meaningful to run-state; every other field is preserved verbatim for consumers.

### Identity rule

`legKey` encodes position deterministically (`<stepPath>@iter<n>` inside loops,
parallel branches distinguished by body indices). Same leg, same key, before and
after a crash — recovery depends on it.

## Public API (target surface)

```typescript
export class RunStateError extends Error { /* operation, file, message */ }

export async function createRun(runRoot: string, workflowName: string): Promise<RunStore>;
export async function openRun(runDir: string): Promise<RunStore>;   // crash-recovery entry

interface RunStore {
  startLeg(legKey: LegKey, meta: LegMeta): Promise<void>;            // pending → running
  waitHuman(legKey: LegKey): Promise<void>;                          // running → waiting-human
  resumeLeg(legKey: LegKey): Promise<void>;                          // waiting-human → running
  completeLeg(legKey: LegKey): Promise<void>;
  failLeg(legKey: LegKey, error: string): Promise<void>;             // attempts += 1 persists
  retryLeg(legKey: LegKey): Promise<void>;

  recordHandoff(h: { fromLeg: LegKey; toLeg: LegKey; verdicts: VerdictMap }): Promise<HandoffRef>;
  latestHandoff(): Promise<Handoff | null>;
  handoff(ref: HandoffRef): Promise<Handoff>;

  bumpIteration(loopKey: LoopKey): Promise<number>;                  // returns new count
  loopState(loopKey: LoopKey): Promise<{ iterations: number; maxIterations?: number }>;

  claimTouch(legKey: LegKey, kind: 'path' | 'branch', value: string): Promise<void>; // conflict-checked
  touchesOf(legKey: LegKey): Promise<Touch[]>;

  putTicket(t: Ticket): Promise<void>;
  readyTickets(status?: string): Promise<Ticket[]>;

  snapshot(): Promise<RunSnapshot>;                                  // pure JSON, for live-view
}
```

Every method returns only once its effect is atomically durable on disk. All reads are
reconstruction from files — no in-memory-only truth ever exists.

### Enforced rules (each produces a `RunStateError` naming the files involved)

- **Write-before-handoff:** `recordHandoff` fails unless `fromLeg` is recorded
  `completed`. The handoff record must exist and validate before the handoff is considered made.
- **Closed-shape handoffs:** unknown keys, missing required fields, or unresolvable
  refs (`touchRefs`/`ticketRefs` pointing outside the run dir) fail construction —
  the schema *is* the size cap; there is no freeform region to bloat.
- **Legal transitions only:** completing a never-started leg, resuming a running leg,
  starting an already-running leg — all rejected with both current and requested states named.
- **Touch conflicts:** claiming a `branch` already claimed by another *active* leg
  names both legs. Paths likewise. Claims by completed legs are re-claimable.
- **Crash tolerance:** a partially-written file is impossible to observe (rename
  atomicity); a corrupt/truncated file that does appear on disk (e.g. externally damaged)
  is reported as a `RunStateError` naming the file — never silently skipped, never guessed around.

## Tech Stack

TypeScript (ESM, `strict: true`), `node:fs/promises`, vitest. No `yaml` dependency —
records are plain JSON; no markdown parsing exists in this module. Types imported from
`definition-format` only (`type ResolvedStep` etc.).

## Commands

```
Build:     npm run build
Test:      npm test
Focused:   npx vitest run tests/run-state/<file>.test.ts
Lint:      npm run lint
```

These all exist already (scaffolded with T1 of definition-format).

## Project Structure

```
src/run-state/
  index.ts        # public API: createRun, openRun, RunStore, RunStateError, types
  paths.ts        # run-dir layout + legKey/loopKey derivation (identity rules live here)
  records.ts      # leg / handoff / loop / touch / ticket readers+writers (atomic)
  snapshot.ts     # pure run-state snapshot builder (definitions-free plain JSON)
tests/run-state/
  ...mirrors src/; every test owns its temp dir; no fixtures shared between tests
```

## Code Style

Same rules as `SPEC-definition-format.md` §Code Style (compiler as collaborator, one
source of truth for shapes, tiny public surface, errors always carry file + operation,
never throw raw fs errors). Illustration of the durability idiom used throughout:

```typescript
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, file); // readers observe either old-or-new, never torn
}
```

Conventions: exported functions noun-ish/pure; every rejected transition wraps into
`RunStateError`; no default exports.

## Testing Strategy

TDD, unchanged from definition-format. Tests **are** the specification of the durability rules.

| Kind | Share | What |
|---|---|---|
| Small / unit | ~85% | Transition rules, handoff preconditions + closed-shape rejection, key derivation, claim conflicts, error messages |
| Medium / integration | ~15% | Real-temp-dir sequences: run → kill (close store abruptly) → reopen → assert recovered state exactly; simulate torn writes by leaving `.tmp` files and corrupting bytes deliberately |

Specifically: crash tests close and reopen the store **without graceful shutdown**
between operations; corruption tests damage files directly and assert named errors;
round-trip asserts `snapshot()` output survives `JSON.stringify → parse` losslessly;
oversize/narrative-shaped handoff input (unknown keys, extra prose fields) is rejected
at construction. No mocks of the filesystem. Message-quality assertions on every invalid case.

## Boundaries

- **Always:** durable-return on every mutation; atomic writes; wrap every failure in
  `RunStateError`; keep reads reconstructible purely from disk; version persisted shapes
  via `apiVersion` in `run.json` from day one; keep handoff records closed-schema.
- **Ask first:** any change to persisted file shapes (this is the contract consumed by
  runtime, live-view, interaction); adding fields to the closed leg-status set; adding
  any agent-authored content channel to handoff records.
- **Never:** execute sessions/subprocesses/network; write outside the run directory;
  contact trackers; interpret the workflow graph (scheduling belongs to runtime);
  author or store narrative payloads (traces and diffs exist for that); silently skip a
  corrupt file; delete failing tests to go green.

## Success Criteria

1. `createRun` then every mutating operation is observable on disk immediately and
   identically after `openRun` in a fresh process — state lives in files, not memory.
2. `recordHandoff` without a durably-completed source leg fails, naming both legs
   (write-before-handoff proven by a test that was RED first).
3. A handoff survives kill/reopen: `latestHandoff()`/`handoff(ref)` return the identical
   record and ordering after recovery, including across parallel and loop-heavy sequences.
4. Iteration counters and retry counts persist across kill/reopen and never double-count.
5. Touch-manifest conflicts fail naming both competing legs; completed-leg claims are re-claimable.
6. A deliberately corrupted state file yields `RunStateError` naming the file — no silent skips.
7. `openRun` after abrupt termination mid-sequence reconstructs exactly the last durable
   truth; stray `.tmp` files from interrupted writes never affect any read.
8. Handoff records accept only their closed key set — any unknown/prose-shaped field
   fails construction with the offending key named (the structural answer to payload bloat).
9. `snapshot()` is pure JSON (survives `stringify→parse` deep-equal) and contains
   everything live-view needs: run status, per-leg status/attempts, loop progress, latest
   handoff summary — without importing run-state classes.
10. Dependency-direction purity test passes: imports nothing from `runtime`,
    `live-view`, `interaction`, `cli`; from `definition-format`, types only.
11. `npm test && npm run lint && npm run build` all green; every criterion above
    witnessed by a named RED-first test.

## Resolved questions (from review)

1. **Run root location** — caller supplies `runRoot`. The module stays cwd-independent;
   the `cli` module later defaults it to `<project>/.piflow/runs/` with an override flag.
   Agreed.
2. **Resume-point computation** — run-state exposes rich snapshot + per-leg record reads
   only; the resume plan is a pure function in `runtime` over `(resolvedDefinitions,
   snapshot)`. Boundary test for future query methods: answerable from records alone →
   belongs here; requires workflow-graph knowledge → runtime. Agreed.
3. **Payload elimination** — the Relay-style "baton" document is dropped entirely. Nothing
   crosses a handoff unless machinery enforces it: handoff records are machine-stamped,
   closed-schema metadata (verdicts + refs); what-changed is pulled from the diff/files
   via tools; forensic detail stays in traces. Agreed — supersedes the drafted markdown+
   frontmatter brief format, and makes retention policy moot (records are ~hundreds of bytes).
4. **Retention** — closed as moot by 3. Append-only handoff records; prune never; revisit
   only if record *counts* (not sizes) ever matter. Agreed.

## Still open (minor)

1. **Verdict submission mechanism** — how an agent renders a verdict (typed tool call vs
   structured completion) is `runtime` territory; run-state commits only to storing typed
   `verdicts` fields and rejecting malformed ones.
2. **Terminology propagation** — "baton"/"brief" are dead terms; "handoff record" replaces
   them. Canonical definitions land in the domain glossary (#24) before any normative use
   in downstream specs; capability-map wording ("baton records") updates alongside.
3. **Ticket field minimums** — proposal: require only `ticketId` + `status`, pass
   everything else through untouched. Consumers define their own richer shapes.
