# piflow

A local-first runtime that executes multi-agent workflows over the
[pi coding agent](https://pi.dev) SDK — structured definitions composed from a
reusable persona library, executed exactly as defined, with a live graph view.

(formerly *pi-workflow-designer* — renamed when we realized the runtime is the
product and the designer is a lens)

The goal: define multi-agent workflows (stages, personas, gates, handoffs)
in a way that is **designed visually**, **validated before execution**, and
**tracked where work already lives** — not in convention-over-markdown.

## Status

Early — design phase. See `docs/intent/multi-agent-workflow-runtime.md`,
`CAPABILITY-MAP.md`, and GitHub issue #1.

## Why

A live experiment with an existing orchestration method (Relay) proved the
load-bearing primitives while exposing how much ceremony a markdown-charter
convention adds. This project starts from those primitives and builds up:
a validated workflow graph with real UI, rather than prose conventions.
