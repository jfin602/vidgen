import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateAssemblyTemplate, type AssemblyTemplate } from '../../../src/core/assembly-template.ts';
import {
  assertClipPlanContextSufficient,
  buildClipPlan,
  buildClipPlanModelOutputSchema,
  CLIP_PLAN_SCHEMA_VERSION,
  MAX_CLIP_PLAN_SLOT_TEXT_LENGTH,
  validateClipPlan,
} from '../../../src/core/clip-plan.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { buildStoryInput, type StoryInput } from '../../../src/core/story-input.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

test('slot-only model output becomes an identity-bound ClipPlan in template slot order', () => {
  const story = storyWithSummary();
  const template = getAssemblyTemplate('default-news-40s');

  const plan = buildClipPlan(story, template, {
    slots: [
      { id: 'closing', text: ' Final thought. ' },
      { id: 'narration', text: ' The core explanation. ' },
      { id: 'headline', text: ' Display headline ' },
      { id: 'supporting-information', text: ' Helpful context. ' },
      { id: 'hook', text: ' Opening line. ' },
    ],
  });

  assert.deepEqual(plan, {
    schemaVersion: CLIP_PLAN_SCHEMA_VERSION,
    storyFingerprint: story.storyFingerprint,
    template: { id: template.id, version: template.version },
    slots: [
      { id: 'hook', text: 'Opening line.' },
      { id: 'headline', text: 'Display headline' },
      { id: 'narration', text: 'The core explanation.' },
      { id: 'supporting-information', text: 'Helpful context.' },
      { id: 'closing', text: 'Final thought.' },
    ],
  });
  assert.deepEqual(Object.keys(plan).sort(), ['schemaVersion', 'slots', 'storyFingerprint', 'template']);
  assert.equal(JSON.stringify(plan).includes('provider'), false);
  assert.equal(JSON.stringify(plan).includes('prompt'), false);
});

test('ClipPlan builder rejects missing, duplicate, undeclared, blank, and pathological slot values', () => {
  const story = storyWithSummary();
  const template = getAssemblyTemplate('default-news-40s');

  const validSlots = template.contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` }));
  const malformedOutputs = [
    { slots: validSlots.slice(1) },
    { slots: [...validSlots.slice(0, -1), { id: 'hook', text: 'Duplicate hook.' }] },
    { slots: [...validSlots.slice(0, -1), { id: 'unexpected', text: 'Unexpected.' }] },
    { slots: validSlots.map((slot, index) => index === 0 ? { ...slot, text: '  \n  ' } : slot) },
    {
      slots: validSlots.map((slot, index) => index === 0
        ? { ...slot, text: 'x'.repeat(MAX_CLIP_PLAN_SLOT_TEXT_LENGTH + 1) }
        : slot),
    },
  ];

  for (const output of malformedOutputs) {
    assert.throws(() => buildClipPlan(story, template, output), hasClipPlanCode);
  }
});

test('ClipPlan context requires a non-null StoryInput summary and accepts a present summary', () => {
  const missingSummary = buildStoryInput(buildCanonicalInput(validManifest()), 'article-2');
  assert.equal(missingSummary.article.summary, null);
  assert.throws(() => assertClipPlanContextSufficient(missingSummary), (error: unknown) =>
    error instanceof VidGenError
      && error.code === 'clip_plan'
      && error.publicMessage === 'A non-null StoryInput summary is required before creating a ClipPlan.',
  );

  assert.doesNotThrow(() => assertClipPlanContextSufficient(storyWithSummary()));
});

test('ClipPlan validation remains generic for a synthetic template with different content slots', () => {
  const story = storyWithSummary();
  const template = alternateTemplate();
  const plan = buildClipPlan(story, template, {
    slots: [
      { id: 'farewell', text: 'Goodbye.' },
      { id: 'announcement', text: 'A short announcement.' },
      { id: 'key-detail', text: 'The important supplied detail.' },
    ],
  });

  assert.deepEqual(plan.slots, [
    { id: 'announcement', text: 'A short announcement.' },
    { id: 'key-detail', text: 'The important supplied detail.' },
    { id: 'farewell', text: 'Goodbye.' },
  ]);
});

test('durable ClipPlan validation requires exact supplied story/template identity and template order', () => {
  const story = storyWithSummary();
  const template = getAssemblyTemplate('default-news-40s');
  const plan = buildValidPlan(story, template);

  for (const invalidPlan of [
    { ...plan, storyFingerprint: '0'.repeat(64) },
    { ...plan, template: { ...plan.template, version: 'wrong' } },
    { ...plan, slots: [...plan.slots].reverse() },
    { ...plan, slots: [{ ...plan.slots[0], text: '   ' }, ...plan.slots.slice(1)] },
    { ...plan, extra: 'not allowed' },
  ]) {
    assert.throws(() => validateClipPlan(invalidPlan, story, template), hasClipPlanCode);
  }
  assert.deepEqual(validateClipPlan(plan, story, template), plan);
});

test('model-output response schema is template-specific and has exact expected slot count', () => {
  const template = alternateTemplate();
  const schema = buildClipPlanModelOutputSchema(template);

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['slots']);
  assert.equal(schema.properties.slots.minItems, 3);
  assert.equal(schema.properties.slots.maxItems, 3);
  assert.equal(schema.properties.slots.items.additionalProperties, false);
  assert.deepEqual(schema.properties.slots.items.properties.id.enum, [
    'announcement', 'key-detail', 'farewell',
  ]);
  assert.equal(schema.properties.slots.items.properties.text.maxLength, MAX_CLIP_PLAN_SLOT_TEXT_LENGTH);
});

test('durable ClipPlan JSON Schema parses and matches runtime strictness intent', () => {
  const schema = JSON.parse(readFileSync('schemas/clip-plan.schema.json', 'utf8')) as Record<string, any>;

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['schemaVersion', 'storyFingerprint', 'template', 'slots']);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    'schemaVersion', 'slots', 'storyFingerprint', 'template',
  ]);
  assert.equal(schema.properties.schemaVersion.const, CLIP_PLAN_SCHEMA_VERSION);
  assert.equal(schema.properties.template.additionalProperties, false);
  assert.deepEqual(schema.properties.template.required, ['id', 'version']);
  assert.equal(schema.$defs.slot.additionalProperties, false);
  assert.deepEqual(schema.$defs.slot.required, ['id', 'text']);
  assert.equal(schema.$defs.slot.properties.text.maxLength, MAX_CLIP_PLAN_SLOT_TEXT_LENGTH);
  assert.equal(JSON.stringify(schema).includes('provider'), false);
  assert.equal(JSON.stringify(schema).includes('prompt'), false);
  assert.equal(JSON.stringify(schema).includes('segment'), false);
});

function storyWithSummary(): StoryInput {
  return buildStoryInput(buildCanonicalInput(validManifest()), 'article-1');
}

function buildValidPlan(story: StoryInput, template: AssemblyTemplate) {
  return buildClipPlan(story, template, {
    slots: template.contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` })),
  });
}

function alternateTemplate(): AssemblyTemplate {
  const template = JSON.parse(readFileSync('templates/default-news-40s.json', 'utf8')) as any;
  template.id = 'brief-update-25s';
  template.contentSlots = [
    { id: 'announcement', usage: 'display', instruction: 'Concise on-screen announcement.' },
    { id: 'key-detail', usage: 'spoken', instruction: 'Explain the most important supplied detail.' },
    { id: 'farewell', usage: 'spoken', instruction: 'Close without adding unsupported facts.' },
  ];
  template.generatedAssetRoles = [
    { id: 'brief-anchor', kind: 'presenter' },
    { id: 'brief-video', kind: 'video' },
    { id: 'brief-voiceover', kind: 'voiceover' },
  ];
  template.segments = [
    {
      id: 'opening', startSeconds: 0, endSeconds: 6,
      contentSlots: ['announcement'], generatedAssetRoles: ['brief-anchor'],
    },
    {
      id: 'summary', startSeconds: 6, endSeconds: 18,
      contentSlots: ['key-detail'], generatedAssetRoles: ['brief-video', 'brief-voiceover'],
    },
    {
      id: 'signoff', startSeconds: 18, endSeconds: 25,
      contentSlots: ['farewell'], generatedAssetRoles: ['brief-anchor'],
    },
  ];
  return validateAssemblyTemplate(template);
}

function hasClipPlanCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'clip_plan';
}
