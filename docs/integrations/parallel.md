# Parallel Integration

Status: IMPLEMENTED / PHASE 7 WORKER INTEGRATION; live Search remains unqualified

## Purpose

Parallel Search supplies bounded, recent web-attention evidence to the VidGen Worker so the Worker can estimate Web Momentum before spending on expensive automatic generation.

Parallel is not part of VidGen creative generation in Phase 7.

Its output must not become:
- CanonicalInput;
- StoryInput;
- ClipPlan grounding;
- presenter-copy context;
- Veo or speech prompt context;
- media-reuse permission.

## Runtime boundary

The Worker owns the Parallel client and PARALLEL_API_KEY.

VidGen and VidGen Poster must not require Parallel configuration.

The initial evaluation contract allows at most one Parallel Search request per Article evaluation identity. Generation retries, Worker restarts, and publication retries must reuse a completed evaluation rather than paying for another search.

Do not introduce autonomous search loops, recursive research, or additional Parallel APIs merely to improve a score.

## Search objective

The Search request should seek recent independent web coverage, reactions, analysis, and follow-up reporting that refer specifically to the candidate news event.

The query strategy should use a small bounded set of concise event-specific queries derived from governed Article fields such as headline and summary. Generic historical popularity of the same person, company, film, product, or topic must not be mistaken for momentum around the current event.

Freshness policy should be bounded around the Article/event timeframe.

The exact request shape, result count, and provider mode remain implementation/runtime choices subject to the one-request and budget contracts.

## Normalized evidence

Treat the provider response as untrusted input and normalize only bounded fields needed for scoring and inspection.

Useful evidence may include:
- title;
- URL;
- normalized domain;
- provider publish date when present;
- bounded relevant excerpt or its hash;
- deterministic event-match features;
- reaction/follow-up features.

Do not persist unrestricted raw provider responses, secrets, authorization data, or unbounded excerpts.

## Web Momentum

The durable metric name is web-momentum with an explicit version.

Initial signal families are:
- independent coverage breadth;
- event-specific result saturation;
- reaction, analysis, or follow-up evidence;
- freshness.

These signals are hypotheses to calibrate. Exact weights and thresholds must not be treated as stable architecture until observe-mode evidence supports them.

Web Momentum is a proxy for current web attention, not a total Internet mention count, social engagement count, factual confidence score, source-trust score, or editorial-quality score.

## Evaluation identity and reuse

A completed evaluation must have a stable identity that binds at least:
- governed Article identity;
- Web Momentum version;
- material query/evidence policy;
- material freshness policy.

A completed matching evaluation is reused. If the scoring/query policy changes materially, create a new version rather than silently reinterpreting old scores.

## Admission semantics

Parallel does not decide whether an ngest Article is valid.

The Worker combines normalized Parallel evidence with its configured Web Momentum algorithm and threshold to decide whether the candidate is admitted to automatic generation.

Below-threshold decisions are durable skips for that evaluation version. They do not modify ngest data and do not prevent manual VidGen invocation.

If a Parallel evaluation cannot complete safely, the Worker fails closed on new generation spend rather than guessing.

## Cost controls

Parallel is intended to save money by cheaply rejecting weak automatic-production candidates before Gemini/Veo work begins.

Required controls:
- at most one Search request per Article evaluation identity;
- bounded queries/results/output;
- reusable completed evaluations;
- explicit spend/evaluation ceilings;
- no hidden retry loops that create additional billable searches;
- safe budget-exhausted state that does not fall through to generation.

Current provider pricing is operational information and should not be embedded as a permanent architecture assumption.

## Calibration

Use observe mode before enabling autonomous generation.

Compare Web Momentum output against owner generate/skip labels on representative real stories, then tune query strategy, feature extraction, score weights, and threshold.

Because the primary goal is cost avoidance, calibration should favor precision over recall.

Any material scoring or query-policy change requires a new metric version and renewed evidence.

## Security and provenance

PARALLEL_API_KEY is runtime-only and must not appear in durable evidence, prompts, logs, public errors, VidGen artifacts, or Poster receipts.

Persist enough normalized evidence and provider-safe identity to explain why an Article was admitted or skipped, but do not persist raw authorization material or unrestricted provider payloads.

## Evidence requirement

A mocked Parallel client proves only Worker behavior around a simulated response.

Live qualification requires at least one real bounded Search request whose normalized evidence, score, and admission decision are observed without exposing credentials. Live Parallel evidence does not prove VidGen generation or social publication; those remain separately qualified.
