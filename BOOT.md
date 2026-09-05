# VidGen Boot Document

This is the session router for repository-aware work in jfin602/vidgen.

VidGen is at bootstrap stage. The workflow below is intentionally borrowed from ngest because it has proven useful, while provider choices, production schemas, deployment topology, persistence technology, and other implementation details remain provisional unless the owner explicitly promotes them later.

## Project identity

- Repository: jfin602/vidgen
- Default branch: main
- Product direction: a standalone cinematic news-generation engine that consumes governed ngest feed input and produces video-news editions.
- Primary upstream integration: a dedicated bearer-authenticated ngest VidGen endpoint that returns the governed Profile feed plus VidGen-specific controls.
- Current package baseline: 0.1.0.
- Current repository state: workflow/bootstrap only; no production engine has been implemented.
- Current roadmap: docs/roadmap/initial-roadmap.md, DRAFT / PROVISIONAL.
- Current architecture notes: docs/architecture.md.
- Current ngest integration notes: docs/integrations/ngest.md.
- Current control-interface notes: docs/control-interface.md.

Ngest remains responsible for governed feed truth. VidGen owns downstream feed interpretation, editorial planning, scripting, production planning, media generation, composition, rendering, and generated artifacts.

VidGen does not consume the ngest Profile digest as pre-generated editorial output.

## /boot

For substantial repository-aware work:

1. Read BOOT.md.
2. Read README.md.
3. Read AGENTS.md.
4. Read docs/README.md.
5. Read the narrowest relevant project, architecture, integration, control, or roadmap notes.
6. Inspect current implementation and tests when repository state matters.

Reply ready after bootstrap when the user asks only for /boot.

Do not treat every bootstrap note as a frozen product contract. Report when a proposed decision should be promoted into a durable contract or ADR later.

## Working authority

Until stronger contracts are deliberately introduced, use this practical order:

1. current explicit owner instruction;
2. deliberately promoted contract/ADR, if one exists later;
3. current roadmap or task-specific accepted planning;
4. BOOT.md and AGENTS.md workflow guidance;
5. current implementation and tests;
6. historical prompts and commit messages.

If sources conflict materially, report the conflict instead of silently choosing.

## Documentation workflow

/docs-review
- Read-only documentation review.
- Report contradictions, stale assumptions, missing decisions, duplicated authority, and recommendations.
- Do not modify files.

/docs-apply
- Apply only documentation changes the owner has approved.
- Re-read current targets immediately before editing.

/docs-prompt [model configuration]
- Produce a docs-only Codex handoff after an approved docs review.
- Use .codex/docs-prompt.txt as the single replaceable handoff slot.
- Do not treat it as a phase task or feed it to codex:phase.

## Implementation planning workflow

Use the same staged planning sequence as ngest:

/prompt-ass
-> /prompt-plan
-> /prompt-write <folder>

### /prompt-ass

Read-only assessment. Identify:
- target behavior;
- constraints and preserved behavior;
- provisional roadmap phase or correction scope;
- smallest coherent task boundaries;
- prompt count/order;
- dependencies;
- producer/consumer boundaries;
- deferred work;
- closeout task;
- provisional model recommendations.

### /prompt-plan

Requires a completed /prompt-ass. Inspect relevant docs, implementation, helpers/consumers/tests, likely file scope, failure modes, validation needs, evidence environment, and non-goals.

For meaningful producer/consumer dependencies, record:

downstream-required capability -> owning implementation/export -> focused proof

If downstream work would have to invent upstream semantics, return Planning needed.

### /prompt-write <folder>

Requires an unblocked /prompt-plan. Revalidate repository state and write ordered prompt files under docs/tasks/<folder>/.

Before declaring a stack ready, validate its grammar with:

    npm run codex:phase:validate -- <folder>

## Task stack grammar

The ported runner retains the ngest grammar because it is already mature.

Common:
- prompt files are P<number>-<lower-kebab-slug>.txt;
- numbering starts at P1 and is contiguous;
- every stack has exactly one final closeout prompt;
- every prompt has exactly one Recommended configuration line using a supported runner label.

Early VidGen roadmap phases should normally use the pre-1.0 family:
- folder p<phase>;
- TASK: Phase <phase> / P<number> — <title>;
- target version 0.<phase>.<prompt>.

The runner also retains p1-<phase> and p2-<phase> compatibility for future roadmap families. Their use is not a current VidGen commitment.

Corrections:
- folder c<phase>-<lower-kebab-slug>;
- TASK: Correction <phase> / P<number> — <title>;
- package version remains unchanged across the correction stack.

The package version exists primarily to support reproducible phase-runner state. The detailed long-term VidGen release/version policy is not yet locked.

## CLI phase runner

Validate a stack:

    npm run codex:phase:validate -- <task-folder>

Run implementation prompts and stop before closeout:

    npm run codex:phase -- <task-folder>

Run implementation prompts plus closeout execution, leaving closeout changes for human review:

    npm run codex:phase -- <task-folder> --closeout

Verbose mode:

    npm run codex:phase -- <task-folder> --verbose

The runner requires:
- a clean Git working tree;
- no package-lock.json;
- a compatible Codex CLI;
- package.json version aligned with the Git-proven completed prompt prefix;
- Codex to leave implementation changes uncommitted so the runner owns the commit boundary.

Run artifacts are written under .codex-runs/ and are ignored by Git.

## Phase handoff

Default flow:

phase implementation
-> final closeout prompt
-> human review
-> /closeout when a roadmap transition is actually defined
-> /docs-review
-> /docs-apply
-> /prompt-ass for the next phase

Unlike ngest, VidGen does not yet have fixed successor baselines or a terminal release gate. /closeout must therefore follow the currently accepted roadmap rather than infer a version transition.

## Review and decision commands

/review <commit, PR, task, implementation>
- Review behavior, architecture, failure handling, tests, security, data integrity, and preserved behavior.

/prove <behavior>
- Identify and, when possible, execute the evidence needed to prove a claim.

/test-matrix <feature>
- Resolve relevant test surfaces, evidence environments, and RUN / DEFER / N/A status.

/lock <decision>
- Treat a decision as owner-approved and identify which durable docs should record it.
- Do not write files unless instructed.

/recommend
- Choose the best option from current evidence, value, risk, and project direction.

/status
- Return Completed / Current / Blocked / Next.

/next
- Recommend the single most logical next task.

## Engineering posture

- Analyze before implementation.
- Prefer small independently reviewable prompts.
- Keep upstream ngest responsibilities separate from VidGen creative-generation responsibilities.
- Keep ngest transport shapes at the input boundary; creative stages consume VidGen canonical models.
- Generic ngest Distribution/PHP consumers must remain unaware of VidGen-only controls.
- VidGen must not connect directly to ngest persistence.
- Keep provider-specific behavior behind explicit adapters/boundaries where practical.
- Preserve reproducibility and provenance for inputs, generated intermediate artifacts, provider jobs, and final outputs as the design matures.
- Treat URLs, publisher content, administrator guidance, model output, and provider responses as untrusted input.
- Do not claim provider/runtime/render/browser behavior unless actually observed.
- Avoid freezing speculative abstractions merely because the project is new.

## Current next action

The repository bootstrap does not create Phase 1 implementation prompts.

Before implementation, use:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write p1

Phase 1 now begins at the direct ngest integration boundary described by docs/integrations/ngest.md and docs/control-interface.md.
