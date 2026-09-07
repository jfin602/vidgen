import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateHeadlineClip, validateHeadlineSidecar } from '../../../src/app/headline-workflow.ts';
import { planPresenterVideoDuration } from '../../../src/core/presenter-video.ts';

const manifest = join(process.cwd(), 'test', 'fixtures', 'ngest-vidgen-manifest.json');

test('headline workflow publishes a validated safe flat MP4/JSON pair with no local-path provenance', async () => {
  await withAssets(async (directory, anchor, font) => {
    const result = await generateHeadlineClip(fakeDependencies(directory, anchor, font));
    const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    validateHeadlineSidecar(sidecar);
    assert.equal(result.clipId, 'clip-safe-1'); assert.equal(sidecar.requestedMaxSeconds, 20); assert.equal(sidecar.plannedDurationSeconds, 4); assert.equal(sidecar.finalDurationSeconds, 4); assert.equal(sidecar.final.filename, 'clip-safe-1.mp4'); assert.match(sidecar.final.sha256, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(sidecar), new RegExp(directory.replace(/[\\]/g, '\\\\'))); assert.doesNotMatch(JSON.stringify(sidecar), /secret-token|CanonicalControl/i);
    assert.deepEqual((await readdir(directory)).filter((item) => item.startsWith('.tmp-')), []);
  });
});

test('short copy under the default ceiling makes only the initial eight-second provider request', async () => {
  await withAssets(async (directory, anchor, font) => {
    let requested: number | undefined;
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async (request) => { requested = request.maxSeconds; return video(request.maxSeconds); } }) });
    assert.equal(requested, 4);
  });
});

test('copy requiring more than eight seconds requests exactly one extension plan', async () => {
  await withAssets(async (directory, anchor, font) => {
    let requested: number | undefined;
    const text = Array.from({ length: 21 }, (_, index) => `word${index}`).join(' ');
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font, text), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async (request) => { requested = request.maxSeconds; return video(request.maxSeconds); } }) });
    assert.equal(requested, 9);
  });
});

test('four-second plan trims the initial provider coverage and rejects provider-plan mismatches before raw media persists', async () => {
  await withAssets(async (directory, anchor, font) => {
    let finished: number | undefined;
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), finisher: fakeFinisher((request) => { finished = request.plannedDurationSeconds; return request.plannedDurationSeconds; }) });
    assert.equal(finished, 4);
    await rm(join(directory, 'clip-safe-1.mp4')); await rm(join(directory, 'clip-safe-1.json'));
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async () => ({ ...video(4), rawDurationSeconds: 15 }) }) }), /incompatible with the selected duration plan/);
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4')));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async () => ({ ...video(4), operationId: '/tmp/provider-response' }) }) }), /provenance was unsafe/);
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4')));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
  });
});

test('sidecar construction or validation failure after finishing leaves no final pair', async () => {
  await withAssets(async (directory, anchor, font) => {
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), engineVersion: '' }));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4')));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), finisher: fakeFinisher(() => 4.1) }));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4')));
    await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
  });
});

test('sidecar write failure removes a promoted MP4 and strict validation rejects unsupported fields', async () => {
  await withAssets(async (directory, anchor, font) => {
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), writeJson: async () => { throw new Error('secret-token'); } }), /Unable to publish headline clip metadata/);
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4'))); await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
    const result = await generateHeadlineClip(fakeDependencies(directory, anchor, font)); const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, unsupported: true }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, final: { ...sidecar.final, technical: { output: sidecar.final.technical.output } } }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finishing: { ...sidecar.finishing, policy: 'file:///tmp/ffmpeg.log' } }));
  });
});

test('headline defaults through the backend selector while an injected client bypasses it', async () => {
  await withAssets(async (directory, anchor, font) => {
    await withVideoBackend('invalid', async () => {
      const { createVideoClient: _ignored, ...defaults } = fakeDependencies(directory, anchor, font);
      await assert.rejects(generateHeadlineClip(defaults), /VIDGEN_VIDEO_BACKEND must be "developer" or "vertex"/);
      await generateHeadlineClip(fakeDependencies(directory, anchor, font));
    });
  });
});

test('headline sidecar records safe Vertex provider/model identity without changing its schema', async () => {
  await withAssets(async (directory, anchor, font) => {
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'vertex-veo', model: 'veo-3.1-generate-001', generatePresenterVideo: async (request: { maxSeconds: number }) => ({ ...video(request.maxSeconds), provider: 'vertex-veo', model: 'veo-3.1-generate-001' }) }) });
    const sidecar = JSON.parse(await readFile(join(directory, 'clip-safe-1.json'), 'utf8'));
    validateHeadlineSidecar(sidecar);
    assert.deepEqual(sidecar.videoProvider.provider, 'vertex-veo');
    assert.deepEqual(sidecar.videoProvider.model, 'veo-3.1-generate-001');
    assert.equal(JSON.stringify(sidecar).includes('GOOGLE_CLOUD_PROJECT'), false);
    assert.equal(JSON.stringify(sidecar).includes('secret-token'), false);
  });
});

function fakeDependencies(directory: string, anchor: string, font: string, text = 'A short factual presenter sentence.') {
  return { inputFile: manifest, articleId: 'example-article-1', anchorReferencePaths: [anchor], fontPath: font, artifactsRoot: directory, createClipId: () => 'clip-safe-1', createTextClient: () => ({ provider: 'fake-text', model: 'fake-model', generateStructuredJson: async () => ({ provider: 'fake-text', model: 'fake-model', requestId: 'request-1', outputText: JSON.stringify({ text }) }) }), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async (request: { maxSeconds: number }) => video(request.maxSeconds) }), finisher: fakeFinisher((request) => request.plannedDurationSeconds) };
}
function video(plannedDurationSeconds: number) { const durationPlan = planPresenterVideoDuration(plannedDurationSeconds); const operationIds = Array.from({ length: durationPlan.extensionCount + 1 }, (_, index) => `operation-${index + 1}`); return { provider: 'fake-video', model: 'fake-model', requestId: operationIds[0], operationId: operationIds.at(-1), operationIds, generationOperationCount: durationPlan.extensionCount + 1, mimeType: 'video/mp4', bytes: new Uint8Array([1]), rawDurationSeconds: durationPlan.rawProviderDurationSeconds, durationPlan }; }
function fakeFinisher(duration: (request: { readonly plannedDurationSeconds: number }) => number) { return { preflight: async () => ({ version: 'ffmpeg version fake' }), finish: async (request: { outputPath: string; plannedDurationSeconds: number }) => { await writeFile(request.outputPath, 'finished'); return { outputPath: request.outputPath, ffmpegVersion: 'ffmpeg version fake', durationMs: 1, probe: { durationSeconds: duration(request), containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } }; } }; }
async function withAssets(run: (directory: string, anchor: string, font: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-headline-')); const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); try { await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font'); await run(directory, anchor, font); } finally { await rm(directory, { recursive: true, force: true }); } }
async function withVideoBackend(value: string | undefined, run: () => Promise<void>) { const prior = process.env.VIDGEN_VIDEO_BACKEND; try { if (value === undefined) delete process.env.VIDGEN_VIDEO_BACKEND; else process.env.VIDGEN_VIDEO_BACKEND = value; await run(); } finally { if (prior === undefined) delete process.env.VIDGEN_VIDEO_BACKEND; else process.env.VIDGEN_VIDEO_BACKEND = prior; } }
