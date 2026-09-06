import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

import { CLIP_PLAN_ARTIFACT_NAME, CLIP_PLAN_RUN_ARTIFACT_NAME } from './clip-plan-workflow.ts';
import { STORY_RUN_ARTIFACT_NAME } from './story-workspace.ts';
import { type AssemblyTemplate } from '../core/assembly-template.ts';
import { validateClipPlanForStoryFingerprint, type ClipPlan } from '../core/clip-plan.ts';
import { VidGenError, isVidGenError, type VidGenErrorCode } from '../core/error.ts';
import {
  resolveGeneratedMediaUnits,
  type GeneratedMediaUnit,
  type SpeechGenerationClient,
  type SpeechGenerationResult,
  type VideoGenerationClient,
  type VideoGenerationResult,
} from '../core/generated-media.ts';
import {
  DEFAULT_MAX_ANCHOR_REFERENCE_BYTES,
  assertApprovedAnchorReferenceCount,
  loadApprovedAnchorReferences,
  type ReferenceImageIdentity,
} from '../core/anchor-reference.ts';
import { getAssemblyTemplate } from '../core/template-registry.ts';
import { GoogleGeminiSpeechGenerationClient } from '../integrations/google/gemini-speech-generation.ts';
import { GoogleVeoVideoGenerationClient } from '../integrations/google/veo-video-generation.ts';
import { writeJsonAtomically, prettyJson } from '../shared/atomic-json.ts';
import { canonicalJson } from '../shared/canonical-json.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const MEDIA_RUN_ARTIFACT_NAME = 'media-run.json';
export const GENERATED_MEDIA_ARTIFACT_NAME = 'generated-media.json';
export const GENERATED_MEDIA_SCHEMA_VERSION = '1';
export const GENERATED_MEDIA_INPUT_CONTRACT_VERSION = '1';
export { DEFAULT_MAX_ANCHOR_REFERENCE_BYTES } from '../core/anchor-reference.ts';
export const DEFAULT_MAX_GENERATED_ASSET_BYTES = 100_000_000;

type UnitStatus = 'pending' | 'ready' | 'failed';

export type { ReferenceImageIdentity } from '../core/anchor-reference.ts';

export interface MediaUnitRecord {
  readonly unitId: string;
  readonly segment: GeneratedMediaUnit['segment'];
  readonly role: GeneratedMediaUnit['role'];
  readonly effectiveGenerationInputFingerprint: string;
  readonly status: UnitStatus;
  readonly provenance?: 'generated' | 'reused';
  readonly assetPath?: string;
  readonly sha256?: string;
  readonly byteSize?: number;
  readonly mimeType?: string;
  readonly provider?: string;
  readonly configuredModel?: string;
  readonly returnedModel?: string;
  readonly voice?: string;
  readonly requestId?: string;
  readonly operationId?: string;
  readonly operationIds?: readonly string[];
  readonly generationOperationCount?: number;
  readonly durationSeconds?: number;
  readonly failure?: { readonly code: VidGenErrorCode; readonly message: string };
}

export interface MediaRunMetadata {
  readonly schemaVersion: typeof GENERATED_MEDIA_SCHEMA_VERSION;
  readonly storyRunId: string;
  readonly status: 'running' | 'media_ready' | 'failed';
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly engineVersion: string;
  readonly storyFingerprint: string;
  readonly clipPlanFingerprint: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly referenceImages: readonly ReferenceImageIdentity[];
  readonly units: readonly MediaUnitRecord[];
  readonly generatedUnitCount: number;
  readonly reusedUnitCount: number;
  readonly generationOperationCount: number;
  readonly failure?: { readonly code: VidGenErrorCode; readonly message: string };
}

export interface GeneratedMediaManifest {
  readonly schemaVersion: typeof GENERATED_MEDIA_SCHEMA_VERSION;
  readonly storyRunId: string;
  readonly storyFingerprint: string;
  readonly clipPlanFingerprint: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly referenceImages: readonly ReferenceImageIdentity[];
  readonly assets: readonly MediaUnitRecord[];
}

export interface MediaWorkflowDependencies {
  readonly storyDirectory: string;
  readonly anchorReferencePaths?: readonly string[];
  readonly getTemplate?: (id: string) => AssemblyTemplate;
  /** Constructed only after workspace and local-reference validation. */
  readonly createVideoClient?: () => VideoGenerationClient;
  /** Constructed only if the resolved template has a voiceover unit. */
  readonly createSpeechClient?: () => SpeechGenerationClient;
  readonly now?: () => Date;
  readonly engineVersion?: string;
  readonly maxAnchorReferenceBytes?: number;
  readonly maxGeneratedAssetBytes?: number;
  /** Injectable atomic JSON boundary for focused persistence-failure tests. */
  readonly writeJson?: typeof writeJsonAtomically;
}

export interface MediaWorkflowResult {
  readonly status: 'media_ready';
  readonly storyRunId: string;
  readonly generatedUnitCount: number;
  readonly reusedUnitCount: number;
  readonly manifestPath: string;
}

/** The producer-owned, fully revalidated Phase 2/3 workspace handoff. */
export interface ValidatedPlannedWorkspace {
  readonly directory: string;
  readonly storyRunId: string;
  readonly storyFingerprint: string;
  readonly template: AssemblyTemplate;
  readonly clipPlan: ClipPlan;
  readonly clipPlanFingerprint: string;
}

/** A media-ready Phase 4 handoff, including the already strict manifest. */
export interface ValidatedMediaReadyWorkspace extends ValidatedPlannedWorkspace {
  readonly mediaRun: MediaRunMetadata;
  readonly generatedMedia: GeneratedMediaManifest;
  readonly generatedMediaUnits: readonly GeneratedMediaUnit[];
  readonly generatedMediaFingerprint: string;
}

/**
 * Realizes raw, story-local generated assets from an already successful
 * workspace. It intentionally neither creates a workspace nor plans text.
 */
export async function generateStoryMedia(dependencies: MediaWorkflowDependencies): Promise<MediaWorkflowResult> {
  const now = dependencies.now ?? (() => new Date());
  const engineVersion = dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION;
  const maxReferenceBytes = positiveInteger(dependencies.maxAnchorReferenceBytes ?? DEFAULT_MAX_ANCHOR_REFERENCE_BYTES, 'Anchor-reference byte limit must be positive.');
  const maxAssetBytes = positiveInteger(dependencies.maxGeneratedAssetBytes ?? DEFAULT_MAX_GENERATED_ASSET_BYTES, 'Generated-asset byte limit must be positive.');
  const writeJson = dependencies.writeJson ?? writeJsonAtomically;
  const workspace = await loadValidatedPlannedWorkspace(dependencies.storyDirectory, dependencies.getTemplate ?? getAssemblyTemplate);
  const units = resolveGeneratedMediaUnits(workspace.template, workspace.clipPlan);
  const hasPresenter = units.some((unit) => unit.role.kind === 'presenter');
  const references = await loadApprovedAnchorReferences(dependencies.anchorReferencePaths ?? [], maxReferenceBytes);
  if (hasPresenter) assertApprovedAnchorReferenceCount(references);
  if (!hasPresenter && references.length > 0) {
    throw new VidGenError('invalid_argument', 'Anchor references were supplied but this template has no presenter media units.');
  }

  // All proof of durable state and local input has completed above. No default
  // provider client is constructed until this point.
  const hasVideo = units.some((unit) => unit.role.kind !== 'voiceover');
  const hasSpeech = units.some((unit) => unit.role.kind === 'voiceover');
  const video = hasVideo ? (dependencies.createVideoClient ?? (() => new GoogleVeoVideoGenerationClient()))() : undefined;
  const speech = hasSpeech ? (dependencies.createSpeechClient ?? (() => new GoogleGeminiSpeechGenerationClient()))() : undefined;
  if (video === undefined && hasVideo) throw new VidGenError('configuration', 'Video generation client is unavailable.');
  if (speech === undefined && hasSpeech) throw new VidGenError('configuration', 'Speech generation client is unavailable.');

  const referenceIdentities = references.map((reference) => reference.identity);
  const referenceImages = references.map((reference) => reference.image);
  const inputs = units.map((unit) => ({ unit, fingerprint: effectiveFingerprint(workspace, unit, referenceIdentities, video, speech) }));
  const prior = await readOptionalJson(join(workspace.directory, MEDIA_RUN_ARTIFACT_NAME));
  const startedAt = timestamp(now());
  let records = inputs.map(({ unit, fingerprint }) => pendingRecord(unit, fingerprint));
  let generated = 0;
  let reused = 0;
  let operations = 0;
  await removeIfExists(join(workspace.directory, GENERATED_MEDIA_ARTIFACT_NAME));

  const persist = async (status: MediaRunMetadata['status'], endedAt?: string, failure?: MediaRunMetadata['failure']): Promise<void> => {
    await writeJson({ writeFile, rename, unlink }, join(workspace.directory, MEDIA_RUN_ARTIFACT_NAME), {
      schemaVersion: GENERATED_MEDIA_SCHEMA_VERSION,
      storyRunId: workspace.storyRunId,
      status,
      startedAt,
      ...(endedAt === undefined ? {} : { endedAt }),
      engineVersion,
      storyFingerprint: workspace.storyFingerprint,
      clipPlanFingerprint: workspace.clipPlanFingerprint,
      template: { id: workspace.template.id, version: workspace.template.version },
      referenceImages: referenceIdentities,
      units: records,
      generatedUnitCount: generated,
      reusedUnitCount: reused,
      generationOperationCount: operations,
      ...(failure === undefined ? {} : { failure }),
    } satisfies MediaRunMetadata, prettyJson);
  };

  try {
    await persist('running');
    for (let index = 0; index < inputs.length; index += 1) {
      const { unit, fingerprint } = inputs[index]!;
      const priorRecord = reusablePriorRecord(prior, workspace, unit, fingerprint);
      if (priorRecord !== undefined && await isReusableFile(workspace.directory, priorRecord, unit)) {
        records[index] = { ...priorRecord, provenance: 'reused', status: 'ready' };
        reused += 1;
        await persist('running');
        continue;
      }
      const result = unit.role.kind === 'voiceover'
        ? await speech!.generateSpeech({ unit })
        : await video!.generateVideo(unit.role.kind === 'presenter' ? { unit, referenceImages } : { unit });
      const ready = await persistGeneratedResult(workspace.directory, unit, fingerprint, result, maxAssetBytes, video, speech);
      records[index] = ready;
      generated += 1;
      operations += result.generationOperationCount ?? 1;
      await persist('running');
    }
    const manifest: GeneratedMediaManifest = {
      schemaVersion: GENERATED_MEDIA_SCHEMA_VERSION,
      storyRunId: workspace.storyRunId,
      storyFingerprint: workspace.storyFingerprint,
      clipPlanFingerprint: workspace.clipPlanFingerprint,
      template: { id: workspace.template.id, version: workspace.template.version },
      referenceImages: referenceIdentities,
      assets: records,
    };
    validateGeneratedMediaManifest(manifest, workspace, units);
    await writeJson({ writeFile, rename, unlink }, join(workspace.directory, GENERATED_MEDIA_ARTIFACT_NAME), manifest, prettyJson);
    try {
      await persist('media_ready', timestamp(now()));
    } catch (cause) {
      await removeIfExists(join(workspace.directory, GENERATED_MEDIA_ARTIFACT_NAME));
      throw cause;
    }
    return { status: 'media_ready', storyRunId: workspace.storyRunId, generatedUnitCount: generated, reusedUnitCount: reused, manifestPath: join(workspace.directory, GENERATED_MEDIA_ARTIFACT_NAME) };
  } catch (cause) {
    const safe = sanitizeMediaError(cause);
    try { await persist('failed', timestamp(now()), { code: safe.code, message: safe.publicMessage }); } catch { /* best effort */ }
    throw safe;
  }
}

/** Hashes the fully validated durable ClipPlan without changing its schema. */
export function fingerprintClipPlan(clipPlan: ClipPlan): string {
  return sha256(canonicalJson(clipPlan));
}

/**
 * Hashes the fully validated provider-neutral handoff. Asset byte hashes are
 * already durable members of the manifest and are not reread here.
 */
export function fingerprintGeneratedMediaManifest(manifest: GeneratedMediaManifest): string {
  return sha256(canonicalJson(manifest));
}

/** Validates the strict, provider-neutral Phase 5 manifest semantics. */
export function validateGeneratedMediaManifest(value: unknown, workspace: Pick<ValidatedPlannedWorkspace, 'storyRunId' | 'storyFingerprint' | 'clipPlanFingerprint' | 'template'>, units: readonly GeneratedMediaUnit[]): GeneratedMediaManifest {
  const manifest = object(value, 'Generated-media manifest');
  rejectExtra(manifest, ['schemaVersion', 'storyRunId', 'storyFingerprint', 'clipPlanFingerprint', 'template', 'referenceImages', 'assets'], 'Generated-media manifest');
  if (manifest.schemaVersion !== GENERATED_MEDIA_SCHEMA_VERSION || manifest.storyRunId !== workspace.storyRunId || manifest.storyFingerprint !== workspace.storyFingerprint || manifest.clipPlanFingerprint !== workspace.clipPlanFingerprint) throw invalidMedia('Generated-media manifest identity does not match the workspace.');
  const template = object(manifest.template, 'Generated-media manifest.template');
  if (template.id !== workspace.template.id || template.version !== workspace.template.version) throw invalidMedia('Generated-media manifest template does not match the workspace.');
  if (!Array.isArray(manifest.referenceImages) || !Array.isArray(manifest.assets) || manifest.assets.length !== units.length) throw invalidMedia('Generated-media manifest is incomplete.');
  const referenceImages = manifest.referenceImages.map((item, index) => validateReferenceIdentity(item, index + 1));
  const assets = manifest.assets.map((item, index) => validateReadyRecord(item, units[index]!));
  return { schemaVersion: GENERATED_MEDIA_SCHEMA_VERSION, storyRunId: workspace.storyRunId, storyFingerprint: workspace.storyFingerprint, clipPlanFingerprint: workspace.clipPlanFingerprint, template: { id: workspace.template.id, version: workspace.template.version }, referenceImages, assets };
}

/**
 * Loads the producer-owned story and ClipPlan artifacts without creating or
 * changing anything. Consumers must use this instead of re-parsing semantics.
 */
export async function loadValidatedPlannedWorkspace(directoryInput: string, getTemplate: (id: string) => AssemblyTemplate = getAssemblyTemplate): Promise<ValidatedPlannedWorkspace> {
  if (typeof directoryInput !== 'string' || directoryInput.trim().length === 0) throw new VidGenError('invalid_argument', '--story-dir requires a non-empty directory.');
  const directory = normalize(directoryInput);
  const storyRun = object(await readJson(join(directory, STORY_RUN_ARTIFACT_NAME)), 'story-run metadata');
  const clipRun = object(await readJson(join(directory, CLIP_PLAN_RUN_ARTIFACT_NAME)), 'clip-plan-run metadata');
  validateStoryRun(storyRun); validateClipRun(clipRun);
  if (storyRun.storyRunId !== clipRun.storyRunId || storyRun.storyFingerprint !== clipRun.storyFingerprint || !sameTemplate(storyRun.template, clipRun.template)) throw invalidMedia('Story and ClipPlan metadata do not agree.');
  if (clipRun.clipPlanArtifact !== CLIP_PLAN_ARTIFACT_NAME) throw invalidMedia('ClipPlan metadata does not identify the expected ClipPlan artifact.');
  const template = getTemplate(stringValue(storyRun.template, 'id'));
  if (template.version !== stringValue(storyRun.template, 'version')) throw invalidMedia('Workspace template version does not match the current registry.');
  const clipPlan = validateClipPlanForStoryFingerprint(await readJson(join(directory, CLIP_PLAN_ARTIFACT_NAME)), stringValue(storyRun, 'storyFingerprint'), template);
  return { directory, storyRunId: stringValue(storyRun, 'storyRunId'), storyFingerprint: stringValue(storyRun, 'storyFingerprint'), template, clipPlan, clipPlanFingerprint: fingerprintClipPlan(clipPlan) };
}

/**
 * Proves that Phase 4 reached terminal success and returns its strict
 * provider-neutral handoff. It deliberately does not read or regenerate asset
 * bytes; the assembly consumer performs that current-file check before use.
 */
export async function loadValidatedMediaReadyWorkspace(
  directoryInput: string,
  getTemplate: (id: string) => AssemblyTemplate = getAssemblyTemplate,
): Promise<ValidatedMediaReadyWorkspace> {
  const workspace = await loadValidatedPlannedWorkspace(directoryInput, getTemplate);
  const mediaRun = validateMediaRunMetadata(
    object(await readJson(join(workspace.directory, MEDIA_RUN_ARTIFACT_NAME)), 'Media-run metadata'),
  );
  if (mediaRun.storyRunId !== workspace.storyRunId || mediaRun.storyFingerprint !== workspace.storyFingerprint
    || mediaRun.clipPlanFingerprint !== workspace.clipPlanFingerprint
    || !sameTemplate(mediaRun.template, { id: workspace.template.id, version: workspace.template.version })) {
    throw invalidMedia('Media-run metadata identity does not match the workspace.');
  }
  if (mediaRun.status !== 'media_ready') throw invalidMedia('Media-run is not media_ready.');
  const units = resolveGeneratedMediaUnits(workspace.template, workspace.clipPlan);
  const generatedMedia = validateGeneratedMediaManifest(
    await readJson(join(workspace.directory, GENERATED_MEDIA_ARTIFACT_NAME)), workspace, units,
  );
  return {
    ...workspace,
    mediaRun,
    generatedMedia,
    generatedMediaUnits: units,
    generatedMediaFingerprint: fingerprintGeneratedMediaManifest(generatedMedia),
  };
}

function validateStoryRun(value: Record<string, unknown>): void {
  rejectExtra(value, ['storyRunId', 'status', 'startedAt', 'endedAt', 'engineVersion', 'articleId', 'storyFingerprint', 'sourceInputFingerprint', 'storyInputArtifact', 'template', 'generatedAssetRoles', 'standardizedAssetRoles', 'failure'], 'Story-run metadata');
  if (value.status !== 'story_ready' || !isSafeId(value.storyRunId) || !isHash(value.storyFingerprint) || !isTemplate(value.template)) throw invalidMedia('Story workspace is not a valid story_ready workspace.');
}
function validateClipRun(value: Record<string, unknown>): void {
  rejectExtra(value, ['storyRunId', 'status', 'startedAt', 'endedAt', 'engineVersion', 'storyFingerprint', 'template', 'provider', 'configuredModel', 'returnedModel', 'requestId', 'clipPlanArtifact', 'failure'], 'ClipPlan-run metadata');
  if (value.status !== 'clip_plan_ready' || !isSafeId(value.storyRunId) || !isHash(value.storyFingerprint) || !isTemplate(value.template) || value.clipPlanArtifact !== CLIP_PLAN_ARTIFACT_NAME) throw invalidMedia('Workspace is not a valid clip_plan_ready workspace.');
}

function validateMediaRunMetadata(value: Record<string, unknown>): MediaRunMetadata {
  rejectExtra(value, ['schemaVersion', 'storyRunId', 'status', 'startedAt', 'endedAt', 'engineVersion', 'storyFingerprint', 'clipPlanFingerprint', 'template', 'referenceImages', 'units', 'generatedUnitCount', 'reusedUnitCount', 'generationOperationCount', 'failure'], 'Media-run metadata');
  if (value.schemaVersion !== GENERATED_MEDIA_SCHEMA_VERSION || !isSafeId(value.storyRunId)
    || (value.status !== 'running' && value.status !== 'media_ready' && value.status !== 'failed')
    || typeof value.startedAt !== 'string' || value.startedAt.trim().length === 0
    || typeof value.engineVersion !== 'string' || value.engineVersion.trim().length === 0
    || (value.status === 'media_ready' && (typeof value.endedAt !== 'string' || value.endedAt.trim().length === 0))
    || !isHash(value.storyFingerprint) || !isHash(value.clipPlanFingerprint) || !isTemplate(value.template)
    || !Array.isArray(value.referenceImages) || !Array.isArray(value.units)
    || !Number.isSafeInteger(value.generatedUnitCount) || (value.generatedUnitCount as number) < 0
    || !Number.isSafeInteger(value.reusedUnitCount) || (value.reusedUnitCount as number) < 0
    || !Number.isSafeInteger(value.generationOperationCount) || (value.generationOperationCount as number) < 0
    || value.units.length !== (value.generatedUnitCount as number) + (value.reusedUnitCount as number)) {
    throw invalidMedia('Media-run metadata is malformed.');
  }
  return value as MediaRunMetadata;
}

function effectiveFingerprint(workspace: ValidatedPlannedWorkspace, unit: GeneratedMediaUnit, references: readonly ReferenceImageIdentity[], video?: VideoGenerationClient, speech?: SpeechGenerationClient): string {
  const isSpeech = unit.role.kind === 'voiceover';
  const client = isSpeech ? speech : video;
  if (client === undefined) throw new VidGenError('configuration', 'Required generated-media client is unavailable.');
  return sha256(canonicalJson({ contractVersion: GENERATED_MEDIA_INPUT_CONTRACT_VERSION, clipPlanFingerprint: workspace.clipPlanFingerprint, template: { id: workspace.template.id, version: workspace.template.version }, unit, provider: client.provider, configuredModel: client.model, ...(isSpeech ? { voice: speech!.voice } : {}), ...(unit.role.kind === 'presenter' ? { referenceImages: references.map(({ sha256: hash, mimeType }) => ({ sha256: hash, mimeType })) } : {}), ...(isSpeech ? {} : { requestMode: 'veo-portrait-720p' }) }));
}

function pendingRecord(unit: GeneratedMediaUnit, fingerprint: string): MediaUnitRecord { return { unitId: unit.unitId, segment: unit.segment, role: unit.role, effectiveGenerationInputFingerprint: fingerprint, status: 'pending' }; }
async function persistGeneratedResult(directory: string, unit: GeneratedMediaUnit, fingerprint: string, result: VideoGenerationResult | SpeechGenerationResult, maxBytes: number, video?: VideoGenerationClient, speech?: SpeechGenerationClient): Promise<MediaUnitRecord> {
  const expected = expectedAsset(unit);
  if (result.bytes.byteLength < 1 || result.bytes.byteLength > maxBytes || result.mimeType !== expected.mimeType) throw invalidMedia('Generated provider output has an unsupported media type or size.');
  const assetPath = expected.path;
  await writeBinaryAtomically(join(directory, ...assetPath.split('/')), result.bytes);
  const provider = result.provider;
  const configuredModel = unit.role.kind === 'voiceover' ? speech!.model : video!.model;
  return { unitId: unit.unitId, segment: unit.segment, role: unit.role, effectiveGenerationInputFingerprint: fingerprint, status: 'ready', provenance: 'generated', assetPath, sha256: sha256(result.bytes), byteSize: result.bytes.byteLength, mimeType: result.mimeType, provider, configuredModel, returnedModel: result.model, ...(unit.role.kind === 'voiceover' ? { voice: (result as SpeechGenerationResult).voice } : {}), ...(result.requestId === undefined ? {} : { requestId: result.requestId }), ...(result.operationId === undefined ? {} : { operationId: result.operationId }), ...('operationIds' in result && result.operationIds !== undefined ? { operationIds: result.operationIds } : {}), ...('generationOperationCount' in result && result.generationOperationCount !== undefined ? { generationOperationCount: result.generationOperationCount } : {}), ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }) };
}

function reusablePriorRecord(prior: unknown, workspace: ValidatedPlannedWorkspace, unit: GeneratedMediaUnit, fingerprint: string): MediaUnitRecord | undefined {
  // A failed attempt may still have honestly persisted ready records from
  // earlier units. Their own identity and byte checks remain the authority.
  if (prior === undefined || !isRecord(prior) || (prior.status !== 'media_ready' && prior.status !== 'failed' && prior.status !== 'running') || prior.storyRunId !== workspace.storyRunId || prior.storyFingerprint !== workspace.storyFingerprint || prior.clipPlanFingerprint !== workspace.clipPlanFingerprint || !sameTemplate(prior.template, { id: workspace.template.id, version: workspace.template.version }) || !Array.isArray(prior.units)) return undefined;
  const match = prior.units.find((record) => isRecord(record) && record.unitId === unit.unitId);
  if (!isRecord(match)) return undefined;
  try { const ready = validateReadyRecord(match, unit); return ready.effectiveGenerationInputFingerprint === fingerprint ? ready : undefined; } catch { return undefined; }
}
async function isReusableFile(directory: string, record: MediaUnitRecord, unit: GeneratedMediaUnit): Promise<boolean> {
  const expected = expectedAsset(unit);
  if (record.assetPath !== expected.path || record.mimeType !== expected.mimeType || record.sha256 === undefined || record.byteSize === undefined || !safeRelativePath(record.assetPath)) return false;
  try { const bytes = new Uint8Array(await readFile(join(directory, ...record.assetPath.split('/')))); return bytes.byteLength === record.byteSize && sha256(bytes) === record.sha256; } catch { return false; }
}

function expectedAsset(unit: GeneratedMediaUnit): { path: string; mimeType: string } { return unit.role.kind === 'voiceover' ? { path: `assets/audio/${unit.unitId}.wav`, mimeType: 'audio/wav' } : unit.role.kind === 'presenter' ? { path: `assets/presenter/${unit.unitId}.mp4`, mimeType: 'video/mp4' } : { path: `assets/video/${unit.unitId}.mp4`, mimeType: 'video/mp4' }; }
async function writeBinaryAtomically(path: string, bytes: Uint8Array): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${randomUUID()}`; let made = false; try { await writeFile(temporary, bytes); made = true; await rename(temporary, path); } catch (cause) { if (made) try { await unlink(temporary); } catch {} throw new VidGenError('artifact', 'Unable to persist generated media asset.', { cause }); } }
async function readJson(path: string): Promise<unknown> { try { return JSON.parse(await readFile(path, 'utf8')) as unknown; } catch (cause) { throw new VidGenError('artifact', 'Unable to read required planned workspace artifacts.', { cause }); } }
async function readOptionalJson(path: string): Promise<unknown | undefined> { try { return await readJson(path); } catch { return undefined; } }
async function removeIfExists(path: string): Promise<void> { try { await rm(path); } catch (cause: any) { if (cause?.code !== 'ENOENT') throw new VidGenError('artifact', 'Unable to invalidate generated-media manifest.', { cause }); } }

function validateReadyRecord(value: unknown, unit: GeneratedMediaUnit): MediaUnitRecord { const record = object(value, 'Generated-media asset'); rejectExtra(record, ['unitId', 'segment', 'role', 'effectiveGenerationInputFingerprint', 'status', 'provenance', 'assetPath', 'sha256', 'byteSize', 'mimeType', 'provider', 'configuredModel', 'returnedModel', 'voice', 'requestId', 'operationId', 'operationIds', 'generationOperationCount', 'durationSeconds', 'failure'], 'Generated-media asset'); if (record.status !== 'ready' || record.unitId !== unit.unitId || !sameSegment(record.segment, unit.segment) || !sameRole(record.role, unit.role) || !isHash(record.effectiveGenerationInputFingerprint) || typeof record.assetPath !== 'string' || !safeRelativePath(record.assetPath) || !isHash(record.sha256) || !Number.isSafeInteger(record.byteSize) || record.byteSize < 1 || typeof record.mimeType !== 'string' || typeof record.provider !== 'string' || typeof record.configuredModel !== 'string' || typeof record.returnedModel !== 'string') throw invalidMedia('Generated-media manifest contains an invalid asset.'); if (record.assetPath !== expectedAsset(unit).path || record.mimeType !== expectedAsset(unit).mimeType) throw invalidMedia('Generated-media manifest asset path or media type is incompatible.'); return record as MediaUnitRecord; }
function validateReferenceIdentity(value: unknown, ordinal: number): ReferenceImageIdentity { const reference = object(value, 'Generated-media reference'); rejectExtra(reference, ['ordinal', 'basename', 'mimeType', 'sha256', 'byteSize'], 'Generated-media reference'); if (reference.ordinal !== ordinal || typeof reference.basename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(reference.basename) || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType as string) || !isHash(reference.sha256) || !Number.isSafeInteger(reference.byteSize) || (reference.byteSize as number) < 1) throw invalidMedia('Generated-media manifest contains an invalid reference identity.'); return reference as ReferenceImageIdentity; }
function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function timestamp(date: Date): string { if (Number.isNaN(date.valueOf())) throw new VidGenError('invalid_argument', 'Media clock produced an invalid timestamp.'); return date.toISOString(); }
function sanitizeMediaError(error: unknown): VidGenError { if (!isVidGenError(error)) return new VidGenError('unexpected', 'Generated-media workflow failed unexpectedly.'); return error.code === 'generated_media' || error.code === 'artifact' || error.code === 'configuration' || error.code === 'invalid_argument' ? error : new VidGenError(error.code, 'Generated-media workflow failed.'); }
function object(value: unknown, name: string): Record<string, unknown> { if (!isRecord(value)) throw invalidMedia(`${name} is malformed.`); return value; }
function rejectExtra(value: Record<string, unknown>, allowed: readonly string[], name: string): void { if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidMedia(`${name} contains unsupported fields.`); }
function stringValue(value: Record<string, unknown>, key: string): string { if (typeof value[key] !== 'string') throw invalidMedia('Workspace metadata is malformed.'); return value[key] as string; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isSafeId(value: unknown): boolean { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value); }
function isHash(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function isTemplate(value: unknown): value is Record<string, unknown> { return isRecord(value) && typeof value.id === 'string' && value.id.trim().length > 0 && typeof value.version === 'string' && value.version.trim().length > 0; }
function sameTemplate(left: unknown, right: unknown): boolean { return isTemplate(left) && isTemplate(right) && left.id === right.id && left.version === right.version; }
function sameSegment(left: unknown, right: GeneratedMediaUnit['segment']): boolean { return isRecord(left) && left.id === right.id && left.startSeconds === right.startSeconds && left.endSeconds === right.endSeconds; }
function sameRole(left: unknown, right: GeneratedMediaUnit['role']): boolean { return isRecord(left) && left.id === right.id && left.kind === right.kind; }
function safeRelativePath(path: string): boolean { return typeof path === 'string' && path.includes('\\') === false && isAbsolute(path) === false && path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..'); }
function positiveInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function invalidMedia(message: string): VidGenError { return new VidGenError('generated_media', message); }
