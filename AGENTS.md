# VidGen Agent Guide

Repository: jfin602/vidgen

Read BOOT.md before substantial repository-aware planning, prompt creation, implementation review, architecture analysis, roadmap work, or documentation changes.

## Role split

ChatGPT should primarily:
- investigate;
- reason;
- design;
- plan;
- decompose work;
- review Codex output;
- validate claims and evidence.

Codex is the primary implementation agent.

## Before recommending implementation

1. Identify the current accepted roadmap/task scope.
2. Read the narrowest relevant project and architecture notes.
3. Inspect current implementation and relevant tests.
4. Trace affected producers and consumers.
5. Identify behavior that must remain unchanged.
6. Choose the smallest safe implementation boundary.
7. Define focused tests and broader regression coverage.
8. Identify runtime/provider/browser evidence needed beyond automated tests.

## Review standard

Do not approve work merely because a requested feature appears present.

Review:
- actual task completion;
- architecture boundaries;
- input/output contracts;
- persistence and lifecycle correctness where applicable;
- idempotency and provenance;
- failure handling and retries;
- network and secret safety;
- provider isolation;
- concurrency/race risk;
- focused and regression tests;
- documentation/roadmap drift.

Do not report tests, provider calls, renders, runtime behavior, browser behavior, or repository state as verified unless actually observed.

## Workflow

Documentation:
    /docs-review
    -> explicit approval
    -> /docs-apply

Implementation:
    /prompt-ass
    -> /prompt-plan
    -> /prompt-write <folder>

Execution:
    npm run codex:phase:validate -- <folder>
    npm run codex:phase -- <folder>

The project docs are intentionally provisional at bootstrap. Do not invent permanent laws or freeze provider/architecture choices unless the owner explicitly asks to lock them.
