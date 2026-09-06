# Project Overview

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Purpose

VidGen turns each production-worthy news story supplied by ngest into its own self-contained, postable video clip.

Ngest supplies a governed, pre-curated feed. Every story delivered to VidGen is already intended for content production. VidGen does not perform another newsworthiness, ranking, clustering, or story-selection pass.

The initial development goal is narrower than the eventual live integration: manually feed one selected sample story in the same shape the ngest integration would provide, then debug the story-to-video pipeline until it reliably produces a usable clip.

## Implementation status

Phases 1 and 2 are complete and closed at versions 0.1.5 and 0.2.5. Phase 3 was manually owner-closed at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4 after its P5 review/repair pass. The repository is now on the 0.5.0 Phase 5 baseline.

Implemented foundation:
- Node.js + TypeScript CLI foundation;
- authenticated ngest manifest acquisition plus local ngest-shaped fixture ingress through the same validator;
- CanonicalFeed, CanonicalControl, CanonicalInput, and explicit StoryInput normalization;
- deterministic input and story fingerprinting;
- a strict declarative default-news-40s assembly template and registry with template-owned slot authoring semantics;
- a strict provider-neutral ClipPlan contract and template-derived structured-output schema;
- a Google Gemini structured-text adapter with runtime model configuration;
- deterministic generated-media unit resolution from template segment/role references plus validated ClipPlan values;
- provider-neutral video and speech generation contracts;
- Google Veo presenter/content-video generation and Gemini TTS voiceover adapters;
- a manual story command that creates an independent story workspace with provenance/template metadata and future source/media directories;
- a manual plan command that performs one normal-path model call and persists validated ClipPlan plus safe planning metadata;
- a manual media command that consumes an existing planned workspace, writes raw story-local assets, and persists resumable media metadata plus a strict generated-media handoff manifest;
- story-local generated-asset reuse keyed by effective generation input and current file identity;
- filesystem-backed run/story/planning/media metadata and shared atomic persistence;
- fail-closed handling for unsupported ngest continuation.

Phase 3 implemented the single creative-planning stage. Phase 4 implemented deterministic generated-media realization and story-local raw media/provenance. Phase 5 now owns standardized asset qualification plus FFmpeg assembly into the first complete clip. Publisher retrieval and live fan-out remain later work.

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

One validated ClipPlan is a filled template form. It contains the story-specific text required by the selected template, such as hook, headline, narration, supporting information, and closing content. It does not contain shot planning, provider instructions, timing decisions, media selection, transition decisions, or a second layer of generated-media prompts.

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

## ClipPlan grounding input

The implemented ClipPlan workflow starts from StoryInput and does not automatically perform research.

For the initial manually debugged pipeline, choose an ngest story whose normalized headline and summary provide enough factual context to fill the selected template. Article/source identity, dates, byline, categories, controls, and provenance may also inform the plan.

If the supplied story context is insufficient for a grounded ClipPlan, fail clearly rather than silently fetching the publisher page or inventing missing facts.

Publisher-page retrieval remains a later fallback capability for insufficient upstream context. Broader web research remains deferred. Any future retrieval capability must preserve the existing rule that retrieval permission does not grant media reuse rights.

## Generated media

The MVP remains Google-first behind thin replaceable boundaries.

Current implementation:
- deterministic per-segment GeneratedMediaUnits resolve directly from template role references plus validated ClipPlan content;
- Veo-backed presenter generation uses exact spoken text plus explicit approved local reference imagery;
- Veo-backed content video uses deterministic unit context;
- Gemini TTS produces exact off-screen voiceover from template-declared voiceover text;
- raw generated assets remain story-local and are tracked by hash/provenance/effective generation input;
- standardized premade intro/outro clips remain outside generated-media production and are qualified during Phase 5;
- supporting text/graphics, if needed outside generated media, remain deterministic rather than another creative reasoning stage.

Provider model and voice selections remain runtime configuration rather than durable template semantics.

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
- publisher-page retrieval fallback for insufficient upstream story context;
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
