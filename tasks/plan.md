# Implementation Plan: definition-format

## Overview

Implement piflow's first module: a pure TypeScript library that parses YAML persona and workflow files, validates them (including `invoke` cycles), and returns a fully-linked object graph. No execution. Tests are written first (RED → GREEN → REFACTOR) and *are* the executable specification.

**Task list target:** GitHub Issues on `N0tS0Lucky/piflow` (not `tasks/todo.md`). Dependencies use native `blocked_by`. The epic is the parent; each task and checkpoint is a sub-issue.

**Spec:** `SPEC-definition-format.md`
**Intent:** `docs/intent/multi-agent-workflow-runtime.md`
**Map:** `CAPABILITY-MAP.md`

## Architecture Decisions

- **Single package, module folder.** `src/definition-format/` inside one package named `piflow`. No monorepo yet — later modules land as sibling folders (`src/run-state/`, …).
- **zod is the schema; types are inferred.** One source of truth. Unknown keys rejected (`z.object({...}).strict()`).
- **`DefinitionError(file, path, message)` is the only error that escapes the module.** Introduced with the first real parse, not as a polish pass.
- **Step kinds grow one slice at a time** so each task leaves `loadOne` / `loadDefinitions` working for everything specified so far.
- **Directory convention is the composition root:** `personas/*.yaml` + `workflows/*.yaml`. `invoke` resolution and cycle detection come after a directory can load, because they are cross-file rules.
- **No CLI in this module.** `piflow validate` is the `cli` module. This module exports `loadDefinitions` / `loadOne` only.
- **TDD is non-negotiable** (see spec Testing Strategy). A task that lands implementation before a failing test is not done.

## Dependency graph

```
T1 scaffold (npm test / build / lint exist; loadDefinitions RED)
    │
    ├── T2 parse persona (schema + DefinitionError + unknown-key reject)
    │       │
    │       └── T3 parse node + interactive steps
    │               │
    │               └── T4 parse loop + parallel
    │                       │
    │                       └── T5 loadDefinitions(dir) + uniqueness
    │                               │
    │                               └── T6 resolve persona refs
    │                                       │
    │                                       └── T7 resolve invoke + reject cycles
    │                                               │
    │                                               └── T8 round-trip, API freeze, purity test
    │
    └── CP1 after T1
            └── CP2 after T5
                    └── CP3 after T8  (module done)
```

This chain is intentionally linear. There is almost nothing safe to parallelize inside a schema that grows by construction — two agents editing `schema.ts` at once would collide.

## Task List

Tracked as GitHub issues. Numbers filled in after creation.

| Order | Issue | Title | Size | Blocked by |
|---|---|---|---|---|
| — | [#2](https://github.com/N0tS0Lucky/piflow/issues/2) | `[definition-format] Implement module` (epic) | — | — |
| 1 | [#3](https://github.com/N0tS0Lucky/piflow/issues/3) | Scaffold TypeScript package and first failing `loadDefinitions` test | M | — |
| 2 | [#4](https://github.com/N0tS0Lucky/piflow/issues/4) | Parse and validate persona files | M | #3 |
| 3 | [#5](https://github.com/N0tS0Lucky/piflow/issues/5) | Parse `node` and `interactive` workflow steps | S | #4 |
| 4 | [#6](https://github.com/N0tS0Lucky/piflow/issues/6) | Parse `loop` and `parallel` steps | S | #5 |
| 5 | [#7](https://github.com/N0tS0Lucky/piflow/issues/7) | `loadDefinitions` over a directory with uniqueness rules | M | #6 |
| 6 | [#8](https://github.com/N0tS0Lucky/piflow/issues/8) | Resolve persona references | S | #7 |
| 7 | [#9](https://github.com/N0tS0Lucky/piflow/issues/9) | Resolve `invoke` and reject cycles | M | #8 |
| 8 | [#10](https://github.com/N0tS0Lucky/piflow/issues/10) | Round-trip, public API freeze, dependency-direction test | S | #9 |
| CP1 | [#11](https://github.com/N0tS0Lucky/piflow/issues/11) | Checkpoint: package tooling works | — | #3 |
| CP2 | [#12](https://github.com/N0tS0Lucky/piflow/issues/12) | Checkpoint: directory of valid definitions loads | — | #7 |
| CP3 | [#13](https://github.com/N0tS0Lucky/piflow/issues/13) | Checkpoint: definition-format module complete | — | #10 |

Ready work after this plan is approved: **T1 only**.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| zod `.strict()` error paths are ugly; wrapping them poorly loses location | Med | T2 owns `DefinitionError` and a single zod-error mapper. Later tasks reuse it; message quality is tested, not assumed. |
| Cycle detection on `invoke` graphs is easy to get subtly wrong (indirect cycles, self-invoke) | Med | T7 is its own task with fixtures for self-invoke, A→B→A, and A→B→C→A. |
| Scaffold file-count creeps past "one session" | Low | T1 is config-only plus one failing test. No schema yet. |
| Temptation to implement `piflow validate` "while we're here" | Low | Out of scope. Public API is two functions. CLI is a later module. |

## Open Questions

None that block this module. Deferred by spec (do not implement):
- persona `extends:`
- named input-mapping on `invoke` (implicit baton only)
- extra `exitWhen` comparators beyond `equals`

## Standing definition of done (every task)

- Failing test existed before the implementation (RED observed).
- Focused tests pass: `npx vitest run tests/definition-format/`
- No imports from `src/runtime`, `src/run-state`, `src/live-view`.
- `DefinitionError` messages include file + path for any new validation failure.
- Issue closed only after verification checkboxes in the issue body are ticked.
