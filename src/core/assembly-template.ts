import { VidGenError } from './error.ts';

export const ASSEMBLY_TEMPLATE_SCHEMA_VERSION = '1';

export interface AssemblyTemplateOutput {
  readonly width: 1080;
  readonly height: 1920;
  readonly fps: 30;
  readonly container: 'mp4';
  readonly videoCodec: 'h264';
}

export interface AssemblyTemplateContentSlot {
  readonly id: string;
}

export interface AssemblyTemplateGeneratedAssetRole {
  readonly id: string;
  readonly kind: 'presenter' | 'video' | 'voiceover';
}

export interface AssemblyTemplateStandardizedAssetRole {
  readonly id: 'intro' | 'outro';
  readonly placement: 'before-story' | 'after-story';
}

export interface AssemblyTemplateSegment {
  readonly id: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly contentSlots: readonly string[];
  readonly generatedAssetRoles: readonly string[];
}

/** A deterministic assembly contract; ClipPlan may fill slots but cannot alter its shape. */
export interface AssemblyTemplate {
  readonly schemaVersion: typeof ASSEMBLY_TEMPLATE_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly output: AssemblyTemplateOutput;
  readonly contentSlots: readonly AssemblyTemplateContentSlot[];
  readonly generatedAssetRoles: readonly AssemblyTemplateGeneratedAssetRole[];
  readonly standardizedAssetRoles: readonly AssemblyTemplateStandardizedAssetRole[];
  readonly segments: readonly AssemblyTemplateSegment[];
}

/** Validates a complete template definition before it crosses into planning or assembly. */
export function validateAssemblyTemplate(value: unknown): AssemblyTemplate {
  const template = requireObject(value, 'template');
  rejectExtraKeys(template, [
    'schemaVersion', 'id', 'version', 'output', 'contentSlots', 'generatedAssetRoles',
    'standardizedAssetRoles', 'segments',
  ], 'template');

  if (requireString(template, 'schemaVersion', 'template.schemaVersion') !== ASSEMBLY_TEMPLATE_SCHEMA_VERSION) {
    throw invalidTemplate('template.schemaVersion is not supported.');
  }

  const output = validateOutput(template.output);
  const contentSlots = validateContentSlots(template.contentSlots);
  const generatedAssetRoles = validateGeneratedAssetRoles(template.generatedAssetRoles);
  const standardizedAssetRoles = validateStandardizedAssetRoles(template.standardizedAssetRoles);
  const segments = validateSegments(template.segments, contentSlots, generatedAssetRoles);

  if (segments.length !== 4 || segments.at(-1)?.endSeconds !== 40) {
    throw invalidTemplate('template must contain exactly four logical segments totaling 40 seconds.');
  }

  return {
    schemaVersion: ASSEMBLY_TEMPLATE_SCHEMA_VERSION,
    id: requireString(template, 'id', 'template.id'),
    version: requireString(template, 'version', 'template.version'),
    output,
    contentSlots,
    generatedAssetRoles,
    standardizedAssetRoles,
    segments,
  };
}

function validateOutput(value: unknown): AssemblyTemplateOutput {
  const output = requireObject(value, 'template.output');
  rejectExtraKeys(output, ['width', 'height', 'fps', 'container', 'videoCodec'], 'template.output');
  if (
    output.width !== 1080 || output.height !== 1920 || output.fps !== 30
    || output.container !== 'mp4' || output.videoCodec !== 'h264'
  ) {
    throw invalidTemplate('template.output must be 1080x1920 at 30 fps with H.264/MP4 target.');
  }
  return { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264' };
}

function validateContentSlots(value: unknown): readonly AssemblyTemplateContentSlot[] {
  return requireArray(value, 'template.contentSlots').map((item, index) => {
    const slot = requireObject(item, `template.contentSlots[${index}]`);
    rejectExtraKeys(slot, ['id'], `template.contentSlots[${index}]`);
    return { id: requireString(slot, 'id', `template.contentSlots[${index}].id`) };
  }).map((slot, index, slots) => {
    assertUnique(slot.id, slots.slice(0, index).map((item) => item.id), 'content slot');
    return slot;
  });
}

function validateGeneratedAssetRoles(value: unknown): readonly AssemblyTemplateGeneratedAssetRole[] {
  return requireArray(value, 'template.generatedAssetRoles').map((item, index) => {
    const role = requireObject(item, `template.generatedAssetRoles[${index}]`);
    rejectExtraKeys(role, ['id', 'kind'], `template.generatedAssetRoles[${index}]`);
    const kind = role.kind;
    if (kind !== 'presenter' && kind !== 'video' && kind !== 'voiceover') {
      throw invalidTemplate(`template.generatedAssetRoles[${index}].kind is not supported.`);
    }
    return { id: requireString(role, 'id', `template.generatedAssetRoles[${index}].id`), kind };
  }).map((role, index, roles) => {
    assertUnique(role.id, roles.slice(0, index).map((item) => item.id), 'generated asset role');
    return role;
  });
}

function validateStandardizedAssetRoles(value: unknown): readonly AssemblyTemplateStandardizedAssetRole[] {
  const roles = requireArray(value, 'template.standardizedAssetRoles').map((item, index) => {
    const role = requireObject(item, `template.standardizedAssetRoles[${index}]`);
    rejectExtraKeys(role, ['id', 'placement'], `template.standardizedAssetRoles[${index}]`);
    if ((role.id !== 'intro' && role.id !== 'outro') || (role.placement !== 'before-story' && role.placement !== 'after-story')) {
      throw invalidTemplate(`template.standardizedAssetRoles[${index}] is invalid.`);
    }
    return { id: role.id, placement: role.placement };
  });

  if (roles.length !== 2 || !roles.some((role) => role.id === 'intro' && role.placement === 'before-story')
    || !roles.some((role) => role.id === 'outro' && role.placement === 'after-story')) {
    throw invalidTemplate('template requires standardized intro and outro roles around story media.');
  }
  return roles;
}

function validateSegments(
  value: unknown,
  contentSlots: readonly AssemblyTemplateContentSlot[],
  generatedAssetRoles: readonly AssemblyTemplateGeneratedAssetRole[],
): readonly AssemblyTemplateSegment[] {
  const slotIds = new Set(contentSlots.map((slot) => slot.id));
  const roleIds = new Set(generatedAssetRoles.map((role) => role.id));
  let previousEnd = 0;
  const segmentIds = new Set<string>();

  return requireArray(value, 'template.segments').map((item, index) => {
    const segment = requireObject(item, `template.segments[${index}]`);
    rejectExtraKeys(segment, ['id', 'startSeconds', 'endSeconds', 'contentSlots', 'generatedAssetRoles'], `template.segments[${index}]`);
    const id = requireString(segment, 'id', `template.segments[${index}].id`);
    if (segmentIds.has(id)) throw invalidTemplate(`duplicate segment ID: ${id}.`);
    segmentIds.add(id);
    const startSeconds = requireFiniteNumber(segment, 'startSeconds', `template.segments[${index}].startSeconds`);
    const endSeconds = requireFiniteNumber(segment, 'endSeconds', `template.segments[${index}].endSeconds`);
    if (startSeconds !== previousEnd || endSeconds <= startSeconds) {
      throw invalidTemplate(`template.segments[${index}] must be contiguous, ordered, and have a positive duration.`);
    }
    previousEnd = endSeconds;
    const segmentSlots = validateReferences(segment.contentSlots, `template.segments[${index}].contentSlots`, slotIds);
    const segmentRoles = validateReferences(segment.generatedAssetRoles, `template.segments[${index}].generatedAssetRoles`, roleIds);
    return { id, startSeconds, endSeconds, contentSlots: segmentSlots, generatedAssetRoles: segmentRoles };
  });
}

function validateReferences(value: unknown, label: string, declared: ReadonlySet<string>): readonly string[] {
  const references = requireArray(value, label).map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0 || !declared.has(item)) {
      throw invalidTemplate(`${label}[${index}] must reference a declared role.`);
    }
    return item;
  });
  if (new Set(references).size !== references.length) throw invalidTemplate(`${label} must not contain duplicate references.`);
  return references;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidTemplate(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidTemplate(`${label} must be a non-empty array.`);
  return value;
}
function requireString(object: Record<string, unknown>, key: string, label: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidTemplate(`${label} must be a non-empty string.`);
  return value;
}
function requireFiniteNumber(object: Record<string, unknown>, key: string, label: string): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidTemplate(`${label} must be a finite number.`);
  return value;
}
function rejectExtraKeys(object: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw invalidTemplate(`${label}.${key} is not supported.`);
}
function assertUnique(value: string, previous: readonly string[], label: string): void {
  if (previous.includes(value)) throw invalidTemplate(`duplicate ${label} ID: ${value}.`);
}
function invalidTemplate(message: string): VidGenError { return new VidGenError('assembly_template', message); }
