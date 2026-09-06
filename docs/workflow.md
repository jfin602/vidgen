# Repository Workflow

Status: BOOTSTRAP WORKFLOW / PROVISIONAL PRODUCT PROCESS

VidGen mirrors the ngest planning and Codex execution workflow because that process is already familiar and reviewable.

## Session bootstrap

    /boot

Read BOOT.md and routed docs before substantial repository-aware work.

## Documentation

    /docs-review
    -> explicit approval
    -> /docs-apply

Optional Codex handoff:

    /docs-prompt [model configuration]

The docs prompt lives at .codex/docs-prompt.txt and is separate from phase task stacks.

## Implementation planning

    /prompt-ass
    -> /prompt-plan
    -> /prompt-write <folder>

Do not skip from an idea directly to implementation prompts when the task is substantial.

## Planning and execution-brief philosophy

Plan richly; prompt sparsely; validate rigorously.

`/prompt-ass` owns task decomposition: target behavior, constraints, preserved behavior, dependencies, prompt order, deferred work, closeout, and model recommendations.

`/prompt-plan` owns detailed implementation analysis: inspect current source and tests, trace affected producers/consumers and shared helpers, identify likely file scope, failure modes, regression risks, focused tests, broader validation, runtime/provider/render evidence, and non-goals.

`/prompt-write` must not copy that analysis wholesale. Revalidate the repository, then distill the accepted plan into the smallest precise execution brief Codex needs. A good brief states the objective, behavior/contracts that must remain true, meaningful scope boundaries, required validation/evidence, non-goals, and producer/consumer proof when it materially constrains the task.

Concise does not mean vague. The implementation agent is still expected to inspect the current code and understand the affected flow before editing. Prompt brevity must not remove trust-boundary validation, security requirements, error handling, durability semantics, or other explicit contracts.

Normally omit step-by-step implementation recipes, predicted internal designs, speculative abstractions, suggested helper/class names, pseudocode unless the algorithm itself is contractual, repeated architecture explanations already available in repository docs, and broad file inventories included only because planning inspected them.

VidGen's workflow is tool-independent. Minimalist implementation aids such as Ponytail may reinforce this posture when installed, but they are not repository requirements and must not become architectural dependencies.

## Early phase folders

For the current pre-1.0 family:

    p1
    p2
    p3
    ...

Prompt versions are:

    0.<phase>.<prompt>

Example Phase 1:
- baseline 0.1.0;
- P1 target 0.1.1;
- P2 target 0.1.2.

This convention is inherited for runner compatibility and can be revisited before the project establishes a public release policy.

## Corrections

Use corrections for bounded repairs rather than roadmap capability:

    c<phase>-<slug>

Corrections keep the package version unchanged.

## Prompt files

Each task folder contains contiguous files:

    P1-some-task.txt
    P2-next-task.txt
    P3-phase-closeout.txt

Exactly one final prompt is the closeout.

Each prompt includes one supported Recommended configuration line.

Implementation prompts should be concise execution briefs rather than planning transcripts. They may use headings such as GOAL, MUST REMAIN TRUE, VALIDATION/PROOF, NON-GOALS, and FINAL RESPONSE when useful, but those prose headings are not runner grammar. Include explicit file scope only when it is a real implementation boundary or safety constraint; otherwise let Codex trace the smallest correct surface from the repository.

## Runner

Validate grammar:

    npm run codex:phase:validate -- p1

Execute implementation prompts:

    npm run codex:phase -- p1

Execute closeout too, but require human review before any manual commit:

    npm run codex:phase -- p1 --closeout

The runner:
- requires a clean Git tree;
- resolves the Codex CLI;
- checks supported model configuration compatibility;
- resumes only from a Git-proven contiguous completed prefix;
- invokes Codex with structured JSON output;
- owns staging and implementation commits;
- records run logs under .codex-runs/;
- stops safely on inconsistent state.

## Closeout

A final prompt closeout and the /closeout project transition are different things.

The final prompt verifies the task stack. /closeout changes project roadmap/version state only when the current accepted roadmap defines such a transition.

VidGen has no locked terminal release gate yet.

## Review commands

    /review <target>
    /prove <behavior>
    /test-matrix <feature>
    /lock <decision>
    /recommend
    /status
    /next
