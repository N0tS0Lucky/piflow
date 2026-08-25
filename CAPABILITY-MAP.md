# Capability Map: piflow

**Status:** APPROVED (human gate passed)
**Intent:** `docs/intent/multi-agent-workflow-runtime.md`
**Binary/product name:** `piflow` (locked)

| Module id | Responsibility | Depends on |
|---|---|---|
| `definition-format` | Schema + validation for the two layers: **persona library** (prompt posture, skills, tools, model) and **workflows** (steps, loops, `parallel`, `invoke` of reusable workflows, isolation flags, interactive kind). Reference resolution: workflow→persona and workflow→workflow (cycles rejected). Pure data — no execution. | — |
| `run-state` | Durable per-run local state store: leg statuses, baton records, iteration counters, retry counts, touch-manifests (paths/branches claimed per leg). Enforces write-before-handoff. Crash-recovery reads. | `definition-format` (types only) |
| `runtime` | Execution engine: resolves personas → mints pi SDK sessions (`createAgentSession`, tool allowlists), manages durable file handoffs, drives loop control, spins up worktrees under concurrency, survives kill/restart mid-run. | `definition-format`, `run-state` |
| `live-view` | Generated graph view: workflow shape rendered once, run-state painted on (lit nodes, batons on edges, iteration counters, waiting-for-human markers). Reads state, never touches the engine. | `definition-format`, `run-state` |
| `interaction` | Interactive node kind: entry-interview legs, need-human signals pausing the run, attach/detach into live sessions. | `runtime`, `run-state` |
| `cli` | Thin `piflow` command surface wiring it together: `validate`, `run`, `status`, `view`, `attach`, `resume`. Grows incrementally as modules land. | all of the above |

**Build order:** `definition-format` → `run-state` → `runtime` → `live-view` → `interaction` → `cli`
*(in practice `cli` accretes alongside: `validate` lands with the format, `run` with the runtime, `view` with live-view)*

**V1 thin slice:** `definition-format` + `run-state` + minimal `runtime` + read-only `live-view`, running one two-persona loop workflow headlessly, watched through the generated graph. `interaction` is the second slice.

**Deliberately absent:** tracker adapters (GitHub/Jira/Beads/Notion are agent outputs at the edge, not runtime concerns — see intent doc decision 4).

**Locked constraints carried into all specs:**
- Live-view must be layered: a pure, framework-free **view-model builder** (`definitions + run-state snapshot → plain JSON`) consumed by dumb renderers. Web renderer is v1; a TUI later would be a new consumer, not a rewrite.
- Local state files are the only source of truth; no external system is read during execution.
- Dependency direction above is enforced; modules never import "upstream" (e.g. definition-format imports nothing from runtime).

**Spec index:** `SPEC-definition-format.md` (approved). Tasks: GitHub epic [#2](https://github.com/N0tS0Lucky/piflow/issues/2). Plan: `tasks/plan.md`.
