# Question 16 — Narration / TTS Timing

## Question

What narration/TTS system owns spoken timing?

## Answer

Decision: Use an audio-first timing model. VidGen should generate narration before final visual production, and the resulting narration audio should become the authoritative timing source for the edition.

The intended flow is:
- Script defines narration text plus pacing, emphasis, pronunciation, and target-duration metadata;
- TTS generates the final narration audio;
- measured narration timing becomes authoritative;
- ProductionPlan and downstream scene timing are built around the actual audio duration;
- anchor/presenter generation must support synchronization to that prerecorded narration contract;
- Veo should primarily handle cinematic/B-roll shots and other visuals that do not require exact mouth synchronization to the finalized narration;
- Remotion + FFmpeg assemble the final timed program around the narration track.

TTS should remain behind a provider-neutral adapter, and the MVP should use a stable program voice unless a later decision requires otherwise.

Confidence: High.

Why: Generating narration first removes timing guesswork from downstream production. It gives the compositor exact durations, makes scene planning more deterministic, and provides a clear synchronization contract for anchor scenes. It also prevents a video-generation provider from becoming the authority for spoken wording or timing when exact script fidelity matters.

Deferred details: Exact TTS provider, voice identity, pronunciation-override format, pacing/emphasis schema, audio format, silence/pause handling, anchor/lip-sync provider, regeneration behavior, and whether any scenes may intentionally use provider-native generated dialogue remain open for implementation planning.

Docs affected: docs/architecture.md, docs/project-overview.md, docs/roadmap/initial-roadmap.md, and future Script/TTS/ProductionPlan/presenter contract documentation when this decision is promoted.
