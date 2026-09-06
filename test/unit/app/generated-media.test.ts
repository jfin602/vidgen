import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateAssemblyTemplate, type AssemblyTemplate } from '../../../src/core/assembly-template.ts';
import { buildClipPlan, validateClipPlanForStoryFingerprint, type ClipPlan } from '../../../src/core/clip-plan.ts';
import {
  createApprovedReferenceImage,
  fingerprintGeneratedMediaUnit,
  resolveGeneratedMediaUnits,
  type SpeechGenerationClient,
  type VideoGenerationClient,
} from '../../../src/core/generated-media.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { buildStoryInput } from '../../../src/core/story-input.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

test('default template resolves ordered per-segment generated-media units without merging repeated roles', () => {
  const template = getAssemblyTemplate('default-news-40s');
  const plan = planFor(template);
  const units = resolveGeneratedMediaUnits(template, plan);

  assert.deepEqual(units.map((unit) => [
    unit.unitId, unit.segment.id, unit.role.id, unit.role.kind, unit.targetDurationSeconds,
  ]), [
    ['u01', 'hook', 'opening-anchor', 'presenter', 5],
    ['u02', 'content', 'content-video', 'video', 10],
    ['u03', 'content', 'content-voiceover', 'voiceover', 10],
    ['u04', 'support', 'supporting-anchor', 'presenter', 13],
    ['u05', 'closing', 'supporting-anchor', 'presenter', 12],
  ]);
  assert.equal(units[3]!.role.id, units[4]!.role.id);
  assert.notEqual(units[3]!.unitId, units[4]!.unitId);
  assert.deepEqual(units[0]!.content, [
    { slotId: 'hook', usage: 'spoken', text: 'hook text' },
    { slotId: 'headline', usage: 'display', text: 'headline text' },
  ]);
  assert.equal(units[0]!.spokenText, 'hook text');
  assert.equal(units[0]!.spokenText.includes('headline text'), false);
  assert.deepEqual(units.slice(1).map((unit) => unit.content.map((slot) => slot.slotId)), [
    ['narration'], ['narration'], ['supporting-information'], ['closing'],
  ]);
  assert.match(units[0]!.unitId, /^u\d+$/);
  assert.equal(fingerprintGeneratedMediaUnit(units[0]!), fingerprintGeneratedMediaUnit(units[0]!));
  assert.notEqual(fingerprintGeneratedMediaUnit(units[0]!), fingerprintGeneratedMediaUnit(units[1]!));
});

test('voiceover without a spoken segment slot fails without promoting display text to dialogue', () => {
  const template = syntheticTemplate([
    { id: 'visual-label', usage: 'display', instruction: 'Display only.' },
  ], [
    { id: 'scene', startSeconds: 0, endSeconds: 7, contentSlots: ['visual-label'], generatedAssetRoles: ['narrator'] },
  ], [
    { id: 'narrator', kind: 'voiceover' },
  ]);
  const plan = planFor(template);

  assert.throws(() => resolveGeneratedMediaUnits(template, plan), (error: unknown) =>
    error instanceof VidGenError && error.code === 'generated_media'
      && error.publicMessage === 'A voiceover generated-media unit requires spoken template content.',
  );
});

test('arbitrary non-default IDs and non-40-second templates resolve from template data', () => {
  const template = syntheticTemplate([
    { id: 'banner:42', usage: 'display', instruction: 'A banner.' },
    { id: 'voice/line', usage: 'spoken', instruction: 'A spoken line.' },
    { id: 'end.note', usage: 'spoken', instruction: 'An ending.' },
  ], [
    { id: 'segment @ start', startSeconds: 0, endSeconds: 3, contentSlots: ['banner:42', 'voice/line'], generatedAssetRoles: ['anchor role'] },
    { id: 'end?segment', startSeconds: 3, endSeconds: 17, contentSlots: ['voice/line', 'end.note'], generatedAssetRoles: ['motion/video', 'voice role'] },
  ], [
    { id: 'anchor role', kind: 'presenter' },
    { id: 'motion/video', kind: 'video' },
    { id: 'voice role', kind: 'voiceover' },
  ]);
  const units = resolveGeneratedMediaUnits(template, planFor(template));

  assert.deepEqual(units.map((unit) => ({
    unitId: unit.unitId, segment: unit.segment.id, role: unit.role.id,
    duration: unit.targetDurationSeconds, spokenText: unit.spokenText,
  })), [
    { unitId: 'u01', segment: 'segment @ start', role: 'anchor role', duration: 3, spokenText: 'voice/line text' },
    { unitId: 'u02', segment: 'end?segment', role: 'motion/video', duration: 14, spokenText: 'voice/line text\nend.note text' },
    { unitId: 'u03', segment: 'end?segment', role: 'voice role', duration: 14, spokenText: 'voice/line text\nend.note text' },
  ]);
  assert.equal(units.every((unit) => /^[a-z0-9]+$/.test(unit.unitId)), true);
});

test('persisted ClipPlan identity validation preserves strict validation without StoryInput reconstruction', () => {
  const template = getAssemblyTemplate('default-news-40s');
  const plan = planFor(template);

  assert.deepEqual(validateClipPlanForStoryFingerprint(plan, plan.storyFingerprint, template), plan);
  for (const invalid of [
    { ...plan, storyFingerprint: '0'.repeat(64) },
    { ...plan, template: { ...plan.template, id: 'another-template' } },
    { ...plan, slots: [...plan.slots].reverse() },
    { ...plan, slots: [{ ...plan.slots[0], text: '  ' }, ...plan.slots.slice(1)] },
  ]) {
    assert.throws(() => validateClipPlanForStoryFingerprint(invalid, plan.storyFingerprint, template), hasClipPlanCode);
  }
});

test('provider-neutral clients expose configuration identity and requests/results stay free of provider URLs', async () => {
  const unit = resolveGeneratedMediaUnits(getAssemblyTemplate('default-news-40s'), planFor(getAssemblyTemplate('default-news-40s')))[0]!;
  const image = createApprovedReferenceImage('image/png', new Uint8Array([1, 2, 3]));
  const video: VideoGenerationClient = {
    provider: 'test-video', model: 'video-model-v1',
    generateVideo: async (request) => {
      assert.deepEqual(Object.keys(request).sort(), ['referenceImages', 'unit']);
      assert.equal(request.referenceImages?.[0]?.sha256, image.sha256);
      return { provider: 'test-video', model: 'video-model-v1', requestId: 'v1', mimeType: 'video/mp4', bytes: new Uint8Array([1]), durationSeconds: 5 };
    },
  };
  const speech: SpeechGenerationClient = {
    provider: 'test-speech', model: 'speech-model-v1', voice: 'news-voice-a',
    generateSpeech: async (request) => {
      assert.deepEqual(Object.keys(request), ['unit']);
      return { provider: 'test-speech', model: 'speech-model-v1', voice: 'news-voice-a', operationId: 's1', mimeType: 'audio/mpeg', bytes: new Uint8Array([2]), durationSeconds: 5 };
    },
  };

  const videoResult = await video.generateVideo({ unit, referenceImages: [image] });
  const speechResult = await speech.generateSpeech({ unit });
  assert.deepEqual(
    { provider: video.provider, model: video.model, result: videoResult },
    { provider: 'test-video', model: 'video-model-v1', result: videoResult },
  );
  assert.equal(speech.voice, 'news-voice-a');
  assert.equal(JSON.stringify({ video, speech, videoResult, speechResult }).toLowerCase().includes('google'), false);
  assert.equal(JSON.stringify({ videoResult, speechResult }).includes('http'), false);
  assert.match(image.sha256, /^[a-f0-9]{64}$/);
});

function planFor(template: AssemblyTemplate): ClipPlan {
  const story = buildStoryInput(buildCanonicalInput(validManifest()), 'article-1');
  return buildClipPlan(story, template, {
    slots: template.contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` })),
  });
}

function syntheticTemplate(
  contentSlots: Array<{ id: string; usage: 'spoken' | 'display'; instruction: string }>,
  segments: Array<{ id: string; startSeconds: number; endSeconds: number; contentSlots: string[]; generatedAssetRoles: string[] }>,
  generatedAssetRoles: Array<{ id: string; kind: 'presenter' | 'video' | 'voiceover' }>,
): AssemblyTemplate {
  const template = JSON.parse(readFileSync('templates/default-news-40s.json', 'utf8')) as Record<string, unknown>;
  template.id = 'generic-template';
  template.contentSlots = contentSlots;
  template.segments = segments;
  template.generatedAssetRoles = generatedAssetRoles;
  return validateAssemblyTemplate(template);
}

function hasClipPlanCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'clip_plan';
}
