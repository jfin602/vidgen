# VidGen Worker

Status: IMPLEMENTED / PHASE 7 WORKER; live capabilities remain unqualified

## Purpose

The VidGen Worker is the long-running orchestration layer around the existing VidGen and VidGen Poster CLIs.

It discovers newly available governed ngest Articles, gathers bounded web-attention evidence through Parallel Search, applies versioned Web Momentum and cost policy, invokes VidGen only for admitted candidates, and publishes completed media independently through ready VidGen Poster platforms.

The Worker is not a creative generation subsystem and is not a publishing adapter.

## Ownership boundary

Ngest owns:
- governed source trust;
- moderation and duplicate behavior;
- Profile filtering and ordering;
- canonical Article identity/provenance;
- the decision that an Article is a valid production candidate.

The Worker owns:
- polling and candidate discovery;
- first-start baseline state;
- Parallel Web Momentum evaluation;
- automatic-production admission and spend limits;
- durable orchestration state;
- bounded retry/resume;
- VidGen CLI invocation;
- VidGen Poster readiness discovery and per-platform fan-out.

VidGen owns generation. A story explicitly submitted to VidGen does not pass through a Parallel gate inside the engine.

VidGen Poster owns each requested publication, including authentication, platform-specific validation, upload/publish behavior, duplicate protection, durable receipts, and safe failure reporting.

## Runtime flow

    poll ngest
        |
        v
   new Article?
      /    \
    no      yes
    |        |
   sleep     v
        Parallel Search
             |
             v
       Web Momentum vN
             |
       admitted?
        /      \
      no        yes
      |          |
   skipped    Poster readiness
                 |
            any video platform ready?
               /        \
             no          yes
             |            |
           hold       VidGen CLI
                          |
                          v
                     final media
                          |
                          v
                  Poster per platform

The initial Worker processes expensive generation single-flight.

## Ngest polling and discovery

The Worker must use the existing authenticated ngest/VidGen boundary rather than query ngest persistence directly.

Normal first startup establishes the Articles in the current coherent feed snapshot as the baseline. Existing baseline Articles are not automatically treated as new work. Processing pre-existing Articles requires an explicit operator backfill action.

New-Article discovery must use durable identity, not process memory alone. Restarting the Worker must not make already-seen Articles appear new.

## Operating modes

### observe

Poll, discover, evaluate with Parallel, score, and persist decisions.

Never invoke VidGen generation and never publish.

This is the required calibration mode.

### generate

Poll, discover, evaluate, and invoke VidGen for admitted candidates.

Never publish.

### live

Run the complete admitted-candidate flow through VidGen and VidGen Poster.

A mode change must not erase durable prior state.

## Web Momentum admission

Web Momentum is a Worker-owned estimate of recent event-specific web attention. It is not a claim to measure the entire Internet and is not an editorial truth score.

Initial signal families are:
- independent coverage breadth;
- saturation of event-specific results;
- reaction, analysis, or follow-up coverage;
- freshness.

Exact weights and the live threshold are calibration outputs, not frozen architecture constants.

Every durable decision records the metric name/version, score, threshold, decision, evaluation time, query/evidence identity, and enough normalized result evidence to explain the outcome.

A skipped Article remains a valid governed Article and may still be submitted manually to VidGen.

## Calibration requirement

Before autonomous live admission is qualified, run a representative set of real governed Articles through observe mode and label each with an owner generate/skip judgment.

Tune the score and threshold against those labels. Because the purpose is cost control, optimize primarily for precision: admitted candidates should rarely be stories the owner would not have chosen to spend generation resources on.

A changed scoring algorithm, query strategy, or materially different evidence policy requires a new Web Momentum version.

## Durable state

Worker state must survive restart.

At minimum, retain semantic state for:
- discovery;
- evaluation;
- admission/skip;
- generation;
- publication per platform.

Do not collapse these into one processed boolean.

A successful earlier stage is not repeated only because a later stage failed. In particular:
- successful Parallel evaluation survives generation failure;
- successful generation survives publication failure;
- one platform's successful publication survives another platform's failure.

Initial filesystem-backed state is acceptable. Database and distributed queue infrastructure are deferred until evidence requires them.

## Queue scheduling and expiration

Admitted work is a durable, score-priority backlog, not a second mutable queue. The Worker orders currently eligible candidates by persisted Web Momentum score descending, successful admission time ascending, then article ID ascending. It never recalculates or decays a stored score as a candidate ages.

`VIDGEN_WORKER_QUEUE_EXPIRATION_DAYS` controls queue eligibility. It is a positive whole number from 1 through 365 and defaults to 3 when omitted; malformed or out-of-range values fail closed as configuration errors. Queue age starts at the Worker's persisted successful admission timestamp. A candidate remains eligible while `now < queuedAt + expirationDays * 24h` and is expired at or after that exact boundary. Expiration is a durable non-generating outcome: it preserves the record while consuming neither a generation attempt nor a daily generation start.

The default daily generation limit is one start per UTC calendar day (the CLI may explicitly override it). Exhausting that limit pauses generation only: polling, discovery, bounded evaluation, admission, and queue reordering continue. On the next UTC day, the highest-scored still-unexpired queued candidate resumes automatically without re-evaluation.

## Generation handoff

The Worker invokes VidGen through a CLI process boundary using argument arrays and no shell interpolation.

For the initial automatic path, generate the final media first. The Worker must not use headline-post as its autonomous orchestration primitive because publication retries must remain independent from expensive generation.

The Worker verifies the successful VidGen result/artifact boundary before publishing.

## Publishing handoff

The Worker does not own social-platform credentials.

Before spending on generation, it may use VidGen Poster doctor commands to identify ready video-capable platforms. A connected platform means a video-capable Poster adapter that passes readiness in the current Worker runtime.

The initial video-capable targets are X, Bluesky, and Instagram Reels. Threads is not a local-video target under the current Poster contract.

The Worker invokes Poster separately per platform. Poster remains authoritative for provider behavior and duplicate/uncertain-publication semantics.

## Failure and retry policy

- Ngest unavailable: perform no new work; retry polling later.
- Parallel unavailable: do not generate; retain evaluation-retry state.
- Parallel budget exhausted: do not generate; retain budget-blocked state.
- Below threshold: persist a terminal skip for that evaluation version.
- VidGen failure: retain successful admission and retry generation only under bounded policy.
- Platform failure: retain successful generation and successful platform outcomes; retry only unresolved platforms.

Unknown external state must not be converted into success.

## Budget policy

The Worker exists partly to prevent unnecessary provider spend.

Initial safeguards include:
- at most one Parallel Search request per Article evaluation identity;
- bounded result/query sizes;
- explicit Parallel spend/evaluation ceilings;
- explicit generation ceilings;
- single-flight expensive generation;
- no automatic generation when evaluation cannot complete safely;
- no generation when no eligible video-capable publishing destination is ready in modes that require publication.

Exact numeric budgets are runtime configuration and operational policy rather than creative controls.

## Security

Worker-only secrets include Parallel credentials and any runtime configuration needed to invoke local tools.

PARALLEL_API_KEY and other secrets must never enter:
- CanonicalInput;
- StoryInput;
- Web Momentum durable evidence;
- creative prompts;
- generated media metadata;
- VidGen Poster receipts;
- logs or public errors.

The Worker must not read or duplicate Poster platform credentials; Poster owns them.

Treat ngest payloads, Parallel responses, URLs, subprocess output, and persisted artifacts as untrusted input.

## Evidence boundaries

The deterministic Worker/state-machine implementation is covered by tests. Those tests do not prove live ngest polling, Parallel search, provider generation, or social publication.

Phase 7 closeout must distinguish:
- deterministic Worker/state-machine proof;
- real ngest polling evidence;
- real Parallel request/evidence proof;
- real VidGen generation evidence;
- real per-platform publication evidence.

No capability may be claimed from another capability's evidence.

## Non-goals

Initial Worker scope does not include:
- creative web research or factual enrichment for StoryInput;
- direct platform API implementation;
- direct ngest database access;
- moving Poster adapters into VidGen;
- moving VidGen generation internals into the Worker;
- distributed queues or multi-worker coordination;
- horizontal scaling;
- a Worker web UI;
- generalized scheduling beyond polling/retry needs.
