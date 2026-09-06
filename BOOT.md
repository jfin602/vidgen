# VidGen Boot Document

This is the session router for repository-aware work in jfin602/vidgen.

VidGen is early-stage. Phases 1 and 2 have been implemented, reviewed, and closed. Phase 3 was manually owner-closed after P4 at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4 after its P5 review/repair pass. Phase 5 was implemented through P3 and manually owner-closed at version 0.5.3 after its P4 closeout review/repair. The Phase 5 closeout host did not have ffmpeg/ffprobe or owner-supplied real media-ready inputs, standardized intro/outro assets, and font, so no real FFmpeg smoke, real story render, or human playback qualification is claimed. Phase 6 is the next roadmap capability; the current owner-directed work is a bounded Phase 5 correction refactor followed by an approved Phase 5 behavior correction that makes standardized intro/outro wrapper media independently optional before Phase 6. The product direction was deliberately simplified after Phase 1: ngest supplies a pre-curated set of production-worthy stories, and VidGen's primary production unit is now one self-contained, postable clip per story.

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
- Phase 2 completion version: 0.2.5.
- Phase 3 owner-closeout version: 0.3.4.
- Phase 4 owner-closeout version: 0.4.4.
- Current package baseline: 0.5.3.
- Next roadmap phase: Phase 6 — live ngest fan-out and operational hardening.
- Current repository state: Phase 1 authenticated ngest acquisition/canonicalization, Phase 2 local fixture ingress/StoryInput/story workspace, Phase 3 ClipPlan planning, Phase 4 deterministic generated-media units and Google Veo/Gemini media adapters, and Phase 5 deterministic FFprobe qualification, AssemblyPlan creation, FFmpeg rendering, `vidgen assemble`, `assembly-run.json`, `final-clip.json`, and atomic final-clip publication are implemented. The current Phase 5 implementation still requires both intro and outro inputs. The owner-approved follow-up correction will make those standardized wrapper assets independently optional without inserting placeholders when omitted. Real host FFmpeg/story-render qualification remains deferred until the required runtime and owner-supplied media are available. Publisher retrieval remains deferred.
- Current roadmap: docs/roadmap/initial-roadmap.md.
- Current architecture: docs/architecture.md.
- Current template contract: docs/template-system.md.
- Current ngest integration notes: docs/integrations/ngest.md.
- Current control notes: docs/control-interface.md.
- Historical engineering worksheet: docs/planning/initial-engineering-question-worksheet.md.

Ngest owns governed feed truth and production eligibility. VidGen does not re-rank or re-select supplied stories. VidGen owns template filling, generated media, deterministic FFmpeg assembly, story artifacts, and final clips. Publisher retrieval is a deferred fallback capability and is not part of the completed Phase 5 assembly implementation or the current refactor correction.

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
- Templates own clip structure and slot semantics; ClipPlan fills declared content slots.
- Keep template-specific media requirements deterministic.
- Standardized intro/outro roles declare supported deterministic wrapper positions; the approved post-Phase-5 contract allows either role to be omitted at assembly time, with no placeholder media inserted.
- ClipPlan generation consumes StoryInput plus the selected AssemblyTemplate directly; insufficient story context fails clearly rather than triggering an implicit research subsystem.
- Keep provider-specific behavior behind thin explicit adapters.
- Preserve provenance and reproducibility inside each story package.
- Treat URLs, publisher content, administrator guidance, model output, and provider responses as untrusted input.
- Publisher retrieval permission does not imply media-reuse permission.
- Prefer story-local asset reuse over a global cache until evidence requires more.
- FFmpeg owns MVP assembly; do not introduce Remotion without a demonstrated need.
- Do not claim provider/runtime/render behavior unless actually observed.

## Current next action

Phases 1 and 2 are closed at 0.1.5 and 0.2.5. Phase 3 was manually owner-closed at 0.3.4. Phase 4 was manually owner-closed at 0.4.4. Phase 5 was manually owner-closed at 0.5.3 with its real FFmpeg/story-render qualification still explicitly unclaimed because the closeout environment and owner media were unavailable.

Current owner-directed work:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write c5-mvp-refactor

That correction must simplify the existing MVP without changing observable product behavior, durable artifact contracts, trust boundaries, retry/failure semantics, or provider/render behavior. The package version stays 0.5.3 across the correction stack.

After the behavior-preserving refactor closes, plan and execute the approved bounded correction:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write c5-optional-standardized-assets

That correction changes assembly behavior and durable artifact semantics deliberately: intro and outro become independently optional, omission inserts no placeholder frames/audio, only supplied assets participate in qualification/duration/fingerprinting/provenance, and social-first output may begin directly with the story hook.

Phase 6 follows these corrections. Before treating the assembly path as operationally qualified, Phase 6 or an equivalent runtime qualification step must complete the previously blocked real ffmpeg/ffprobe capability smoke and one real owner-media story render; an intro is no longer a prerequisite for that qualification once the optional-wrapper correction lands.
