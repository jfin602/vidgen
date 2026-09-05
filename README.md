# VidGen

VidGen is a standalone cinematic news-generation engine.

Its primary production input is a dedicated authenticated ngest integration endpoint. Ngest supplies a governed Distribution Profile feed plus bounded VidGen-specific controls; VidGen independently performs feed interpretation, theme discovery, story selection, editorial planning, scripting, production planning, media generation, composition, rendering, and artifact output.

VidGen does not consume the ngest Profile digest as pre-written editorial output.

## System boundary

Ngest remains responsible for:
- approved-source trust;
- collection and normalization;
- canonical Article identity and provenance;
- duplicate handling and moderation;
- outward Article eligibility;
- Distribution Profile selection and ordering;
- original publisher destinations;
- authentication and delivery of the VidGen integration response.

VidGen remains responsible for:
- validating and normalizing its received input;
- deriving canonical feed/control models;
- generation identity and reproducibility;
- editorial and creative reasoning;
- source traceability through generated artifacts;
- downstream production and rendering.

The systems communicate over HTTP using a VidGen-specific bearer credential. VidGen does not connect directly to ngest persistence.

## Current state

This repository is in bootstrap state. It currently contains:
- the project/session workflow;
- a port of the ngest Codex phase runner;
- phase-runner tests;
- documentation snapshot tooling;
- the initial integration/control architecture;
- a draft implementation roadmap.

No AI provider, video provider, rendering stack, VidGen persistence design, queue topology, or public API is locked yet.

## Start here

Read BOOT.md first for repository-aware work.

Documentation index:
- docs/README.md
- docs/project-overview.md
- docs/architecture.md
- docs/integrations/ngest.md
- docs/control-interface.md
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
