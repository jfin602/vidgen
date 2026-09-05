# Initial VidGen Roadmap

Status: CURRENT MVP DIRECTION / PROVISIONAL PHASE BOUNDARIES
Phase 1 completion: 0.1.5
Phase 2 completion: 0.2.5
Current baseline: 0.3.0

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

Status: CURRENT / PLANNING BASELINE 0.3.0

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

Likely concerns:
- require sufficient normalized story context for the initial manual path;
- fail clearly on insufficient context rather than automatically researching;
- add small declarative authoring semantics to template content slots so core ClipPlan generation stays template-generic;
- one logical model-assisted operation per story;
- generic ClipPlan identity plus slot-value contract;
- template ID/version and storyFingerprint linkage;
- provider-neutral text-model boundary with Google as the first implementation;
- provider-native structured output where useful without making provider shapes canonical;
- VidGen-owned JSON Schema/runtime/semantic validation;
- exact required-slot completeness with no missing, duplicate, or undeclared slots;
- bounded text/slot lengths;
- controls treated as untrusted configuration that cannot alter template structure or grounding;
- bounded malformed-output repair/retry;
- clip-plan.json persistence in the story workspace;
- manual CLI/application integration for repeated story debugging.

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

Goal:
Realize the generated media required by the selected template without building a generalized media platform.

For the default template, the target is approximately:
- anchor/presenter clip #1;
- main generated content/B-roll clip;
- off-screen voiceover for the content clip;
- anchor/presenter clip #2 when required by the locked template.

Likely concerns:
- deterministic resolution of generated asset-role inputs from AssemblyTemplate relationships plus ClipPlan slot values;
- for the default template: opening-anchor <- hook + headline; content-video/content-voiceover <- narration; supporting-anchor <- supporting-information + closing;
- thin provider-neutral request/result contracts;
- Veo presenter generation from scripted text plus approved/reference imagery;
- Veo or qualified generated-video path for the content clip;
- selection/qualification of the off-screen narration/voiceover mechanism before implementation;
- provider job IDs/status where necessary;
- bounded retries/timeouts;
- malformed/partial provider responses;
- asset identity/hashes;
- effective-generation-input identity for story-local reuse;
- provider cost observability;
- source/provenance metadata;
- mocked orchestration proof;
- limited live-provider qualification.

Standardized intro/outro assets are not regenerated per story.

A separate generated-graphic subsystem is out of scope unless real clips demonstrate a need.

## Phase 5 — FFmpeg assembly and first complete clip

Goal:
Produce the first complete, postable vertical story clip from standardized and generated assets.

Conceptual assembly:

    standardized intro
          +
    presenter/content media
          +
    standardized outro
          |
          v
       FFmpeg
          |
          v
      final clip.mp4

Likely concerns:
- media probing/validation;
- normalization to the template's required resolution/frame rate/codecs;
- deterministic trimming;
- concatenation;
- voiceover mux/replacement;
- audio-level normalization;
- simple deterministic text/overlay support only where necessary;
- burned captions if enabled;
- H.264 MP4 final encoding;
- honest failed-assembly semantics;
- final clip identity/provenance;
- story package completeness;
- reusing valid story-local generated assets during repeated assembly;
- end-to-end execution against a real manually selected sample story.

Success criterion:
A manually selected ngest-shaped story produces one usable 1080x1920 postable clip and a self-contained story package with the story-specific source/generated files used to make it.

Remotion is not part of this phase.

## Phase 6 — Live ngest fan-out and operational hardening

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

Use:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write p3

Phase 3 planning should inspect the implemented StoryInput, story-workspace, AssemblyTemplate, and ngest boundaries and build the smallest direct StoryInput + AssemblyTemplate -> validated ClipPlan capability. It should add generic slot authoring semantics where needed, keep one logical model call, persist clip-plan.json, and leave publisher retrieval, media prompting, provider generation, and FFmpeg out of scope.
