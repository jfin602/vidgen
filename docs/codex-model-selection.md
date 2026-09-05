# Codex Model Selection

Status: WORKFLOW SUPPORT

The phase runner currently accepts these exact configuration labels:

- Luna Low
- Luna Medium
- Luna High
- Terra Medium
- Terra High
- Terra Ultra
- Sol Light
- Sol Medium
- Sol High
- Sol Ultra

These labels map to the concrete GPT-5.6 Codex model/reasoning combinations encoded in scripts/codex-phase-core.mjs.

## Selection approach

Use the minimum-cost configuration that is adequate for the task.

General guidance:
- Luna: narrow, low-risk, well-specified edits and mechanical work.
- Terra: normal implementation, focused refactors, tests, and medium-depth debugging.
- Sol: architecture-sensitive work, difficult debugging, broad review, or tasks with high interaction risk.

Increase reasoning within a family when the task is more ambiguous or has more failure modes.

Do not compensate for an oversized prompt by simply selecting a stronger model. Split work first when independent review boundaries exist.

The runner source is the executable authority for currently supported labels. This document is guidance and may evolve.
