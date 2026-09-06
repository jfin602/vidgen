# Task Stacks

Generated implementation prompts live under this directory.

Use:
    /prompt-ass
    -> /prompt-plan
    -> /prompt-write <folder>

Then validate:
    npm run codex:phase:validate -- <folder>

Do not hand-author a large task stack without the planning stages unless the owner explicitly requests an exception.

## Prompt-writing posture

Plan richly; prompt sparsely; validate rigorously.

Detailed reasoning belongs in /prompt-ass and /prompt-plan. /prompt-write should distill the accepted plan into a concise execution brief.

A normal implementation prompt should carry only what Codex needs to execute safely:
- task identity and supported Recommended configuration;
- required phase/correction version metadata;
- a concise objective;
- behavior, contracts, and boundaries that must remain true;
- meaningful scope limits when they are real constraints;
- required focused tests, broader validation, and runtime/provider/render evidence;
- explicit non-goals;
- producer/consumer proof when it materially constrains downstream correctness.

Normally omit:
- planning transcripts and long architectural rationale already present in repository docs;
- step-by-step implementation recipes;
- speculative abstractions or predicted internal designs;
- suggested helper/class names unless naming itself is contractual;
- pseudocode unless the algorithm itself is contractual;
- broad file inventories included only because planning inspected them.

Concise does not mean vague. Codex must inspect the current implementation and trace the affected flow before editing, then choose the smallest correct implementation that preserves explicit contracts and safety.

The runner grammar remains authoritative for required TASK, model configuration, version metadata, numbering, filenames, and final closeout structure.
