# Project Overview

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Purpose

VidGen turns each production-worthy news story supplied by ngest into its own self-contained, postable video clip.

Ngest supplies a governed, pre-curated feed. Every story delivered to VidGen is already intended for content production. VidGen does not perform another newsworthiness, ranking, clustering, or story-selection pass.

The initial development goal is narrower than the eventual live integration: manually feed one selected sample story in the same shape the ngest integration would provide, then debug the story-to-video pipeline until it reliably produces a usable clip.

## Implementation status

Phase 1 is complete and closed at version 0.1.5. The repository remains on the 0.2.0 Phase 2 baseline, but Phase 2 was rebased after Phase 1 from feed intelligence to the single-story development foundation.

Phase 1 provides:
- Node.js + TypeScript CLI foundation;
- authenticated ngest manifest acquisition;
- transport validation;
- CanonicalFeed, CanonicalControl, and CanonicalInput normalization;
- deterministic input fingerprinting;
- filesystem-backed run metadata and atomic CanonicalInput persistence;
- fail-closed handling for unsupported ngest continuation.

Those capabilities remain useful. Later edition-oriented stages were planning only and are not implemented.

## Core architectural standards

### Ngest owns production eligibility

Ngest decides which governed stories are supplied to VidGen.

A supplied story is already content-worthy. VidGen does not add another eligibility gate.

### One story is one production unit

Each story produces one independent story package containing the final clip and the story-specific source/intermediate/generated files used to make it.

Failures, retries, or regeneration for one story should not contaminate another story.

### Templates own structure

VidGen does not ask a model to invent a clip format for every story.

A selected assembly template defines:
- segment order;
- timing expectations;
- which segments are presenter, generated content, voiceover, or standardized assets;
- required content slots;
- fixed intro/outro usage.

The model fills declared story-content slots.

The locked default content template is:

    0-05 sec
      Hook
      Presenter
      Headline treatment

    05-15 sec
      Narration
      Generated visual

    15-28 sec
      Presenter
      Supporting information

    28-40 sec
      Closing beat

Standardized premade intro/outro assets wrap or fulfill fixed assembly positions. Their exact media duration/placement should be qualified from the real assets without reintroducing creative planning.

See docs/template-system.md.

### One creative planning artifact

The current MVP does not use separate FeedAnalysis, EditorialPlan, Script, and ProductionPlan stages.

One validated ClipPlan contains the story-specific material needed to fill the selected template, such as presenter dialogue, narration, generated-video prompt/content, headline/supporting text, closing content, and source support.

No downstream step should need to reinterpret the story or redesign the template.

### FFmpeg owns MVP assembly

The current MVP does not use Remotion.

The generated presenter/content media and standardized intro/outro clips are normalized and assembled deterministically with FFmpeg.

Remotion or another programmable compositor is deferred unless real production requirements demonstrate a need for one.

## Boundary with ngest

Ngest owns:
- approved-source trust;
- collection and normalization;
- canonical Article identity and provenance;
- duplicate handling and moderation;
- outward Article eligibility;
- Distribution Profile filtering and ordering;
- the decision that supplied stories are eligible for VidGen production;
- original publisher URLs;
- bearer-token authorization;
- Profile-associated control persistence/delivery.

VidGen owns:
- validation and normalization of received input;
- story-level production identity;
- story package lifecycle;
- conditional bounded source-context preparation;
- ClipPlan generation and validation;
- generated presenter/content media;
- narration/voiceover integration;
- deterministic FFmpeg assembly;
- final clip artifacts and provenance.

VidGen must not query ngest persistence directly or reproduce ngest eligibility/filtering logic.

## Initial development input

The first story-to-video implementation is manually invoked.

A selected sample story should be represented using the same external shape expected from the ngest VidGen integration and should pass through the same validation/normalization boundary rather than creating a separate demo-only story model.

Conceptually:

    local ngest-shaped fixture ----+
                                   |
                                   v
                           common validation
                                   |
    live ngest response -----------+
                                   |
                                   v
                             CanonicalInput

Live feed fan-out is deliberately deferred until the single-story video process works.

## Story package

Exact names remain provisional, but the intended ownership shape is approximately:

    stories/<story-production-id>/
      story.json
      sources/
      clip-plan.json
      assets/
        presenter/
        video/
        audio/
      final/
        clip.mp4

The story package should retain the story-specific source files and generated files required to understand, inspect, reuse, or reproduce the clip.

Shared engine code and shared standardized template assets do not need to be duplicated into every story directory; the story package should identify the template/version and shared asset identities used.

## Context preparation

The ngest story headline, summary, metadata, provenance, and original publisher URL are the starting factual context.

Publisher-page retrieval is conditional rather than mandatory. Retrieve and normalize the governed publisher page only when the available story context is insufficient for a grounded ClipPlan.

Broader web research is deferred.

Publisher retrieval does not grant media reuse rights.

## Generated media

The MVP remains Google-first behind thin replaceable boundaries.

Current direction:
- Veo for presenter generation from scripted text plus approved/reference imagery;
- generated video for the content visual where the default template requires it;
- standardized premade intro/outro clips;
- supporting text/graphics, if needed outside generated media, should be deterministic and simple rather than another creative reasoning stage.

Exact Veo version, presenter continuity technique, and off-screen narration/voiceover provider remain open until provider qualification.

## Output

The initial first-class target is:
- 1080x1920;
- 9:16 vertical;
- MP4;
- H.264;
- 30 fps.

16:9 and 1:1 outputs are deferred until the vertical single-story pipeline works.

Caption, audio-codec, bitrate, and loudness details remain implementation-level decisions to qualify during FFmpeg assembly work.

## Recovery and reuse

Do not build a global cache for the initial pipeline.

Story-local expensive generated assets may be reused when their effective generation inputs match. Provider/network operations should remain bounded and failures explicit.

The initial goal is debuggability and reproducibility of one story, not distributed throughput.

## Deferred

- live multi-story feed fan-out until the video pipeline works;
- general web research;
- configurable approval workflows;
- global asset caching;
- Remotion/programmatic composition;
- 16:9 and 1:1 output;
- automated publishing;
- database/queue/distributed workers;
- public API/UI;
- exact long-term control schema;
- exact provider/model versions;
- off-screen narration provider;
- advanced graphics/compositing.
