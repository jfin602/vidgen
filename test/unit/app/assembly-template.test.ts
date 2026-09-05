import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateAssemblyTemplate } from '../../../src/core/assembly-template.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';

test('default-news-40s loads through the registry with locked timing and output', () => {
  const template = getAssemblyTemplate('default-news-40s');

  assert.equal(template.id, 'default-news-40s');
  assert.equal(template.version, '1');
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

test('default template defines all story content and generated asset requirements without a third anchor', () => {
  const template = getAssemblyTemplate('default-news-40s');
  const segment = (id: string) => template.segments.find((candidate) => candidate.id === id)!;

  assert.deepEqual(template.contentSlots.map((slot) => slot.id), [
    'hook', 'headline', 'narration', 'supporting-information', 'closing',
  ]);
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
  alternate.contentSlots = [{ id: 'headline' }, { id: 'summary' }, { id: 'closing' }];
  alternate.generatedAssetRoles = [
    { id: 'brief-anchor', kind: 'presenter' },
    { id: 'brief-video', kind: 'video' },
    { id: 'brief-voiceover', kind: 'voiceover' },
  ];
  alternate.segments = [
    {
      id: 'opening', startSeconds: 0, endSeconds: 6,
      contentSlots: ['headline'], generatedAssetRoles: ['brief-anchor'],
    },
    {
      id: 'summary', startSeconds: 6, endSeconds: 18,
      contentSlots: ['summary'], generatedAssetRoles: ['brief-video', 'brief-voiceover'],
    },
    {
      id: 'signoff', startSeconds: 18, endSeconds: 25,
      contentSlots: ['closing'], generatedAssetRoles: ['brief-anchor'],
    },
  ];

  const template = validateAssemblyTemplate(alternate);
  assert.equal(template.id, 'brief-update-25s');
  assert.equal(template.segments.length, 3);
  assert.equal(template.segments.at(-1)?.endSeconds, 25);
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
  assert.deepEqual(schema.required, [
    'schemaVersion', 'id', 'version', 'output', 'contentSlots', 'generatedAssetRoles',
    'standardizedAssetRoles', 'segments',
  ]);
  assert.equal(schema.properties.output.additionalProperties, false);
  assert.deepEqual(schema.properties.output.required, ['width', 'height', 'fps', 'container', 'videoCodec']);
  assert.equal(schema.$defs.segment.additionalProperties, false);
  assert.equal(schema.$defs.generatedAssetRole.additionalProperties, false);
  assert.equal(schema.$defs.standardizedAssetRole.additionalProperties, false);
  assert.equal(JSON.stringify(schema).includes('remotion'), false);
  assert.equal(JSON.stringify(schema).includes('model'), false);
});

function copyDefaultTemplate(): any {
  return JSON.parse(readFileSync('templates/default-news-40s.json', 'utf8'));
}

function hasAssemblyTemplateCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'assembly_template';
}
