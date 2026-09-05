# Architecture Notes

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Conceptual pipeline

    ngest VidGen integration endpoint
               |
               v
      authenticated acquisition
               |
               v
        boundary validation
               |
               v
          CanonicalInput
      /          |          \
CanonicalFeed CanonicalControl metadata
               |
               v
      input identity / run context
               |
               v
          FeedAnalysis
               |
               v
         EditorialPlan
               |
               v
             Script
               |
               v
       approval gate
        (configurable)
               |
               v
        ProductionPlan
               |
               v
     provider-neutral requests
        /        |         \
     Veo     still media   other
        \        |         /
               v
       generated/acquired assets
               |
               v
        RenderManifest
               |
               v
         Remotion + FFmpeg
               |
               v
      final video + run record

This is a responsibility sketch, not a committed module tree.

## MVP runtime and execution shape

The MVP application runtime is Node.js + TypeScript.

The first execution model is a CLI that processes one edition at a time. The engine should remain structured so later worker/service/API hosting can be added without rewriting editorial or production semantics, but distributed infrastructure is not an MVP requirement.

Orchestration, Remotion, and FFmpeg may run on an ordinary CPU host. Veo and other managed generation providers supply their own generation infrastructure.

## Ngest integration boundary

VidGen's production input comes from a dedicated bearer-authenticated ngest integration endpoint.

The endpoint should compose:
- the same governed Distribution Profile feed semantics used by ngest's outward feed producer; and
- Profile-associated VidGen controls.

It must not create a second implementation of Article eligibility, ordering, normalization, provenance, duplicate handling, moderation, or Profile filtering.

Generic ngest Distribution endpoints and PHP integration packages remain unchanged and do not receive VidGen-specific controls.

VidGen must not connect directly to ngest persistence or depend on ngest database schema.

See docs/integrations/ngest.md.

## Input normalization boundary

The external ngest response is transport input, not the VidGen domain model.

VidGen validates and normalizes once at the edge:

    ngest response
          |
          v
    validate/normalize
          |
          +--> CanonicalFeed
          |
          +--> CanonicalControl
          |
          +--> provenance/debug metadata
          |
          v
      CanonicalInput

CanonicalInput is the durable structured input artifact for a run. It contains or references the normalized CanonicalFeed and CanonicalControl plus generation identity/provenance metadata.

Feed analysis, editorial planning, scripting, and production must not contain ngest endpoint, pagination, authentication, or persistence semantics.

Only the input boundary should need to understand supported external response/control versions.

## Control boundary

Controls represent administrator intent, preferences, and constraints. They are not pre-generated creative output.

Ngest owns control persistence, Profile association, administrator configuration, authorization, and delivery.

VidGen owns control validation at its semantic boundary, normalization, defaults, hard-constraint enforcement, preference handling, and all creative consequences.

See docs/control-interface.md.

## Input identity

VidGen derives deterministic generation identity from generation-relevant canonical input:

    CanonicalFeed
    +
    CanonicalControl
            |
            v
    deterministic canonical serialization
            |
            v
          SHA-256
            |
            v
       inputFingerprint

The bearer credential is never part of the creative fingerprint.

An ngest snapshot/revision may be retained as provenance/debugging metadata, but it must not by itself define VidGen generation identity.

## Durable artifact model

The MVP uses filesystem artifacts plus structured metadata. A database is not required for the first end-to-end pipeline.

The major pipeline artifacts are durable and inspectable:

    01 CanonicalInput.json
    02 FeedAnalysis.json
    03 EditorialPlan.json
    04 Script.json
    05 ProductionPlan.json
    06 RenderManifest.json
    07 final video

Exact filenames and directory layout are not locked.

All structured pipeline artifacts use VidGen-owned standardized JSON schemas and carry enough version/provenance metadata to identify their producer and upstream inputs.

The final video is the terminal media artifact.

Traceability must survive creative transformation:

    rendered factual segment
        -> Script segment
        -> EditorialPlan story
        -> supporting Article IDs
        -> governed Article
        -> original publisher URL

## Model-output validation boundary

No downstream stage consumes raw or unvalidated model output.

Model-assisted stages should combine:
- provider-native structured output where available;
- VidGen-owned JSON Schema validation;
- runtime type validation;
- deterministic semantic validators;
- bounded repair/retry for malformed or incomplete output;
- rejection when required provenance, Article support, or stage-owned semantics are missing.

Exact libraries, schemas, retry counts, and repair strategies remain provisional.

## Research/enrichment boundary

CanonicalInput remains the governed ngest input. Research/enrichment is downstream VidGen output and must not be confused with upstream canonical truth.

VidGen may retrieve governed original publisher URLs for factual enrichment. Where practical, ordinary publisher-page acquisition should be performed by VidGen's bounded HTTP retrieval subsystem instead of consuming model URL-context/browsing capability merely to fetch content.

Retrieval must use explicit redirect, timeout, size, content-type, and SSRF-safe policies. Retrieved content remains untrusted input and must be normalized before model-assisted stages consume it.

Broader web research beyond governed publisher URLs requires a separately explicit research capability.

Research permission is not media-reuse permission. Publisher images/video may be used in production only when reuse is explicitly permitted.

## Editorial pipeline boundary

FeedAnalysis and EditorialPlan are separate durable stages.

FeedAnalysis owns:
- themes and clusters;
- repeated entities/coverage;
- candidate stories;
- uncertainty/conflict;
- Article-level support/provenance.

EditorialPlan owns:
- final theme;
- selected stories;
- ordering/grouping;
- opening/closing intent;
- transitions;
- control-driven editorial choices.

EditorialPlan is a standardized JSON artifact and must not encode Remotion implementation details or invent the final composition system.

## Script boundary

Script is a standardized structured JSON artifact. Narration text is only one field.

Script segments should carry enough editorial semantics that ProductionPlan does not need to reinterpret story meaning, including concepts such as:
- stable segment identity;
- supporting Article IDs/provenance;
- narration/presentation text;
- intended duration;
- emphasis/priority;
- quoted or on-screen text;
- visualizable entities/events/subjects;
- transition intent;
- factual or visual caution metadata.

If ProductionPlan would need to invent missing editorial semantics, the producer boundary is incomplete and planning must return to Script.

## Human approval boundary

The MVP supports configurable approval gates.

During development, the default gate is after Script and before expensive media generation. Fully automatic execution remains possible when gating is disabled.

Exact CLI interaction and persisted approval-state shape remain provisional.

## Production architecture

The MVP uses a template-first hybrid production model.

The program has a stable deterministic broadcast shell and reusable scene/composition templates. Generated media fills declared slots instead of determining the fundamental program layout.

Remotion components define deterministic scene behavior. Separate JSON template definitions expose production-facing capabilities such as:
- content/media slots;
- timing constraints;
- safe areas;
- supported media types;
- configurable parameters;
- responsive behavior.

ProductionPlan selects templates and fills their declared slots. Editorial stages do not import or depend on Remotion components.

The exact ProductionPlan schema is intentionally deferred until real Script outputs have been evaluated.

## Generated media and provider boundary

The MVP is Google-first, with Veo as the initial generated-video and presenter path. Provider-specific details remain behind VidGen adapters so upstream and downstream stages consume provider-neutral contracts.

Preferred visual fallback order:
1. Veo-generated video when motion materially benefits the scene;
2. generated still imagery;
3. deterministic Remotion motion graphics/text treatments;
4. template-only fallback.

Generated video is an enhancement, not a single point of failure.

The anchor/presenter is first-class from the beginning. The initial presenter path uses scripted text plus source/reference images with Veo. The resulting presenter clip is a timed media asset consumed by composition.

Exact Veo version, identity-continuity strategy, pronunciation/dialogue controls, generated-audio handling, and off-screen narration ownership remain open for provider qualification and production planning.

## Asset rights boundary

Production asset priority is:
1. governed publisher media only when reuse is explicitly permitted;
2. generated media;
3. approved stock/library assets;
4. deterministic templates/graphics.

Public accessibility does not imply licensing permission. Media found during article-page retrieval must not automatically enter production.

## Composition, design system, and rendering

Remotion owns deterministic program composition:
- program shell;
- scene templates;
- typography;
- lower thirds;
- source labels;
- headline treatments;
- quote/stat cards;
- captions;
- logos/branding;
- intro/outro;
- transitions;
- music-bed placement;
- stingers;
- audio ducking rules;
- safe areas;
- responsive layout behavior.

These should be driven by reusable design-system tokens/configuration rather than generated ad hoc per edition.

FFmpeg owns lower-level media processing where appropriate:
- encoding;
- muxing;
- normalization;
- conversion/transcoding;
- other media operations better expressed outside the Remotion composition layer.

## Output baseline

The first-class output baseline is:
- 1920x1080 16:9 landscape master;
- 1080x1920 9:16 derived vertical variant;
- responsive templates from the beginning;
- MP4 container;
- H.264 video;
- 30 fps;
- burned-in captions;
- configurable edition duration.

1:1 output and exact codec/audio/loudness tuning remain deferred.

## Runtime recovery and reuse

The MVP processes one edition at a time.

Every completed valid stage is persisted so an interrupted run can resume from the last reusable stage rather than repeat all prior work.

Successful expensive provider assets may be reused when their effective generation inputs match.

Identical CanonicalInput + CanonicalControl must not automatically return a previous final edition. Valid intermediate work and provider assets may be reused while final composition/rendering may be regenerated.

Provider/network retries are bounded. Provider spend is constrained by a configurable per-run ceiling. No edition-wide hard wall-clock limit is required initially, but individual external operations must be bounded, observable, and fail explicitly.

Exact retry/backoff, cache keys, spend defaults, and invalidation semantics remain provisional.

## Production-plan checkpoint

The high-level production architecture is chosen; the exact ProductionPlan contract is not.

After Phase 4, generate and inspect several materially different Script artifacts before locking ProductionPlan v1.

Observed Script requirements should determine the exact durable production concepts and fields while preserving the already-selected boundaries:
- template-first composition;
- first-class presenter scenes;
- provider-neutral generated-media requests;
- Veo as the initial video/presenter provider;
- deterministic fallback hierarchy;
- Remotion + FFmpeg composition;
- responsive 16:9 and 9:16 output;
- provenance and resumability.

If downstream production work would need to invent Script-owned semantics, return Planning needed and correct the producer boundary first.

## Deployment shape

The MVP deployment shape is a CLI process with filesystem-backed run artifacts and one edition at a time.

Future service, worker, API, queue, or database topology remains open. Do not introduce distributed infrastructure before real workload evidence requires it.
