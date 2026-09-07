# Initial VidGen Roadmap

Status: CURRENT MVP DIRECTION / PROVISIONAL PHASE BOUNDARIES
Phase 1 completion: 0.1.5
Phase 2 completion: 0.2.5
Phase 3 owner closeout: 0.3.4
Phase 4 owner closeout: 0.4.4
Phase 5 owner closeout: 0.5.3
Current baseline: 0.6.5

This roadmap was rebased on 2026-09-05 after Phase 1. The original edition/newscast phases were intentionally removed in favor of a single-story clip engine. On 2026-09-06 the owner prioritized a still simpler presenter-headline production path before live fan-out while explicitly preserving the implemented cinematic template pipeline.

## Cross-phase MVP constraints

The roadmap assumes:
- Node.js + TypeScript;
- manually invoked CLI development first;
- one selected story at a time until the video path is proven;
- manual sample input using VidGen's validated post-adapter input shape;
- each supplied ngest story is already production-worthy;
- no VidGen ranking, clustering, or story-selection stage;
- one story remains one independent production boundary;
- StoryInput is the shared boundary for downstream production;
- the Phase 6 simple path branches directly from StoryInput and does not require AssemblyTemplate, ClipPlan, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan;
- the preserved cinematic path continues to use one validated ClipPlan creative stage and declarative assembly templates for structure/timing/media-slot requirements;
- independently optional standardized premade intro/outro wrapper assets remain part of the preserved cinematic path under the approved post-Phase-5 correction; omission inserts no placeholder media;
- Google-first generated media behind thin replaceable adapters;
- Veo as the initial presenter/video direction;
- FFmpeg/FFprobe for deterministic finishing/qualification of the simple path and assembly/qualification of the preserved cinematic path;
- 1080x1920 9:16 H.264 MP4 at 30 fps as the initial output target;
- simple-path `maxSeconds` configurable from 4 through 20 seconds inclusive as a hard output ceiling, not a target duration;
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
- bearer-authenticated ngest input client;
- authenticated HTTP acquisition;
- transport validation;
- CanonicalFeed;
- CanonicalControl;
- CanonicalInput;
- deterministic canonical serialization and SHA-256 inputFingerprint;
- filesystem-backed run metadata/artifacts;
- deterministic tests;
- fail-closed behavior for unsupported non-null nextCursor in the original Phase 1 transport.

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
- representative fictional local fixture using VidGen's validated post-adapter input shape;
- local fixture loading through `validateNgestVidGenManifestPage()` before canonicalization;
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

## Approved post-Phase-5 corrections

The owner approved these bounded Phase 5 corrections:

1. `c5-mvp-refactor` — COMPLETE. Behavior-preserving simplification only; observable product behavior, durable artifact meanings, trust boundaries, retry/failure semantics, and provider/render behavior were preserved.
2. `c5-optional-assets` — COMPLETE. Intro and outro are independently optional deterministic wrapper assets. Omission inserts no placeholder media or silence; only supplied wrappers are probed/qualified, included in expected duration and assembly identity, and recorded in durable provenance. Social-first output may begin directly with the story hook.
3. `c5-config-fix` — OWNER-APPROVED / DEFERRED. Transitional live-development ingress may later consume ngest's existing authenticated Distribution v1 Profile endpoint using base URL + Profile key + bearer configuration, validate and adapt the complete bounded snapshot into the existing VidGen input shape with neutral VidGen-owned controls, and add an Article-URL helper that writes validated one-Article sample fixtures. It no longer blocks Phase 6.

The Distribution-v1 path is transitional. It must remain isolated behind the ngest adapter so the future dedicated Profile-bound VidGen feed-plus-controls endpoint can replace it without changing downstream CanonicalInput, StoryInput, provider, or assembly contracts.

## Phase 6 — Simple presenter headline clips

Status: IMPLEMENTED AT 0.6.5 / OWNER CLOSEOUT PENDING

Goal:
Add the smallest useful production path for the current client requirement while preserving the completed cinematic pipeline unchanged.

Conceptual contract:

    StoryInput
        |
        v
  bounded presenter copy
        |
        v
  one presenter video
        |
        v
 deterministic lower third
   headline + source
        |
        v
 qualification / finishing
        |
        v
   MP4 + JSON sidecar

Required direction:
- one continuous presenter clip per selected story;
- no B-roll, separate TTS voiceover, standardized intro/outro, ClipPlan, AssemblyTemplate, cinematic GeneratedMediaUnit resolution, or cinematic AssemblyPlan requirement;
- headline and source display name rendered deterministically after generation rather than delegated to model-generated on-screen text;
- configurable `maxSeconds` from 4 through 20 seconds inclusive;
- `maxSeconds` is a hard final-output ceiling, not a target duration;
- prefer the shortest useful provider-supported duration that does not exceed the ceiling;
- keep provider-specific duration granularity behind the provider boundary;
- fail rather than publish a qualified final clip whose duration exceeds the configured ceiling;
- pair each final MP4 with article/provenance JSON containing the governed Article metadata and enough production identity to inspect or publish the clip safely;
- reuse existing CanonicalInput/StoryInput, provider boundaries, local reference-image safety, FFmpeg/FFprobe, hashing, and atomic-publication patterns where appropriate;
- preserve existing `vidgen story`, `vidgen plan`, `vidgen media`, and `vidgen assemble` behavior and cinematic durable artifact meanings;
- no live fan-out, publisher retrieval, database/queue work, automated publishing, or cinematic refactor as part of this phase.

Phase 6 planning owns the exact CLI spelling, presenter-copy contract, provider-duration capability mapping, runtime anchor/font configuration, output naming, and durable JSON sidecar schema.

Phase 6 implementation has reached package/engine baseline 0.6.5. Owner review has driven bounded Phase 6 correction work without promoting those repairs into a new roadmap phase.

## Approved Phase 6 corrections

The owner has approved `c6-vertex-adapter` as a bounded Phase 6 correction at unchanged version 0.6.5.

Goal:
Add Vertex AI Veo as a parallel Google video backend behind the existing provider-neutral video-generation boundaries while preserving the working Gemini Developer API Veo backend.

Required direction:
- existing Developer API behavior remains supported and regression-protected;
- Vertex is selected explicitly through runtime configuration rather than StoryInput, CanonicalControl, ClipPlan, templates, or model output;
- use supported Google Cloud authentication for Vertex rather than reusing `GEMINI_API_KEY`;
- keep Vertex model/project/location and any bounded Cloud Storage staging configuration inside the adapter/runtime boundary;
- preserve the current approved presenter-reference semantics and fail configuration when a selected Vertex model cannot satisfy them;
- keep provider request/poll/output retrieval and staging safety inside the Vertex adapter;
- do not silently fall back between Developer API and Vertex;
- preserve simple-path duration/FFmpeg/sidecar behavior and cinematic GeneratedMediaUnit/assembly semantics;
- record safe effective backend/model/operation provenance without secrets, raw provider responses, or unrestricted staging paths;
- include mocked deterministic proof plus a real Vertex qualification when credentials, quota, supported model access, staging, and runtime are actually available;
- no Flow automation, ngest changes, fan-out, database/queue work, publishing, or generalized provider-framework redesign.

See docs/integrations/google-video.md.

## Phase 7 — Live ngest fan-out and operational hardening

Status: DEFERRED UNTIL AFTER PHASE 6

Goal:
Connect the proven production paths back to live curated ngest input and process supplied stories independently through the shared CanonicalInput/StoryInput boundary.

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
        + independent selected production paths

Likely concerns:
- resume or complete `c5-config-fix` if the transitional Distribution-v1 development adapter is still needed;
- complete live authentication/integration qualification of the applicable ngest adapter;
- story fan-out without editorial selection;
- sequential processing first unless workload evidence justifies concurrency;
- failure isolation between stories;
- retries/resume;
- provider-job/asset recovery;
- idempotency and duplicate-production policy;
- artifact retention;
- CLI observability;
- provider spend limits;
- secret-leak review;
- end-to-end provenance;
- add bounded publisher-page retrieval fallback only if real governed stories demonstrate insufficient normalized context;
- retain separate runtime qualification evidence for both the simple and cinematic paths rather than treating one as proof of the other.

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

Plan the owner-approved Phase 6 Vertex backend correction:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write c6-vertex-adapter

Keep package/engine version 0.6.5 across the correction stack. Preserve the existing Developer API backend and the completed simple/cinematic contracts.

Phase 7 remains live ngest fan-out and operational hardening. Do not pull Phase 7 scope into the Vertex correction.

Do not claim live Vertex/provider/render qualification unless the corresponding execution was actually observed.
