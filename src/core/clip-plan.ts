import type { AssemblyTemplate } from './assembly-template.ts';
import { VidGenError } from './error.ts';
import type { StoryInput } from './story-input.ts';

export const CLIP_PLAN_SCHEMA_VERSION = '1';

/** A generic limit for one template-filled text value, independent of slot meaning. */
export const MAX_CLIP_PLAN_SLOT_TEXT_LENGTH = 4_000;

export interface ClipPlanSlot {
  readonly id: string;
  readonly text: string;
}

/**
 * The durable story-specific content that fills a selected AssemblyTemplate.
 * Template structure, provider metadata, and production decisions stay outside
 * this artifact.
 */
export interface ClipPlan {
  readonly schemaVersion: typeof CLIP_PLAN_SCHEMA_VERSION;
  readonly storyFingerprint: string;
  readonly template: {
    readonly id: string;
    readonly version: string;
  };
  readonly slots: readonly ClipPlanSlot[];
}

/** A provider-neutral JSON Schema suitable for requesting slot-only model output. */
export interface ClipPlanModelOutputSchema {
  readonly $schema: 'https://json-schema.org/draft/2020-12/schema';
  readonly title: 'ClipPlan model output';
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly required: readonly ['slots'];
  readonly properties: {
    readonly slots: {
      readonly type: 'array';
      readonly minItems: number;
      readonly maxItems: number;
      readonly items: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly required: readonly ['id', 'text'];
        readonly properties: {
          readonly id: {
            readonly type: 'string';
            readonly enum: readonly string[];
          };
          readonly text: {
            readonly type: 'string';
            readonly minLength: 1;
            readonly maxLength: typeof MAX_CLIP_PLAN_SLOT_TEXT_LENGTH;
          };
        };
      };
    };
  };
}

/**
 * Builds the schema a text-model provider may use for its structured response.
 * This is intentionally not the durable ClipPlan schema: identity remains
 * VidGen-owned and is attached only after model output is checked.
 */
export function buildClipPlanModelOutputSchema(
  template: AssemblyTemplate,
): ClipPlanModelOutputSchema {
  const slotIds = template.contentSlots.map((slot) => slot.id);
  const slotCount = slotIds.length;

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ClipPlan model output',
    type: 'object',
    additionalProperties: false,
    required: ['slots'],
    properties: {
      slots: {
        type: 'array',
        minItems: slotCount,
        maxItems: slotCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'text'],
          properties: {
            id: { type: 'string', enum: slotIds },
            text: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_CLIP_PLAN_SLOT_TEXT_LENGTH,
            },
          },
        },
      },
    },
  };
}

/** The minimal initial grounding rule for the automatic ClipPlan path. */
export function assertClipPlanContextSufficient(storyInput: StoryInput): void {
  if (storyInput.article.summary === null) {
    throw invalidClipPlan('A non-null StoryInput summary is required before creating a ClipPlan.');
  }
}

/**
 * Converts untrusted slot-only model output to a durable ClipPlan. Identity is
 * always derived from the validated VidGen-owned StoryInput and template.
 */
export function buildClipPlan(
  storyInput: StoryInput,
  template: AssemblyTemplate,
  modelOutput: unknown,
): ClipPlan {
  assertClipPlanContextSufficient(storyInput);
  const slotsById = validateModelOutput(modelOutput, template);

  return validateClipPlan({
    schemaVersion: CLIP_PLAN_SCHEMA_VERSION,
    storyFingerprint: storyInput.storyFingerprint,
    template: { id: template.id, version: template.version },
    slots: template.contentSlots.map((slot) => ({ id: slot.id, text: slotsById.get(slot.id)! })),
  }, storyInput, template);
}

/**
 * Validates a durable ClipPlan against the StoryInput and template it claims to
 * fill. Durable slots must already be in declared template order.
 */
export function validateClipPlan(
  value: unknown,
  storyInput: StoryInput,
  template: AssemblyTemplate,
): ClipPlan {
  const plan = requireObject(value, 'ClipPlan');
  rejectExtraKeys(plan, ['schemaVersion', 'storyFingerprint', 'template', 'slots'], 'ClipPlan');

  if (plan.schemaVersion !== CLIP_PLAN_SCHEMA_VERSION) {
    throw invalidClipPlan('ClipPlan schemaVersion is not supported.');
  }
  if (plan.storyFingerprint !== storyInput.storyFingerprint) {
    throw invalidClipPlan('ClipPlan storyFingerprint does not match the supplied StoryInput.');
  }

  const planTemplate = requireObject(plan.template, 'ClipPlan.template');
  rejectExtraKeys(planTemplate, ['id', 'version'], 'ClipPlan.template');
  if (planTemplate.id !== template.id || planTemplate.version !== template.version) {
    throw invalidClipPlan('ClipPlan template identity does not match the supplied AssemblyTemplate.');
  }

  const slots = requireArray(plan.slots, 'ClipPlan.slots');
  if (slots.length !== template.contentSlots.length) {
    throw invalidClipPlan('ClipPlan must contain every declared content slot exactly once.');
  }

  const validatedSlots = slots.map((value, index) => validateDurableSlot(value, index, template));
  return {
    schemaVersion: CLIP_PLAN_SCHEMA_VERSION,
    storyFingerprint: storyInput.storyFingerprint,
    template: { id: template.id, version: template.version },
    slots: validatedSlots,
  };
}

function validateModelOutput(value: unknown, template: AssemblyTemplate): ReadonlyMap<string, string> {
  const output = requireObject(value, 'ClipPlan model output');
  rejectExtraKeys(output, ['slots'], 'ClipPlan model output');
  const slots = requireArray(output.slots, 'ClipPlan model output.slots');
  const expectedIds = new Set(template.contentSlots.map((slot) => slot.id));
  const slotsById = new Map<string, string>();

  for (const [index, rawSlot] of slots.entries()) {
    const slot = requireObject(rawSlot, `ClipPlan model output.slots[${index}]`);
    rejectExtraKeys(slot, ['id', 'text'], `ClipPlan model output.slots[${index}]`);
    const id = requireString(slot.id, `ClipPlan model output.slots[${index}].id`);
    if (!expectedIds.has(id)) {
      throw invalidClipPlan('ClipPlan model output contains an undeclared content slot.');
    }
    if (slotsById.has(id)) {
      throw invalidClipPlan('ClipPlan model output contains a duplicate content slot.');
    }
    slotsById.set(id, normalizeSlotText(slot.text, `ClipPlan model output.slots[${index}].text`));
  }

  if (slotsById.size !== template.contentSlots.length) {
    throw invalidClipPlan('ClipPlan model output must contain every declared content slot exactly once.');
  }
  return slotsById;
}

function validateDurableSlot(
  value: unknown,
  index: number,
  template: AssemblyTemplate,
): ClipPlanSlot {
  const slot = requireObject(value, `ClipPlan.slots[${index}]`);
  rejectExtraKeys(slot, ['id', 'text'], `ClipPlan.slots[${index}]`);
  const expectedSlot = template.contentSlots[index];
  if (expectedSlot === undefined || slot.id !== expectedSlot.id) {
    throw invalidClipPlan('ClipPlan slots must match the declared content slots exactly once in template order.');
  }
  return {
    id: expectedSlot.id,
    text: normalizeSlotText(slot.text, `ClipPlan.slots[${index}].text`),
  };
}

function normalizeSlotText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw invalidClipPlan(`${label} must be a string.`);
  }
  const text = value.trim();
  if (text.length === 0) {
    throw invalidClipPlan(`${label} must not be blank.`);
  }
  if (text.length > MAX_CLIP_PLAN_SLOT_TEXT_LENGTH) {
    throw invalidClipPlan(`${label} exceeds the maximum supported length.`);
  }
  return text;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidClipPlan(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidClipPlan(`${label} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidClipPlan(`${label} must be a non-empty string.`);
  }
  return value;
}

function rejectExtraKeys(object: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw invalidClipPlan(`${label} has an unsupported field.`);
    }
  }
}

function invalidClipPlan(message: string): VidGenError {
  return new VidGenError('clip_plan', message);
}
