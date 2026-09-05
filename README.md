# VidGen

VidGen is a standalone cinematic news-generation engine.

Its primary production input is a dedicated authenticated ngest integration endpoint. Ngest supplies a governed Distribution Profile feed plus bounded VidGen-specific controls; VidGen independently performs feed interpretation, enrichment, theme discovery, story selection, editorial planning, scripting, production planning, media generation, composition, rendering, and artifact output.

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
- bounded research/enrichment;
- editorial and creative reasoning;
- source traceability through generated artifacts;
- downstream production and rendering.

The systems communicate over HTTP using a VidGen-specific bearer credential. VidGen does not connect directly to ngest persistence.

## Current MVP direction

The completed engineering worksheet establishes this current direction:

- Node.js + TypeScript application runtime;
- CLI execution for the MVP, one edition at a time;
- durable filesystem artifacts plus structured run metadata;
- standardized JSON schemas for pipeline artifacts;
- Google-first AI/media integrations behind provider-neutral adapters;
- Veo for generated video and the initial anchor/presenter path;
- separate FeedAnalysis, EditorialPlan, Script, and ProductionPlan stages;
- configurable human approval gates, defaulting during development to after Script and before expensive media generation;
- template-first hybrid production;
- Remotion for deterministic composition and responsive broadcast templates;
- FFmpeg for lower-level processing, normalization, encoding, and muxing;
- 1920x1080 16:9 master plus 1080x1920 9:16 derived output;
- H.264 MP4 at 30 fps with burned-in captions for the MVP;
- resumable runs from durable valid stages and reuse of matching expensive generated assets.

Exact schemas, provider/model versions, run-directory layout, retry counts, cost limits, and future service/deployment topology remain provisional.

## Current state

Phase 1 is implemented and closed at version 0.1.5. The repository is now on the 0.2.0 Phase 2 planning baseline.

Implemented Phase 1 capabilities include:
- the Node.js + TypeScript CLI foundation;
- secure bearer-authenticated ngest manifest acquisition;
- fail-closed handling for unsupported manifest continuation;
- VidGen-owned CanonicalFeed, CanonicalControl, and CanonicalInput models and schemas;
- deterministic SHA-256 input fingerprinting;
- filesystem-backed run metadata and atomic CanonicalInput persistence;
- deterministic application and runner tests.

The repository also contains the project/session workflow, Codex phase runner, documentation tooling, completed engineering worksheet, current MVP architecture, and roadmap.

FeedAnalysis and later creative/provider/render stages are not yet implemented.

## Start here

Read BOOT.md first for repository-aware work.

Documentation index:
- docs/README.md
- docs/project-overview.md
- docs/architecture.md
- docs/integrations/ngest.md
- docs/control-interface.md
- docs/planning/initial-engineering-question-worksheet.md
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

Phase 1 completion: 0.1.5

Current Phase 2 baseline: 0.2.0

The phase baseline exists for the inherited phase-runner version grammar and is not a promise about the final public product versioning strategy.
