import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildAssemblyPlan, qualifyAssemblyInputs } from '../../../src/app/assembly-input.ts';
import { fingerprintGeneratedMediaManifest, generateStoryMedia, loadValidatedMediaReadyWorkspace } from '../../../src/app/media-workflow.ts';
import { buildClipPlan } from '../../../src/core/clip-plan.ts';
import { validateAssemblyTemplate } from '../../../src/core/assembly-template.ts';
import { VidGenError } from '../../../src/core/error.ts';
import type { SpeechGenerationClient, VideoGenerationClient } from '../../../src/core/generated-media.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';

const fingerprint = 'a'.repeat(64);
const runId = 'assembly-test';

test('a Phase 4 media-ready workspace becomes the default deterministic AssemblyPlan without hard-coded core IDs', async () => {
  await withMediaWorkspace(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4');
    await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
    const plan = await qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: outro, probe: fakeProbe });
    assert.deepEqual(plan.storySegments.map((segment) => [segment.id, segment.targetDurationSeconds, segment.visual.unitId, segment.voiceover?.unitId]), [
      ['hook', 5, 'u01', undefined], ['content', 10, 'u02', 'u03'], ['support', 13, 'u04', undefined], ['closing', 12, 'u05', undefined],
    ]);
    assert.deepEqual(plan.storySegments[0]!.displayText, ['headline text']);
    assert.deepEqual(plan.storySegments[1]!.displayText, []);
    assert.equal(plan.storyDurationSeconds, 40);
    assert.equal(plan.expectedFinalDurationSeconds, 45);
    assert.equal(plan.output.width, 1080);
    const handoff = await loadValidatedMediaReadyWorkspace(directory);
    assert.equal(fingerprintGeneratedMediaManifest(handoff.generatedMedia), handoff.generatedMediaFingerprint);
    assert.notEqual(fingerprintGeneratedMediaManifest({ ...handoff.generatedMedia, assets: [{ ...handoff.generatedMedia.assets[0]!, provider: 'changed' }, ...handoff.generatedMedia.assets.slice(1)] }), handoff.generatedMediaFingerprint);
  });
});

test('assembly independently qualifies supplied wrappers without probing or reading omitted wrappers', async () => {
  await withMediaWorkspace(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4');
    for (const [request, roles, duration] of [
      [{ introPath: intro, outroPath: outro }, ['intro', 'outro'], 45],
      [{ introPath: intro }, ['intro'], 42],
      [{ outroPath: outro }, ['outro'], 43],
      [{}, [], 40],
    ] as const) {
      await rm(intro, { force: true }); await rm(outro, { force: true });
      if ('introPath' in request) await writeFile(intro, 'intro');
      if ('outroPath' in request) await writeFile(outro, 'outro');
      const probed: string[] = [];
      const plan = await qualifyAssemblyInputs({ storyDirectory: directory, ...request, probe: async (path) => { probed.push(path); return fakeProbe(path); } });
      assert.deepEqual(Object.keys(plan.standardizedAssets), roles);
      assert.equal(plan.expectedFinalDurationSeconds, duration);
      assert.deepEqual(probed.filter((path) => path.endsWith('intro.mp4') || path.endsWith('outro.mp4')).map((path) => path.replace(/.*[\\/]/, '').replace('.mp4', '')), roles);
    }
    await writeFile(intro, 'intro');
    await assert.rejects(qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: intro, probe: fakeProbe }), hasAssemblyCode);
  });
});

test('non-ready and corrupt Phase 4 media state fail before any FFprobe call', async () => {
  await withMediaWorkspace(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
    const mediaRunPath = join(directory, 'media-run.json'); const mediaRun = JSON.parse(await readFile(mediaRunPath, 'utf8')); mediaRun.status = 'failed'; await writeFile(mediaRunPath, JSON.stringify(mediaRun));
    let calls = 0;
    await assert.rejects(qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: outro, probe: async () => { calls += 1; return fakeProbe(''); } }), (error: unknown) => error instanceof VidGenError && error.code === 'generated_media');
    assert.equal(calls, 0);
  });
  await withMediaWorkspace(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
    await writeFile(join(directory, 'assets', 'video', 'u02.mp4'), 'corrupt');
    let calls = 0;
    await assert.rejects(qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: outro, probe: async () => { calls += 1; return fakeProbe(''); } }), hasAssemblyCode);
    assert.equal(calls, 0);
  });
});

test('assembly rejects ambiguous streams, short visuals, and overlong voiceovers while accepting short voiceover padding', async () => {
  for (const mutate of [
    (path: string, facts: any) => path.endsWith('u01.mp4') ? { ...facts, durationSeconds: 4 } : facts,
    (path: string, facts: any) => path.endsWith('u03.wav') ? { ...facts, durationSeconds: 11 } : facts,
    (path: string, facts: any) => path.endsWith('u02.mp4') ? { ...facts, streamTypes: ['video', 'audio', 'audio'], audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } : facts,
  ]) {
    await withMediaWorkspace(async (directory) => {
      const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
      await assert.rejects(qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: outro, probe: async (path) => mutate(path, fakeProbe(path)) }), hasAssemblyCode);
    });
  }
  await withMediaWorkspace(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
    await assert.doesNotReject(qualifyAssemblyInputs({ storyDirectory: directory, introPath: intro, outroPath: outro, probe: fakeProbe }));
  });
});

test('assembly subset is generic: unsupported visual and voiceover shapes fail closed', () => {
  const template = validateAssemblyTemplate({ schemaVersion: '2', id: 'synthetic', version: '1', output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264' }, contentSlots: [{ id: 'caption', usage: 'display', instruction: 'caption' }], generatedAssetRoles: [{ id: 'v1', kind: 'video' }, { id: 'v2', kind: 'presenter' }, { id: 'a1', kind: 'voiceover' }, { id: 'a2', kind: 'voiceover' }], standardizedAssetRoles: [{ id: 'intro', placement: 'before-story' }, { id: 'outro', placement: 'after-story' }], segments: [{ id: 'beat', startSeconds: 0, endSeconds: 7, contentSlots: ['caption'], generatedAssetRoles: ['v1', 'v2', 'a1', 'a2'] }] });
  const clipPlan = buildClipPlan({ storyFingerprint: fingerprint, article: { summary: 'sufficient' } } as any, template, { slots: [{ id: 'caption', text: 'caption' }] });
  const unit = (id: string, kind: any) => ({ unitId: id, role: { id, kind }, segment: { id: 'beat', startSeconds: 0, endSeconds: 7 }, targetDurationSeconds: 7 });
  const workspace = { storyRunId: runId, storyFingerprint: fingerprint, clipPlanFingerprint: fingerprint, generatedMediaFingerprint: fingerprint, template, clipPlan, generatedMediaUnits: [unit('one', 'video'), unit('two', 'presenter'), unit('three', 'voiceover'), unit('four', 'voiceover')] } as any;
  const asset = (item: any) => ({ ...item, identity: { path: item.unitId, basename: item.unitId, byteSize: 1, sha256: fingerprint }, probe: fakeProbe(item.unitId) });
  const standardizedAssets = { intro: { identity: { path: 'intro', basename: 'intro', byteSize: 1, sha256: fingerprint }, probe: fakeProbe('intro') }, outro: { identity: { path: 'outro', basename: 'outro', byteSize: 1, sha256: fingerprint }, probe: fakeProbe('outro') } };
  assert.throws(() => buildAssemblyPlan(workspace, workspace.generatedMediaUnits.map(asset), standardizedAssets), hasAssemblyCode);
});

test('a non-default seven-second template maps one visual and display text without default identifiers', () => {
  const template = validateAssemblyTemplate({ schemaVersion: '2', id: 'seven', version: '1', output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264' }, contentSlots: [{ id: 'strap', usage: 'display', instruction: 'strap' }], generatedAssetRoles: [{ id: 'scene', kind: 'video' }], standardizedAssetRoles: [{ id: 'intro', placement: 'before-story' }, { id: 'outro', placement: 'after-story' }], segments: [{ id: 'only-beat', startSeconds: 0, endSeconds: 7, contentSlots: ['strap'], generatedAssetRoles: ['scene'] }] });
  const clipPlan = buildClipPlan({ storyFingerprint: fingerprint, article: { summary: 'sufficient' } } as any, template, { slots: [{ id: 'strap', text: 'Visible only' }] });
  const visual: any = { unitId: 'not-default', role: { id: 'scene', kind: 'video' }, segment: { id: 'only-beat', startSeconds: 0, endSeconds: 7 }, targetDurationSeconds: 7, identity: { path: 'visual', basename: 'visual', byteSize: 1, sha256: fingerprint }, probe: fakeProbe('u02.mp4') };
  const standard = { identity: { path: 'standard', basename: 'standard', byteSize: 1, sha256: fingerprint }, probe: fakeProbe('intro.mp4') };
  const plan = buildAssemblyPlan({ storyRunId: runId, storyFingerprint: fingerprint, clipPlanFingerprint: fingerprint, generatedMediaFingerprint: fingerprint, template, clipPlan, generatedMediaUnits: [visual] } as any, [visual], { intro: standard, outro: standard });
  assert.deepEqual(plan.storySegments.map((segment) => [segment.id, segment.displayText]), [['only-beat', ['Visible only']]]);
  assert.equal(plan.storyDurationSeconds, 7);
});

function fakeProbe(path: string) {
  const name = path.replace(/.*[\\/]/, '');
  if (name === 'u03.wav') return { durationSeconds: 9, containerNames: ['wav'], streamTypes: ['audio'] as const, audio: { codecName: 'pcm_s16le', sampleRate: 24000, channels: 1 } };
  if (name === 'intro.mp4') return { durationSeconds: 2, containerNames: ['mp4'], streamTypes: ['video'] as const, video: video() };
  if (name === 'outro.mp4') return { durationSeconds: 3, containerNames: ['mp4'], streamTypes: ['video'] as const, video: video() };
  const duration = name === 'u01.mp4' ? 5 : name === 'u02.mp4' ? 10 : name === 'u04.mp4' ? 13 : 12;
  return { durationSeconds: duration, containerNames: ['mp4'], streamTypes: ['video'] as const, video: video() };
}
function video() { return { codecName: 'h264', width: 720, height: 1280, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }; }
function fakes() { const videoClient: VideoGenerationClient = { provider: 'fake-video', model: 'model', generateVideo: async () => ({ provider: 'fake-video', model: 'model', mimeType: 'video/mp4', bytes: new Uint8Array([1, 2, 3]) }) }; const speechClient: SpeechGenerationClient = { provider: 'fake-speech', model: 'model', voice: 'voice', generateSpeech: async () => ({ provider: 'fake-speech', model: 'model', voice: 'voice', mimeType: 'audio/wav', bytes: new Uint8Array([4, 5, 6]) }) }; return { createVideoClient: () => videoClient, createSpeechClient: () => speechClient }; }
async function withMediaWorkspace(run: (directory: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-assembly-')); try { await writeWorkspace(directory); await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [await writeAnchor(directory)], ...fakes(), now: () => new Date('2026-09-05T00:00:00.000Z') }); await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
async function writeAnchor(directory: string) { const path = join(directory, 'anchor.png'); await writeFile(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); return path; }
async function writeWorkspace(directory: string) { const template = getAssemblyTemplate('default-news-40s'); const plan = { schemaVersion: '1', storyFingerprint: fingerprint, template: { id: template.id, version: template.version }, slots: template.contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` })) }; const story = { storyRunId: runId, status: 'story_ready', startedAt: '2026-09-05T00:00:00.000Z', engineVersion: '0.4.4', articleId: 'article', storyFingerprint: fingerprint, sourceInputFingerprint: 'b'.repeat(64), storyInputArtifact: 'story.json', template: { id: template.id, version: template.version }, generatedAssetRoles: [], standardizedAssetRoles: [] }; const clipRun = { storyRunId: runId, status: 'clip_plan_ready', startedAt: '2026-09-05T00:00:00.000Z', engineVersion: '0.4.4', storyFingerprint: fingerprint, template: { id: template.id, version: template.version }, provider: 'fake', configuredModel: 'fake', clipPlanArtifact: 'clip-plan.json' }; await Promise.all([writeFile(join(directory, 'story-run.json'), JSON.stringify(story)), writeFile(join(directory, 'clip-plan-run.json'), JSON.stringify(clipRun)), writeFile(join(directory, 'clip-plan.json'), JSON.stringify(plan))]); }
function hasAssemblyCode(error: unknown): boolean { return error instanceof VidGenError && error.code === 'assembly'; }
