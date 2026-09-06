import { createHash } from 'node:crypto';

import type { AssemblyTemplate, AssemblyTemplateSegment } from './assembly-template.ts';
import { validateClipPlanForStoryFingerprint, type ClipPlan } from './clip-plan.ts';
import { VidGenError } from './error.ts';
import { canonicalJson } from '../shared/canonical-json.ts';

/** One template-declared content value required to realize a generated-media unit. */
export interface GeneratedMediaContentValue {
  readonly slotId: string;
  readonly usage: 'spoken' | 'display';
  readonly text: string;
}

/**
 * One generated-media requirement for one segment-role reference. It contains
 * only template timing/role requirements and validated ClipPlan content.
 */
export interface GeneratedMediaUnit {
  readonly unitId: string;
  readonly segment: {
    readonly id: string;
    readonly startSeconds: number;
    readonly endSeconds: number;
  };
  readonly role: {
    readonly id: string;
    readonly kind: 'presenter' | 'video' | 'voiceover';
  };
  readonly targetDurationSeconds: number;
  readonly content: readonly GeneratedMediaContentValue[];
  readonly spokenText: string;
}

/**
 * Resolves exactly one unit for every generated role reference, in template
 * segment order and then segment role order. Standardized asset roles are not
 * generated-media units.
 */
export function resolveGeneratedMediaUnits(
  template: AssemblyTemplate,
  clipPlan: ClipPlan,
): readonly GeneratedMediaUnit[] {
  const validatedPlan = validateClipPlanForStoryFingerprint(
    clipPlan,
    clipPlan.storyFingerprint,
    template,
  );
  const slotsById = new Map(validatedPlan.slots.map((slot) => [slot.id, slot.text]));
  const templateSlotsById = new Map(template.contentSlots.map((slot) => [slot.id, slot]));
  const rolesById = new Map(template.generatedAssetRoles.map((role) => [role.id, role]));
  const units: GeneratedMediaUnit[] = [];

  for (const segment of template.segments) {
    const content = resolveSegmentContent(segment, slotsById, templateSlotsById);
    const spokenText = content
      .filter((slot) => slot.usage === 'spoken')
      .map((slot) => slot.text)
      .join('\n');

    for (const roleId of segment.generatedAssetRoles) {
      const role = rolesById.get(roleId);
      if (role === undefined) {
        throw invalidGeneratedMedia('Generated media requirements could not be resolved.');
      }
      if (role.kind === 'voiceover' && spokenText.length === 0) {
        throw invalidGeneratedMedia('A voiceover generated-media unit requires spoken template content.');
      }
      units.push({
        unitId: formatUnitId(units.length + 1),
        segment: { id: segment.id, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds },
        role: { id: role.id, kind: role.kind },
        targetDurationSeconds: segment.endSeconds - segment.startSeconds,
        content,
        spokenText,
      });
    }
  }

  return units;
}

/**
 * Hashes the complete VidGen-owned semantic input of a resolved unit: stable
 * unit ordinal, segment timing/identity, role identity/kind, target duration,
 * ordered slot values, and derived spoken text. Provider configuration and
 * reference images deliberately remain outside this template-level identity.
 */
export function fingerprintGeneratedMediaUnit(unit: GeneratedMediaUnit): string {
  return createHash('sha256').update(canonicalJson({
    unitId: unit.unitId,
    segment: unit.segment,
    role: unit.role,
    targetDurationSeconds: unit.targetDurationSeconds,
    content: unit.content,
    spokenText: unit.spokenText,
  })).digest('hex');
}

/** A VidGen-approved, in-memory presenter reference image; no remote URL crosses this boundary. */
export interface ApprovedReferenceImage {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** Creates a reference-image value with a VidGen-computed byte identity. */
export function createApprovedReferenceImage(
  mimeType: string,
  bytes: Uint8Array,
): ApprovedReferenceImage {
  if (mimeType.trim().length === 0 || bytes.length === 0) {
    throw invalidGeneratedMedia('An approved reference image requires MIME type and bytes.');
  }
  return {
    mimeType,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Provider-neutral video generation configuration and call boundary. */
export interface VideoGenerationClient {
  readonly provider: string;
  /** The stable configured model identity, available before a provider call. */
  readonly model: string;
  generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

export interface VideoGenerationRequest {
  readonly unit: GeneratedMediaUnit;
  readonly referenceImages?: readonly ApprovedReferenceImage[];
}

export interface VideoGenerationResult {
  readonly provider: string;
  readonly model: string;
  readonly requestId?: string;
  readonly operationId?: string;
  /** Ordered provider operation identifiers, including deterministic extensions. */
  readonly operationIds?: readonly string[];
  /** Number of provider generation operations used to produce these raw bytes. */
  readonly generationOperationCount?: number;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /** Raw provider coverage, not a claim about final assembled media timing. */
  readonly durationSeconds?: number;
}

/** Provider-neutral speech generation configuration and call boundary. */
export interface SpeechGenerationClient {
  readonly provider: string;
  /** The stable configured model identity, available before a provider call. */
  readonly model: string;
  /** The stable configured voice identity, available before a provider call. */
  readonly voice: string;
  generateSpeech(request: SpeechGenerationRequest): Promise<SpeechGenerationResult>;
}

export interface SpeechGenerationRequest {
  readonly unit: GeneratedMediaUnit;
}

export interface SpeechGenerationResult {
  readonly provider: string;
  readonly model: string;
  readonly voice: string;
  readonly requestId?: string;
  readonly operationId?: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly durationSeconds?: number;
}

function resolveSegmentContent(
  segment: AssemblyTemplateSegment,
  slotsById: ReadonlyMap<string, string>,
  templateSlotsById: ReadonlyMap<string, { readonly id: string; readonly usage: 'spoken' | 'display' }>,
): readonly GeneratedMediaContentValue[] {
  return segment.contentSlots.map((slotId) => {
    const definition = templateSlotsById.get(slotId);
    const text = slotsById.get(slotId);
    if (definition === undefined || text === undefined) {
      throw invalidGeneratedMedia('Generated media requirements could not be resolved.');
    }
    return { slotId: definition.id, usage: definition.usage, text };
  });
}

function formatUnitId(ordinal: number): string {
  return `u${String(ordinal).padStart(2, '0')}`;
}

function invalidGeneratedMedia(message: string): VidGenError {
  return new VidGenError('generated_media', message);
}
