import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { qualifyAssemblyInputs, type AssemblyPlan } from './assembly-input.ts';
import { VidGenError, isVidGenError, type VidGenErrorCode } from '../core/error.ts';
import { FFMPEG_ASSEMBLY_POLICY, LocalFfmpegRenderer, type FfmpegRenderResult } from '../integrations/ffmpeg/ffmpeg-renderer.ts';
import { identifyLocalFile, type LocalFileIdentity } from '../integrations/ffmpeg/local-file.ts';
import { probeLocalMedia, type LocalMediaProbe } from '../integrations/ffmpeg/ffprobe.ts';
import { writeJsonAtomically } from '../shared/atomic-json.ts';
import { canonicalJson } from '../shared/canonical-json.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const ASSEMBLY_RUN_ARTIFACT_NAME = 'assembly-run.json';
export const FINAL_CLIP_ARTIFACT_NAME = 'final-clip.json';
export const FINAL_CLIP_RELATIVE_PATH = 'final/clip.mp4';
export const ASSEMBLY_SCHEMA_VERSION = '1';
export const ASSEMBLY_INPUT_CONTRACT_VERSION = '1';
export const DEFAULT_MAX_FONT_BYTES = 100_000_000;
export const DEFAULT_MAX_FINAL_CLIP_BYTES = 1_000_000_000;
/** Two output frames plus a small MP4 timestamp-rounding allowance. */
export const FINAL_DURATION_TOLERANCE_SECONDS = 0.05;

export interface SafeFileIdentity {
  readonly basename: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface ProbeSummary {
  readonly durationSeconds: number;
  readonly containerNames: readonly string[];
  readonly video?: { readonly codec: string; readonly width: number; readonly height: number; readonly pixelFormat: string; readonly fps: { readonly numerator: number; readonly denominator: number } };
  readonly audio?: { readonly codec: string; readonly sampleRate: number; readonly channels: number };
}

export interface StandardizedAssetProvenance extends SafeFileIdentity {
  readonly roleId: 'intro' | 'outro';
  readonly placement: 'before-story' | 'after-story';
  readonly probe: ProbeSummary;
}

export interface AssemblyRunMetadata {
  readonly schemaVersion: typeof ASSEMBLY_SCHEMA_VERSION;
  readonly assemblyRunId: string;
  readonly status: 'running' | 'final_ready' | 'failed';
  readonly storyRunId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly engineVersion: string;
  readonly storyFingerprint: string;
  readonly clipPlanFingerprint: string;
  readonly generatedMediaFingerprint: string;
  readonly assemblyFingerprint: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly standardizedAssets: readonly StandardizedAssetProvenance[];
  readonly font?: SafeFileIdentity;
  readonly assemblyPolicy: { readonly version: string };
  readonly ffmpegVersion: string;
  readonly expectedDurationSeconds: number;
  readonly output?: FinalClipManifest['output'];
  readonly failure?: { readonly code: VidGenErrorCode; readonly message: string };
}

export interface FinalClipManifest {
  readonly schemaVersion: typeof ASSEMBLY_SCHEMA_VERSION;
  readonly storyRunId: string;
  readonly storyFingerprint: string;
  readonly clipPlanFingerprint: string;
  readonly generatedMediaFingerprint: string;
  readonly assemblyFingerprint: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly standardizedAssets: readonly StandardizedAssetProvenance[];
  readonly font?: SafeFileIdentity;
  readonly assemblyPolicy: { readonly version: string };
  readonly ffmpegVersion: string;
  readonly output: {
    readonly path: typeof FINAL_CLIP_RELATIVE_PATH;
    readonly sha256: string;
    readonly byteSize: number;
    readonly durationSeconds: number;
    readonly width: number;
    readonly height: number;
    readonly fps: { readonly numerator: number; readonly denominator: number };
    readonly videoCodec: 'h264';
    readonly pixelFormat: 'yuv420p';
    readonly audioCodec: 'aac';
    readonly audioSampleRate: 48000;
    readonly audioChannels: 2;
  };
}

export interface AssemblyRenderer {
  preflight(needsDisplayText?: boolean): Promise<{ readonly version: string }>;
  render(request: { readonly assemblyPlan: AssemblyPlan; readonly workDirectory: string; readonly outputPath: string; readonly fontPath?: string }): Promise<FfmpegRenderResult>;
}

export interface AssemblyWorkflowDependencies {
  readonly storyDirectory: string;
  readonly introPath: string;
  readonly outroPath: string;
  readonly fontPath?: string;
  readonly qualifyInputs?: (request: { readonly storyDirectory: string; readonly introPath: string; readonly outroPath: string }) => Promise<AssemblyPlan>;
  readonly createRenderer?: () => AssemblyRenderer;
  readonly probe?: (path: string) => Promise<LocalMediaProbe>;
  readonly now?: () => Date;
  readonly createAssemblyRunId?: () => string;
  readonly engineVersion?: string;
  readonly maxFontBytes?: number;
  readonly maxFinalClipBytes?: number;
  readonly writeJson?: typeof writeJsonAtomically;
}

export interface AssemblyWorkflowResult {
  readonly status: 'final_ready';
  readonly storyRunId: string;
  readonly assemblyRunId: string;
  readonly finalPath: string;
  readonly finalSha256: string;
  readonly durationSeconds: number;
}

/**
 * Performs exactly one fresh local composition of an already media-ready story.
 * It never creates/plans/regenerates upstream artifacts and only publishes a
 * final clip after the rendered candidate has been independently qualified.
 */
export async function assembleStoryWorkspace(dependencies: AssemblyWorkflowDependencies): Promise<AssemblyWorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const writeJson = dependencies.writeJson ?? writeJsonAtomically;
  const maxFontBytes = positiveInteger(dependencies.maxFontBytes ?? DEFAULT_MAX_FONT_BYTES, 'Font byte limit must be positive.');
  const maxFinalClipBytes = positiveInteger(dependencies.maxFinalClipBytes ?? DEFAULT_MAX_FINAL_CLIP_BYTES, 'Final clip byte limit must be positive.');
  if (typeof dependencies.storyDirectory !== 'string' || dependencies.storyDirectory.trim().length === 0) throw new VidGenError('invalid_argument', '--story-dir requires a non-empty directory.');
  const storyDirectory = resolve(dependencies.storyDirectory);

  // All producer-owned state and explicit local media are qualified before
  // renderer construction. This is intentionally the first executable edge.
  const plan = await (dependencies.qualifyInputs ?? qualifyAssemblyInputs)({ storyDirectory, introPath: dependencies.introPath, outroPath: dependencies.outroPath });
  const needsDisplayText = plan.storySegments.some((segment) => segment.displayText.length > 0);
  const font = await qualifyFont(dependencies.fontPath, needsDisplayText, maxFontBytes);
  const renderer = (dependencies.createRenderer ?? (() => new LocalFfmpegRenderer()))();
  const capabilities = await renderer.preflight(needsDisplayText);
  const ffmpegVersion = safeFfmpegVersion(capabilities.version);
  const standardizedAssets = standardizedProvenance(plan);
  const assemblyFingerprint = fingerprintAssembly({ plan, standardizedAssets, font, ffmpegVersion });
  const assemblyRunId = safeRunId((dependencies.createAssemblyRunId ?? randomUUID)());
  const startedAt = timestamp(now());
  const finalDirectory = join(storyDirectory, 'final');
  const finalPath = join(finalDirectory, 'clip.mp4');
  const finalManifestPath = join(storyDirectory, FINAL_CLIP_ARTIFACT_NAME);
  const runPath = join(storyDirectory, ASSEMBLY_RUN_ARTIFACT_NAME);
  const workDirectory = join(finalDirectory, `.assembly-${assemblyRunId}`);
  const candidatePath = join(workDirectory, 'candidate.mp4');
  let published = false;
  const base = baseRun({ plan, assemblyRunId, startedAt, standardizedAssets, font, assemblyFingerprint, ffmpegVersion, engineVersion: dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION });

  try {
    await mkdir(finalDirectory, { recursive: true });
    await removeIfExists(finalManifestPath, 'Unable to invalidate prior final provenance.');
    await removeIfExists(finalPath, 'Unable to invalidate prior final clip.');
    await writeRun(writeJson, runPath, base);
    await mkdir(workDirectory, { recursive: false });
    await renderer.render({ assemblyPlan: plan, workDirectory, outputPath: candidatePath, ...(font === undefined ? {} : { fontPath: font.path }) });
    const candidateProbe = await (dependencies.probe ?? probeLocalMedia)(candidatePath);
    validateFinalCandidate(candidateProbe, plan);
    const outputIdentity = await identifyLocalFile(candidatePath, { maxBytes: maxFinalClipBytes });
    const output = outputProvenance(outputIdentity, candidateProbe);
    await rename(candidatePath, finalPath);
    published = true;
    const manifest: FinalClipManifest = {
      schemaVersion: ASSEMBLY_SCHEMA_VERSION,
      storyRunId: plan.storyRunId,
      storyFingerprint: plan.storyFingerprint,
      clipPlanFingerprint: plan.clipPlanFingerprint,
      generatedMediaFingerprint: plan.generatedMediaFingerprint,
      assemblyFingerprint,
      template: templateIdentity(plan),
      standardizedAssets,
      ...(font === undefined ? {} : { font: safeIdentity(font) }),
      assemblyPolicy: { version: FFMPEG_ASSEMBLY_POLICY.version },
      ffmpegVersion,
      output,
    };
    validateFinalClipManifest(manifest);
    await writeJsonForArtifact(writeJson, finalManifestPath, manifest);
    await writeRun(writeJson, runPath, { ...base, status: 'final_ready', endedAt: timestamp(now()), output });
    await cleanupWorkDirectory(workDirectory);
    return { status: 'final_ready', storyRunId: plan.storyRunId, assemblyRunId, finalPath: FINAL_CLIP_RELATIVE_PATH, finalSha256: output.sha256, durationSeconds: output.durationSeconds };
  } catch (error) {
    await cleanupWorkDirectory(workDirectory);
    // final-clip.json is success-only. A terminal persistence failure cannot
    // leave a newly rendered final byte stream looking authoritative.
    try { await removeIfExists(finalManifestPath, 'Unable to invalidate final provenance.'); } catch {}
    if (published) try { await removeIfExists(finalPath, 'Unable to remove unpublished final clip.'); } catch {}
    const failure = safeFailure(error);
    try { await writeRun(writeJson, runPath, { ...base, status: 'failed', endedAt: timestamp(now()), failure }); } catch {}
    throw error;
  }
}

export function fingerprintAssembly(input: { readonly plan: AssemblyPlan; readonly standardizedAssets?: readonly StandardizedAssetProvenance[]; readonly font?: LocalFileIdentity; readonly ffmpegVersion: string; readonly assemblyPolicy?: { readonly version: string } }): string {
  const standardizedAssets = input.standardizedAssets ?? standardizedProvenance(input.plan);
  return sha256(canonicalJson({
    contractVersion: ASSEMBLY_INPUT_CONTRACT_VERSION,
    storyFingerprint: input.plan.storyFingerprint,
    clipPlanFingerprint: input.plan.clipPlanFingerprint,
    generatedMediaFingerprint: input.plan.generatedMediaFingerprint,
    template: { ...templateIdentity(input.plan), output: input.plan.output },
    storySegments: input.plan.storySegments.map((segment) => ({
      id: segment.id, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds, targetDurationSeconds: segment.targetDurationSeconds,
      visual: { unitId: segment.visual.unitId, role: segment.visual.role, segment: segment.visual.segment, sha256: segment.visual.identity.sha256, byteSize: segment.visual.identity.byteSize },
      ...(segment.voiceover === undefined ? {} : { voiceover: { unitId: segment.voiceover.unitId, role: segment.voiceover.role, segment: segment.voiceover.segment, sha256: segment.voiceover.identity.sha256, byteSize: segment.voiceover.identity.byteSize } }),
      // Text changes rendering, but the provenance must never retain ClipPlan
      // display text. Its deterministic digest supplies that sensitivity.
      displayTextSha256: sha256(canonicalJson(segment.displayText)),
    })),
    standardizedAssets: standardizedAssets.map((asset) => ({ roleId: asset.roleId, placement: asset.placement, sha256: asset.sha256, byteSize: asset.byteSize, probe: asset.probe })),
    ...(input.font === undefined ? {} : { fontSha256: input.font.sha256 }),
    assemblyPolicy: input.assemblyPolicy ?? { version: FFMPEG_ASSEMBLY_POLICY.version },
    ffmpegVersion: safeFfmpegVersion(input.ffmpegVersion),
  }));
}

export function validateFinalCandidate(probe: LocalMediaProbe, plan: AssemblyPlan): void {
  const videos = probe.streamTypes.filter((type) => type === 'video').length;
  const audio = probe.streamTypes.filter((type) => type === 'audio').length;
  if (videos !== 1 || audio !== 1 || probe.streamTypes.length !== 2 || probe.video === undefined || probe.audio === undefined) throw assembly('Final candidate must contain exactly one video stream and one audio stream.');
  if (!probe.containerNames.includes('mp4')) throw assembly('Final candidate container is not MP4-compatible.');
  if (probe.video.width !== plan.output.width || probe.video.height !== plan.output.height) throw assembly('Final candidate dimensions do not match the assembly template.');
  if (probe.video.codecName.toLowerCase() !== 'h264' || probe.video.pixelFormat.toLowerCase() !== 'yuv420p') throw assembly('Final candidate video encoding does not match the output contract.');
  if (probe.video.averageFrameRate.numerator !== plan.output.fps * probe.video.averageFrameRate.denominator) throw assembly('Final candidate frame rate does not match the assembly template.');
  if (probe.audio.codecName.toLowerCase() !== 'aac' || probe.audio.sampleRate !== 48_000 || probe.audio.channels !== 2) throw assembly('Final candidate audio encoding does not match the output contract.');
  const tolerance = (2 / plan.output.fps) + FINAL_DURATION_TOLERANCE_SECONDS;
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0 || Math.abs(probe.durationSeconds - plan.expectedFinalDurationSeconds) > tolerance) throw assembly('Final candidate duration does not match the assembly plan.');
}

/** Strict durable success-only handoff validation. */
export function validateFinalClipManifest(value: unknown): FinalClipManifest {
  const manifest = record(value, 'Final clip manifest');
  rejectExtra(manifest, ['schemaVersion', 'storyRunId', 'storyFingerprint', 'clipPlanFingerprint', 'generatedMediaFingerprint', 'assemblyFingerprint', 'template', 'standardizedAssets', 'font', 'assemblyPolicy', 'ffmpegVersion', 'output'], 'Final clip manifest');
  if (manifest.schemaVersion !== ASSEMBLY_SCHEMA_VERSION || !safeId(manifest.storyRunId) || !hash(manifest.storyFingerprint) || !hash(manifest.clipPlanFingerprint) || !hash(manifest.generatedMediaFingerprint) || !hash(manifest.assemblyFingerprint)) throw assembly('Final clip manifest is malformed.');
  validateTemplate(manifest.template); validateStandardizedAssets(manifest.standardizedAssets); if (manifest.font !== undefined) validateIdentity(manifest.font, 'Final clip font');
  const policy = record(manifest.assemblyPolicy, 'Final clip assembly policy'); rejectExtra(policy, ['version'], 'Final clip assembly policy'); if (typeof policy.version !== 'string' || policy.version.length < 1 || !isSafeFfmpegVersion(manifest.ffmpegVersion)) throw assembly('Final clip manifest is malformed.');
  validateOutput(manifest.output);
  return value as FinalClipManifest;
}

export function validateAssemblyRunMetadata(value: unknown): AssemblyRunMetadata {
  const run = record(value, 'Assembly-run metadata');
  rejectExtra(run, ['schemaVersion', 'assemblyRunId', 'status', 'storyRunId', 'startedAt', 'endedAt', 'engineVersion', 'storyFingerprint', 'clipPlanFingerprint', 'generatedMediaFingerprint', 'assemblyFingerprint', 'template', 'standardizedAssets', 'font', 'assemblyPolicy', 'ffmpegVersion', 'expectedDurationSeconds', 'output', 'failure'], 'Assembly-run metadata');
  if (run.schemaVersion !== ASSEMBLY_SCHEMA_VERSION || !safeId(run.assemblyRunId) || !safeId(run.storyRunId) || !['running', 'final_ready', 'failed'].includes(run.status as string) || typeof run.startedAt !== 'string' || typeof run.engineVersion !== 'string' || !hash(run.storyFingerprint) || !hash(run.clipPlanFingerprint) || !hash(run.generatedMediaFingerprint) || !hash(run.assemblyFingerprint) || !finitePositive(run.expectedDurationSeconds)) throw assembly('Assembly-run metadata is malformed.');
  validateTemplate(run.template); validateStandardizedAssets(run.standardizedAssets); if (run.font !== undefined) validateIdentity(run.font, 'Assembly-run font');
  const policy = record(run.assemblyPolicy, 'Assembly-run policy'); rejectExtra(policy, ['version'], 'Assembly-run policy'); if (typeof policy.version !== 'string' || policy.version.length < 1 || !isSafeFfmpegVersion(run.ffmpegVersion)) throw assembly('Assembly-run metadata is malformed.');
  if (run.status === 'running' && (run.endedAt !== undefined || run.output !== undefined || run.failure !== undefined)) throw assembly('Assembly-run metadata is malformed.');
  if (run.status === 'final_ready') { if (typeof run.endedAt !== 'string' || run.failure !== undefined || run.output === undefined) throw assembly('Assembly-run metadata is malformed.'); validateOutput(run.output); }
  if (run.status === 'failed') { if (typeof run.endedAt !== 'string' || run.output !== undefined || !isFailure(run.failure)) throw assembly('Assembly-run metadata is malformed.'); }
  return value as AssemblyRunMetadata;
}

async function qualifyFont(path: string | undefined, required: boolean, maxBytes: number): Promise<LocalFileIdentity | undefined> {
  if (!required) {
    if (path !== undefined) throw new VidGenError('invalid_argument', '--font-file is only allowed when the selected assembly contains display text.');
    return undefined;
  }
  if (typeof path !== 'string' || path.trim().length === 0) throw new VidGenError('invalid_argument', 'Assembly requires --font-file <font-path> for display text.');
  const extension = extname(path.trim()).toLowerCase();
  if (extension !== '.ttf' && extension !== '.otf') throw new VidGenError('invalid_argument', 'Font input must use a supported .ttf or .otf file.');
  try { return await identifyLocalFile(path, { maxBytes }); } catch (cause) { throw new VidGenError('invalid_argument', 'Font input must be an explicit local regular file.', { cause }); }
}

function standardizedProvenance(plan: AssemblyPlan): readonly StandardizedAssetProvenance[] {
  return [
    standardizedAsset('intro', 'before-story', plan.standardizedAssets.intro.identity, plan.standardizedAssets.intro.probe),
    standardizedAsset('outro', 'after-story', plan.standardizedAssets.outro.identity, plan.standardizedAssets.outro.probe),
  ];
}
function standardizedAsset(roleId: 'intro' | 'outro', placement: 'before-story' | 'after-story', identity: LocalFileIdentity, probe: LocalMediaProbe): StandardizedAssetProvenance { return { roleId, placement, ...safeIdentity(identity), probe: summarizeProbe(probe) }; }
function safeIdentity(identity: LocalFileIdentity): SafeFileIdentity { return { basename: identity.basename, sha256: identity.sha256, byteSize: identity.byteSize }; }
function summarizeProbe(probe: LocalMediaProbe): ProbeSummary { return { durationSeconds: probe.durationSeconds, containerNames: [...probe.containerNames], ...(probe.video === undefined ? {} : { video: { codec: probe.video.codecName, width: probe.video.width, height: probe.video.height, pixelFormat: probe.video.pixelFormat, fps: { numerator: probe.video.averageFrameRate.numerator, denominator: probe.video.averageFrameRate.denominator } } }), ...(probe.audio === undefined ? {} : { audio: { codec: probe.audio.codecName, sampleRate: probe.audio.sampleRate, channels: probe.audio.channels } }) }; }
function outputProvenance(identity: LocalFileIdentity, probe: LocalMediaProbe): FinalClipManifest['output'] { if (probe.video === undefined || probe.audio === undefined) throw assembly('Final candidate cannot be recorded.'); return { path: FINAL_CLIP_RELATIVE_PATH, sha256: identity.sha256, byteSize: identity.byteSize, durationSeconds: probe.durationSeconds, width: probe.video.width, height: probe.video.height, fps: { numerator: probe.video.averageFrameRate.numerator, denominator: probe.video.averageFrameRate.denominator }, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', audioSampleRate: 48_000, audioChannels: 2 }; }
function templateIdentity(plan: AssemblyPlan): { readonly id: string; readonly version: string } { return plan.template; }
function baseRun(input: { readonly plan: AssemblyPlan; readonly assemblyRunId: string; readonly startedAt: string; readonly standardizedAssets: readonly StandardizedAssetProvenance[]; readonly font?: LocalFileIdentity; readonly assemblyFingerprint: string; readonly ffmpegVersion: string; readonly engineVersion: string }): AssemblyRunMetadata { return { schemaVersion: ASSEMBLY_SCHEMA_VERSION, assemblyRunId: input.assemblyRunId, status: 'running', storyRunId: input.plan.storyRunId, startedAt: input.startedAt, engineVersion: input.engineVersion, storyFingerprint: input.plan.storyFingerprint, clipPlanFingerprint: input.plan.clipPlanFingerprint, generatedMediaFingerprint: input.plan.generatedMediaFingerprint, assemblyFingerprint: input.assemblyFingerprint, template: templateIdentity(input.plan), standardizedAssets: input.standardizedAssets, ...(input.font === undefined ? {} : { font: safeIdentity(input.font) }), assemblyPolicy: { version: FFMPEG_ASSEMBLY_POLICY.version }, ffmpegVersion: input.ffmpegVersion, expectedDurationSeconds: input.plan.expectedFinalDurationSeconds }; }
async function writeRun(writeJson: typeof writeJsonAtomically, path: string, run: AssemblyRunMetadata): Promise<void> { validateAssemblyRunMetadata(run); await writeJsonForArtifact(writeJson, path, run); }
async function writeJsonForArtifact(writeJson: typeof writeJsonAtomically, path: string, value: unknown): Promise<void> { try { await writeJson({ writeFile, rename, unlink }, path, value); } catch (cause) { throw new VidGenError('artifact', 'Unable to persist assembly provenance.', { cause }); } }
async function removeIfExists(path: string, message: string): Promise<void> { try { await rm(path, { force: true }); } catch (cause) { throw new VidGenError('artifact', message, { cause }); } }
async function cleanupWorkDirectory(path: string): Promise<void> { await rm(path, { recursive: true, force: true }).catch(() => undefined); }
function safeFailure(error: unknown): { readonly code: VidGenErrorCode; readonly message: string } { if (!isVidGenError(error)) return { code: 'unexpected', message: 'Assembly workflow failed unexpectedly.' }; if (error.code === 'invalid_argument') return { code: error.code, message: 'Assembly input is invalid.' }; if (error.code === 'configuration') return { code: error.code, message: 'Assembly runtime configuration failed.' }; if (error.code === 'artifact') return { code: error.code, message: 'Assembly artifact persistence failed.' }; return { code: error.code, message: 'Assembly rendering or technical validation failed.' }; }
/**
 * Version output is executable-controlled input. Preserve only the normalized
 * version token required for provenance, never a complete stdout line/build
 * configuration that could contain paths or other diagnostic data.
 */
function safeFfmpegVersion(value: unknown): string {
  if (typeof value !== 'string') throw new VidGenError('configuration', 'FFmpeg version could not be identified.');
  const match = /^ffmpeg version\s+([A-Za-z0-9][A-Za-z0-9._+-]{0,127})(?:\s|$)/u.exec(value.trim());
  if (match === null) throw new VidGenError('configuration', 'FFmpeg version could not be identified.');
  return `ffmpeg version ${match[1]!}`;
}
function isSafeFfmpegVersion(value: unknown): boolean {
  try { return safeFfmpegVersion(value) === value; } catch { return false; }
}
function safeRunId(value: unknown): string { if (!safeId(value)) throw new VidGenError('invalid_argument', 'Assembly run ID is invalid.'); return value as string; }
function timestamp(value: Date): string { if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new VidGenError('invalid_argument', 'Assembly clock produced an invalid timestamp.'); return value.toISOString(); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function record(value: unknown, label: string): Record<string, any> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw assembly(`${label} is malformed.`); return value as Record<string, any>; }
function rejectExtra(value: Record<string, unknown>, allowed: readonly string[], label: string): void { if (Object.keys(value).some((key) => !allowed.includes(key))) throw assembly(`${label} contains unsupported fields.`); }
function validateTemplate(value: unknown): void { const template = record(value, 'Template'); rejectExtra(template, ['id', 'version'], 'Template'); if (typeof template.id !== 'string' || template.id.length < 1 || typeof template.version !== 'string' || template.version.length < 1) throw assembly('Template is malformed.'); }
function validateStandardizedAssets(value: unknown): void { if (!Array.isArray(value) || value.length !== 2) throw assembly('Standardized assets are malformed.'); for (const [index, asset] of value.entries()) { const item = record(asset, 'Standardized asset'); rejectExtra(item, ['roleId', 'placement', 'basename', 'sha256', 'byteSize', 'probe'], 'Standardized asset'); if ((index === 0 && (item.roleId !== 'intro' || item.placement !== 'before-story')) || (index === 1 && (item.roleId !== 'outro' || item.placement !== 'after-story'))) throw assembly('Standardized assets are malformed.'); validateIdentity(item, 'Standardized asset'); validateProbeSummary(item.probe); } }
function validateIdentity(value: unknown, label: string): void { const identity = record(value, label); const allowed = label === 'Standardized asset' ? ['roleId', 'placement', 'basename', 'sha256', 'byteSize', 'probe'] : ['basename', 'sha256', 'byteSize']; rejectExtra(identity, allowed, label); if (typeof identity.basename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u.test(identity.basename) || !hash(identity.sha256) || !positive(identity.byteSize)) throw assembly(`${label} is malformed.`); }
function validateProbeSummary(value: unknown): void { const probe = record(value, 'Probe summary'); rejectExtra(probe, ['durationSeconds', 'containerNames', 'video', 'audio'], 'Probe summary'); if (!finitePositive(probe.durationSeconds) || !Array.isArray(probe.containerNames) || !probe.containerNames.every((name) => typeof name === 'string' && name.length > 0)) throw assembly('Probe summary is malformed.'); if (probe.video !== undefined) { const video = record(probe.video, 'Probe video'); rejectExtra(video, ['codec', 'width', 'height', 'pixelFormat', 'fps'], 'Probe video'); const fps = record(video.fps, 'Probe video fps'); rejectExtra(fps, ['numerator', 'denominator'], 'Probe video fps'); if (typeof video.codec !== 'string' || !positive(video.width) || !positive(video.height) || typeof video.pixelFormat !== 'string' || !positive(fps.numerator) || !positive(fps.denominator)) throw assembly('Probe summary is malformed.'); } if (probe.audio !== undefined) { const audio = record(probe.audio, 'Probe audio'); rejectExtra(audio, ['codec', 'sampleRate', 'channels'], 'Probe audio'); if (typeof audio.codec !== 'string' || !positive(audio.sampleRate) || !positive(audio.channels)) throw assembly('Probe summary is malformed.'); } }
function validateOutput(value: unknown): void { const output = record(value, 'Final clip output'); rejectExtra(output, ['path', 'sha256', 'byteSize', 'durationSeconds', 'width', 'height', 'fps', 'videoCodec', 'pixelFormat', 'audioCodec', 'audioSampleRate', 'audioChannels'], 'Final clip output'); const fps = record(output.fps, 'Final clip output fps'); rejectExtra(fps, ['numerator', 'denominator'], 'Final clip output fps'); if (output.path !== FINAL_CLIP_RELATIVE_PATH || !hash(output.sha256) || !positive(output.byteSize) || !finitePositive(output.durationSeconds) || !positive(output.width) || !positive(output.height) || !positive(fps.numerator) || !positive(fps.denominator) || output.videoCodec !== 'h264' || output.pixelFormat !== 'yuv420p' || output.audioCodec !== 'aac' || output.audioSampleRate !== 48_000 || output.audioChannels !== 2) throw assembly('Final clip manifest is malformed.'); }
function isFailure(value: unknown): boolean { if (value === null || typeof value !== 'object' || Array.isArray(value)) return false; const item = value as Record<string, unknown>; return Object.keys(item).length === 2 && typeof item.code === 'string' && typeof item.message === 'string' && item.message.length > 0; }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function finitePositive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function positiveInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function assembly(message: string): VidGenError { return new VidGenError('assembly', message); }
