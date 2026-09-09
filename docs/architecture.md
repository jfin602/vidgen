# Architecture Notes

Status: CURRENT MVP DIRECTION / EARLY-STAGE

## Conceptual pipeline

StoryInput remains the shared production boundary inside VidGen. Phase 7 adds a separate Worker in front of automatic generation:

    live governed ngest feed
              |
              v
       VidGen Worker
       - discover new Articles
       - Parallel Web Momentum
       - cost/admission policy
              |
        admitted candidate
              |
              v
        boundary validation
              |
              v
         CanonicalInput
              |
              v
          StoryInput
           /    \
          /      \
         v        v
 simple headline  cinematic template
      path             path
 CURRENT PRIORITY     PRESERVED
       |                 |
       v                 v
 bounded presenter    ClipPlan
      copy               |
       |                 v
       v            generated media
 one presenter            |
    video                 v
       |            optional wrappers
       v                 |
 deterministic           v
 lower third +      FFmpeg assembly
   finishing              |
       |                 v
       v            final clip.mp4
 MP4 + JSON pair

Manual operator invocation may submit a story directly to VidGen without Worker admission. The Worker therefore controls automatic-production spend, not the validity of the VidGen generation contract.

The simple path must not be forced through AssemblyTemplate, ClipPlan, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan. The existing story -> plan -> media -> assemble behavior remains supported and regression-protected.

Parallel Web Momentum is Worker-only evidence. It must not become CanonicalInput, StoryInput, ClipPlan grounding, presenter-copy context, or provider prompt input.

See docs/worker.md and docs/integrations/parallel.md.

## Runtime and execution shape

The MVP application runtime is Node.js + TypeScript.

Development execution remains manually invokable through the CLI and processes one selected story at a time. Phase 7 adds a long-running Worker around those CLI boundaries; the engine remains independently usable without it.

The initial Worker should be single-process and single-flight for expensive generation. Durable filesystem state is sufficient initially; databases, distributed queues, and multi-worker coordination remain deferred until workload evidence requires them.

FFmpeg runs locally. Managed media providers supply their own generation infrastructure.

## Worker orchestration boundary

The planned Phase 7 Worker is an orchestration layer, not a third creative pipeline.

It owns:
- polling live ngest through the existing authenticated boundary;
- first-start baseline establishment and new-Article discovery;
- one bounded Parallel Web Momentum evaluation per eligible evaluation identity;
- versioned scoring and configurable admission thresholds;
- hard spend limits and fail-closed admission when evaluation is unavailable;
- durable per-Article stage state across restart;
- invoking VidGen generation through CLI process boundaries;
- discovering ready video-capable VidGen Poster platforms via doctor;
- invoking VidGen Poster independently per platform and retaining partial-success state.

It must not import VidGen internal implementation modules as an orchestration shortcut, move platform authentication/publishing into VidGen, or ingest Poster credentials. Successful earlier stages are not repeated merely because a later stage fails.

Worker operating modes are observe, generate, and live. Normal first startup establishes a baseline without treating the entire current feed as new work. See docs/worker.md.

## Ngest boundary

VidGen's intended production input remains the dedicated bearer-authenticated ngest VidGen integration endpoint carrying governed feed data plus Profile-associated VidGen controls.

If the owner later resumes the approved deferred `c5-config-fix` correction, it will use ngest's existing authenticated Distribution v1 Profile endpoint as a transitional development transport:

    NGEST_BASE_URL
          +
    NGEST_PROFILE_KEY
          |
          v
    GET /api/v1/distribution/{profile}
          |
          v
    Distribution transport validator/adapter
          |
          v
    existing VidGen input shape
          |
          v
      CanonicalInput

The transitional adapter must discard Distribution-only digest/generatedAt state, validate the returned Profile identity, preserve canonical Article order/destinations, and supply neutral VidGen-owned controls. This does not replace the future dedicated feed-plus-controls boundary.

Ngest's feed is pre-curated. Every supplied Article is a governed production candidate.

The VidGen generation engine must not:
- rank stories for production eligibility;
- cluster stories to choose winners;
- apply a second newsworthiness filter;
- recreate ngest moderation, duplicate, eligibility, Profile filtering, or ordering logic;
- connect directly to ngest persistence.

The planned Worker may make a separate automatic-production admission decision using bounded Web Momentum and cost policy. That decision must remain outside the generation engine and must not reinterpret ngest trust or moderation semantics.

See docs/integrations/ngest.md.

## Manual fixture boundary

The first video-production phases use a manually selected local sample story in VidGen's validated post-adapter input shape.

This is a development transport substitute, not a second creative contract. It does not need to reproduce the upstream Distribution v1 envelope.

Live input first passes through its transport-specific validator/adapter; both paths then converge through the same VidGen input validation/normalization semantics before story-level production logic begins.

No demo-only story fields should be invented merely to make the fixture path easier.

## Canonical input and story fan-out

Phase 1 already persists CanonicalInput containing CanonicalFeed, CanonicalControl, fingerprint, and provenance.

The single-story pipeline should build on that boundary.

A later live run may contain multiple feed Articles, but each Article becomes an independent production unit.

Phase 2 implemented a strict StoryInput schema and deterministic storyFingerprint. StoryInput preserves the explicitly selected Article, profile/publication identity, CanonicalControl, and source CanonicalInput provenance without carrying unrelated feed Articles. The storyFingerprint excludes provenance-only and unrelated-feed changes.

## Artifact boundaries

The preserved cinematic path continues to use one self-contained production directory per story.

Conceptually:

    story package
      |
      +-- story input / metadata
      +-- source context actually used
      +-- ClipPlan
      +-- generated presenter/video/audio assets
      +-- generation/provenance metadata
      +-- final clip

Shared engine code, provider credentials, and globally standardized intro/outro files are not copied into every story package. The package records identities only for standardized assets actually used, plus the template/version needed to understand the assembly.

A cinematic story failure must not make another story appear failed or successful.

The simple path has a separate publication-oriented output boundary: one final MP4 paired with one JSON sidecar. The sidecar must bind the output to the governed Article/story identity and record the presenter text, configured maximum duration, actual qualified duration, final file identity, and provider/engine provenance. Phase 6 planning owns the exact schema and output naming.

## Cinematic ClipPlan grounding boundary

The implemented ClipPlan workflow consumes the normalized StoryInput directly.

The initial manual pipeline should use a story with a usable headline and summary so the creative path can be qualified without building a retrieval subsystem first. Article/source identity, original URL, dates/byline/categories, controls, and provenance remain available as supporting context.

If StoryInput lacks a non-null summary, ClipPlan planning fails with a clear insufficient-context outcome before provider activity rather than automatically retrieving the publisher page or fabricating missing facts.

Publisher-page retrieval, HTML extraction, SSRF/network policy, and broader web research for creative generation are deferred capabilities. Phase 7's bounded Parallel Search is not creative retrieval: it is Worker-only Web Momentum evidence for automatic-production admission. If creative retrieval is later added, it must be separately bounded and provenance-aware.

## Cinematic ClipPlan boundary

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

## Cinematic template boundary

Templates remove production reasoning.

A template defines deterministic assembly requirements:
- ordered segments;
- expected timing;
- declared content slots;
- brief slot authoring semantics;
- supported standardized intro/outro wrapper positions;
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

Phase 4 now deterministically resolves one GeneratedMediaUnit for every template segment/generated-role reference. For the default template this yields:

    u01 hook / opening-anchor
      <- hook + headline
      spoken <- hook only

    u02 content / content-video
      <- narration

    u03 content / content-voiceover
      <- narration

    u04 support / supporting-anchor
      <- supporting-information

    u05 closing / supporting-anchor
      <- closing

The repeated supporting-anchor role is intentionally realized as two segment-scoped units because the template references it in two different timing segments. No second creative planning artifact decides that split.

## Preserved cinematic default template

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
- independently optional standardized premade intro/outro wrapper assets.

A supporting treatment must not become a separate generative subsystem unless evidence requires it. It may be part of presenter media, a fixed treatment, or simple deterministic FFmpeg-level presentation.

Phase 2 established role-only standardized intro/outro positions without fabricating media facts because the real owner-supplied assets were not present. Phase 5 then implemented concrete binding and duration/codec qualification assuming both wrappers were supplied. The approved follow-up correction changes that assembly contract so intro and outro are independently optional: an omitted wrapper contributes no placeholder media, duration, identity, or provenance, while any supplied wrapper remains subject to the same local qualification.

## Simple presenter-headline boundary

The Phase 6 simple path consumes StoryInput directly.

Its creative requirement is intentionally narrow: produce only the presenter dialogue needed to introduce the topic/headline while remaining grounded in supplied StoryInput facts. The lower third is deterministic and carries the Article headline plus source display name; those strings are not delegated to generated on-screen model text.

The simple path:
- produces one continuous presenter clip;
- has no B-roll or separate TTS voiceover requirement;
- has no standardized intro/outro requirement;
- does not require the cinematic template or ClipPlan contracts;
- uses a configurable `maxSeconds` presenter-copy/planning ceiling from 4 through 20 seconds inclusive;
- uses that planning ceiling to select the initial or extended provider coverage, never to trim final media;
- preserves the complete qualified Veo timeline, which may be the supported 8- or 15-second coverage;
- keeps provider-specific duration granularity behind the provider adapter;
- finishes the clip deterministically with FFmpeg and qualifies it with FFprobe before publication;
- publishes an MP4 plus coupled Article/provenance JSON sidecar.

The exact presenter-copy artifact shape, CLI spelling, runtime asset configuration, and durable sidecar schema remain Phase 6 implementation-planning decisions.

## Provider boundary

The MVP is Google-first, not Google-coupled.

Keep thin provider-neutral requests/results at the VidGen boundary so ClipPlan generation, media generation, and FFmpeg assembly do not depend directly on provider response shapes.

Current implementation:
- the provider-neutral structured-text boundary uses the project/global Agent Platform `generateContent` path;
- provider-neutral video and speech generation boundaries use Agent Platform Veo and Cloud Text-to-Speech Gemini TTS respectively;
- provider jobs/assets retain story-local provenance, hashes, request/operation identity where safe, and effective-generation-input identity;
- provider model/voice selections remain runtime configuration rather than template semantics.

The prior `c6-vertex-adapter` direction is historical/superseded. Gemini Enterprise Agent Platform is the sole supported Google model platform:

    provider-neutral capability boundaries
                    |
                    v
      Gemini Enterprise Agent Platform
          /          |          \
         v           v           v
       text         video       speech
         \           |          /
          \          |         /
           v         v        v
              neutral results
                    |
                    v
         existing VidGen workflows

Platform choice must not enter StoryInput, CanonicalControl, ClipPlan, AssemblyTemplate, generated model output, or ngest state.

Each Agent Platform capability owns its supported authentication, request/poll transport, model capability checks, and any bounded output/staging behavior. Authentication proven for one capability must not be assumed to prove another.

Do not silently route around Agent Platform failures through a legacy backend. Failures must remain attributable so billing, provenance, reproducibility, and debugging are unambiguous.

Do not build a large generalized provider framework merely because the Google integration is being reconciled. Preserve the current neutral contracts and keep capability-specific adapters thin.

See docs/integrations/google-video.md.

## Asset rights and trust

Public accessibility is not reuse permission.

Future publisher retrieval may be added as a bounded fallback for insufficient StoryInput, but publisher images/video may enter a rendered clip only when reuse is explicitly permitted.

Generated media, approved stock/library media, and standardized VidGen-owned assets remain safe alternatives.

Provider output, publisher content, URLs, and administrator text remain untrusted inputs.

## FFmpeg finishing and assembly boundary

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

The assembly layer consumes the selected template, validated ClipPlan, strict generated-media.json handoff, local generated assets, and any standardized wrapper assets actually supplied. It must not reinterpret story meaning or call media-generation providers.

Phase 5 implemented this boundary with bounded local FFprobe qualification, deterministic AssemblyPlan creation, a no-shell FFmpeg renderer, manual `vidgen assemble`, post-render technical validation, `assembly-run.json`, strict `final-clip.json`, and atomic `final/clip.mp4` publication. The closeout environment did not contain ffmpeg/ffprobe or the required owner-supplied real media inputs, so the implementation is not yet claimed as real-host/story-render qualified.

A separate creative RenderManifest is not a pipeline stage. The implemented assembly/final metadata exists only for deterministic execution state, provenance, and technical validation.

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

Phase 4 persists media-run.json at durable per-unit boundaries plus generated-media.json only when all current generated-media units are ready.

Generated asset reuse is story-local. Reuse requires matching effective generation input plus current local file hash/size validation; file existence alone is insufficient. No global cache is required.

External operations must be bounded and failures explicit.

No approval-state machine is required for the first end-to-end pipeline. Human playback/aesthetic inspection remains separate from deterministic technical validation and was not completed during the Phase 5 closeout.

## Deployment shape

The MVP is a manually invoked CLI with filesystem-backed artifacts.

Future live feed processing should reuse the same story pipeline by fanning each supplied Article into an independent production package.

Service/API/worker/queue/database topology remains deferred until real workload evidence requires it.
