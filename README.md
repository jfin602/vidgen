# VidGen

VidGen is a new, standalone cinematic news-generation codebase.

The current direction is to consume a governed news-feed manifest from an upstream system such as ngest and turn that bounded input into a produced video-news edition. The external engine is expected to own the creative pipeline: research, theme/story development, scripting, scene planning, media generation, composition, rendering, and output artifacts.

This repository is intentionally separate from ngest. ngest remains responsible for canonical feed authority and controlled input; VidGen is responsible for downstream creative generation.

## Current state

This repository is in bootstrap state. It currently contains:

- the project/session workflow;
- a port of the ngest Codex phase runner;
- phase-runner tests;
- documentation snapshot tooling;
- a small provisional documentation set;
- a draft initial roadmap.

No provider, video model, rendering stack, persistence design, queue topology, or public API is locked yet.

## Start here

Read BOOT.md first for repository-aware work.

Documentation index:
- docs/README.md
- docs/project-overview.md
- docs/architecture.md
- docs/workflow.md
- docs/roadmap/initial-roadmap.md

## Runner commands

Validate a task stack:

    npm run codex:phase:validate -- <task-folder>

Run implementation prompts:

    npm run codex:phase -- <task-folder>

Run implementation prompts and execute closeout for human review:

    npm run codex:phase -- <task-folder> --closeout

Run the runner test suite:

    npm test

Create a clean committed documentation snapshot:

    npm run docs:snapshot

## Status

Package baseline: 0.1.0

The baseline is a bootstrap marker for the inherited phase-runner version grammar, not a promise about the final product versioning strategy.
