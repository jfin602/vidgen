# Question 12 — Compositor and Rendering Technology

## Question

What compositor/rendering technology should own final assembly?

## Answer

Decision: Use Remotion + FFmpeg for the MVP.

Remotion should own the programmatic composition layer, including reusable newscast templates, typography, animation, captions, responsive layout behavior, and deterministic scene assembly. FFmpeg should handle lower-level media processing, encoding, muxing, audio/video normalization, and other media operations where it is the better fit.

Confidence: High.

Why: This aligns cleanly with the Node.js + TypeScript runtime decision and the template-first hybrid production model. Remotion provides a maintainable way to author and test deterministic broadcast compositions, while FFmpeg remains the mature media-processing foundation for encoding and transformation work. The combination avoids forcing complex layout and animation logic directly into FFmpeg filters while retaining deterministic output and open-source portability.

Deferred details: Exact Remotion project structure, render worker topology, Chromium/runtime packaging, FFmpeg invocation boundaries, codec settings, GPU usage, caching, and deployment/runtime requirements remain open for implementation planning.

Docs affected: README.md, docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future rendering/compositor contract documentation when this decision is promoted.
