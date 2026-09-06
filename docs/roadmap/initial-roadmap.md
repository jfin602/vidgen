# Initial VidGen Roadmap

Status: CURRENT MVP DIRECTION / PROVISIONAL PHASE BOUNDARIES
Phase 1 completion: 0.1.5
Phase 2 completion: 0.2.5
Phase 3 owner closeout: 0.3.4
Phase 4 owner closeout: 0.4.4
Phase 5 owner closeout: 0.5.3
Current baseline: 0.5.3

This roadmap was rebased on 2026-09-05 after Phase 1. The original edition/newscast phases were intentionally removed in favor of the smallest useful single-story clip pipeline.

## Cross-phase MVP constraints

The roadmap assumes:
- Node.js + TypeScript;
- manually invoked CLI development first;
- one selected story at a time until the video path is proven;
- manual sample input shaped like the ngest integration contract;
- each supplied ngest story is already production-worthy;
- no VidGen ranking, clustering, or story-selection stage;
- one story = one independent artifact/package boundary;
- one validated ClipPlan creative stage;
- declarative assembly templates own structure/timing/media-slot requirements;
- standardized premade intro/outro assets;
- Google-first generated media behind thin replaceable adapters;
- Veo as the initial presenter/video direction;
- FFmpeg for MVP assembly and finishing;
- 1080x1920 9:16 H.264 MP4 at 30 fps as the initial output target;
- no Remotion, approval state machine, global cache, database, queue, or distributed runtime in the initial pipeline.

No downstream stage may consume raw/unvalidated model output.

## Phase 1 — Foundation and ngest integration boundary

Status: COMPLETE / CLOSED AT 0.1.5

Goal:
Create the executable Node.js + TypeScript CLI foundation and reliably acquire, validate, normalize, persist, and fingerprint one ngest VidGen integration response.

Implemented capabilities:
- Node.js/TypeScript project/runtime tooling;
- CLI entrypoint;
- runtime secret handling;
- dedicated ngest bearer-token client;
- authenticated HTTP acquisition;
- transport validation;
- CanonicalFeed;
- CanonicalControl;
- CanonicalInput;
- deterministic canonical serialization and SHA-256 inputFingerprint;
- filesystem-backed run metadata/artifacts;
- deterministic tests;
- fail-closed behavior for unsupported non-null nextCursor.

Preserved boundaries:
- no direct ngest database access;
- no duplicate eligibility/filtering logic;
- no ngest digest as creative input;
- no VidGen controls leaked to generic Distribution/PHP consumers.

The existing CanonicalInput foundation should be reused rather than replaced.

## Phase 2 — Single-story development foundation

Status: COMPLETE / CLOSED AT 0.2.5

Goal:
Create the minimum deterministic boundary for manually feeding one selected ngest-shaped story into an independent story-production workspace.

Conceptual contract:

    ngest-shaped local fixture
            |
            v
    existing validation/
      normalization path
            |
            v
      CanonicalInput
            |
            v
      selected Article
            |
            v
       story package
            +
      selected template

Implemented capabilities:
- representative fictional ngest-shaped local fixture using the real external manifest shape;
- local fixture loading through the same validateNgestVidGenManifestPage() boundary as live ingress;
- explicit one-Article StoryInput selection with fail-closed missing/ambiguous behavior;
- deterministic storyFingerprint isolated from unrelated feed Articles and provenance-only changes;
- provenance linkage back to CanonicalInput/Article;
- strict StoryInput JSON Schema;
- validated declarative assembly-template contract and registry;
- built-in default-news-40s template with exact 0-5, 5-15, 15-28, and 28-40 logical timing;
- 1080x1920 at 30 fps output contract;
- standardized intro/outro asset roles without fabricated filenames, durations, hashes, codecs, or availability claims;
- manual `vidgen story` command and independent story workspace with story.json, story-run.json, sources/, assets/, and final/ boundaries;
- shared atomic JSON persistence and deterministic regression coverage.

Deferred from Phase 2 because the real standardized media were not present: concrete intro/outro binding plus duration/codec/media qualification.

Non-goals:
- AI ClipPlan generation;
- publisher retrieval;
- Veo/provider calls;
- FFmpeg final assembly;
- live multi-story processing;
- Remotion.

Phase 2 should make it trivial for subsequent phases to run one story repeatedly while debugging video behavior.

## Phase 3 — ClipPlan generation

Status: COMPLETE / OWNER-CLOSED AFTER P4 AT 0.3.4

Goal:
Turn one sufficiently described StoryInput plus the selected AssemblyTemplate into one validated ClipPlan by filling the template's declared content slots.

Conceptual contract:

    StoryInput
       +
    AssemblyTemplate
          |
          v
    one model-assisted
    template-fill operation
          |
          v
       ClipPlan

Implemented capabilities:
- template-owned content-slot authoring semantics using generic id/usage/instruction data rather than core hard-coded slot meanings;
- AssemblyTemplate schema/version update while preserving generic non-40-second extensibility;
- strict provider-neutral ClipPlan type and JSON Schema;
- deterministic StoryInput/template identity attachment owned by VidGen rather than the model;
- exact required-slot completeness with no missing, duplicate, or undeclared slots;
- template-order canonicalization, trimmed non-empty slot text, and a generic bounded slot-text limit;
- deterministic insufficient-context guard requiring a non-null StoryInput summary before provider activity;
- template-derived provider structured-output schema;
- provider-neutral structured-text model interface;
- Google Gemini Interactions REST adapter using runtime GEMINI_API_KEY and VIDGEN_TEXT_MODEL configuration, fixed endpoint, bounded response handling, timeout, and safe errors;
- pure template-generic ClipPlan prompt construction with StoryInput facts and controls treated as untrusted input;
- one normal-path text-model call with no hidden creative retry/reflection loop;
- manual `vidgen plan` CLI/application workflow;
- atomic `clip-plan.json` persistence plus safe `clip-plan-run.json` provenance/failure metadata;
- deterministic fake-provider and regression coverage.

Owner closeout note:
- Phase 3 P5 required a live Google qualification smoke before ordinary acceptance.
- The owner explicitly waived that unrun live-provider gate on 2026-09-05 and manually closed the phase after the completed P4 implementation.
- No live-provider qualification is claimed by this roadmap closeout.

For default-news-40s, the ClipPlan fills hook, headline, narration, supporting-information, and closing content. It does not contain shot plans, media selection, timing decisions, provider instructions, or separate generated-video/voiceover prompts.

Explicit Phase 3 non-goals:
- publisher-page retrieval;
- HTML parsing;
- SSRF/network retrieval policy;
- broader web research;
- shot/scene planning;
- media prompts;
- Veo;
- presenter/video/audio generation;
- FFmpeg;
- standardized intro/outro qualification;
- control-schema redesign.

There is no FeedAnalysis, EditorialPlan, separate Script, or ProductionPlan stage.

## Phase 4 — Generated story media

Status: COMPLETE / OWNER-CLOSED AT 0.4.4

Goal:
Realize the generated media required by the selected template without building a generalized media platform.

For the default template, the target is approximately:
- anchor/presenter clip #1;
- main generated content/B-roll clip;
- off-screen voiceover for the content clip;
- anchor/presenter clip #2 when required by the locked template.

Implemented capabilities:
- deterministic GeneratedMediaUnit resolution with one unit per template segment/generated-role reference;
- stable engine-owned unit IDs plus exact segment timing/role/content linkage;
- strict durable ClipPlan validation against expected storyFingerprint + template identity;
- provider-neutral video and speech generation client/result contracts;
- approved in-memory presenter reference-image values with SHA-256 identity and no remote URL boundary;
- Google Veo REST adapter for presenter/content video with bounded operation polling, reference-image support, deterministic extension, prompt-safe failures, and immediate bounded media download;
- Google Gemini TTS REST adapter for exact template-declared voiceover text with bounded response/audio handling and deterministic PCM-to-WAV wrapping;
- manual `vidgen media` CLI workflow operating only on an existing successful planned story workspace;
- explicit local presenter-reference loading with signature validation, byte bounds, safe provenance, and no publisher image retrieval;
- deterministic clipPlanFingerprint and effective-generation-input fingerprints;
- atomic story-local generated asset persistence;
- resumable `media-run.json` state with per-unit progress/provenance;
- strict provider-neutral `generated-media.json` + JSON Schema as the Phase 5 handoff;
- selective story-local reuse requiring matching generation identity plus current file hash/size;
- fail-honest partial-generation/resume behavior;
- closeout hardening for reference-file read-time size checks and terminal success-metadata failure invalidation.

Owner closeout note:
- P5 executed a Phase 4 review/repair pass and produced bounded media-workflow hardening under commit subject `0.4.5`, while package/engine version remained `0.4.4`.
- The owner explicitly approved `/closeout phase 4` on 2026-09-05 local time.
- This roadmap transition records no additional live-provider qualification beyond evidence actually observed; owner approval is not converted into a fabricated provider-smoke claim.

Standardized intro/outro assets are not regenerated per story.

A separate generated-graphic subsystem is out of scope unless real clips demonstrate a need.

## Phase 5 — FFmpeg assembly and first complete clip

Status: IMPLEMENTED / OWNER-CLOSED AT 0.5.3; REAL RENDER QUALIFICATION DEFERRED

Goal:
Produce the first complete, postable vertical story clip from standardized and generated assets.

Implemented capabilities:
- strict reuse of the Phase 4 media-ready handoff and generated asset identity/hash/size verification;
- bounded local-only FFprobe adapter and media qualification;
- explicit standardized intro/outro and local font qualification;
- deterministic AssemblyPlan mapping from template + generated-media identities;
- duration/stream-layout validation before render;
- deterministic no-shell FFmpeg rendering with engine-owned normalization/timing/audio/display policy;
- safe staged text/font handling rather than interpolating untrusted display text into filter syntax;
- manual `vidgen assemble` workflow;
- candidate render isolation and post-render technical validation;
- `assembly-run.json`, strict `final-clip.json`, final clip hash/size/probe provenance, and atomic `final/clip.mp4` publication;
- failure-honest invalidation/cleanup semantics;
- deterministic default-template and synthetic non-default template coverage.

Owner closeout note:
- P1-P3 landed at package versions 0.5.1, 0.5.2, and 0.5.3.
- P4 closeout reviewed the implementation and repaired one bounded provenance issue while keeping package/engine version 0.5.3.
- The closeout host had neither ffmpeg nor ffprobe and did not have an owner-supplied media-ready workspace, standardized intro/outro, or font.
- Therefore no real FFmpeg capability smoke, real `vidgen assemble` story render, post-probe of an actual story clip, or human playback/aesthetic review is claimed.
- The owner manually closed Phase 5 at 0.5.3 and deferred that runtime/media qualification rather than fabricating evidence.

Phase 5 non-goals remained:
- live multi-story ngest fan-out;
- publisher retrieval;
- database/queue orchestration;
- global caching;
- automated publishing;
- alternate aspect ratios;
- Remotion.

## Phase 6 — Live ngest fan-out and operational hardening

Status: NEXT ROADMAP PHASE / AFTER C5 MVP REFACTOR

Goal:
Connect the proven story pipeline back to live curated ngest input and process supplied stories independently.

Conceptual contract:

    live curated ngest feed
              |
              v
      CanonicalInput
          /   |   \
         /    |    \
        v     v     v
     story A story B story C
        |     |     |
        + independent story pipelines

Likely concerns:
- complete the previously blocked real ffmpeg/ffprobe capability smoke and one owner-media story render before treating the Phase 5 assembly path as operationally qualified;
- add bounded publisher-page retrieval fallback before live operation if real ngest stories can lack sufficient normalized context; keep broader web research deferred;
- live authentication/integration qualification;
- explicit resolution of ngest continuation/pagination semantics before multi-page production use;
- story fan-out without editorial selection;
- sequential processing first unless workload evidence justifies concurrency;
- failure isolation between stories;
- retries/resume;
- story-local provider-job/asset recovery;
- idempotency and duplicate-production policy;
- artifact retention;
- CLI observability;
- provider spend limits;
- secret-leak review;
- end-to-end provenance.

## Deferred until evidence requires them

- Remotion or another programmable compositor;
- 16:9 and 1:1 output;
- general web research beyond a future bounded publisher fallback;
- approval workflows;
- global asset cache;
- sophisticated template inheritance/editor tooling;
- database persistence;
- queues/workers/distributed orchestration;
- automated publishing destinations;
- public VidGen API/UI;
- multi-tenant behavior;
- future non-Google provider implementations;
- advanced generated graphics.

## Immediate next action

Run the owner-directed behavior-preserving correction stack:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write c5-mvp-refactor

The correction should simplify the existing MVP implementation after rapid Phase 1-5 construction. It must not add product capability, alter durable schemas/artifact meanings, weaken validation/trust boundaries, change provider/render semantics, or turn the previously unperformed real FFmpeg/story-render qualification into a claimed success.

After the correction closes, proceed to Phase 6 planning. The deferred real-host/owner-media assembly qualification remains an explicit Phase 6 operational-hardening prerequisite.
