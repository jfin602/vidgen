# VidGen Documentation

This is the current early-stage documentation set.

The project was deliberately rebased after Phase 1 from an edition-oriented newscast pipeline to a single-story clip engine. The owner has now prioritized an even simpler StoryInput -> presenter -> lower-third -> MP4+JSON path as Phase 6 while preserving the implemented template-driven cinematic pipeline as an advanced path. The original engineering worksheet remains historical decision context; current architecture and roadmap documents govern where they conflict with earlier worksheet answers.

## Read order

- project-overview.md — current product intent and ngest/VidGen ownership boundary.
- architecture.md — shared StoryInput boundary plus the current-priority simple presenter path and preserved cinematic path.
- template-system.md — preserved cinematic assembly-template contract and locked default cinematic clip structure.
- integrations/ngest.md — authenticated ngest boundary and manual ngest-shaped fixture path.
- control-interface.md — current provisional control compatibility and simplified future direction.
- roadmap/initial-roadmap.md — current implementation sequence.
- planning/initial-engineering-question-worksheet.md — historical index of the original 20 engineering decisions and supersession notes.
- planning/worksheet-answers/README.md — historical decision-record index.
- workflow.md — repository planning, prompt, and runner workflow.
- codex-model-selection.md — supported runner configuration labels and selection guidance.
- tasks/README.md — task stack storage and naming.

BOOT.md remains the session router.
