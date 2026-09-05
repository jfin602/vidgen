import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ASSEMBLY_TEMPLATE_SCHEMA_VERSION, validateAssemblyTemplate } from '../../../src/core/assembly-template.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';

test('default-news-40s loads through the registry with locked timing and output', () => {
  const template = getAssemblyTemplate('default-news-40s');

  assert.equal(template.id, 'default-news-40s');
  assert.equal(template.schemaVersion, '2');
  assert.equal(template.version, '2');
  assert.deepEqual(template.output, {
    width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264',
  });
  assert.deepEqual(template.segments.map(({ id, startSeconds, endSeconds }) => ({ id, startSeconds, endSeconds })), [
    { id: 'hook', startSeconds: 0, endSeconds: 5 },
    { id: 'content', startSeconds: 5, endSeconds: 15 },
    { id: 'support', startSeconds: 15, endSeconds: 28 },
    { id: 'closing', startSeconds: 28, endSeconds: 40 },
  ]);
  assert.equal(template.segments.at(-1)?.endSeconds, 40);
  assert.ok(template.segments.every((segment, index) => index === 0 || segment.startSeconds === template.segments[index - 1].endSeconds));
});

test('default template defines authoring semantics and generated asset requirements without a third anchor', () => {
  const template = getAssemblyTemplate('default-news-40s');
  const segment = (id: string) => template.segments.find((candidate) => candidate.id === id)!;

  assert.deepEqual(template.contentSlots, [
    { id: 'hook', usage: 'spoken', instruction: 'Short presenter opening hook grounded in the supplied story.' },
    { id: 'headline', usage: 'display', instruction: 'Concise on-screen headline treatment grounded in the supplied story.' },
    { id: 'narration', usage: 'spoken', instruction: 'Voiceover explaining the core story during the content beat.' },
    { id: 'supporting-information', usage: 'spoken', instruction: 'Strongest useful supporting detail for the presenter.' },
    { id: 'closing', usage: 'spoken', instruction: 'Brief concluding statement that adds no unsupported new facts.' },
  ]);
  assert.ok(template.contentSlots.every((slot) => slot.instruction.trim().length > 0));
  assert.deepEqual(segment('hook').contentSlots, ['hook', 'headline']);
  assert.deepEqual(segment('hook').generatedAssetRoles, ['opening-anchor']);
  assert.deepEqual(segment('content').generatedAssetRoles, ['content-video', 'content-voiceover']);
  assert.deepEqual(segment('support').generatedAssetRoles, ['supporting-anchor']);
  assert.deepEqual(segment('closing').generatedAssetRoles, ['supporting-anchor']);
  assert.equal(template.generatedAssetRoles.filter((role) => role.kind === 'presenter').length, 2);
  assert.deepEqual(template.standardizedAssetRoles, [
    { id: 'intro', placement: 'before-story' },
    { id: 'outro', placement: 'after-story' },
  ]);
  assert.equal(JSON.stringify(template).includes('path'), false);
  assert.equal(JSON.stringify(template).includes('duration'), false);
});

test('runtime validation accepts a valid declarative template with a different shape and duration', () => {
  const alternate = copyDefaultTemplate();
  alternate.id = 'brief-update-25s';
  alternate.version = '2';
  alternate.contentSlots = [
    { id: 'announcement', usage: 'display', instruction: 'Concise on-screen announcement.' },
    { id: 'key-detail', usage: 'spoken', instruction: 'Explain the most important supplied detail.' },
    { id: 'farewell', usage: 'spoken', instruction: 'Close without adding unsupported facts.' },
  ];
  alternate.generatedAssetRoles = [
    { id: 'brief-anchor', kind: 'presenter' },
    { id: 'brief-video', kind: 'video' },
    { id: 'brief-voiceover', kind: 'voiceover' },
  ];
  alternate.segments = [
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

  const template = validateAssemblyTemplate(alternate);
  assert.equal(template.id, 'brief-update-25s');
  assert.equal(template.segments.length, 3);
  assert.equal(template.segments.at(-1)?.endSeconds, 25);
  assert.deepEqual(template.contentSlots.map((slot) => slot.id), ['announcement', 'key-detail', 'farewell']);
});

test('runtime validation rejects blank instructions, unsupported usage, extra slot fields, and duplicate slot IDs', () => {
  for (const mutate of [
    (template: any) => { template.contentSlots[0].instruction = '   '; },
    (template: any) => { template.contentSlots[0].usage = 'media'; },
    (template: any) => { template.contentSlots[0].provider = 'example'; },
    (template: any) => { template.contentSlots[1].id = template.contentSlots[0].id; },
  ]) {
    const malformed = copyDefaultTemplate();
    mutate(malformed);
    assert.throws(() => validateAssemblyTemplate(malformed), hasAssemblyTemplateCode);
  }
});

test('runtime validation fails closed on malformed timing, duplicate IDs, and undeclared references', () => {
  for (const mutate of [
    (template: any) => { template.segments[0].startSeconds = 1; },
    (template: any) => { template.segments[1].startSeconds = 6; },
    (template: any) => { template.segments[1].startSeconds = 4; },
    (template: any) => { template.segments[1].endSeconds = 5; },
    (template: any) => { template.segments[1].endSeconds = 4; },
    (template: any) => { template.segments.reverse(); },
    (template: any) => { template.segments[1].id = 'hook'; },
    (template: any) => { template.segments[0].generatedAssetRoles = ['unrecognized']; },
    (template: any) => { template.standardizedAssetRoles = [{ id: 'intro', placement: 'before-story' }]; },
  ]) {
    const malformed = copyDefaultTemplate();
    mutate(malformed);
    assert.throws(() => validateAssemblyTemplate(malformed), hasAssemblyTemplateCode);
  }
});

test('registry rejects unknown IDs clearly', () => {
  assert.throws(() => getAssemblyTemplate('missing-template'), hasAssemblyTemplateCode);
});

test('AssemblyTemplate schema parses and matches runtime strictness intent', () => {
  const schema = JSON.parse(readFileSync('schemas/assembly-template.schema.json', 'utf8')) as Record<string, any>;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, ASSEMBLY_TEMPLATE_SCHEMA_VERSION);
  assert.deepEqual(schema.required, [
    'schemaVersion', 'id', 'version', 'output', 'contentSlots', 'generatedAssetRoles',
    'standardizedAssetRoles', 'segments',
  ]);
  assert.equal(schema.properties.output.additionalProperties, false);
  assert.deepEqual(schema.properties.output.required, ['width', 'height', 'fps', 'container', 'videoCodec']);
  assert.equal(schema.$defs.segment.additionalProperties, false);
  assert.equal(schema.$defs.contentSlot.additionalProperties, false);
  assert.deepEqual(schema.$defs.contentSlot.required, ['id', 'usage', 'instruction']);
  assert.deepEqual(schema.$defs.contentSlot.properties.usage.enum, ['spoken', 'display']);
  assert.equal(schema.$defs.generatedAssetRole.additionalProperties, false);
  assert.equal(schema.$defs.standardizedAssetRole.additionalProperties, false);
  assert.equal(JSON.stringify(schema).includes('remotion'), false);
  assert.equal(JSON.stringify(schema).includes('model'), false);
  assert.equal(JSON.stringify(schema).includes('provider'), false);
  assert.equal(JSON.stringify(schema).includes('prompt'), false);
});

function copyDefaultTemplate(): any {
  return JSON.parse(readFileSync('templates/default-news-40s.json', 'utf8'));
}

function hasAssemblyTemplateCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'assembly_template';
}
