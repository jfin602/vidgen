# Initial VidGen Roadmap

Status: CURRENT MVP DIRECTION / PROVISIONAL PHASE BOUNDARIES
Phase 1 completion: 0.1.5
Current baseline: 0.2.0

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

Status: CURRENT / PLANNING BASELINE 0.2.0

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

Likely concerns:
- one representative local sample fixture using the real ngest external shape;
- reuse of the same boundary validation/normalization semantics as live input;
- selecting exactly one Article for the manual development run without inventing editorial ranking;
- story-production identity/fingerprint;
- story directory/package layout;
- provenance linkage back to CanonicalInput/Article;
- template registry and validation boundary;
- implementation of the locked default assembly template definition;
- handling/versioning of standardized intro/outro assets;
- qualification of the actual intro/outro durations and their deterministic relationship to the locked logical 0-40 story timing;
- 9:16 media normalization assumptions needed by later FFmpeg assembly;
- focused deterministic tests.

Non-goals:
- AI ClipPlan generation;
- publisher retrieval;
- Veo/provider calls;
- FFmpeg final assembly;
- live multi-story processing;
- Remotion.

Phase 2 should make it trivial for subsequent phases to run one story repeatedly while debugging video behavior.

## Phase 3 — Story context and ClipPlan

Goal:
Turn one selected story plus only the context it actually needs into one validated ClipPlan that fills the selected template.

Conceptual contract:

    story input
       +
    template contract
       +
    optional bounded
    publisher context
          |
          v
       ClipPlan

Likely concerns:
- deterministic assessment of whether ngest story data is sufficient;
- bounded publisher-page retrieval only when needed;
- redirect/timeout/size/content-type/SSRF safeguards;
- normalized source-context persistence when retrieval occurs;
- one logical model-assisted creative operation per story;
- presenter dialogue;
- headline/supporting text;
- off-screen narration text;
- generated-content prompt/description;
- closing content;
- Article/source provenance;
- provider-native structured output where available;
- VidGen-owned JSON Schema/runtime/semantic validation;
- bounded malformed-output repair/retry;
- prevention of unsupported factual expansion;
- proof that every required default-template slot is filled.

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
- general web research;
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
    -> /prompt-write p2

Phase 2 planning should inspect the implemented CanonicalInput/run boundaries and build the smallest manual single-story fixture, story package, and default assembly-template foundation needed to unlock video debugging.
