# Project Overview

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Purpose

VidGen turns explicitly submitted governed news stories into self-contained, postable video clips.

Ngest supplies a governed, pre-curated feed of valid production candidates. The VidGen generation engine does not perform another newsworthiness, ranking, clustering, or story-selection pass. Phase 7 introduces a separate Worker that may decline automatic generation for a newly discovered candidate based on bounded Web Momentum and cost policy; that decision is orchestration admission, not a change to ngest source trust or Article validity.

Phase 6 implemented the short presenter-led headline path with deterministic headline/source lower third and paired metadata JSON while preserving the previously implemented template-driven cinematic pipeline. Phase 7 implements Worker orchestration around those CLI production boundaries; live capability qualification remains separate.

## Implementation status

Phases 1 and 2 are complete and closed at versions 0.1.5 and 0.2.5. Phase 3 was manually owner-closed at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4. Phase 5 was manually owner-closed at version 0.5.3 after its closeout review/repair. The deterministic assembly path is implemented; real FFmpeg/story-render qualification remains explicitly unclaimed because the closeout host and owner-supplied media were unavailable.

Implemented foundation:
- Node.js + TypeScript CLI foundation;
- authenticated ngest acquisition plus local VidGen-shaped fixture ingress through the same post-adapter validation/normalization semantics;
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
- bounded local FFprobe qualification and deterministic AssemblyPlan creation;
- a no-shell FFmpeg renderer plus manual `vidgen assemble` workflow;
- `assembly-run.json`, strict `final-clip.json`, post-render technical validation, and atomic `final/clip.mp4` publication;
- fail-closed handling for unsupported ngest continuation in the original Phase 1 client.

Phase 3 implemented the cinematic creative-planning stage. Phase 4 implemented cinematic generated-media realization and story-local raw media/provenance. Phase 5 implemented standardized asset qualification plus deterministic FFmpeg assembly and final-clip provenance. `c5-optional-assets` subsequently made intro and outro independently optional without placeholders. The deployment VPS has qualified the required FFmpeg/FFprobe capabilities, while one complete owner-media generated cinematic story render and playback review remain unclaimed. Phase 6 implementation has reached the 0.6.5 baseline: the simpler StoryInput-based presenter-headline path uses a configurable 4-20 second maximum-duration ceiling and paired MP4/JSON output while preserving the cinematic path. `c6-agent-platform` makes Gemini Enterprise Agent Platform the sole supported Google model platform with capability-specific authentication. `c5-config-fix` remains owner-approved but deferred; Phase 7 implements the Worker for live polling, Web Momentum admission, durable orchestration, generation invocation, and publishing fan-out. Its live ngest, Parallel, generation, publication, render, and playback evidence remains unqualified.

## Core architectural standards

### Shared StoryInput, two production paths

StoryInput is the common production boundary. The current-priority simple path branches directly from StoryInput and does not require AssemblyTemplate, ClipPlan, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan. The implemented cinematic path remains supported and preserves its existing template/ClipPlan/media/assembly contracts.

Conceptually:

    StoryInput
      |     \
      |      +--> cinematic template pipeline (preserved)
      v
    simple presenter-headline pipeline (current priority)


### Ngest governs candidates; Worker governs automatic admission

Ngest decides which Articles are trusted, governed production candidates. A supplied Article does not need a second source-trust, moderation, or editorial-validity pass inside VidGen.

The Phase 7 Worker may separately decide whether a newly discovered governed candidate is admitted to automatic generation. That decision is based on bounded Web Momentum evidence and operator cost policy. It must not be implemented inside StoryInput, ClipPlan, presenter-copy generation, or any VidGen provider adapter.

VidGen itself generates stories explicitly submitted to its production CLI and does not know about Parallel or Worker admission thresholds.

### One story is one production unit

Each governed story remains an independent production identity and failure boundary. The preserved cinematic path owns its self-contained story workspace/package; the simple path owns its paired final MP4 + metadata JSON output and may use bounded internal working state without inheriting the cinematic package contract.

Failures, retries, or regeneration for one story should not contaminate another story.

### Templates own cinematic structure

The template system governs the preserved cinematic path. The simple presenter-headline path does not use an AssemblyTemplate unless a future design explicitly promotes it into that system.

For cinematic production, VidGen does not ask a model to invent a clip format for every story.

A selected assembly template defines:
- segment order;
- timing expectations;
- which segments are presenter, generated content, voiceover, or standardized assets;
- required content slots;
- supported deterministic intro/outro wrapper positions; under the approved post-Phase-5 contract, either wrapper may be omitted at assembly time.

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

Standardized premade intro/outro assets may occupy deterministic wrapper positions around the story body. They are independently optional under the approved post-Phase-5 contract: if an asset is omitted, assembly inserts nothing in its place and the story timeline is not shifted by a placeholder. Any wrapper that is supplied must still be qualified from the real local asset without reintroducing creative planning. For social-first output, beginning directly with the story hook is the normal no-intro path.

See docs/template-system.md.

### Cinematic creative planning

The preserved cinematic path does not use separate FeedAnalysis, EditorialPlan, Script, and ProductionPlan stages.

One validated ClipPlan is a filled template form. It contains the story-specific text required by the selected template, such as hook, headline, narration, supporting information, and closing content. It does not contain shot planning, provider instructions, timing decisions, media selection, transition decisions, or a second layer of generated-media prompts.

No downstream step should need to reinterpret the story or redesign the template.

### FFmpeg owns deterministic finishing and assembly

The current MVP does not use Remotion.

The simple path uses FFmpeg for deterministic lower-third finishing/normalization, while the preserved cinematic path continues to normalize and assemble generated presenter/content media and any supplied standardized intro/outro clips with FFmpeg.

Remotion or another programmable compositor is deferred unless real production requirements demonstrate a need for one.

## Boundary with ngest

Ngest owns:
- approved-source trust;
- collection and normalization;
- canonical Article identity and provenance;
- duplicate handling and moderation;
- outward Article candidate eligibility;
- Distribution Profile filtering and ordering;
- the decision that supplied stories are valid candidates for VidGen production;
- original publisher URLs;
- bearer-token authorization;
- Profile-associated control persistence/delivery.

The VidGen Worker owns:
- live polling and new-Article discovery;
- bounded Parallel Web Momentum evaluation;
- automatic-production admission and cost limits;
- durable retry/resume and idempotent stage orchestration;
- invoking VidGen CLI generation;
- invoking VidGen Poster independently per ready video-capable platform.

VidGen owns:
- validation and normalization of received input;
- story-level production identity;
- production/artifact lifecycle for both paths;
- simple presenter-headline production;
- ClipPlan generation and validation for the preserved cinematic path;
- generated presenter/content media;
- narration/voiceover integration where the cinematic path requires it;
- deterministic FFmpeg finishing/assembly;
- final clip artifacts and provenance.

VidGen must not query ngest persistence directly or reproduce ngest eligibility/filtering logic.

## Initial development input

The first story-to-video implementation is manually invoked.

A selected sample story should use VidGen's validated post-adapter input shape rather than creating a separate demo-only story model. The current owner-approved transitional live path may receive the upstream Distribution v1 wire first, but that transport is adapted at the ngest boundary before downstream canonicalization.

Conceptually:

    live Distribution v1 wire
              |
              v
      transport validator/
            adapter
              |
              +------------------+
                                 |
    local VidGen-shaped fixture -+
                                 |
                                 v
                         VidGen input validation
                                 |
                                 v
                           CanonicalInput

The single-story video process is now implemented far enough for Phase 7 to add Worker-level live polling and orchestration without changing the downstream StoryInput creative contract.

## Artifact boundaries

The preserved cinematic path continues to use the existing story-package shape:


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

The cinematic story package should retain the story-specific source files and generated files required to understand, inspect, reuse, or reproduce the clip.

The simple path instead targets a flatter publication-oriented pair under an engine-owned output directory:

    <clip-id>.mp4
    <clip-id>.json

The JSON sidecar must couple the clip to the governed Article and include enough identity/provenance to inspect and publish it safely, including Article metadata, storyFingerprint, presenter text actually used, configured maxSeconds, actual final duration, clip hash/size, provider/model provenance, and engine version. Exact durable schema names remain Phase 6 planning work.

Shared engine code and shared standardized cinematic template assets do not need to be duplicated into every story directory; cinematic story packages should continue to identify the template/version and shared asset identities used.

## ClipPlan grounding input

The implemented ClipPlan workflow starts from StoryInput and does not automatically perform research.

For the initial manually debugged pipeline, choose an ngest story whose normalized headline and summary provide enough factual context to fill the selected template. Article/source identity, dates, byline, categories, controls, and provenance may also inform the plan.

If the supplied story context is insufficient for a grounded ClipPlan, fail clearly rather than silently fetching the publisher page or inventing missing facts.

Publisher-page retrieval remains a later fallback capability for insufficient upstream creative context. Broader web research for creative generation remains deferred. Phase 7's bounded Parallel Search is separate: it supplies Worker-level Web Momentum evidence only and must not enter StoryInput, ClipPlan, presenter-copy context, or media prompts. Any future creative retrieval capability must preserve the existing rule that retrieval permission does not grant media reuse rights.

## Generated media

The MVP remains Google-first behind thin replaceable boundaries.

Current implementation:
- deterministic per-segment GeneratedMediaUnits resolve directly from template role references plus validated ClipPlan content;
- Agent Platform Veo is the sole Google presenter/content-video implementation;
- presenter generation uses exact spoken text plus explicit approved local reference imagery;
- content video uses deterministic unit context;
- Gemini TTS produces exact off-screen voiceover from template-declared voiceover text;
- raw generated assets remain story-local and are tracked by hash/provenance/effective generation input;
- standardized premade intro/outro clips remain outside generated-media production and, when supplied, are qualified by the assembly path;
- supporting text/graphics, if needed outside generated media, remain deterministic rather than another creative reasoning stage.

Gemini Enterprise Agent Platform is the only supported Google model platform. Text, video, and speech remain separate capability boundaries; authentication and transport may differ by capability and must be qualified independently. Provider provenance must remain inspectable without leaking credentials or provider-private response data.

Provider model and voice selections remain runtime configuration rather than durable template or upstream-control semantics. See docs/integrations/google-video.md.

## Simple presenter-headline path

The Phase 6 simple path produces one continuous presenter clip from StoryInput, then deterministically adds a lower third containing the Article headline and source display name. It does not require B-roll, separate TTS voiceover, intro/outro wrappers, ClipPlan, AssemblyTemplate, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan.

Its configurable `maxSeconds` value is a copy/planning ceiling from 4 through 20 seconds inclusive, not a requested target or a final-media trim. The engine uses the shortest useful speech estimate to select initial or extended provider coverage, then preserves the complete qualified Veo timeline. Provider-specific duration granularity remains behind the provider boundary rather than becoming the product contract.

## Output

The initial first-class target for both paths is:
- 1080x1920;
- 9:16 vertical;
- MP4;
- H.264;
- 30 fps.

16:9 and 1:1 outputs are deferred until the vertical single-story pipeline works.

Caption/display treatment, audio codec, bitrate, and loudness behavior are engine-owned Phase 5 assembly policy rather than template or creative-model decisions.

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
