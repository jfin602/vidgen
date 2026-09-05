# Question 1 — Primary Runtime and Language

## Question

What should the primary VidGen runtime and language be?

## Answer

Decision: Node.js + TypeScript.

Confidence: High.

Why: This keeps the initial application stack simple, provides strong HTTP/schema/testing support, fits the likely programmatic rendering ecosystem well, and avoids introducing a second application runtime before there is a concrete need for one. External media tools such as FFmpeg may still be used without making VidGen a split-runtime application.

Deferred details: Specific Node.js version, TypeScript compiler settings, package/runtime conventions, and any future justification for introducing another runtime remain open until implementation planning.

Docs affected: README.md, docs/project-overview.md, docs/architecture.md, and the implementation roadmap when this decision is promoted into the active architecture.
