# Architecture Notes

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Conceptual pipeline

Initial development:

    manually selected
    ngest-shaped story fixture
              |
              v
      boundary validation
              |
              v
        CanonicalInput
              |
              v
       select one story
              |
              v
   initialize story package
              |
              v
          ClipPlan
   one validated template-fill step
              |
              v
   generate required media
      /       |       \
 presenter  content  voiceover
      \       |       /
              v
      standardized intro/outro
              |
              v
        FFmpeg assembly
              |
              v
         final clip.mp4

Live ngest acquisition remains a supported boundary from Phase 1, but live feed fan-out is not required to debug the initial video-production path.

## Runtime and execution shape

The MVP application runtime is Node.js + TypeScript.

Development execution is manually invoked through the CLI and processes one selected story at a time.

The engine should remain separable enough that live feed orchestration can later fan stories into the same story pipeline, but queues, workers, databases, and distributed orchestration are not initial requirements.

FFmpeg runs locally. Managed media providers supply their own generation infrastructure.

## Ngest boundary

VidGen's eventual production input comes from the dedicated bearer-authenticated ngest VidGen integration endpoint.

Ngest's feed is pre-curated for VidGen production. Every supplied story is already eligible for content creation.

VidGen must not:
- rank stories for production eligibility;
- cluster stories to choose winners;
- apply a second newsworthiness filter;
- recreate ngest moderation, duplicate, eligibility, Profile filtering, or ordering logic;
- connect directly to ngest persistence.

See docs/integrations/ngest.md.

## Manual fixture boundary

The first video-production phases use a manually selected sample story shaped like real ngest integration input.

This is a development transport substitute, not a second creative contract.

Both fixture and live input should converge through the same validation/normalization semantics before story-level production logic begins.

No demo-only story fields should be invented merely to make the fixture path easier.

## Canonical input and story fan-out

Phase 1 already persists CanonicalInput containing CanonicalFeed, CanonicalControl, fingerprint, and provenance.

The single-story pipeline should build on that boundary.

A later live run may contain multiple feed Articles, but each Article becomes an independent production unit.

Phase 2 implemented a strict StoryInput schema and deterministic storyFingerprint. StoryInput preserves the explicitly selected Article, profile/publication identity, CanonicalControl, and source CanonicalInput provenance without carrying unrelated feed Articles. The storyFingerprint excludes provenance-only and unrelated-feed changes.

## Story package boundary

One story owns one self-contained production directory.

Conceptually:

    story package
      |
      +-- story input / metadata
      +-- source context actually used
      +-- ClipPlan
      +-- generated presenter/video/audio assets
      +-- generation/provenance metadata
      +-- final clip

Shared engine code, provider credentials, and globally standardized intro/outro files are not copied into every story package. The package records the identities/versions needed to understand what was used.

A story failure must not make another story appear failed or successful.

## ClipPlan grounding boundary

The implemented ClipPlan workflow consumes the normalized StoryInput directly.

The initial manual pipeline should use a story with a usable headline and summary so the creative path can be qualified without building a retrieval subsystem first. Article/source identity, original URL, dates/byline/categories, controls, and provenance remain available as supporting context.

If StoryInput lacks a non-null summary, ClipPlan planning fails with a clear insufficient-context outcome before provider activity rather than automatically retrieving the publisher page or fabricating missing facts.

Publisher-page retrieval, HTML extraction, SSRF/network policy, and broader web research are deferred capabilities. If later added, they must be separately bounded and provenance-aware.

## ClipPlan boundary

ClipPlan is the only model-assisted creative artifact in the implemented initial planning pipeline.

It fills a selected template. It does not invent the template.

A ClipPlan should carry only identity plus the story-specific values required by the declared template. Conceptually:

    ClipPlan
      schemaVersion
      storyFingerprint
      template
        id
        version
      slots
        - id
          text

The implemented wire shape is schemaVersion + storyFingerprint + template { id, version } + ordered slots { id, text }, and the contract remains generic across templates.

The model does not write shot plans, media-type decisions, provider instructions, transition plans, timing changes, or separate generated-video/voiceover prompts.

No downstream stage consumes raw model output. The implemented workflow uses provider-structured JSON, VidGen runtime/semantic validation, deterministic slot completeness/order checks, and one normal-path model call; malformed or invalid output fails for human rerun rather than triggering a hidden creative repair loop.

If media generation or assembly must infer missing story meaning, ClipPlan is incomplete.

## Template boundary

Templates remove production reasoning.

A template defines deterministic assembly requirements:
- ordered segments;
- expected timing;
- declared content slots;
- brief slot authoring semantics;
- standardized intro/outro positions;
- which generated asset roles consume each segment;
- output requirements needed for assembly.

ClipPlan fills only declared story-content slots.

Each content slot now requires the generic authoring guidance implemented in Phase 3:
- id;
- usage: spoken or display;
- instruction describing what content belongs in the slot.

Core ClipPlan generation must not hard-code meanings for default-news-40s slot IDs.

Adding a new template should normally require adding a template definition and any associated standardized media assets, not changing the story-reasoning engine.

See docs/template-system.md.

Phase 4 can then deterministically resolve generated-asset inputs from the template graph and filled slots. For the default template, the intended relationship is conceptually:

    opening-anchor
      <- hook + headline

    content-video
      <- narration

    content-voiceover
      <- narration

    supporting-anchor
      <- supporting-information + closing

That mapping comes from template segment/role relationships rather than a second creative planning artifact.

## Default template

The locked default logical content structure is:

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

The MVP should generate only the story-specific media the template truly requires.

Current simplification target:
- presenter/anchor clip(s);
- one generated content clip;
- voiceover for the content clip;
- standardized premade intro/outro assets.

A supporting treatment must not become a separate generative subsystem unless evidence requires it. It may be part of presenter media, a fixed treatment, or simple deterministic FFmpeg-level presentation.

Phase 2 established role-only standardized intro/outro requirements without fabricating media facts because the real owner-supplied assets were not present. Concrete binding plus duration/codec qualification remains deferred until those assets are available, before final assembly.

## Provider boundary

The MVP is Google-first, not Google-coupled.

Keep thin provider-neutral requests/results at the VidGen boundary so ClipPlan generation, media generation, and FFmpeg assembly do not depend directly on provider response shapes.

Current direction:
- Phase 3 implemented a thin provider-neutral structured-text boundary plus a Google Gemini Interactions REST adapter, with the exact model ID kept in runtime configuration;
- the owner manually closed Phase 3 without claiming the unrun live Google qualification smoke;
- Veo remains the initial presenter/video direction for Phase 4;
- off-screen narration/voiceover mechanism remains unresolved;
- provider jobs/assets should retain story-local provenance and effective-input identity where useful.

Do not build a large generalized provider framework before a second provider or real complexity requires it.

## Asset rights and trust

Public accessibility is not reuse permission.

Future publisher retrieval may be added as a bounded fallback for insufficient StoryInput, but publisher images/video may enter a rendered clip only when reuse is explicitly permitted.

Generated media, approved stock/library media, and standardized VidGen-owned assets remain safe alternatives.

Provider output, publisher content, URLs, and administrator text remain untrusted inputs.

## FFmpeg assembly boundary

Remotion is not part of the current MVP.

FFmpeg owns deterministic assembly and finishing needed by the fixed templates, including where appropriate:
- normalization of resolution/frame rate/codec;
- trimming to template timing;
- concatenation;
- voiceover/audio replacement or muxing;
- audio normalization;
- simple deterministic overlays/treatments;
- burned captions if enabled;
- final H.264 MP4 encoding.

The assembly layer consumes the selected template, validated ClipPlan, local generated assets, and standardized assets. It must not reinterpret story meaning.

A separate persisted RenderManifest is not required as a conceptual pipeline stage. Emit render/debug metadata only if implementation evidence shows it is useful.

## Output baseline

Initial first-class output:
- 1080x1920;
- 9:16;
- MP4;
- H.264;
- 30 fps.

16:9, 1:1, responsive-template logic, and advanced composition are deferred.

## Recovery and reuse

The initial execution boundary is one story.

Persist enough completed story-local work to debug failures and avoid needlessly regenerating expensive media.

A sophisticated global cache is not required. Asset reuse can initially be local to the story package and keyed by effective generation inputs.

External operations must be bounded and failures explicit.

No approval-state machine is required for the first end-to-end pipeline. Human inspection occurs after generation while the pipeline is being developed.

## Deployment shape

The MVP is a manually invoked CLI with filesystem-backed artifacts.

Future live feed processing should reuse the same story pipeline by fanning each supplied Article into an independent production package.

Service/API/worker/queue/database topology remains deferred until real workload evidence requires it.
