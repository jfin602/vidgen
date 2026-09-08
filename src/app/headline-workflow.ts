import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { loadApprovedAnchorReferences, type ReferenceImageIdentity } from '../core/anchor-reference.ts';
import { buildCanonicalInput } from '../core/canonical-input.ts';
import { VidGenError } from '../core/error.ts';
import { generateSimpleClipCopy, assertSimpleClipMaxSeconds, getSimpleClipPlannedDurationSeconds, SIMPLE_CLIP_REALIZABLE_MAX_SECONDS, type SimpleClipCopyResult } from '../core/simple-clip-copy.ts';
import { planPresenterVideoDuration, type PresenterVideoGenerationClient, type PresenterVideoGenerationResult } from '../core/presenter-video.ts';
import { buildStoryInput, type StoryInput } from '../core/story-input.ts';
import type { StructuredTextModelClient } from '../core/structured-text-model.ts';
import { LocalSimpleClipFinisher, SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS, SIMPLE_CLIP_FINISHING_POLICY, validateSimpleLowerThird } from '../integrations/ffmpeg/simple-clip-finisher.ts';
import { GoogleGeminiStructuredTextModelClient } from '../integrations/google/gemini-agent-platform.ts';
import { createConfiguredVideoClient } from '../integrations/google/video-client-factory.ts';
import { loadNgestVidGenManifestFile } from '../integrations/ngest/local-manifest-file.ts';
import { writeJsonAtomically } from '../shared/atomic-json.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const DEFAULT_HEADLINE_ARTIFACTS_ROOT = 'artifacts/headline-clips';
export const HEADLINE_SIDECAR_SCHEMA_VERSION = '3';
export const HEADLINE_DRY_RUN_METADATA_SCHEMA_VERSION = '1';
export interface HeadlineWorkflowDependencies { readonly inputFile: string; readonly articleId: string; readonly maxSeconds?: number; readonly anchorReferencePaths: readonly string[]; readonly fontPath: string; readonly artifactsRoot?: string; readonly dryRun?: true; readonly loadManifest?: typeof loadNgestVidGenManifestFile; readonly createTextClient?: () => StructuredTextModelClient; readonly createVideoClient?: () => PresenterVideoGenerationClient; readonly finisher?: Pick<LocalSimpleClipFinisher, 'preflightLowerThird' | 'finish'>; readonly createClipId?: () => string; readonly writeJson?: typeof writeJsonAtomically; readonly engineVersion?: string; readonly onProgress?: (message: string) => void; }
export interface HeadlineWorkflowResult { readonly clipId: string; readonly rawVeoPath: string; readonly finalPath: string; readonly metadataPath: string; readonly sha256: string; readonly durationSeconds: number; readonly headline: string; readonly sourceDisplayName: string; }
export interface HeadlineDryRunResult { readonly dryRun: true; readonly clipId: string; readonly presenterTextPath: string; readonly metadataPath: string; readonly plannedDurationSeconds: number; }

/** Produces one flat raw-Veo/final-MP4/sidecar package without entering the cinematic workspace. */
export async function generateHeadlineClip(dependencies: HeadlineWorkflowDependencies): Promise<HeadlineWorkflowResult | HeadlineDryRunResult> {
  const maxSeconds = dependencies.maxSeconds ?? 20; assertSimpleClipMaxSeconds(maxSeconds);
  const inputFile = nonBlank(dependencies.inputFile, '--input-file requires a non-empty file path.'); const articleId = nonBlank(dependencies.articleId, '--article-id requires a non-empty articleId.'); const fontPath = nonBlank(dependencies.fontPath, '--font-file requires a non-empty file path.');
  const clipId = safeClipId((dependencies.createClipId ?? randomUUID)()); const root = resolve(dependencies.artifactsRoot ?? DEFAULT_HEADLINE_ARTIFACTS_ROOT); const rawVeoPath = join(root, `${clipId}.veo.mp4`); const finalPath = join(root, `${clipId}.mp4`); const metadataPath = join(root, `${clipId}.json`); const dryRunTextPath = join(root, `${clipId}.dry-run.txt`); const dryRunMetadataPath = join(root, `${clipId}.dry-run.json`); const workDirectory = join(root, `.tmp-${clipId}`);
  const manifest = await (dependencies.loadManifest ?? loadNgestVidGenManifestFile)(inputFile); const story = buildStoryInput(buildCanonicalInput(manifest), articleId); validateSimpleLowerThird(story.article.headline, story.article.source.displayName); progress(dependencies, 'Headline input and story validation complete.');
  const references = await loadApprovedAnchorReferences(dependencies.anchorReferencePaths, 10_000_000); if (references.length < 1 || references.length > 3) throw new VidGenError('invalid_argument', 'Headline requires one to three --anchor-reference values.'); const font = await fileIdentity(fontPath, 100_000_000, 'Font file'); const finisher = dependencies.finisher ?? new LocalSimpleClipFinisher(); await mkdir(root, { recursive: true }); await assertUnpublished(...(dependencies.dryRun === true ? [dryRunTextPath, dryRunMetadataPath] : [rawVeoPath, finalPath, metadataPath]));
  let published = false;
  try {
    await mkdir(workDirectory, { recursive: false });
    const lowerThird = await finisher.preflightLowerThird({ headline: story.article.headline, sourceDisplayName: story.article.source.displayName, fontPath, workDirectory }); progress(dependencies, 'Headline lower-third and font preflight complete.');
    progress(dependencies, 'Presenter copy generation starting.');
    const copy = await generateSimpleClipCopy(story, maxSeconds, (dependencies.createTextClient ?? (() => new GoogleGeminiStructuredTextModelClient()))()); progress(dependencies, 'Presenter copy generation completed.');
    const plannedDurationSeconds = getSimpleClipPlannedDurationSeconds(copy.copy.text, maxSeconds); const plan = planPresenterVideoDuration(plannedDurationSeconds); progress(dependencies, `Planned final duration: ${plannedDurationSeconds} seconds.`);
    if (dependencies.dryRun === true) {
      const metadata = buildHeadlineDryRunMetadata(clipId, story, copy, references.map(({ identity }) => identity), font, maxSeconds, plannedDurationSeconds, plan, basename(dryRunTextPath), dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION);
      try {
        await writeTextAtomically(dryRunTextPath, copy.copy.text);
        await (dependencies.writeJson ?? writeJsonAtomically)({ writeFile, rename, unlink: async (path) => rm(path, { force: true }) }, dryRunMetadataPath, metadata);
      } catch (cause) {
        await Promise.all([rm(dryRunTextPath, { force: true }), rm(dryRunMetadataPath, { force: true })].map((operation) => operation.catch(() => undefined)));
        throw new VidGenError('artifact', 'Unable to publish headline dry-run inspection artifacts.', { cause });
      }
      published = true;
      progress(dependencies, 'Headline dry-run inspection artifacts published; Veo generation suppressed.');
      return { dryRun: true, clipId, presenterTextPath: dryRunTextPath, metadataPath: dryRunMetadataPath, plannedDurationSeconds };
    }
    const videoClient = dependencies.createVideoClient === undefined ? createConfiguredVideoClient(process.env, { onProgress: (event) => progress(dependencies, event.stage === 'operation_started' ? `Veo operation ${event.operationNumber} started.` : event.stage === 'operation_completed' ? `Veo operation ${event.operationNumber} completed.` : `Veo operation ${event.operationNumber} pending (poll ${event.pollNumber}).`) }) : undefined;
    const activeVideoClient = videoClient ?? dependencies.createVideoClient!();
    progress(dependencies, `Configured Veo model: ${activeVideoClient.model}.`); progress(dependencies, `Reference images: ${references.length}.`); progress(dependencies, `Veo extension required: ${plan.extensionCount === 1 ? 'yes' : 'no'}.`); progress(dependencies, 'Veo generation starting.');
    const video = await activeVideoClient.generatePresenterVideo({ spokenText: copy.copy.text, referenceImages: references.map(({ image }) => image), maxSeconds: plannedDurationSeconds }); validateVideoResult(video, plan);
    const rawVeoCandidatePath = join(workDirectory, 'raw-veo.mp4'); const rawPath = join(workDirectory, 'presenter.mp4'); const candidatePath = join(workDirectory, 'candidate.mp4'); const candidateMetadataPath = join(workDirectory, 'sidecar.json'); await Promise.all([writeFile(rawVeoCandidatePath, video.bytes, { flag: 'wx' }), writeFile(rawPath, video.bytes, { flag: 'wx' })]);
    progress(dependencies, 'FFmpeg finishing starting.'); const finished = await finisher.finish({ rawPresenterVideoPath: rawPath, fontPath, headline: lowerThird.headline, sourceDisplayName: lowerThird.sourceDisplayName, maxSeconds, plannedDurationSeconds, workDirectory, outputPath: candidatePath }); progress(dependencies, 'FFmpeg finishing completed.');
    const bytes = await readFile(candidatePath); const sidecar = buildHeadlineSidecar(clipId, story, copy, video, activeVideoClient.promptAssetIdentity, references.map(({ identity }) => identity), font, maxSeconds, plannedDurationSeconds, finished.probe.durationSeconds, basename(rawVeoPath), video.bytes, basename(finalPath), bytes, finished.ffmpegVersion, dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION); validateHeadlineSidecar(sidecar);
    try { await (dependencies.writeJson ?? writeJsonAtomically)({ writeFile, rename, unlink: async (path) => rm(path, { force: true }) }, candidateMetadataPath, sidecar); } catch (cause) { throw new VidGenError('artifact', 'Unable to publish headline clip metadata.', { cause }); }
    await rename(rawVeoCandidatePath, rawVeoPath); await rename(candidatePath, finalPath); await rename(candidateMetadataPath, metadataPath); published = true;
    progress(dependencies, 'Headline final publication completed.'); return { clipId, rawVeoPath, finalPath, metadataPath, sha256: sha256(bytes), durationSeconds: finished.probe.durationSeconds, headline: story.article.headline, sourceDisplayName: story.article.sourceDisplayName };
  } finally { await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined); if (!published) await Promise.all([rm(rawVeoPath, { force: true }), rm(finalPath, { force: true }), rm(metadataPath, { force: true }), rm(dryRunTextPath, { force: true }), rm(dryRunMetadataPath, { force: true })].map((operation) => operation.catch(() => undefined))); }
}

function buildHeadlineDryRunMetadata(clipId: string, story: StoryInput, copy: SimpleClipCopyResult, references: readonly ReferenceImageIdentity[], font: FileIdentity, maxSeconds: number, plannedDurationSeconds: number, plan: ReturnType<typeof planPresenterVideoDuration>, presenterTextFilename: string, engineVersion: string) {
  return {
    schemaVersion: HEADLINE_DRY_RUN_METADATA_SCHEMA_VERSION,
    kind: 'headline-dry-run',
    status: 'prepared_non_final',
    clipId,
    governedInput: { articleId: story.article.articleId, headline: story.article.headline, sourceDisplayName: story.article.source.displayName, storyFingerprint: story.storyFingerprint, sourceInputFingerprint: story.provenance.sourceInputFingerprint },
    requestedMaxSeconds: maxSeconds,
    plannedDurationSeconds,
    presenterDurationPlan: { rawCoverageSeconds: plan.rawProviderDurationSeconds, extensionCount: plan.extensionCount },
    presenterText: { filename: presenterTextFilename, sha256: sha256(Buffer.from(copy.copy.text)), byteSize: Buffer.byteLength(copy.copy.text) },
    textProvider: safeProvider(copy.provider, copy.model, copy.requestId),
    videoGeneration: { requested: false, status: 'suppressed' },
    references,
    font,
    finishing: { policy: SIMPLE_CLIP_FINISHING_POLICY.version, lowerThirdPreflight: 'completed' },
    engineVersion: safeToken(engineVersion, 'engine version'),
  };
}

async function writeTextAtomically(finalPath: string, text: string): Promise<void> {
  const temporaryPath = `${finalPath}.tmp-${randomUUID()}`;
  let created = false;
  try { await writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' }); created = true; await rename(temporaryPath, finalPath); }
  catch (cause) { if (created) await rm(temporaryPath, { force: true }).catch(() => undefined); throw cause; }
}

function buildHeadlineSidecar(clipId: string, story: StoryInput, copy: SimpleClipCopyResult, video: PresenterVideoGenerationResult, promptAssetIdentity: { readonly basename: string; readonly sha256: string; readonly byteSize: number }, references: readonly ReferenceImageIdentity[], font: FileIdentity, maxSeconds: number, plannedDurationSeconds: number, durationSeconds: number, rawVeoFilename: string, rawVeoBytes: Uint8Array, finalFilename: string, finalBytes: Uint8Array, ffmpegVersion: string, engineVersion: string) { return { schemaVersion: HEADLINE_SIDECAR_SCHEMA_VERSION, clipId, article: story.article, profile: story.profile, publication: story.publication, story: { fingerprint: story.storyFingerprint, provenance: story.provenance }, presenterText: copy.copy.text, requestedMaxSeconds: maxSeconds, plannedDurationSeconds, finalDurationSeconds: durationSeconds, rawVeo: { filename: rawVeoFilename, sha256: sha256(rawVeoBytes), byteSize: rawVeoBytes.byteLength }, final: { filename: finalFilename, sha256: sha256(finalBytes), byteSize: finalBytes.byteLength, technical: { output: SIMPLE_CLIP_FINISHING_POLICY.output, audio: SIMPLE_CLIP_FINISHING_POLICY.audio } }, textProvider: safeProvider(copy.provider, copy.model, copy.requestId), videoProvider: { ...safeProvider(video.provider, video.model, video.requestId), promptAssetIdentity: safeFileIdentity(promptAssetIdentity), ...(video.operationId === undefined ? {} : { operationId: safeToken(video.operationId, 'video operation') }), ...(video.operationIds === undefined ? {} : { operationIds: video.operationIds.map((id) => safeToken(id, 'video operation')) }), ...(video.generationOperationCount === undefined ? {} : { generationOperationCount: video.generationOperationCount }) }, references, font, finishing: { policy: SIMPLE_CLIP_FINISHING_POLICY.version, ffmpegVersion: safeFfmpegVersion(ffmpegVersion) }, engineVersion: safeToken(engineVersion, 'engine version') }; }
interface FileIdentity { readonly basename: string; readonly sha256: string; readonly byteSize: number; }
async function fileIdentity(path: string, maxBytes: number, label: string): Promise<FileIdentity> { const info = await stat(path); if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new VidGenError('invalid_argument', `${label} is empty or exceeds the supported size.`); const bytes = await readFile(path); if (bytes.byteLength !== info.size) throw new VidGenError('invalid_argument', `${label} changed while being read.`); const name = basename(path); if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name)) throw new VidGenError('invalid_argument', `${label} basename is unsafe.`); return { basename: name, sha256: sha256(bytes), byteSize: bytes.byteLength }; }
async function assertUnpublished(...paths: readonly string[]): Promise<void> { for (const path of paths) { try { await stat(path); throw new VidGenError('artifact', 'Generated headline clip ID already has published artifacts.'); } catch (error) { if (error instanceof VidGenError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new VidGenError('artifact', 'Unable to inspect headline clip publication paths.', { cause: error }); } } }
function validateVideoResult(result: PresenterVideoGenerationResult, plan: ReturnType<typeof planPresenterVideoDuration>): void { if (result.bytes.byteLength < 1 || result.mimeType !== 'video/mp4' || result.rawDurationSeconds !== plan.rawProviderDurationSeconds || !Number.isSafeInteger(result.rawDurationSeconds) || result.durationPlan.finalDurationCeilingSeconds !== plan.finalDurationCeilingSeconds || result.durationPlan.rawProviderDurationSeconds !== plan.rawProviderDurationSeconds || result.durationPlan.extensionCount !== plan.extensionCount || result.durationPlan.requiresFinalTrim !== plan.requiresFinalTrim) throw new VidGenError('simple_clip', 'Presenter video provider returned coverage incompatible with the selected duration plan.'); safeProvider(result.provider, result.model, result.requestId); if (result.operationId !== undefined) safeToken(result.operationId, 'video operation'); if (result.operationIds !== undefined) { result.operationIds.forEach((id) => safeToken(id, 'video operation')); if (result.operationIds.length !== plan.extensionCount + 1 || (result.operationId !== undefined && result.operationId !== result.operationIds.at(-1)) || (result.requestId !== undefined && result.requestId !== result.operationIds[0])) throw new VidGenError('simple_clip', 'Presenter video provider returned provenance incompatible with the selected duration plan.'); } if (result.generationOperationCount !== undefined && result.generationOperationCount !== plan.extensionCount + 1) throw new VidGenError('simple_clip', 'Presenter video provider returned provenance incompatible with the selected duration plan.'); }
function safeProvider(provider: string, model: string, requestId?: string) { return { provider: safeToken(provider, 'provider'), model: safeToken(model, 'model'), ...(requestId === undefined ? {} : { requestId: safeToken(requestId, 'request') }) }; }
function safeFfmpegVersion(value: string): string { const match = /^ffmpeg version ([A-Za-z0-9._-]{1,128})\b/iu.exec(value); if (match === null) throw new VidGenError('simple_clip', 'Presenter FFmpeg version provenance was unsafe.'); return `ffmpeg version ${match[1]}`; }
function safeToken(value: string, label: string): string { if (!safeTokenValue(value)) throw new VidGenError('simple_clip', `Presenter ${label} provenance was unsafe.`); return value; }
function safeClipId(value: string): string { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new VidGenError('invalid_argument', 'Generated headline clip ID is not safe.'); return value; }
function nonBlank(value: string, message: string): string { if (value.trim().length === 0) throw new VidGenError('invalid_argument', message); return value; }
function progress(dependencies: HeadlineWorkflowDependencies, message: string): void { try { dependencies.onProgress?.(message); } catch {} }
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function safeFileIdentity(value: { readonly basename: string; readonly sha256: string; readonly byteSize: number }): FileIdentity { if (!safeBasename(value.basename) || !hash(value.sha256) || !positiveInteger(value.byteSize)) throw new VidGenError('simple_clip', 'Presenter prompt asset provenance was unsafe.'); return value; }

/** Narrow runtime counterpart to schemas/headline-clip.schema.json. */
export function validateHeadlineSidecar(value: unknown): void {
  const sidecar = sidecarRecord(value, 'Headline clip sidecar');
  rejectSidecarExtra(sidecar, ['schemaVersion', 'clipId', 'article', 'profile', 'publication', 'story', 'presenterText', 'requestedMaxSeconds', 'plannedDurationSeconds', 'finalDurationSeconds', 'rawVeo', 'final', 'textProvider', 'videoProvider', 'references', 'font', 'finishing', 'engineVersion']);
  if (sidecar.schemaVersion !== HEADLINE_SIDECAR_SCHEMA_VERSION || !safeId(sidecar.clipId) || !nonEmptyString(sidecar.presenterText) || !safeTokenValue(sidecar.engineVersion)) throw invalidSidecar();
  const requested = sidecar.requestedMaxSeconds; const planned = sidecar.plannedDurationSeconds; const final = sidecar.finalDurationSeconds;
  if (!safeInteger(requested) || requested < 4 || requested > 20 || !safeInteger(planned) || planned < 4 || planned > SIMPLE_CLIP_REALIZABLE_MAX_SECONDS || planned > requested || typeof final !== 'number' || !Number.isFinite(final) || final <= 0 || final > requested + SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS || Math.abs(final - planned) > SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS) throw invalidSidecar();
  validateArticle(sidecar.article); validateProfile(sidecar.profile); validatePublication(sidecar.publication); validateStory(sidecar.story); validateProvider(sidecar.textProvider); validateVideoProvider(sidecar.videoProvider); validateReferences(sidecar.references); validateFile(sidecar.font); validateFinishing(sidecar.finishing); validateRawVeo(sidecar.rawVeo, sidecar.clipId); validateFinal(sidecar.final, sidecar.clipId);
}

function validateArticle(value: unknown): void { const article = sidecarRecord(value, 'Article'); rejectSidecarExtra(article, ['articleId', 'headline', 'originalUrl', 'effectiveFeedDate', 'feedDateSource', 'publishedAt', 'author', 'summary', 'imageUrl', 'source', 'categories']); if (!['articleId', 'headline', 'originalUrl', 'effectiveFeedDate', 'feedDateSource'].every((key) => nonEmptyString(article[key])) || !uri(article.originalUrl) || !nullableString(article.publishedAt) || !nullableString(article.author) || !nullableString(article.summary) || !nullableString(article.imageUrl) || !Array.isArray(article.categories) || !article.categories.every(nonEmptyString)) throw invalidSidecar(); validateProfile(article.source); }
function validateProfile(value: unknown): void { const profile = sidecarRecord(value, 'Profile'); rejectSidecarExtra(profile, ['configKey', 'displayName']); if (!nonEmptyString(profile.configKey) || !nonEmptyString(profile.displayName)) throw invalidSidecar(); }
function validatePublication(value: unknown): void { const publication = sidecarRecord(value, 'Publication'); rejectSidecarExtra(publication, ['name']); if (!nonEmptyString(publication.name)) throw invalidSidecar(); }
function validateStory(value: unknown): void { const story = sidecarRecord(value, 'Story'); rejectSidecarExtra(story, ['fingerprint', 'provenance']); if (!hash(story.fingerprint)) throw invalidSidecar(); const provenance = sidecarRecord(story.provenance, 'Story provenance'); rejectSidecarExtra(provenance, ['sourceInputFingerprint', 'ngestApiVersion', 'snapshotRevision']); if (!hash(provenance.sourceInputFingerprint) || !nonEmptyString(provenance.ngestApiVersion) || (provenance.snapshotRevision !== undefined && !jsonValue(provenance.snapshotRevision))) throw invalidSidecar(); }
function validateProvider(value: unknown): void { const provider = sidecarRecord(value, 'Provider'); rejectSidecarExtra(provider, ['provider', 'model', 'requestId']); if (!safeTokenValue(provider.provider) || !safeTokenValue(provider.model) || (provider.requestId !== undefined && !safeTokenValue(provider.requestId))) throw invalidSidecar(); }
function validateVideoProvider(value: unknown): void { const provider = sidecarRecord(value, 'Video provider'); rejectSidecarExtra(provider, ['provider', 'model', 'promptAssetIdentity', 'requestId', 'operationId', 'operationIds', 'generationOperationCount']); validateProvider({ provider: provider.provider, model: provider.model, ...(provider.requestId === undefined ? {} : { requestId: provider.requestId }) }); validateFile(provider.promptAssetIdentity); if ((provider.operationId !== undefined && !safeTokenValue(provider.operationId)) || (provider.operationIds !== undefined && (!Array.isArray(provider.operationIds) || !provider.operationIds.every(safeTokenValue))) || (provider.generationOperationCount !== undefined && (!safeInteger(provider.generationOperationCount) || provider.generationOperationCount < 1))) throw invalidSidecar(); }
function validateReferences(value: unknown): void { if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw invalidSidecar(); value.forEach((item, index) => { const reference = sidecarRecord(item, 'Reference'); rejectSidecarExtra(reference, ['ordinal', 'basename', 'mimeType', 'sha256', 'byteSize']); if (reference.ordinal !== index + 1 || !safeBasename(reference.basename) || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType as string) || !hash(reference.sha256) || !positiveInteger(reference.byteSize)) throw invalidSidecar(); }); }
function validateFile(value: unknown): void { const file = sidecarRecord(value, 'File'); rejectSidecarExtra(file, ['basename', 'sha256', 'byteSize']); if (!safeBasename(file.basename) || !hash(file.sha256) || !positiveInteger(file.byteSize)) throw invalidSidecar(); }
function validateFinishing(value: unknown): void { const finishing = sidecarRecord(value, 'Finishing'); rejectSidecarExtra(finishing, ['policy', 'ffmpegVersion']); if (finishing.policy !== SIMPLE_CLIP_FINISHING_POLICY.version || !safeTokenValue(finishing.ffmpegVersion)) throw invalidSidecar(); }
function validateRawVeo(value: unknown, clipId: unknown): void { const rawVeo = sidecarRecord(value, 'Raw Veo'); rejectSidecarExtra(rawVeo, ['filename', 'sha256', 'byteSize']); if (rawVeo.filename !== `${clipId}.veo.mp4` || !hash(rawVeo.sha256) || !positiveInteger(rawVeo.byteSize)) throw invalidSidecar(); }
function validateFinal(value: unknown, clipId: unknown): void { const final = sidecarRecord(value, 'Final'); rejectSidecarExtra(final, ['filename', 'sha256', 'byteSize', 'technical']); if (final.filename !== `${clipId}.mp4` || !hash(final.sha256) || !positiveInteger(final.byteSize)) throw invalidSidecar(); const technical = sidecarRecord(final.technical, 'Final technical'); rejectSidecarExtra(technical, ['output', 'audio']); if (!sameObject(technical.output, SIMPLE_CLIP_FINISHING_POLICY.output) || !sameObject(technical.audio, SIMPLE_CLIP_FINISHING_POLICY.audio)) throw invalidSidecar(); }
function sidecarRecord(value: unknown, label: string): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new VidGenError('artifact', `${label} is malformed.`); return value as Record<string, unknown>; }
function rejectSidecarExtra(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value) && !['requestId', 'operationId', 'operationIds', 'generationOperationCount', 'snapshotRevision'].includes(key))) throw invalidSidecar(); }
function invalidSidecar(): VidGenError { return new VidGenError('artifact', 'Headline clip sidecar is malformed.'); }
function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function nullableString(value: unknown): boolean { return value === null || typeof value === 'string'; }
function safeTokenValue(value: unknown): boolean { return typeof value === 'string' && /^(?!\/)(?![A-Za-z]:[\\/])(?!file:)[A-Za-z0-9._:/@ -]{1,256}$/i.test(value); }
function safeId(value: unknown): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value); }
function safeBasename(value: unknown): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(value); }
function hash(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function safeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }
function positiveInteger(value: unknown): boolean { return safeInteger(value) && value > 0; }
function uri(value: unknown): boolean { if (typeof value !== 'string' || value.length === 0) return false; try { new URL(value); return true; } catch { return false; } }
function jsonValue(value: unknown): boolean { if (value === null || typeof value === 'string' || typeof value === 'boolean') return true; if (typeof value === 'number') return Number.isFinite(value); if (Array.isArray(value)) return value.every(jsonValue); if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(jsonValue); return false; }
function sameObject(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
