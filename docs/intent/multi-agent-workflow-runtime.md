# Intent: Multi-Agent Workflow Runtime (piflow)

**Status:** CONFIRMED (interview-me session, explicit user yes)
**Source:** GitHub issue #1 (Relay experiment findings) + capability survey in comments

## Confirmed statement of intent

- **Outcome:** A local-first runtime over [pi](https://pi.dev)'s SDK that executes
  multi-agent workflows *exactly as defined* — workflows composed by reference from a
  reusable, separately-defined **persona library** (built on the skills pack); native
  loop semantics; durable file handoffs; durable local run-state; a live graph view;
  interactive nodes for entry-interviews and mid-run human escalation.
- **User:** Solo developer (mark) orchestrating his own build/review agent fleets —
  everything from feature inception through planning, ticketing, parallel builds,
  adversarial review.
- **Why now:** The Relay experiment proved three load-bearing primitives (fresh context
  per leg, durable state before handoff, independent diff review) while exposing the
  ceremony cost of markdown-charter conventions. pi's SDK makes every needed mechanism
  native; nothing wires personas into executable, watchable flows.
- **Success:** Launch an inception workflow: interview with the user → assessor persona
  vets the plan → work-breakdown persona records tickets → build legs fan out in
  worktrees → critic loop iterates until verified — watched live, attaching when a leg
  signals for help, restartable without losing run-state.
- **Constraint:** Local state files are the source of truth; trackers are edge adapters
  only; soft-law default with structural capability limits per persona (read-only
  critics, write-scoped builders); fresh context per leg; git worktrees under
  concurrency.
- **Out of scope (for now):** Interactive drag-and-drop editor (generated live view
  instead); tracker-coupled scheduling/triggers; multi-user/team features;
  multi-machine distribution; fleet clash-manifest visibility (first post-v1 candidate).

## Key decisions locked during the interview

1. **Runtime-first, not canvas-first.** The visual layer exists for *comprehension* —
   "glancing at YAML isn't as straightforward as a diagram" — not as the product. A
   generated live view satisfies it; an interactive editor does not.
2. **Live graph over static diagram.** The killer artifact answers "which workflow, up
   to step N, which is an iterative loop passing between 2 personas" at a glance:
   nodes lit per leg, edges carrying batons, rejections/retries visible.
3. **Loops are headline constructs**, not edge cases (Builder⇄Critic until-converged).
   Definitions need loop body / max iterations / exit conditions; graph renders
   iteration progress.
4. **Trackers are peripheral by design.** Issues raised by critics and PRs raised by
   builders are *outputs*; feature requests and new projects are *seeds* produced by
   interviews. Runtime works alongside any tracker (GitHub, Jira, Beads, Notion…).
5. **Local durable state is the spine** — written before every handoff (Relay lesson).
   Rich/fast (iteration counters, baton previews); the live view reads it.
6. **Isolation levels, chosen per node:** (1) fresh context always; (2) structural
   capability constraints (`tools` allowlist — read-only Critic); (3) git worktree per
   leg under concurrency. Soft law except irreversible actions.
7. **Two-layer definition format:** persona library (named, versioned: prompt posture +
   loaded skills + tools + model) referenced by workflows. Personas ≈ skill-pack
   compositions (e.g. Critic = code-review-and-quality + doubt-driven-development +
   read-only tools). Workflows stay readable: `critic ← builder until verified`.
8. **Interactive node type.** Entry interviews ("Build new feature" starts as a
   conversation like this session) and need-human escalation: any leg can signal, the
   run pauses at that node, the human attaches into the session, resolves, detaches,
   leg resumes. One attach mechanism serves both.
9. **In-workflow intake pattern.** Breakdown stages write tickets into run-state
   (mirrored to tracker); fan-out stages consume ready tickets within the same graph —
   no polling of external systems.

## Downstream

- Spec: `spec-driven-development` consumes this intent → capability map → module specs.
- Planning: `planning-and-task-breakdown` after spec.
- Reference material: issue #1 comments (pi SDK capability survey: `createAgentSession()`
  configs as serializable nodes, prompt overrides, tool allowlists, tmux philosophy);
  inspiration repos: Zetaphor/pi-webui, ruizrica/agent-pi.
