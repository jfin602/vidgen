import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateHeadlineClip, validateHeadlineSidecar } from '../../../src/app/headline-workflow.ts';
import { planPresenterVideoDuration } from '../../../src/core/presenter-video.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';

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
    assert.equal(sidecar.finishing.policy, 'simple-clip-finishing-policy-v2');
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finishing: { ...sidecar.finishing, policy: 'simple-clip-finishing-policy-v1' } }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finishing: { ...sidecar.finishing, policy: 'file:///tmp/ffmpeg.log' } }));
    const schema = JSON.parse(await readFile(join(process.cwd(), 'schemas', 'headline-clip.schema.json'), 'utf8'));
    assert.equal(schema.$defs.finishing.properties.policy.const, 'simple-clip-finishing-policy-v2');
  });
});

test('headline defaults through the Agent Platform client while an injected client bypasses ambient configuration', async () => {
  await withAssets(async (directory, anchor, font) => {
    await withVideoModel('unsupported-model', async () => {
      const { createVideoClient: _ignored, ...defaults } = fakeDependencies(directory, anchor, font);
      await assert.rejects(generateHeadlineClip(defaults), /project, location, or model configuration is invalid/);
      await generateHeadlineClip(fakeDependencies(directory, anchor, font));
    });
  });
});

test('headline sidecar records safe Agent Platform provider/model identity without changing its schema', async () => {
  await withAssets(async (directory, anchor, font) => {
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'google-agent-platform-veo', model: 'veo-3.1-generate-001', generatePresenterVideo: async (request: { maxSeconds: number }) => ({ ...video(request.maxSeconds), provider: 'google-agent-platform-veo', model: 'veo-3.1-generate-001' }) }) });
    const sidecar = JSON.parse(await readFile(join(directory, 'clip-safe-1.json'), 'utf8'));
    validateHeadlineSidecar(sidecar);
    assert.deepEqual(sidecar.videoProvider.provider, 'google-agent-platform-veo');
    assert.deepEqual(sidecar.videoProvider.model, 'veo-3.1-generate-001');
    assert.equal(JSON.stringify(sidecar).includes('GOOGLE_CLOUD_PROJECT'), false);
    assert.equal(JSON.stringify(sidecar).includes('secret-token'), false);
  });
});

test('headline workflow accepts the governed wrapping regression before any provider call', async () => {
  await withAssets(async (directory, anchor, font) => {
    let reachedNextStage = false;
    let videoClientCreated = false;
    await assert.rejects(generateHeadlineClip({
      ...fakeDependencies(directory, anchor, font),
      loadManifest: async (path) => {
        const loaded = await loadNgestVidGenManifestFile(path);
        return { ...loaded, articles: loaded.articles.map((article) => article.articleId === 'example-article-1' ? { ...article, headline: '‘Possible Love’: What The Critics Are Saying About Lee Chang-dong’s Korean Drama — Venice' } : article) };
      },
      createTextClient: () => { reachedNextStage = true; throw new Error('next injected stage'); },
      createVideoClient: () => { videoClientCreated = true; throw new Error('video provider must not be created'); },
    }), /next injected stage/);
    assert.equal(reachedNextStage, true);
    assert.equal(videoClientCreated, false);
  });
});

test('headline workflow rejects selected-font lower-third overflow before provider creation', async () => {
  await withAssets(async (directory, anchor, font) => {
    let textClientCreated = false; let videoClientCreated = false;
    await assert.rejects(generateHeadlineClip({
      ...fakeDependencies(directory, anchor, font),
      loadManifest: async (path) => {
        const loaded = await loadNgestVidGenManifestFile(path);
        return { ...loaded, articles: loaded.articles.map((article) => article.articleId === 'example-article-1' ? { ...article, source: { ...article.source, displayName: 'W'.repeat(32) } } : article) };
      },
      finisher: { ...fakeFinisher(() => 4), preflightLowerThird: async () => { throw new Error('selected font cannot fit source'); } },
      createTextClient: () => { textClientCreated = true; throw new Error('text provider must not be created'); },
      createVideoClient: () => { videoClientCreated = true; throw new Error('video provider must not be created'); },
    }), /selected font cannot fit source/);
    assert.equal(textClientCreated, false); assert.equal(videoClientCreated, false);
  });
});

function fakeDependencies(directory: string, anchor: string, font: string, text = 'A short factual presenter sentence.') {
  return { inputFile: manifest, articleId: 'example-article-1', anchorReferencePaths: [anchor], fontPath: font, artifactsRoot: directory, createClipId: () => 'clip-safe-1', createTextClient: () => ({ provider: 'fake-text', model: 'fake-model', generateStructuredJson: async () => ({ provider: 'fake-text', model: 'fake-model', requestId: 'request-1', outputText: JSON.stringify({ text }) }) }), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async (request: { maxSeconds: number }) => video(request.maxSeconds) }), finisher: fakeFinisher((request) => request.plannedDurationSeconds) };
}
function video(plannedDurationSeconds: number) { const durationPlan = planPresenterVideoDuration(plannedDurationSeconds); const operationIds = Array.from({ length: durationPlan.extensionCount + 1 }, (_, index) => `operation-${index + 1}`); return { provider: 'fake-video', model: 'fake-model', requestId: operationIds[0], operationId: operationIds.at(-1), operationIds, generationOperationCount: durationPlan.extensionCount + 1, mimeType: 'video/mp4', bytes: new Uint8Array([1]), rawDurationSeconds: durationPlan.rawProviderDurationSeconds, durationPlan }; }
function fakeFinisher(duration: (request: { readonly plannedDurationSeconds: number }) => number) { return { preflightLowerThird: async (request: { headline: string; sourceDisplayName: string }) => ({ headline: request.headline, sourceDisplayName: request.sourceDisplayName }), finish: async (request: { outputPath: string; plannedDurationSeconds: number }) => { await writeFile(request.outputPath, 'finished'); return { outputPath: request.outputPath, ffmpegVersion: 'ffmpeg version fake', durationMs: 1, probe: { durationSeconds: duration(request), containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } }; } }; }
async function withAssets(run: (directory: string, anchor: string, font: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-headline-')); const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); try { await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font'); await run(directory, anchor, font); } finally { await rm(directory, { recursive: true, force: true }); } }
async function withVideoModel(value: string, run: () => Promise<void>) { const prior = { project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION, model: process.env.VIDGEN_VIDEO_MODEL }; try { process.env.GOOGLE_CLOUD_PROJECT = 'vidgen-test-project'; process.env.GOOGLE_CLOUD_LOCATION = 'us-central1'; process.env.VIDGEN_VIDEO_MODEL = value; await run(); } finally { for (const [name, priorValue] of Object.entries({ GOOGLE_CLOUD_PROJECT: prior.project, GOOGLE_CLOUD_LOCATION: prior.location, VIDGEN_VIDEO_MODEL: prior.model })) if (priorValue === undefined) delete process.env[name]; else process.env[name] = priorValue; } }
