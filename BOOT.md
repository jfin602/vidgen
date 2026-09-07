# VidGen Boot Document

This is the session router for repository-aware work in jfin602/vidgen.

VidGen is early-stage. Phases 1 and 2 have been implemented, reviewed, and closed. Phase 3 was manually owner-closed after P4 at version 0.3.4. Phase 4 was manually owner-closed at version 0.4.4 after its P5 review/repair pass. Phase 5 was implemented through P3 and manually owner-closed at version 0.5.3 after its P4 closeout review/repair. The Phase 5 closeout host did not have ffmpeg/ffprobe or owner-supplied real media-ready inputs, so no real story render or human playback qualification was established there. Since then, the deployment VPS has directly qualified FFmpeg 6.1.1, FFprobe 6.1.1, libx264, AAC, and the required assembly filters, but a complete owner-media generated story render is still unclaimed. The behavior-preserving MVP refactor and the `c5-optional-assets` correction are complete; standardized intro/outro wrappers are now independently optional. Phase 6 simple presenter-headline implementation has reached the 0.6.5 baseline while preserving the existing template/ClipPlan/generated-media/assembly cinematic path. The owner has approved `c6-vertex-adapter` as a bounded Phase 6 correction at unchanged 0.6.5: Vertex AI Veo will be added as a parallel Google video backend without replacing the working Gemini Developer API Veo path. Live ngest fan-out and operational hardening remain Phase 7. `c5-config-fix` remains owner-approved but deferred.

The initial engineering worksheet is historical decision context. Several of its promoted edition/newscast decisions were superseded by the single-story rebase on 2026-09-05. Current architecture and roadmap docs govern active direction.

## Project identity

- Repository: jfin602/vidgen
- Default branch: main
- Product direction: a standalone news video generation engine with a simple presenter-headline path as the current priority and the implemented template-driven cinematic path preserved.
- Upstream contract: ngest supplies a governed, pre-curated feed in which every supplied story is already intended for content production.
- Primary production unit: one story -> one independent clip package.
- Primary application stack: Node.js + TypeScript.
- MVP execution model: manually invoked CLI development flow, one selected story at a time.
- Initial development input: a local VidGen-shaped sample fixture that exercises the same post-adapter validation/normalization semantics as live input, without requiring the upstream Distribution v1 wire itself.
- MVP run state: filesystem-backed story artifacts plus structured metadata.
- Creative production paths: the current-priority simple path branches from StoryInput without requiring ClipPlan/AssemblyTemplate; the preserved cinematic path continues to use one validated ClipPlan constrained by the selected assembly template.
- Initial provider direction: Google-first, with Veo behind thin provider-neutral boundaries; the existing Developer API backend is preserved and the owner-approved `c6-vertex-adapter` correction adds Vertex AI as a parallel backend.
- MVP assembly: FFmpeg.
- Remotion: not part of the current MVP; defer programmable composition until evidence requires it.
- Initial output: 1080x1920 9:16 H.264 MP4 at 30 fps.
- Phase 1 completion version: 0.1.5.
- Phase 2 completion version: 0.2.5.
- Phase 3 owner-closeout version: 0.3.4.
- Phase 4 owner-closeout version: 0.4.4.
- Current package baseline: 0.6.5.
- Next roadmap phase: Phase 7 — live ngest fan-out and operational hardening; current owner-directed work remains the Phase 6 `c6-vertex-adapter` correction.
- Current repository state: Phases 1-5 provide authenticated ngest acquisition/canonicalization, local fixture ingress/StoryInput/story workspace, ClipPlan planning, deterministic generated-media units and Google Veo/Gemini adapters, FFprobe qualification, AssemblyPlan creation, FFmpeg rendering, cinematic final-artifact publication, and independently optional intro/outro wrappers. Phase 6 has added the separate StoryInput-based simple presenter-headline path with bounded presenter copy/video generation, deterministic lower-third finishing, and paired MP4/JSON publication at package/engine baseline 0.6.5. The deployment VPS has qualified required FFmpeg/FFprobe capabilities, while full live provider/story playback qualification remains evidence-specific and must not be inferred. `c6-vertex-adapter` is owner-approved for planning next. `c5-config-fix` remains owner-approved and deferred. Publisher retrieval remains deferred.
- Current roadmap: docs/roadmap/initial-roadmap.md.
- Current architecture: docs/architecture.md.
- Current template contract: docs/template-system.md.
- Current ngest integration notes: docs/integrations/ngest.md.
- Current Google video backend notes: docs/integrations/google-video.md.
- Current control notes: docs/control-interface.md.
- Historical engineering worksheet: docs/planning/initial-engineering-question-worksheet.md.

Ngest owns governed feed truth and production eligibility. VidGen does not re-rank or re-select supplied stories. VidGen owns both the simple presenter-headline production path and the preserved cinematic template path, including generated media, deterministic FFmpeg finishing/assembly, story artifacts, and final clips. Publisher retrieval is a deferred fallback capability and is not part of the completed Phase 5 assembly implementation or the current refactor correction.

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

Plan richly; prompt sparsely; validate rigorously. `/prompt-ass` and `/prompt-plan` own detailed reasoning and implementation analysis. `/prompt-write` distills that work into the smallest precise execution brief that preserves the objective, required behavior and boundaries, validation/evidence requirements, non-goals, and meaningful producer/consumer proof without prescribing unnecessary implementation details.

Concise does not mean vague. Codex must still inspect the current implementation and trace the affected flow before editing. Avoid copying planning transcripts, speculative abstractions, predicted helper/class names, step-by-step implementation recipes, or broad file inventories unless they are necessary constraints for the task.

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
- Plan richly; prompt sparsely; validate rigorously. Detailed reasoning belongs in `/prompt-ass` and `/prompt-plan`; `/prompt-write` should carry only the precise execution constraints Codex needs.
- A concise prompt never relaxes comprehension: inspect the current code and trace the affected flow before choosing the smallest correct implementation.
- Prefer small independently reviewable prompts.
- Codex model policy: Luna Medium is the minimum allowed configuration; prefer Terra for almost all implementation work; use Luna only for tightly bounded mechanical work; escalate to Sol rarely and only when substantial reasoning ambiguity remains after planning.
- Preserve the ngest/VidGen boundary.
- Treat every supplied ngest story as already production-worthy; do not add VidGen story-ranking or selection gates.
- Keep ngest transport shapes at the input boundary.
- Manual development fixtures must exercise the same post-adapter VidGen validation/normalization semantics as live ngest input; they need not duplicate the upstream Distribution v1 wire.
- One story is one independent production and artifact boundary.
- The simple presenter-headline path branches from StoryInput and must not be forced through AssemblyTemplate, ClipPlan, cinematic GeneratedMediaUnit, or cinematic AssemblyPlan contracts.
- The preserved cinematic path continues to use one validated ClipPlan rather than FeedAnalysis, EditorialPlan, Script, and ProductionPlan stages.
- Templates own structure and slot semantics for the cinematic path; ClipPlan fills its declared content slots.
- Keep template-specific media requirements deterministic.
- Standardized intro/outro roles declare supported deterministic wrapper positions; the approved post-Phase-5 contract allows either role to be omitted at assembly time, with no placeholder media inserted.
- ClipPlan generation consumes StoryInput plus the selected AssemblyTemplate directly; insufficient story context fails clearly rather than triggering an implicit research subsystem.
- Keep provider-specific behavior behind thin explicit adapters.
- Preserve provenance and reproducibility in each production path's durable artifact boundary.
- Treat URLs, publisher content, administrator guidance, model output, and provider responses as untrusted input.
- Publisher retrieval permission does not imply media-reuse permission.
- Prefer story-local asset reuse over a global cache until evidence requires more.
- FFmpeg owns deterministic simple-path finishing and cinematic-path assembly; do not introduce Remotion without a demonstrated need.
- Do not claim provider/runtime/render behavior unless actually observed.

## Current next action

Current owner-directed work is the bounded Phase 6 Vertex backend correction:

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write c6-vertex-adapter

The correction must keep package/engine version 0.6.5 unchanged, preserve the existing Gemini Developer API Veo backend, and add Vertex AI Veo only behind the existing provider-neutral video boundaries.

Backend selection belongs to runtime configuration. Vertex authentication, project/location/model configuration, polling, and any Cloud Storage staging/retrieval remain adapter concerns. Do not silently fall back between Developer API and Vertex.

Phase 7 remains live ngest fan-out and operational hardening. Do not move fan-out, publisher retrieval, database/queue work, or automated publishing into the Vertex correction.

`c5-config-fix` remains owner-approved but deferred. Its transitional Distribution-v1 live-development adapter and Article-URL sample helper may be resumed later without changing downstream StoryInput or video-provider boundaries.

The deployment VPS has qualified FFmpeg/FFprobe and required codec/filter availability. Live Developer API, Vertex AI, render, and human-playback claims remain separate and must be made only when actually observed.
