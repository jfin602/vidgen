import { join, resolve } from 'node:path';

import {
  loadValidatedMediaReadyWorkspace,
  type ValidatedMediaReadyWorkspace,
} from './media-workflow.ts';
import type { AssemblyTemplate, AssemblyTemplateOutput } from '../core/assembly-template.ts';
import { VidGenError } from '../core/error.ts';
import type { GeneratedMediaUnit } from '../core/generated-media.ts';
import {
  probeLocalMedia,
  type FfprobeDependencies,
  type LocalMediaProbe,
} from '../integrations/ffmpeg/ffprobe.ts';
import {
  identifyLocalFile,
  type LocalFileIdentity,
} from '../integrations/ffmpeg/local-file.ts';

/** One frame at the fixed output rate: allowed only for probe/container rounding. */
export const MEDIA_DURATION_TOLERANCE_SECONDS = 1 / 30;

export interface StandardizedAssetRequest {
  readonly introPath?: string;
  readonly outroPath?: string;
}

export interface QualifiedMediaFile {
  readonly identity: LocalFileIdentity;
  readonly probe: LocalMediaProbe;
}

export interface QualifiedGeneratedMediaFile extends QualifiedMediaFile {
  readonly unitId: string;
  readonly role: GeneratedMediaUnit['role'];
  readonly segment: GeneratedMediaUnit['segment'];
  readonly targetDurationSeconds: number;
}

export interface AssemblyPlanStorySegment {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly targetDurationSeconds: number;
  readonly visual: QualifiedGeneratedMediaFile;
  readonly voiceover?: QualifiedGeneratedMediaFile;
  readonly displayText: readonly string[];
}

/** P2-ready, execution-only composition facts; it is never persisted by P1. */
export interface AssemblyPlan {
  readonly storyRunId: string;
  readonly storyFingerprint: string;
  readonly clipPlanFingerprint: string;
  readonly generatedMediaFingerprint: string;
  /** Durable template identity retained for final assembly provenance. */
  readonly template: { readonly id: string; readonly version: string };
  readonly output: AssemblyTemplateOutput;
  readonly standardizedAssets: {
    readonly intro?: QualifiedMediaFile;
    readonly outro?: QualifiedMediaFile;
  };
  readonly storyDurationSeconds: number;
  readonly expectedFinalDurationSeconds: number;
  readonly storySegments: readonly AssemblyPlanStorySegment[];
}

export interface AssemblyInputDependencies extends StandardizedAssetRequest {
  readonly storyDirectory: string;
  readonly maxLocalMediaBytes?: number;
  readonly getTemplate?: (id: string) => AssemblyTemplate;
  readonly probe?: (path: string, dependencies?: FfprobeDependencies) => Promise<LocalMediaProbe>;
  readonly ffprobe?: FfprobeDependencies;
}

/**
 * Phase 5 P1's strict consumer boundary. It neither writes artifacts nor
 * invokes providers/rendering; all successful facts are current local facts.
 */
export async function qualifyAssemblyInputs(dependencies: AssemblyInputDependencies): Promise<AssemblyPlan> {
  const workspace = await loadValidatedMediaReadyWorkspace(dependencies.storyDirectory, dependencies.getTemplate);
  const maxBytes = dependencies.maxLocalMediaBytes;
  const generated = await identifyGeneratedAssets(workspace, maxBytes);
  const standardized = await identifyStandardizedAssets(workspace.template, dependencies, maxBytes);
  const probe = dependencies.probe ?? probeLocalMedia;

  // Identity checks for every generated file intentionally finish before the
  // first probe, so stale Phase 4 state cannot reach an executable boundary.
  const qualifiedGenerated: QualifiedGeneratedMediaFile[] = [];
  for (const item of generated) {
    const facts = await probe(item.identity.path, dependencies.ffprobe);
    requireGeneratedStreamShape(item.unit, facts);
    requireGeneratedContainer(item.unit, facts);
    requireDuration(item.unit, facts);
    qualifiedGenerated.push({
      identity: item.identity,
      probe: facts,
      unitId: item.unit.unitId,
      role: item.unit.role,
      segment: item.unit.segment,
      targetDurationSeconds: item.unit.targetDurationSeconds,
    });
  }
  const qualifiedStandardized: AssemblyPlan['standardizedAssets'] = {};
  if (standardized.intro !== undefined) {
    const facts = await probe(standardized.intro.path, dependencies.ffprobe);
    requireVideoStreamShape(facts, 'Standardized media');
    requirePositiveDuration(facts, 'Standardized media');
    qualifiedStandardized.intro = { identity: standardized.intro, probe: facts };
  }
  if (standardized.outro !== undefined) {
    const facts = await probe(standardized.outro.path, dependencies.ffprobe);
    requireVideoStreamShape(facts, 'Standardized media');
    requirePositiveDuration(facts, 'Standardized media');
    qualifiedStandardized.outro = { identity: standardized.outro, probe: facts };
  }
  return buildAssemblyPlan(workspace, qualifiedGenerated, qualifiedStandardized);
}

/** Pure subset resolver, exported for focused non-default template coverage. */
export function buildAssemblyPlan(
  workspace: Pick<ValidatedMediaReadyWorkspace, 'storyRunId' | 'storyFingerprint' | 'clipPlanFingerprint' | 'generatedMediaFingerprint' | 'template' | 'clipPlan' | 'generatedMediaUnits'>,
  generatedAssets: readonly QualifiedGeneratedMediaFile[],
  standardizedAssets: AssemblyPlan['standardizedAssets'],
): AssemblyPlan {
  const byUnit = new Map(generatedAssets.map((asset) => [asset.unitId, asset]));
  if (byUnit.size !== workspace.generatedMediaUnits.length) throw invalidAssembly('Qualified generated media is incomplete.');
  const slotById = new Map(workspace.template.contentSlots.map((slot) => [slot.id, slot]));
  const textById = new Map(workspace.clipPlan.slots.map((slot) => [slot.id, slot.text]));
  const storySegments = workspace.template.segments.map((segment) => {
    const units = workspace.generatedMediaUnits.filter((unit) => sameSegment(unit.segment, segment));
    const visual = units.filter((unit) => unit.role.kind === 'presenter' || unit.role.kind === 'video');
    const voiceovers = units.filter((unit) => unit.role.kind === 'voiceover');
    if (visual.length === 0) throw invalidAssembly('Assembly requires exactly one visual generated-media unit per story segment.');
    if (visual.length > 1) throw invalidAssembly('Assembly supports only one visual generated-media unit per story segment.');
    if (voiceovers.length > 1) throw invalidAssembly('Assembly supports only one voiceover generated-media unit per story segment.');
    const visualAsset = byUnit.get(visual[0]!.unitId);
    if (visualAsset === undefined) throw invalidAssembly('Qualified generated media is incomplete.');
    const voiceoverUnit = voiceovers[0];
    const voiceover = voiceoverUnit === undefined ? undefined : byUnit.get(voiceoverUnit.unitId);
    if (voiceoverUnit !== undefined && voiceover === undefined) throw invalidAssembly('Qualified generated media is incomplete.');
    const displayText = segment.contentSlots
      .filter((id) => slotById.get(id)?.usage === 'display')
      .map((id) => textById.get(id))
      .filter((text): text is string => text !== undefined);
    return {
      id: segment.id,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      targetDurationSeconds: segment.endSeconds - segment.startSeconds,
      visual: visualAsset,
      ...(voiceover === undefined ? {} : { voiceover }),
      displayText,
    };
  });
  const storyDurationSeconds = workspace.template.segments.at(-1)!.endSeconds;
  return {
    storyRunId: workspace.storyRunId,
    storyFingerprint: workspace.storyFingerprint,
    clipPlanFingerprint: workspace.clipPlanFingerprint,
    generatedMediaFingerprint: workspace.generatedMediaFingerprint,
    template: { id: workspace.template.id, version: workspace.template.version },
    output: workspace.template.output,
    standardizedAssets,
    storyDurationSeconds,
    expectedFinalDurationSeconds: storyDurationSeconds + (standardizedAssets.intro?.probe.durationSeconds ?? 0) + (standardizedAssets.outro?.probe.durationSeconds ?? 0),
    storySegments,
  };
}

async function identifyGeneratedAssets(workspace: ValidatedMediaReadyWorkspace, maxBytes: number | undefined): Promise<readonly { readonly unit: GeneratedMediaUnit; readonly identity: LocalFileIdentity }[]> {
  const found: { unit: GeneratedMediaUnit; identity: LocalFileIdentity }[] = [];
  for (const [index, unit] of workspace.generatedMediaUnits.entries()) {
    const record = workspace.generatedMedia.assets[index]!;
    const assetPath = record.assetPath!;
    const identity = await identifyLocalFile(join(workspace.directory, ...assetPath.split('/')), { maxBytes });
    if (identity.byteSize !== record.byteSize || identity.sha256 !== record.sha256) {
      throw invalidAssembly('Generated media bytes no longer match the Phase 4 manifest.');
    }
    found.push({ unit, identity });
  }
  return found;
}

async function identifyStandardizedAssets(template: AssemblyTemplate, request: StandardizedAssetRequest, maxBytes: number | undefined): Promise<Partial<Record<'intro' | 'outro', LocalFileIdentity>>> {
  const roles = new Map(template.standardizedAssetRoles.map((role) => [role.id, role.placement]));
  if (roles.size !== 2 || roles.get('intro') !== 'before-story' || roles.get('outro') !== 'after-story') {
    throw invalidAssembly('Template standardized asset roles are unsupported for assembly.');
  }
  const intro = request.introPath === undefined ? undefined : await identifyLocalFile(request.introPath, { maxBytes });
  const outro = request.outroPath === undefined ? undefined : await identifyLocalFile(request.outroPath, { maxBytes });
  if (intro !== undefined && outro !== undefined && samePath(intro.path, outro.path)) throw invalidAssembly('Standardized intro and outro must be distinct local media files.');
  return { ...(intro === undefined ? {} : { intro }), ...(outro === undefined ? {} : { outro }) };
}

function requireGeneratedStreamShape(unit: GeneratedMediaUnit, facts: LocalMediaProbe): void {
  if (unit.role.kind === 'voiceover') {
    if (facts.streamTypes.length !== 1 || facts.streamTypes[0] !== 'audio' || facts.audio === undefined || facts.video !== undefined) {
      throw invalidAssembly('Generated voiceover media has an unsupported stream layout.');
    }
    return;
  }
  requireVideoStreamShape(facts, 'Generated visual media');
}
function requireVideoStreamShape(facts: LocalMediaProbe, label: string): void {
  const videos = facts.streamTypes.filter((type) => type === 'video').length;
  const audio = facts.streamTypes.filter((type) => type === 'audio').length;
  if (videos !== 1 || audio > 1 || facts.streamTypes.length !== videos + audio || facts.video === undefined) {
    throw invalidAssembly(`${label} has an unsupported stream layout.`);
  }
}
function requireGeneratedContainer(unit: GeneratedMediaUnit, facts: LocalMediaProbe): void {
  const expected = unit.role.kind === 'voiceover' ? 'wav' : 'mp4';
  if (!facts.containerNames.includes(expected)) throw invalidAssembly('Generated media container does not match its required local format.');
}
function requireDuration(unit: GeneratedMediaUnit, facts: LocalMediaProbe): void {
  requirePositiveDuration(facts, 'Generated media');
  if (unit.role.kind === 'voiceover') {
    if (facts.durationSeconds > unit.targetDurationSeconds + MEDIA_DURATION_TOLERANCE_SECONDS) {
      throw invalidAssembly('Generated voiceover exceeds its target story segment duration.');
    }
  } else if (facts.durationSeconds + MEDIA_DURATION_TOLERANCE_SECONDS < unit.targetDurationSeconds) {
    throw invalidAssembly('Generated visual media is shorter than its target story segment duration.');
  }
}
function requirePositiveDuration(facts: LocalMediaProbe, label: string): void {
  if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0) throw invalidAssembly(`${label} has an invalid duration.`);
}
function sameSegment(unit: GeneratedMediaUnit['segment'], segment: { readonly id: string; readonly startSeconds: number; readonly endSeconds: number }): boolean { return unit.id === segment.id && unit.startSeconds === segment.startSeconds && unit.endSeconds === segment.endSeconds; }
function samePath(left: string, right: string): boolean { return process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right); }
function invalidAssembly(message: string): VidGenError { return new VidGenError('assembly', message); }
