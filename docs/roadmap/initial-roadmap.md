# Initial VidGen Roadmap

Status: DRAFT / PROVISIONAL
Baseline: 0.1.0

This roadmap is an initial planning scaffold, not an owner-locked commitment. Phase boundaries should be revised when implementation evidence shows a better decomposition.

## Phase 1 — Foundation and manifest ingestion

Goal:
Create the minimum executable project foundation and reliably ingest/validate one upstream VidGen manifest into an internal run context.

Likely concerns:
- runtime/tooling;
- configuration;
- manifest client boundary;
- input validation/normalization;
- run identity seed;
- fixtures and deterministic tests;
- first CLI or worker entrypoint.

## Phase 2 — Edition/story planning

Goal:
Turn governed feed input into a reproducible proposed edition structure.

Likely concerns:
- bounded research;
- story selection;
- theme/angle development;
- provenance;
- deterministic constraints around model-assisted decisions;
- cost/failure behavior.

## Phase 3 — Script and scene plan

Goal:
Produce a structured script and scene/shot plan that later rendering stages can consume without reinterpreting editorial intent.

Likely concerns:
- narration/script schema;
- source support/citations;
- scene timing;
- on-screen text;
- asset requirements;
- validation.

## Phase 4 — Media/provider adapters

Goal:
Introduce replaceable provider boundaries for media generation/acquisition and narration.

Likely concerns:
- provider-neutral requests;
- job IDs/status;
- retries/timeouts;
- cost accounting;
- artifact provenance;
- mocked and limited live qualification.

No provider is selected by this roadmap.

## Phase 5 — Composition and render

Goal:
Assemble approved/generated assets into one reproducible video edition.

Likely concerns:
- timeline/compositor choice;
- transitions/titles;
- audio mixing;
- captions;
- render artifacts;
- restart/resume behavior.

## Phase 6 — Integration and operational hardening

Goal:
Prove the full external-engine boundary with real upstream input and realistic provider/render failure modes.

Likely concerns:
- server-to-server authentication;
- scheduling/orchestration;
- observability;
- cancellation;
- retries/resume;
- artifact retention;
- cost controls;
- deployment packaging;
- end-to-end qualification.

## Deferred until evidence requires them

- multi-tenant product behavior;
- public web UI;
- customer-facing API;
- complex distributed orchestration;
- a permanent database choice;
- a specific cloud/provider stack;
- automated publishing destinations;
- v2 manifest behavior.

The immediate implementation sequence should begin only after /prompt-ass and /prompt-plan refine Phase 1 against the latest ngest manifest boundary and current VidGen repository state.
