# Codex Model Selection

Status: WORKFLOW SUPPORT / CURRENT PROJECT POLICY

The phase runner accepts these exact configuration labels:

- Luna Medium
- Luna High
- Terra Medium
- Terra High
- Terra Ultra
- Sol Light
- Sol Medium
- Sol High
- Sol Ultra

`Luna Low` is intentionally not supported in VidGen. Luna Medium is the minimum allowed configuration.

These labels map to the concrete GPT-5.6 Codex model/reasoning combinations encoded in scripts/codex-phase-core.mjs.

## Project selection policy

VidGen planning, architecture analysis, task decomposition, and prompt design are normally performed upstream with strong reasoning before Codex implementation begins. Codex prompts should therefore use cheaper implementation models as workhorses rather than repeatedly paying for high-end architectural reasoning that has already been done.

Default posture:

- Prefer Terra for almost all normal implementation work.
- Use Luna only when the task is narrow, highly specified, low-risk, and mechanically verifiable.
- Never use anything below Luna Medium.
- Escalate to Sol rarely and only when the implementation task itself still contains substantial unresolved reasoning, broad interaction risk, or difficult debugging that cannot be removed through better planning or task decomposition.
- Do not select Sol merely because a task is important, security-sensitive, contract-defining, or a closeout. Increase validation rigor first.
- Do not compensate for an oversized or ambiguous prompt by choosing a stronger model. Split or improve the prompt first.
- Prefer concise execution briefs after rich upstream planning, but do not treat prompt brevity as evidence that the implementation itself is easy.

## Prompt style and model tier

The `/prompt-ass` and `/prompt-plan` stages should remove avoidable ambiguity before Codex runs. `/prompt-write` then distills that work into a concise execution brief rather than repeating the full reasoning process.

Model selection is based on the residual implementation difficulty after planning: branching complexity, contract sensitivity, interaction surface, debugging uncertainty, and the amount of reasoning Codex still has to perform while tracing the real code. A shorter prompt, or use of a minimalist implementation aid such as Ponytail, does not automatically justify a lower configuration.

VidGen does not depend on Ponytail or any equivalent plugin. Such tools may reinforce the project's reuse-first, smallest-correct-implementation posture when available, but the model policy and validation requirements must remain correct without them.

## Minimum capable matrix

- Luna Medium: repetitive boilerplate, fixtures, small mechanical edits, narrowly scoped documentation or test additions.
- Luna High: narrow implementation with modest branching or a slightly larger local surface.
- Terra Medium: ordinary implementation, focused refactors, routine feature work, and straightforward debugging.
- Terra High: the normal VidGen workhorse for contract-sensitive implementation, integration boundaries, persistence/artifact semantics, validation logic, and phase closeout.
- Terra Ultra: unusually difficult implementation or debugging where Terra High is plausibly insufficient but Sol-level architectural reasoning is still unnecessary.
- Sol Light / Medium / High / Ultra: exceptional escalation only. Use when the implementation itself remains architecture-sensitive, cross-system, highly ambiguous, or difficult to diagnose after planning has already reduced scope as far as practical.

## Selection principle

Use the minimum-cost configuration that is clearly capable of completing the task safely.

Risk affects tests, evidence, review depth, and acceptance criteria before it affects model tier.

The runner source is the executable authority for currently supported labels. This document is the project policy for choosing among them.
