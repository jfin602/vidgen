# Initial VidGen Roadmap

Status: DRAFT / PROVISIONAL
Baseline: 0.1.0

This roadmap is an initial planning scaffold. Phase boundaries may be revised when implementation evidence shows a safer or more coherent decomposition.

The direct ngest integration and control boundary are current project direction. Provider choices and production contracts remain deliberately open.

## Phase 1 — Foundation and ngest integration boundary

Goal:
Create the minimum executable VidGen foundation and reliably acquire, validate, normalize, and fingerprint one dedicated ngest VidGen integration response.

Likely concerns:
- runtime/tooling;
- runtime secret/configuration handling;
- dedicated ngest bearer-token client;
- authenticated HTTP acquisition;
- response contract validation;
- separation of authentication, transport, and validation failures;
- CanonicalFeed;
- CanonicalControl;
- deterministic normalization;
- deterministic canonical serialization and SHA-256 inputFingerprint;
- provenance/debug metadata that does not redefine creative identity;
- minimal/full/invalid fixtures;
- deterministic tests;
- first CLI or worker entrypoint.

Preserved boundaries:
- no direct ngest database access;
- no reimplementation of ngest feed eligibility/order/provenance logic;
- no ngest digest as creative input;
- no VidGen controls added to generic PHP/Distribution responses;
- ngest transport details stop at the input boundary.

Phase 1 should be refined against the real ngest outward feed contract during /prompt-ass and /prompt-plan. Exact ngest route and persistence details must not be invented from this repository.

## Phase 2 — Feed intelligence

Goal:
Turn CanonicalFeed plus CanonicalControl into a reproducible, source-grounded FeedAnalysis artifact.

Conceptual contract:

    CanonicalFeed
    + CanonicalControl
        -> FeedAnalysis

Likely concerns:
- theme discovery;
- repeated entities and related coverage;
- candidate-story identification;
- story clustering;
- uncertainty/conflict recording;
- Article-level support/provenance;
- hard editorial controls;
- editorial preferences;
- bounded research/retrieval policy;
- deterministic structural validation around model-assisted output;
- provider/cost/failure behavior.

The feed-analysis stage chooses among governed input Articles. It must not reconstruct ngest eligibility logic or invent unavailable source material.

## Phase 3 — Editorial planning

Goal:
Turn FeedAnalysis into a coherent proposed program structure while preserving explicit Article support.

Conceptual contract:

    FeedAnalysis
    + CanonicalControl
        -> EditorialPlan

Likely concerns:
- central program theme;
- story selection;
- grouping related Articles;
- story ordering;
- opening/closing intent;
- transitions;
- must-include/exclude behavior;
- maximum story constraints;
- preference deviation recording where useful;
- Article support mapping;
- reproducible structured output.

## Phase 4 — Script generation

Goal:
Turn the editorial plan into structured, source-grounded narration/presentation content suitable for later production planning.

Conceptual contract:

    EditorialPlan
    + FeedAnalysis
    + CanonicalControl
        -> Script

Likely concerns:
- structured segments;
- factual grounding;
- Article support for factual sections;
- target-duration behavior;
- style/tone/pace controls;
- unsupported-expansion prevention;
- exact publisher provenance;
- output validation;
- provider/cost/failure behavior.

## Production design checkpoint

After Phase 4, generate and inspect several materially different programs before locking ProductionPlan v1.

Do not design the production contract entirely from assumptions.

Use observed script requirements to decide what durable production concepts are actually necessary, including scenes, shots, anchor/presenter use, B-roll, graphics, lower thirds, transitions, narration timing, music, captions, and provider jobs.

If downstream production work would need to invent script-owned semantics, return Planning needed and correct the producer boundary first.

## Phase 5 — Production planning

Goal:
Create a validated ProductionPlan contract based on observed script needs and translate structured Script output into provider-neutral visual/audio production work.

Likely concerns:
- scene/shot structure;
- narration timing;
- visual requirements;
- graphics/lower thirds;
- transitions;
- caption timing;
- provider-neutral asset requirements;
- source/provenance linkage where presentation depends on factual claims;
- restart/resume boundaries.

Exact schema is intentionally deferred until the production design checkpoint.

## Phase 6 — Media and narration providers

Goal:
Introduce replaceable provider boundaries for generated/acquired media and narration.

Likely concerns:
- provider-neutral requests;
- job IDs/status;
- retries/timeouts;
- malformed/partial provider responses;
- cost accounting;
- asset identity and hashes;
- artifact provenance;
- mocked orchestration proof;
- limited live-provider qualification.

No provider is selected by this roadmap.

## Phase 7 — Composition and rendering

Goal:
Assemble planned/generated assets into one reproducible video edition.

Likely concerns:
- timeline/compositor choice;
- titles and transitions;
- audio mixing;
- captions;
- RenderManifest;
- final artifact identity;
- restart/resume behavior;
- failed-render semantics;
- deterministic assembly around nondeterministically generated assets.

## Phase 8 — Integration and operational hardening

Goal:
Prove the full ngest-to-final-video boundary under realistic failure, retry, provider, and render conditions.

Likely concerns:
- live ngest authentication/integration qualification;
- scheduling/orchestration;
- observability;
- cancellation;
- retries/resume;
- idempotency;
- artifact retention;
- cost controls;
- deployment packaging;
- end-to-end provenance;
- failure recovery;
- secret-leak review;
- end-to-end qualification.

## Deferred until evidence requires them

- multi-tenant product behavior;
- public VidGen web UI;
- customer-facing VidGen API;
- complex distributed orchestration;
- a permanent VidGen database choice;
- a specific cloud/provider stack;
- automated publishing destinations;
- stable ProductionPlan schema before real scripts exist;
- exact ngest control table/schema details;
- additional control versions.

The immediate implementation sequence begins with /prompt-ass for Phase 1 against docs/integrations/ngest.md, docs/control-interface.md, current ngest integration evidence when explicitly available, and current VidGen repository state.
