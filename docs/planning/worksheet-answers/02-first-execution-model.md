# Question 2 — First Execution Model

## Question

What should the first execution model be?

## Answer

Decision: CLI for the MVP.

Confidence: High.

Why: A CLI is the simplest execution model for early development and hackathon demonstration work. It minimizes operational complexity while the core pipeline is still being proven and makes it easy to run, inspect, and iterate on individual editions locally or remotely.

Deferred details: Whether the CLI is built directly around reusable application services, the eventual worker/service or HTTP hosting model, ngest-triggered execution, and long-running provider-job orchestration remain open for later planning.

Docs affected: README.md, docs/project-overview.md, docs/architecture.md, docs/workflow.md, and docs/roadmap/initial-roadmap.md when this decision is promoted into the active architecture.
