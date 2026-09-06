import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadApprovedAnchorReferences, type ReferenceImageIdentity } from '../core/anchor-reference.ts';
import { buildCanonicalInput } from '../core/canonical-input.ts';
import { VidGenError } from '../core/error.ts';
import { generateSimpleClipCopy, assertSimpleClipMaxSeconds, type SimpleClipCopyResult } from '../core/simple-clip-copy.ts';
import { planPresenterVideoDuration, type PresenterVideoGenerationClient, type PresenterVideoGenerationResult } from '../core/presenter-video.ts';
import { buildStoryInput, type StoryInput } from '../core/story-input.ts';
import type { StructuredTextModelClient } from '../core/structured-text-model.ts';
import { LocalSimpleClipFinisher, SIMPLE_CLIP_FINISHING_POLICY, validateSimpleLowerThird } from '../integrations/ffmpeg/simple-clip-finisher.ts';
import { GoogleGeminiStructuredTextModelClient } from '../integrations/google/gemini-interactions.ts';
import { GoogleVeoVideoGenerationClient } from '../integrations/google/veo-video-generation.ts';
import { loadNgestVidGenManifestFile } from '../integrations/ngest/local-manifest-file.ts';
import { writeJsonAtomically } from '../shared/atomic-json.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const DEFAULT_HEADLINE_ARTIFACTS_ROOT = 'artifacts/headline-clips';
export const HEADLINE_SIDECAR_SCHEMA_VERSION = '1';
export interface HeadlineWorkflowDependencies { readonly inputFile: string; readonly articleId: string; readonly maxSeconds?: number; readonly anchorReferencePaths: readonly string[]; readonly fontPath: string; readonly artifactsRoot?: string; readonly loadManifest?: typeof loadNgestVidGenManifestFile; readonly createTextClient?: () => StructuredTextModelClient; readonly createVideoClient?: () => PresenterVideoGenerationClient; readonly finisher?: Pick<LocalSimpleClipFinisher, 'preflight' | 'finish'>; readonly createClipId?: () => string; readonly writeJson?: typeof writeJsonAtomically; readonly engineVersion?: string; }
export interface HeadlineWorkflowResult { readonly clipId: string; readonly finalPath: string; readonly metadataPath: string; readonly sha256: string; readonly durationSeconds: number; }

/** Produces one flat MP4/sidecar pair without entering the cinematic workspace. */
export async function generateHeadlineClip(dependencies: HeadlineWorkflowDependencies): Promise<HeadlineWorkflowResult> {
  const maxSeconds = dependencies.maxSeconds ?? 20; assertSimpleClipMaxSeconds(maxSeconds);
  const inputFile = nonBlank(dependencies.inputFile, '--input-file requires a non-empty file path.'); const articleId = nonBlank(dependencies.articleId, '--article-id requires a non-empty articleId.'); const fontPath = nonBlank(dependencies.fontPath, '--font-file requires a non-empty file path.');
  const clipId = safeClipId((dependencies.createClipId ?? randomUUID)()); const root = resolve(dependencies.artifactsRoot ?? DEFAULT_HEADLINE_ARTIFACTS_ROOT); const finalPath = join(root, `${clipId}.mp4`); const metadataPath = join(root, `${clipId}.json`); const workDirectory = join(root, `.tmp-${clipId}`); const plan = planPresenterVideoDuration(maxSeconds);
  const manifest = await (dependencies.loadManifest ?? loadNgestVidGenManifestFile)(inputFile); const story = buildStoryInput(buildCanonicalInput(manifest), articleId); const lowerThird = validateSimpleLowerThird(story.article.headline, story.article.source.displayName);
  const references = await loadApprovedAnchorReferences(dependencies.anchorReferencePaths, 10_000_000); if (references.length < 1 || references.length > 3) throw new VidGenError('invalid_argument', 'Headline requires one to three --anchor-reference values.'); const font = await fileIdentity(fontPath, 100_000_000, 'Font file'); const finisher = dependencies.finisher ?? new LocalSimpleClipFinisher(); await finisher.preflight(); await mkdir(root, { recursive: true }); await assertUnpublished(finalPath, metadataPath);
  let published = false;
  try {
    await mkdir(workDirectory, { recursive: false });
    const copy = await generateSimpleClipCopy(story, maxSeconds, (dependencies.createTextClient ?? (() => new GoogleGeminiStructuredTextModelClient()))());
    const video = await (dependencies.createVideoClient ?? (() => new GoogleVeoVideoGenerationClient()))().generatePresenterVideo({ spokenText: copy.copy.text, referenceImages: references.map(({ image }) => image), maxSeconds }); validateVideoResult(video, plan.rawProviderDurationSeconds);
    const rawPath = join(workDirectory, 'presenter.mp4'); const candidatePath = join(workDirectory, 'candidate.mp4'); await writeFile(rawPath, video.bytes, { flag: 'wx' });
    const finished = await finisher.finish({ rawPresenterVideoPath: rawPath, fontPath, headline: lowerThird.headline, sourceDisplayName: lowerThird.sourceDisplayName, maxSeconds, plannedDurationSeconds: Math.min(maxSeconds, video.rawDurationSeconds), workDirectory, outputPath: candidatePath }); await rename(candidatePath, finalPath); published = true;
    const bytes = await readFile(finalPath); const sidecar = buildHeadlineSidecar(clipId, story, copy, video, references.map(({ identity }) => identity), font, maxSeconds, finished.probe.durationSeconds, basename(finalPath), bytes, finished.ffmpegVersion, dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION);
    try { await (dependencies.writeJson ?? writeJsonAtomically)({ writeFile, rename, unlink: async (path) => rm(path, { force: true }) }, metadataPath, sidecar); } catch (cause) { await rm(finalPath, { force: true }).catch(() => undefined); published = false; throw new VidGenError('artifact', 'Unable to publish headline clip metadata.', { cause }); }
    return { clipId, finalPath, metadataPath, sha256: sha256(bytes), durationSeconds: finished.probe.durationSeconds };
  } finally { await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined); if (!published) await rm(finalPath, { force: true }).catch(() => undefined); }
}

function buildHeadlineSidecar(clipId: string, story: StoryInput, copy: SimpleClipCopyResult, video: PresenterVideoGenerationResult, references: readonly ReferenceImageIdentity[], font: FileIdentity, maxSeconds: number, durationSeconds: number, filename: string, bytes: Uint8Array, ffmpegVersion: string, engineVersion: string) { return { schemaVersion: HEADLINE_SIDECAR_SCHEMA_VERSION, clipId, article: story.article, profile: story.profile, publication: story.publication, story: { fingerprint: story.storyFingerprint, provenance: story.provenance }, presenterText: copy.copy.text, requestedMaxSeconds: maxSeconds, plannedDurationSeconds: Math.min(maxSeconds, video.rawDurationSeconds), finalDurationSeconds: durationSeconds, final: { filename, sha256: sha256(bytes), byteSize: bytes.byteLength, technical: { output: SIMPLE_CLIP_FINISHING_POLICY.output, audio: SIMPLE_CLIP_FINISHING_POLICY.audio } }, textProvider: safeProvider(copy.provider, copy.model, copy.requestId), videoProvider: { ...safeProvider(video.provider, video.model, video.requestId), ...(video.operationId === undefined ? {} : { operationId: safeToken(video.operationId, 'video operation') }), ...(video.operationIds === undefined ? {} : { operationIds: video.operationIds.map((id) => safeToken(id, 'video operation')) }), ...(video.generationOperationCount === undefined ? {} : { generationOperationCount: video.generationOperationCount }) }, references, font, finishing: { policy: SIMPLE_CLIP_FINISHING_POLICY.version, ffmpegVersion: safeToken(ffmpegVersion, 'FFmpeg version') }, engineVersion: safeToken(engineVersion, 'engine version') }; }
interface FileIdentity { readonly basename: string; readonly sha256: string; readonly byteSize: number; }
async function fileIdentity(path: string, maxBytes: number, label: string): Promise<FileIdentity> { const info = await stat(path); if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new VidGenError('invalid_argument', `${label} is empty or exceeds the supported size.`); const bytes = await readFile(path); if (bytes.byteLength !== info.size) throw new VidGenError('invalid_argument', `${label} changed while being read.`); const name = basename(path); if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name)) throw new VidGenError('invalid_argument', `${label} basename is unsafe.`); return { basename: name, sha256: sha256(bytes), byteSize: bytes.byteLength }; }
async function assertUnpublished(...paths: readonly string[]): Promise<void> { for (const path of paths) { try { await stat(path); throw new VidGenError('artifact', 'Generated headline clip ID already has published artifacts.'); } catch (error) { if (error instanceof VidGenError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new VidGenError('artifact', 'Unable to inspect headline clip publication paths.', { cause: error }); } } }
function validateVideoResult(result: PresenterVideoGenerationResult, requiredDuration: number): void { if (result.bytes.byteLength < 1 || result.rawDurationSeconds < requiredDuration || !Number.isSafeInteger(result.rawDurationSeconds)) throw new VidGenError('simple_clip', 'Presenter video provider returned an invalid duration or empty video.'); }
function safeProvider(provider: string, model: string, requestId?: string) { return { provider: safeToken(provider, 'provider'), model: safeToken(model, 'model'), ...(requestId === undefined ? {} : { requestId: safeToken(requestId, 'request') }) }; }
function safeToken(value: string, label: string): string { if (typeof value !== 'string' || !/^[A-Za-z0-9._:/@ -]{1,256}$/.test(value)) throw new VidGenError('simple_clip', `Presenter ${label} provenance was unsafe.`); return value; }
function safeClipId(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new VidGenError('invalid_argument', 'Generated headline clip ID is not safe.'); return value; }
function nonBlank(value: string, message: string): string { if (value.trim().length === 0) throw new VidGenError('invalid_argument', message); return value; }
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
