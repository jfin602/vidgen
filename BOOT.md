# VidGen Boot Document

This is the session router for repository-aware work in jfin602/vidgen.

VidGen is early-stage. Phase 1 has been implemented, reviewed, and closed. The product direction was deliberately simplified after Phase 1: ngest supplies a pre-curated set of production-worthy stories, and VidGen's primary production unit is now one self-contained, postable clip per story.

The initial engineering worksheet is historical decision context. Several of its promoted edition/newscast decisions were superseded by the single-story rebase on 2026-09-05. Current architecture and roadmap docs govern active direction.

## Project identity

- Repository: jfin602/vidgen
- Default branch: main
- Product direction: a standalone template-driven news clip generator.
- Upstream contract: ngest supplies a governed, pre-curated feed in which every supplied story is already intended for content production.
- Primary production unit: one story -> one independent clip package.
- Primary application stack: Node.js + TypeScript.
- MVP execution model: manually invoked CLI development flow, one selected story at a time.
- Initial development input: a local sample fixture shaped exactly like the ngest integration input so the video pipeline can be debugged before live feed orchestration.
- MVP run state: filesystem-backed story artifacts plus structured metadata.
- Creative planning: one validated ClipPlan operation per story, constrained by the selected assembly template.
- Initial provider direction: Google-first, with Veo for generated presenter/video work behind thin provider-neutral boundaries.
- MVP assembly: FFmpeg.
- Remotion: not part of the current MVP; defer programmable composition until evidence requires it.
- Initial output: 1080x1920 9:16 H.264 MP4 at 30 fps.
- Phase 1 completion version: 0.1.5.
- Current package baseline: 0.2.0.
- Current roadmap phase: Phase 2 — Single-story development foundation.
- Current repository state: Phase 1 authenticated ngest acquisition, canonicalization, fingerprinting, CLI run, and durable CanonicalInput are implemented. Single-story clip generation is not yet implemented.
- Current roadmap: docs/roadmap/initial-roadmap.md.
- Current architecture: docs/architecture.md.
- Current template contract: docs/template-system.md.
- Current ngest integration notes: docs/integrations/ngest.md.
- Current control notes: docs/control-interface.md.
- Historical engineering worksheet: docs/planning/initial-engineering-question-worksheet.md.

Ngest owns governed feed truth and production eligibility. VidGen does not re-rank or re-select supplied stories. VidGen owns story-level context preparation, template filling, generated media, deterministic FFmpeg assembly, story artifacts, and final clips.

## /boot

For substantial repository-aware work:

1. Read BOOT.md.
2. Read README.md.
3. Read AGENTS.md.
4. Read docs/README.md.
5. Read the narrowest relevant architecture, template, integration, control, planning, or roadmap notes.
6. Inspect current implementation and tests when repository state matters.

Reply ready after bootstrap when the user asks only for /boot.

## Working authority

Until stronger contracts are deliberately introduced:

1. current explicit owner instruction;
2. deliberately promoted contract/ADR;
3. current architecture/roadmap or accepted task-specific planning;
4. BOOT.md and AGENTS.md workflow guidance;
5. current implementation and tests;
6. historical worksheet records, prompts, and commit messages.

Historical worksheet answers do not override the current single-story architecture.

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

/prompt-ass
-> /prompt-plan
-> /prompt-write <folder>

### /prompt-ass

Read-only assessment. Identify target behavior, constraints, preserved behavior, smallest coherent task boundaries, dependencies, prompt order, deferred work, closeout, and model recommendations.

### /prompt-plan

Requires a completed /prompt-ass. Inspect relevant docs, implementation, helpers/consumers/tests, likely file scope, failure modes, validation needs, evidence environment, and non-goals.

For meaningful producer/consumer dependencies, record:

downstream-required capability -> owning implementation/export -> focused proof

If downstream work would have to invent upstream semantics, return Planning needed.

### /prompt-write <folder>

Requires an unblocked /prompt-plan. Revalidate repository state and write ordered prompt files under docs/tasks/<folder>/.

Before declaring a stack ready:

    npm run codex:phase:validate -- <folder>

## Task stack grammar

Common:
- prompt files are P<number>-<lower-kebab-slug>.txt;
- numbering starts at P1 and is contiguous;
- every stack has exactly one final closeout prompt;
- every prompt has exactly one Recommended configuration line using a supported runner label.

Early roadmap phases normally use:
- folder p<phase>;
- TASK: Phase <phase> / P<number> — <title>;
- target version 0.<phase>.<prompt>.

Corrections use:
- folder c<phase>-<lower-kebab-slug>;
- TASK: Correction <phase> / P<number> — <title>;
- package version unchanged across the correction stack.

The package version primarily supports reproducible phase-runner state. Long-term release policy remains open.

## CLI phase runner

Validate:

    npm run codex:phase:validate -- <task-folder>

Run implementation prompts:

    npm run codex:phase -- <task-folder>

Run implementation plus closeout execution:

    npm run codex:phase -- <task-folder> --closeout

Verbose:

    npm run codex:phase -- <task-folder> --verbose

The runner requires a clean Git tree, no package-lock.json, a compatible Codex CLI, package version aligned with the Git-proven completed prompt prefix, and Codex to leave implementation changes uncommitted so the runner owns commit boundaries.

Run artifacts are written under .codex-runs/ and ignored by Git.

## Engineering posture

- Analyze before implementation.
- Prefer small independently reviewable prompts.
- Codex model policy: Luna Medium is the minimum allowed configuration; prefer Terra for almost all implementation work; use Luna only for tightly bounded mechanical work; escalate to Sol rarely and only when substantial reasoning ambiguity remains after planning.
- Preserve the ngest/VidGen boundary.
- Treat every supplied ngest story as already production-worthy; do not add VidGen story-ranking or selection gates.
- Keep ngest transport shapes at the input boundary.
- Manual development fixtures must exercise the same validation/normalization semantics as live ngest-shaped input.
- One story is one independent production and artifact boundary.
- Use one validated ClipPlan rather than FeedAnalysis, EditorialPlan, Script, and ProductionPlan stages.
- Templates own clip structure; ClipPlan fills declared content slots.
- Keep template-specific media requirements deterministic.
- Keep provider-specific behavior behind thin explicit adapters.
- Preserve provenance and reproducibility inside each story package.
- Treat URLs, publisher content, administrator guidance, model output, and provider responses as untrusted input.
- Publisher retrieval permission does not imply media-reuse permission.
- Prefer story-local asset reuse over a global cache until evidence requires more.
- FFmpeg owns MVP assembly; do not introduce Remotion without a demonstrated need.
- Do not claim provider/runtime/render behavior unless actually observed.

## Current next action

Phase 1 is closed at 0.1.5 and the repository remains on the 0.2.0 Phase 2 baseline.

Before Phase 2 implementation:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write p2

Phase 2 should build a manual ngest-shaped single-story fixture path, story package boundary, and assembly-template contract on top of the useful Phase 1 canonical-input foundation.
