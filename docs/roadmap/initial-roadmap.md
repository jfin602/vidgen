# Initial VidGen Roadmap

Status: CURRENT MVP DIRECTION / PROVISIONAL PHASE BOUNDARIES
Phase 1 completion: 0.1.5
Current baseline: 0.2.0

This roadmap is the current implementation scaffold. Phase boundaries may be revised when implementation evidence shows a safer or more coherent decomposition.

The direct ngest integration/control boundary and the initial engineering worksheet decisions are current project direction. Exact schemas, provider/model versions, retry values, template taxonomy, and deployment topology remain provisional.

## Cross-phase MVP constraints

The roadmap assumes:
- Node.js + TypeScript;
- CLI execution, one edition at a time;
- filesystem-backed durable artifacts plus metadata;
- standardized VidGen-owned JSON schemas for pipeline artifacts;
- Google-first providers behind replaceable adapters;
- Veo for generated video and the initial presenter path;
- template-first hybrid production;
- Remotion + FFmpeg composition;
- configurable human approval gates;
- 16:9 master plus 9:16 vertical output;
- resumable stage artifacts and reusable expensive provider assets.

No downstream stage may consume unvalidated model output.

## Phase 1 — Foundation and ngest integration boundary

Status: COMPLETE / CLOSED AT 0.1.5

Goal:
Create the minimum executable Node.js + TypeScript CLI foundation and reliably acquire, validate, normalize, persist, and fingerprint one dedicated ngest VidGen integration response.

Likely concerns:
- Node.js/TypeScript project/runtime tooling;
- CLI entrypoint;
- runtime secret/configuration handling;
- dedicated ngest bearer-token client;
- authenticated HTTP acquisition;
- response contract validation;
- separation of authentication, transport, and validation failures;
- CanonicalFeed;
- CanonicalControl;
- CanonicalInput durable JSON artifact;
- deterministic normalization;
- deterministic canonical serialization and SHA-256 inputFingerprint;
- provenance/debug metadata that does not redefine creative identity;
- initial filesystem run/artifact layout;
- minimal/full/invalid fixtures;
- deterministic tests.

Preserved boundaries:
- no direct ngest database access;
- no reimplementation of ngest feed eligibility/order/provenance logic;
- no ngest digest as creative input;
- no VidGen controls added to generic PHP/Distribution responses;
- ngest transport details stop at the input boundary.

Phase 1 is implemented and closed. The resulting boundary includes secure manifest acquisition, canonical normalization, deterministic inputFingerprint generation, and durable CLI run artifacts. Exact ngest continuation request semantics remain unresolved; the implementation correctly fails closed on non-null nextCursor rather than inventing producer-owned behavior.

## Phase 2 — Feed intelligence and bounded enrichment

Status: CURRENT / PLANNING BASELINE 0.2.0

Goal:
Turn CanonicalInput into a reproducible, source-grounded FeedAnalysis JSON artifact.

Conceptual contract:

    CanonicalInput
        -> bounded enrichment/retrieval where needed
        -> FeedAnalysis

Likely concerns:
- governed publisher-page retrieval;
- VidGen-controlled HTTP fetching where practical instead of model URL-context fetching;
- redirect/timeout/size/content-type/SSRF safety;
- provenance-aware normalized research results;
- optional separately authorized broader research capability;
- theme discovery;
- repeated entities and related coverage;
- candidate-story identification;
- story clustering;
- uncertainty/conflict recording;
- Article-level support/provenance;
- hard editorial controls;
- editorial preferences;
- Google-first AI provider adapter;
- provider-native structured output where available;
- VidGen JSON Schema + runtime + semantic validation;
- bounded repair/retry;
- provider/cost/failure behavior.

The feed-analysis stage chooses among governed input Articles. It must not reconstruct ngest eligibility logic or silently replace upstream truth with research output.

Phase 2 may build against validated CanonicalInput and deterministic fixtures, but it must not treat multi-page production input as qualified until ngest nextCursor request semantics are explicitly resolved.

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
- standardized JSON Schema;
- provider-native structured output where available;
- runtime/semantic validation and bounded repair/retry.

EditorialPlan remains separate from FeedAnalysis and must not contain Remotion component details or invent final composition structure.

## Phase 4 — Script generation

Goal:
Turn EditorialPlan into structured, source-grounded presentation content that owns editorial meaning required by production.

Conceptual contract:

    EditorialPlan
    + FeedAnalysis
    + CanonicalControl
        -> Script

Likely concerns:
- stable segment identity;
- factual grounding;
- supporting Article IDs/provenance;
- narration/presentation text;
- intended duration;
- emphasis/priority;
- quoted/on-screen text;
- visualizable entities/events/subjects;
- transition intent;
- factual/visual caution metadata;
- target-duration behavior;
- style/tone/pace controls;
- unsupported-expansion prevention;
- standardized JSON Schema;
- provider-native structured output where available;
- runtime/semantic validation and bounded repair/retry.

The default development flow introduces a configurable human approval gate after Script and before expensive media generation.

## Production design checkpoint

After Phase 4, generate and inspect several materially different valid Script artifacts before locking ProductionPlan v1.

The high-level production architecture is already selected:
- template-first hybrid newscast;
- first-class anchor/presenter;
- Veo as the initial video/presenter provider;
- Remotion code + JSON template definitions;
- generated-media fallback hierarchy;
- Remotion + FFmpeg final composition;
- responsive 16:9 and 9:16 output.

The checkpoint determines the exact ProductionPlan schema and scene/shot contract from observed Script needs.

If downstream production work would need to invent Script-owned semantics, return Planning needed and correct the Script boundary first.

## Phase 5 — Production planning and template contract

Goal:
Create a validated ProductionPlan v1 and translate structured Script output into provider-neutral scene/template/media work.

Likely concerns:
- scene/shot structure;
- anchor/presenter segments;
- generated B-roll/media requirements;
- template selection;
- declared template slots;
- timing constraints;
- safe areas;
- responsive behavior;
- graphics/lower thirds;
- transitions;
- caption requirements;
- provider-neutral asset requirements;
- source/provenance linkage;
- restart/resume boundaries;
- JSON template definition schema;
- ProductionPlan JSON Schema and semantic validation.

Remotion components implement deterministic scenes; ProductionPlan consumes template capabilities and must not depend on component internals.

## Phase 6 — Generated media and presenter providers

Goal:
Implement provider-neutral media generation/acquisition boundaries with Google/Veo as the initial video/presenter implementation.

Preferred fallback hierarchy:
1. Veo-generated video;
2. generated still imagery;
3. deterministic Remotion motion graphics/text;
4. template-only fallback.

Likely concerns:
- provider-neutral request/result models;
- Veo text + source/reference-image presenter generation;
- generated B-roll/video;
- generated still-image provider;
- job IDs/status;
- retries/timeouts;
- malformed/partial provider responses;
- quality rejection/regeneration;
- provider spend accounting and per-run ceiling;
- asset identity/hashes;
- effective-input cache keys;
- artifact provenance;
- mocked orchestration proof;
- limited live-provider qualification.

The program must remain renderable when generated media fails.

Exact off-screen narration/audio ownership, presenter identity-continuity technique, Veo version, and still-image model remain subject to provider qualification.

## Phase 7 — Composition, design system, and rendering

Goal:
Assemble planned/generated assets into reproducible 16:9 and 9:16 video editions.

Remotion owns:
- deterministic program shell;
- scene templates;
- typography;
- lower thirds;
- source labels;
- headline/quote/stat treatments;
- captions;
- logos/branding;
- intro/outro;
- transitions;
- music placement;
- stingers;
- ducking behavior;
- safe areas;
- responsive layout.

FFmpeg owns lower-level processing, normalization, encoding, and muxing where appropriate.

Initial output baseline:
- 1920x1080 16:9 master;
- 1080x1920 9:16 derived output;
- H.264 MP4;
- 30 fps;
- burned-in captions;
- configurable duration.

Likely concerns:
- shared design-system tokens/configuration;
- responsive template qualification;
- RenderManifest JSON Schema;
- final artifact identity;
- failed-render semantics;
- deterministic assembly around nondeterministically generated assets;
- reuse of completed valid assets;
- final render regeneration without automatically returning an old final edition.

## Phase 8 — Integration and operational hardening

Goal:
Prove the full ngest-to-final-video boundary under realistic failure, retry, provider, approval, recovery, and render conditions.

Likely concerns:
- live ngest authentication/integration qualification;
- CLI run observability;
- approval-gate behavior;
- cancellation;
- bounded retries/resume;
- resume from last valid durable stage;
- provider-job recovery;
- effective-input asset reuse;
- cache invalidation;
- idempotency;
- artifact retention;
- configurable provider-spend ceiling;
- deployment packaging;
- end-to-end provenance;
- failure recovery;
- secret-leak review;
- end-to-end qualification.

The MVP remains one edition at a time. More complex concurrency/distributed execution requires workload evidence.

## Deferred until evidence requires them

- multi-tenant product behavior;
- public VidGen web UI;
- customer-facing VidGen API;
- complex distributed orchestration;
- a permanent VidGen database choice;
- queue topology;
- automated publishing destinations;
- exact ProductionPlan schema before real Script evidence exists;
- exact ngest control table/schema details;
- additional control versions;
- 1:1 output;
- exact codec/audio/loudness tuning;
- exact provider/model versions;
- off-screen narration/audio strategy;
- future non-Google provider implementations.

The immediate implementation sequence is /prompt-ass -> /prompt-plan -> /prompt-write p2 for Phase 2 against the implemented CanonicalInput boundary, docs/architecture.md, current Phase 1 source/tests, and any explicitly available ngest continuation contract evidence.
