# piflow

Local-first runtime for multi-agent workflows on the [pi](https://pi.dev) SDK.

Read **only** what the current task needs, in this order:

| Need | Open |
|---|---|
| What exists / module boundaries | `CAPABILITY-MAP.md` |
| Why we're building this | `docs/intent/multi-agent-workflow-runtime.md` |
| Contract for a module | `SPEC-<module-id>.md` at repo root |
| How this module will be built | `tasks/plan.md` |
| What to implement right now | GitHub Issues (see Tracker) |

Do not paste those documents into the prompt. Open the file.

## Tracker

**GitHub Issues are the task list.** Do not create `tasks/todo.md`.

- Epic per module; tasks and checkpoints are sub-issues
- Dependencies: native `blocked_by` (`POST /issues/{n}/dependencies/blocked_by` with integer `issue_id`)
- Ready work = open issues whose blockers are all closed
- `tasks/plan.md` is the ordered index of issue numbers, not a second checklist

Issue #1 is origin research, not a build task.

## Stack

TypeScript (ESM, `strict`), zod, `yaml`, vitest. One package, modules as `src/<module-id>/`.

Commands (once scaffolding exists): `npm test` · `npx vitest run <file>` · `npm run build` · `npm run lint`

## Boundaries

- Logic: RED → GREEN → REFACTOR. A test that never failed proves nothing.
- Dependency direction in the capability map is law. Downstream modules do not import upstream.
- Schema / public-API changes: ask first. This is the product contract.
- Trackers (GitHub, Jira, …) are agent outputs at the edge, not runtime state.
- Never commit secrets, `.env`, or credentials.

## Skills

Match the work, don't load the catalog:

- New module, no spec → `spec-driven-development` (map is already approved — do not rewrite it)
- Spec approved, no tasks → `planning-and-task-breakdown`
- Any logic or bug → `test-driven-development`
