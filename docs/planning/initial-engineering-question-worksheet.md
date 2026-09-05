# Initial Engineering Question Worksheet

Status: OPEN / PRE-IMPLEMENTATION
Purpose: Resolve the highest-impact engineering decisions before Phase 1 implementation planning and before locking the production architecture.

This worksheet is intentionally decision-oriented. The questions below are not implementation tasks. They should be answered well enough to establish the first coherent technical direction while preserving room for provider and production iteration.

## How to use this worksheet

For each question, record:
- Decision: the current chosen direction;
- Confidence: low / medium / high;
- Why: the reasoning or evidence behind the decision;
- Deferred details: anything intentionally left open;
- Docs affected: durable documentation that should be updated if the decision is locked.

Do not treat unanswered examples or options as requirements.

---

## 1. What should the primary VidGen runtime and language be?

The repository has not yet chosen its application stack.

Major candidates include:
- Node.js + TypeScript;
- Python;
- a deliberately split stack where orchestration and rendering use different runtimes.

Consider:
- AI/provider SDK quality;
- HTTP and schema tooling;
- media-processing libraries;
- renderer/compositor compatibility;
- testability;
- deployment simplicity;
- contributor accessibility;
- whether multiple runtimes are justified this early.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 2. What should the first execution model be?

Should VidGen initially operate as:
- a local/remote CLI batch engine;
- a long-running worker/service;
- an HTTP API service;
- a CLI over reusable application services that can later be hosted?

Consider:
- hackathon demonstration;
- ngest-triggered execution later;
- restart/resume;
- provider jobs that outlive one process;
- operational complexity.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 3. What durable run state is required before the first end-to-end video exists?

Decide how much state VidGen must persist during early development.

Possible starting points:
- filesystem-only run directories;
- filesystem artifacts plus a small metadata store;
- database-backed run/job state from the beginning.

Consider:
- reproducibility;
- crash recovery;
- resume;
- provider job polling;
- idempotency;
- local development;
- eventual multi-worker execution.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 4. What is the canonical artifact model for a VidGen run?

Decide which intermediate outputs must be durable and inspectable.

Current conceptual stages are:
- CanonicalInput;
- FeedAnalysis;
- EditorialPlan;
- Script;
- ProductionPlan;
- RenderManifest;
- final video.

Resolve:
- which stages are persisted as versioned structured artifacts;
- whether every stage has a stable schema;
- how artifacts reference their producer version and upstream inputs;
- which artifacts are disposable cache versus durable provenance.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 5. How provider-neutral should the first AI orchestration layer be?

Should early FeedAnalysis, EditorialPlan, and Script work:
- directly against Gemini first;
- use a minimal provider interface from day one;
- support multiple model providers immediately?

Consider:
- hackathon speed;
- avoiding provider leakage into domain models;
- structured-output differences;
- model/tool-call capabilities;
- retry/error semantics;
- future provider replacement.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 6. What research/enrichment is VidGen allowed to perform, and at which stage?

The ngest feed provides governed Articles and original publisher URLs, but VidGen may need more context than normalized summaries provide.

Decide whether VidGen may:
- use only ngest-supplied normalized content;
- fetch the supplied publisher URLs;
- perform broader web research through a separately authorized research capability;
- use different research rules for different stages.

Resolve:
- retrieval safety;
- source provenance;
- factual support requirements;
- caching;
- timeout/size bounds;
- what happens when publisher pages cannot be retrieved.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 7. Should FeedAnalysis and EditorialPlan remain separate model stages?

Current architecture treats them as distinct artifacts.

Decide whether:
- FeedAnalysis discovers themes, clusters, entities, uncertainty, and candidate stories;
- EditorialPlan separately chooses the final theme, stories, order, opening, closing, and transitions;

or whether the first version should combine them.

Consider:
- inspectability;
- model cost/latency;
- prompt complexity;
- regression testing;
- ability to change editorial strategy without repeating research;
- hackathon transparency.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 8. What structured-output and validation strategy should model-assisted stages use?

Decide how AI output becomes trusted internal data.

Possible elements:
- JSON Schema;
- runtime types;
- provider-native structured output;
- deterministic validators;
- bounded repair/retry;
- rejection of unsupported claims or missing Article support.

Resolve which failures are:
- retryable;
- repairable;
- terminal;
- human-reviewable.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 9. Where, if anywhere, should human review occur in the first complete pipeline?

Decide whether the first usable system is:
- fully automatic;
- reviewable after EditorialPlan;
- reviewable after Script;
- reviewable before expensive media generation;
- configurable between automatic and approval-gated operation.

Consider:
- hackathon automation expectations;
- expensive video-generation calls;
- factual/editorial mistakes;
- development iteration speed.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 10. What must Script provide so ProductionPlan never has to reinvent editorial meaning?

Before production design, identify the semantic information Script must carry beyond narration text.

Potential needs:
- segment identity;
- supporting Article IDs;
- intended duration;
- emphasis;
- quoted/on-screen text;
- visualizable entities/events;
- transition intent;
- factual claims requiring visual/source caution.

The goal is to avoid ProductionPlan inventing script-owned semantics later.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 11. How template-driven should the newscast be versus fully generative?

The client has explicitly indicated that basic composition templates are acceptable for a newscast.

Decide the intended balance between:
- deterministic reusable newscast templates;
- generated video clips;
- generated still images;
- publisher/source imagery where permitted;
- text/graphic scenes.

For example, determine whether the default program is mostly a stable broadcast package with generated media filling defined visual slots, or whether each edition receives a substantially unique generated visual structure.

This decision strongly affects cost, reliability, consistency, and ProductionPlan complexity.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 12. What compositor/rendering technology should own final assembly?

Major candidates may include:
- Remotion/React rendered through Chromium + FFmpeg;
- direct FFmpeg timeline/filter composition;
- another programmatic video compositor;
- a 3D/render engine where justified;
- a hybrid where templates are composed in one system and encoded/muxed in FFmpeg.

Evaluate:
- template authoring;
- typography/graphics;
- animation;
- audio mixing;
- caption rendering;
- deterministic output;
- headless deployment;
- GPU requirements;
- testability;
- open-source portability.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 13. What is the reusable newscast template model?

If templates are central, decide what a template actually means.

Possible structure:
- program shell;
- intro/outro;
- anchor/presenter scene;
- headline card;
- story opener;
- B-roll montage;
- quote/stat card;
- lower third;
- transition;
- closing scene.

Resolve:
- which scene types are deterministic;
- which slots ProductionPlan fills;
- how templates expose timing and safe areas;
- whether templates are code, data, or both;
- how new templates can be added without changing editorial code.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 14. What generated-media strategy and provider fallback hierarchy should VidGen use?

Decide what media VidGen is expected to generate and when.

Potential media classes:
- text-to-video;
- image-to-video;
- generated still images;
- motion graphics;
- template-only visual fallback.

Resolve:
- initial provider target;
- provider-neutral request model;
- maximum generated clip duration;
- retries;
- quality rejection;
- timeout handling;
- what VidGen renders when a generation job fails.

A reliable fallback path is especially important if templates can keep the program renderable when generative media fails.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 15. Will the program use an anchor/presenter, and how is that presenter produced?

Decide whether the initial newscast uses:
- voiceover only;
- a deterministic graphic/newsroom host frame;
- an AI-generated human presenter;
- an avatar/lip-sync provider;
- short presenter segments mixed with B-roll.

Consider:
- consistency across episodes;
- uncanny-valley risk;
- lip-sync complexity;
- generation cost;
- template implications;
- narration ownership.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 16. What narration/TTS system owns spoken timing?

Decide:
- initial TTS provider or provider-neutral boundary;
- whether one stable program voice is required;
- how pronunciation overrides work;
- whether Script duration is estimated or narration audio becomes the final timing authority;
- how regenerated narration affects scene timing;
- how pauses, emphasis, and pacing controls are represented.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 17. How should deterministic graphics, captions, and audio packaging work?

Decide which elements should be template/render-engine responsibilities rather than generative-media responsibilities.

Examples:
- lower thirds;
- source labels;
- headline text;
- stat/quote cards;
- captions;
- logos/branding;
- intro/outro;
- transitions;
- music beds;
- stingers;
- audio ducking.

Resolve whether these are driven by one shared design system and how they adapt across aspect ratios.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 18. What is the asset-source priority and rights/safety policy?

For each story, decide the preferred hierarchy among:
- original publisher media explicitly supplied through governed input;
- generated media;
- approved stock/library assets;
- deterministic templates/graphics;
- other future acquisition providers.

Resolve:
- whether remote publisher images may be downloaded automatically;
- attribution/source-label requirements;
- licensing assumptions;
- unsafe or unusable media handling;
- when VidGen must fall back to generated/template visuals.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 19. What output formats are first-class for v1?

Decide the initial delivery targets:
- 16:9 landscape;
- 9:16 vertical;
- 1:1;
- one master plus derived variants.

Also resolve:
- resolution;
- frame rate;
- codec/container;
- target duration range;
- caption burn-in versus sidecar;
- whether templates must be responsive across all supported aspect ratios from the start.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## 20. What are the render/runtime limits and recovery guarantees?

Define the operational envelope for one edition.

Decide:
- where rendering/generation runs;
- CPU/GPU assumptions;
- maximum wall-clock runtime;
- concurrency expectations;
- provider-spend ceiling;
- caching rules;
- which completed stages/assets may be reused;
- resume behavior after process crash;
- provider retry limits;
- whether identical CanonicalFeed + CanonicalControl should reuse a prior successful edition or only prior intermediate work.

This decision ties together inputFingerprint, durable artifacts, provider jobs, and final rendering.

Decision:

Confidence:

Why:

Deferred details:

Docs affected:

---

## Suggested decision order

The questions are numbered for reference, not strict resolution order.

A productive planning sequence is likely:

1. Runtime and execution: 1, 2, 3, 4
2. AI/editorial pipeline: 5, 6, 7, 8, 9, 10
3. Production architecture: 11, 12, 13, 14, 15, 16, 17, 18
4. Delivery and operations: 19, 20

Questions 11-14 are the central production architecture cluster. They should be resolved together because template usage, compositor choice, scene contracts, generative-media providers, fallbacks, cost, and reliability directly constrain one another.
