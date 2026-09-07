import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  GENERATED_MEDIA_ARTIFACT_NAME,
  MEDIA_RUN_ARTIFACT_NAME,
  generateStoryMedia,
} from '../../../src/app/media-workflow.ts';
import { assertApprovedAnchorReferenceCount, loadApprovedAnchorReferences } from '../../../src/core/anchor-reference.ts';
import type { SpeechGenerationClient, VideoGenerationClient } from '../../../src/core/generated-media.ts';
import { getAssemblyTemplate } from '../../../src/core/template-registry.ts';
import { writeJsonAtomically } from '../../../src/shared/atomic-json.ts';

const storyFingerprint = 'a'.repeat(64);
const runId = 'planned-media-test';

test('media workflow dispatches the deterministic five units, persists a complete manifest, and reuses matching assets', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png');
    await writeFile(reference, png(1));
    const first = fakes();
    const result = await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => first.video, createSpeechClient: () => first.speech, now: clock() });
    assert.deepEqual(first.videoUnits, ['u01', 'u02', 'u04', 'u05']);
    assert.deepEqual(first.speechUnits, ['u03']);
    assert.equal(result.generatedUnitCount, 5);
    const manifest = JSON.parse(await readFile(join(directory, GENERATED_MEDIA_ARTIFACT_NAME), 'utf8')) as any;
    assert.deepEqual(manifest.assets.map((asset: any) => asset.unitId), ['u01', 'u02', 'u03', 'u04', 'u05']);
    assert.deepEqual(manifest.assets.map((asset: any) => asset.assetPath), ['assets/presenter/u01.mp4', 'assets/video/u02.mp4', 'assets/audio/u03.wav', 'assets/presenter/u04.mp4', 'assets/presenter/u05.mp4']);
    assert.equal(JSON.stringify(manifest).includes(directory), false);
    assert.equal(JSON.stringify(manifest).includes('anchor.png'), true);
    const second = fakes();
    const rerun = await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => second.video, createSpeechClient: () => second.speech, now: clock() });
    assert.equal(rerun.reusedUnitCount, 5);
    assert.deepEqual(second.videoUnits, []);
    assert.deepEqual(second.speechUnits, []);
  });
});

test('anchor, model, ClipPlan, and byte changes selectively invalidate story-local assets', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png');
    await writeFile(reference, png(1));
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], ...fakes(), now: clock() });
    await writeFile(reference, png(2));
    const changedReference = fakes();
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => changedReference.video, createSpeechClient: () => changedReference.speech, now: clock() });
    assert.deepEqual(changedReference.videoUnits, ['u01', 'u04', 'u05']);
    assert.deepEqual(changedReference.speechUnits, []);
    const videoModel = fakes('video-v2');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => videoModel.video, createSpeechClient: () => videoModel.speech, now: clock() });
    assert.deepEqual(videoModel.videoUnits, ['u01', 'u02', 'u04', 'u05']);
    const speechModel = fakes('video-v2', 'speech-v2', 'voice-b');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => speechModel.video, createSpeechClient: () => speechModel.speech, now: clock() });
    assert.deepEqual(speechModel.videoUnits, []);
    assert.deepEqual(speechModel.speechUnits, ['u03']);
    await writeFile(join(directory, 'assets', 'video', 'u02.mp4'), Buffer.from('corrupt'));
    const corrupt = fakes('video-v2', 'speech-v2', 'voice-b');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => corrupt.video, createSpeechClient: () => corrupt.speech, now: clock() });
    assert.deepEqual(corrupt.videoUnits, ['u02']);
    await unlink(join(directory, 'assets', 'presenter', 'u04.mp4'));
    const missing = fakes('video-v2', 'speech-v2', 'voice-b');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => missing.video, createSpeechClient: () => missing.speech, now: clock() });
    assert.deepEqual(missing.videoUnits, ['u04']);
    const planPath = join(directory, 'clip-plan.json');
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as any;
    plan.slots[0].text = 'Different validated hook.';
    await writeFile(planPath, JSON.stringify(plan), 'utf8');
    const changedPlan = fakes('video-v2', 'speech-v2', 'voice-b');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => changedPlan.video, createSpeechClient: () => changedPlan.speech, now: clock() });
    assert.deepEqual(changedPlan.videoUnits, ['u01', 'u02', 'u04', 'u05']);
    assert.deepEqual(changedPlan.speechUnits, ['u03']);
  });
});

test('a terminal media-ready metadata failure invalidates the new success manifest', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png');
    await writeFile(reference, png(1));
    let writes = 0;

    await assert.rejects(generateStoryMedia({
      storyDirectory: directory,
      anchorReferencePaths: [reference],
      ...fakes(),
      now: clock(),
      writeJson: async (...args) => {
        writes += 1;
        if (writes === 8) throw new Error('terminal media metadata write failed');
        return writeJsonAtomically(...args);
      },
    }));

    assert.equal((JSON.parse(await readFile(join(directory, MEDIA_RUN_ARTIFACT_NAME), 'utf8')) as any).status, 'failed');
    await assert.rejects(readFile(join(directory, GENERATED_MEDIA_ARTIFACT_NAME), 'utf8'));
  });
});

test('a provider failure leaves durable completed assets resumable and no success manifest', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png'); await writeFile(reference, png(1));
    const failed = fakes();
    let calls = 0;
    failed.video.generateVideo = async (request) => {
      calls += 1;
      if (calls === 2) throw new Error('provider failed');
      failed.videoUnits.push(request.unit.unitId);
      return videoResult(request.unit.unitId);
    };
    await assert.rejects(generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => failed.video, createSpeechClient: () => failed.speech, now: clock() }));
    assert.equal((JSON.parse(await readFile(join(directory, MEDIA_RUN_ARTIFACT_NAME), 'utf8')) as any).status, 'failed');
    await assert.rejects(readFile(join(directory, GENERATED_MEDIA_ARTIFACT_NAME), 'utf8'));
    const resumed = fakes();
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createVideoClient: () => resumed.video, createSpeechClient: () => resumed.speech, now: clock() });
    assert.deepEqual(resumed.videoUnits, ['u02', 'u04', 'u05']);
    assert.deepEqual(resumed.speechUnits, ['u03']);
  });
});

test('media workflow rejects an invalid local anchor reference before constructing provider clients', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png');
    await writeFile(reference, Buffer.from('not an image'));
    let videoConstructed = false;
    let speechConstructed = false;

    await assert.rejects(generateStoryMedia({
      storyDirectory: directory,
      anchorReferencePaths: [reference],
      createVideoClient: () => { videoConstructed = true; return fakes().video; },
      createSpeechClient: () => { speechConstructed = true; return fakes().speech; },
      now: clock(),
    }), /Anchor-reference file type is unsupported/);

    assert.equal(videoConstructed, false);
    assert.equal(speechConstructed, false);
  });
});

test('cinematic media defaults through the backend selector while an injected client bypasses it', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png'); await writeFile(reference, png(1));
    await withVideoBackend('invalid', async () => {
      const defaults = fakes();
      await assert.rejects(generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], createSpeechClient: defaults.createSpeechClient, now: clock() }), /VIDGEN_VIDEO_BACKEND must be "developer" or "vertex"/);
      await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], ...defaults, now: clock() });
    });
  });
});

test('video backend provider identity invalidates cinematic reuse without leaking backend configuration', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png'); await writeFile(reference, png(1));
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], ...fakes('video-v1', 'speech-v1', 'voice-a', 'google-veo'), now: clock() });
    const vertex = fakes('video-v1', 'speech-v1', 'voice-a', 'vertex-veo');
    await generateStoryMedia({ storyDirectory: directory, anchorReferencePaths: [reference], ...vertex, now: clock() });
    assert.deepEqual(vertex.videoUnits, ['u01', 'u02', 'u04', 'u05']);
    assert.deepEqual(vertex.speechUnits, []);
    const manifest = await readFile(join(directory, GENERATED_MEDIA_ARTIFACT_NAME), 'utf8');
    assert.equal(manifest.includes('vertex-veo'), true);
    assert.equal(manifest.includes('GOOGLE_CLOUD_PROJECT'), false);
    assert.equal(manifest.includes('secret-token'), false);
  });
});

test('shared approved anchor references retain local MIME, byte, and hash validation for cinematic and simple clients', async () => {
  await withWorkspace(async (directory) => {
    const reference = join(directory, 'anchor.png');
    await writeFile(reference, png(7));
    const loaded = await loadApprovedAnchorReferences([reference], 100);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.identity.basename, 'anchor.png');
    assert.equal(loaded[0]!.identity.mimeType, 'image/png');
    assert.equal(loaded[0]!.identity.byteSize, png(7).byteLength);
    assert.match(loaded[0]!.identity.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => assertApprovedAnchorReferenceCount([]), /one to three/);
    assert.throws(() => assertApprovedAnchorReferenceCount([loaded[0], loaded[0], loaded[0], loaded[0]]), /one to three/);
  });
});

function fakes(videoModel = 'video-v1', speechModel = 'speech-v1', voice = 'voice-a', videoProvider = 'fake-video') {
  const videoUnits: string[] = []; const speechUnits: string[] = [];
  const video: VideoGenerationClient = { provider: videoProvider, model: videoModel, generateVideo: async (request) => { videoUnits.push(request.unit.unitId); return videoResult(request.unit.unitId, videoProvider); } };
  const speech: SpeechGenerationClient = { provider: 'fake-speech', model: speechModel, voice, generateSpeech: async (request) => { speechUnits.push(request.unit.unitId); return { provider: 'fake-speech', model: speechModel, voice, requestId: `s-${request.unit.unitId}`, mimeType: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70, 1]), durationSeconds: 1 }; } };
  return { video, speech, videoUnits, speechUnits, createVideoClient: () => video, createSpeechClient: () => speech };
}
function videoResult(unitId: string, provider = 'fake-video') { return { provider, model: 'returned-video', requestId: `v-${unitId}`, mimeType: 'video/mp4', bytes: new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112]), durationSeconds: 8 }; }
function png(last: number) { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, last]); }
function clock() { return () => new Date('2026-09-05T12:00:00.000Z'); }
async function withWorkspace(run: (directory: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-media-')); try { await writeWorkspace(directory); await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
async function withVideoBackend(value: string | undefined, run: () => Promise<void>) { const prior = process.env.VIDGEN_VIDEO_BACKEND; try { if (value === undefined) delete process.env.VIDGEN_VIDEO_BACKEND; else process.env.VIDGEN_VIDEO_BACKEND = value; await run(); } finally { if (prior === undefined) delete process.env.VIDGEN_VIDEO_BACKEND; else process.env.VIDGEN_VIDEO_BACKEND = prior; } }
async function writeWorkspace(directory: string) { const template = getAssemblyTemplate('default-news-40s'); const plan = { schemaVersion: '1', storyFingerprint, template: { id: template.id, version: template.version }, slots: template.contentSlots.map((slot) => ({ id: slot.id, text: `${slot.id} text` })) }; const story = { storyRunId: runId, status: 'story_ready', startedAt: '2026-09-05T00:00:00.000Z', endedAt: '2026-09-05T00:00:01.000Z', engineVersion: '0.4.4', articleId: 'article', storyFingerprint, sourceInputFingerprint: 'b'.repeat(64), storyInputArtifact: 'story.json', template: { id: template.id, version: template.version }, generatedAssetRoles: [], standardizedAssetRoles: [] }; const clipRun = { storyRunId: runId, status: 'clip_plan_ready', startedAt: '2026-09-05T00:00:00.000Z', endedAt: '2026-09-05T00:00:01.000Z', engineVersion: '0.4.4', storyFingerprint, template: { id: template.id, version: template.version }, provider: 'fake', configuredModel: 'fake', clipPlanArtifact: 'clip-plan.json' }; await Promise.all([writeFile(join(directory, 'story-run.json'), JSON.stringify(story)), writeFile(join(directory, 'clip-plan-run.json'), JSON.stringify(clipRun)), writeFile(join(directory, 'clip-plan.json'), JSON.stringify(plan))]); }
