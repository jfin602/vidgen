import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateHeadlineClip, validateHeadlineSidecar } from '../../../src/app/headline-workflow.ts';
import { planPresenterVideoDuration } from '../../../src/core/presenter-video.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';

const manifest = join(process.cwd(), 'test', 'fixtures', 'ngest-vidgen-manifest.json');
const promptAssetIdentity = { basename: 'veo-prompts.json', sha256: 'c'.repeat(64), byteSize: 1 };

test('headline workflow publishes the raw Veo MP4, finished MP4, and validated sidecar with no local-path provenance', async () => {
  await withAssets(async (directory, anchor, font) => {
    const result = await generateHeadlineClip(fakeDependencies(directory, anchor, font));
    const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    validateHeadlineSidecar(sidecar);
    const raw = await readFile(result.rawVeoPath); const final = await readFile(result.finalPath);
    assert.equal(result.clipId, 'clip-safe-1'); assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith('clip-safe-1')).sort(), ['clip-safe-1.json', 'clip-safe-1.mp4', 'clip-safe-1.veo.mp4']); assert.deepEqual(raw, Buffer.from([1])); assert.deepEqual(final, Buffer.from('finished')); assert.equal(sidecar.requestedMaxSeconds, 20); assert.equal(sidecar.speechPlanningDurationSeconds, 4); assert.equal(sidecar.rawVeo.durationSeconds, 8); assert.equal(sidecar.finalDurationSeconds, 8); assert.equal(sidecar.rawVeo.filename, 'clip-safe-1.veo.mp4'); assert.equal(sidecar.rawVeo.sha256, sha256(raw)); assert.equal(sidecar.rawVeo.byteSize, raw.byteLength); assert.equal(sidecar.final.filename, 'clip-safe-1.mp4'); assert.equal(sidecar.final.sha256, sha256(final)); assert.equal(sidecar.final.byteSize, final.byteLength); assert.doesNotMatch(JSON.stringify(sidecar), new RegExp(directory.replace(/[\\]/g, '\\\\'))); assert.doesNotMatch(JSON.stringify(sidecar), /secret-token|CanonicalControl/i);
    assert.deepEqual((await readdir(directory)).filter((item) => item.startsWith('.tmp-')), []);
  });
});

test('headline workflow emits only useful safe stage progress when requested', async () => {
  await withAssets(async (directory, anchor, font) => {
    const events: string[] = [];
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), onProgress: (event) => events.push(event) });
    const output = events.join('\n');
    for (const event of ['input and story validation complete', 'lower-third and font preflight complete', 'Presenter copy generation starting', 'Presenter copy generation completed', 'Presenter speech planning duration: 4 seconds', 'Configured Veo model: fake-model', 'Reference images: 1', 'Veo extension required: no', 'Veo generation starting', 'FFmpeg finishing starting', 'FFmpeg finishing completed', 'final publication completed']) assert.match(output, new RegExp(event));
    assert.doesNotMatch(output, /planned final duration/i);
    assert.doesNotMatch(output, /A short factual presenter sentence|\.tmp-|anchor\.png|font\.ttf/);
  });
});

test('headline workflow refuses a clip ID when any member of its final package already exists', async () => {
  await withAssets(async (directory, anchor, font) => {
    await writeFile(join(directory, 'clip-safe-1.veo.mp4'), 'prior raw clip');
    let videoClientCreated = false;
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => { videoClientCreated = true; throw new Error('Veo must not start'); } }), /already has published artifacts/);
    assert.equal(videoClientCreated, false);
  });
});

test('headline dry run completes governed pre-Veo preparation, writes safe non-final inspection artifacts, and never creates Veo media', async () => {
  await withAssets(async (directory, anchor, font) => {
    let preflightCalls = 0; let textCalls = 0; let videoClientCalls = 0; let finishCalls = 0;
    const result = await generateHeadlineClip({
      ...fakeDependencies(directory, anchor, font),
      dryRun: true,
      finisher: {
        preflightLowerThird: async (request) => { preflightCalls += 1; assert.equal(request.fontPath, font); return { headline: request.headline, sourceDisplayName: request.sourceDisplayName }; },
        finish: async () => { finishCalls += 1; throw new Error('dry run must not finish video'); },
      },
      createTextClient: () => ({ provider: 'fake-text', model: 'fake-model', generateStructuredJson: async () => { textCalls += 1; return { provider: 'fake-text', model: 'fake-model', requestId: 'request-1', outputText: JSON.stringify({ text: 'A short factual presenter sentence.' }), rawResponse: 'secret-provider-response C:\\private\\response.json' }; } }),
      createVideoClient: () => { videoClientCalls += 1; throw new Error('dry run must not construct Veo client'); },
    });
    assert.equal(result.dryRun, true); if (result.dryRun !== true) throw new Error('expected dry run result');
    assert.equal(preflightCalls, 1); assert.equal(textCalls, 1); assert.equal(videoClientCalls, 0); assert.equal(finishCalls, 0); assert.equal(result.speechPlanningDurationSeconds, 4);
    assert.equal(await readFile(result.presenterTextPath, 'utf8'), 'A short factual presenter sentence.');
    const metadata = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    assert.deepEqual(metadata.videoGeneration, { requested: false, status: 'suppressed' }); assert.equal(metadata.kind, 'headline-dry-run'); assert.equal(metadata.status, 'prepared_non_final'); assert.equal(metadata.governedInput.articleId, 'example-article-1'); assert.equal(metadata.requestedMaxSeconds, 20); assert.equal(metadata.speechPlanningDurationSeconds, 4); assert.equal(metadata.presenterDurationPlan.rawCoverageSeconds, 8); assert.equal(metadata.references[0].basename, 'anchor.png'); assert.equal(metadata.font.basename, 'font.ttf'); assert.equal(metadata.presenterText.filename, 'clip-safe-1.dry-run.txt');
    assert.equal(metadata.finishing.policy, 'simple-clip-finishing-policy-v3');
    const serialized = JSON.stringify(metadata); assert.doesNotMatch(serialized, new RegExp(directory.replace(/[\\]/g, '\\\\'))); assert.doesNotMatch(serialized, /secret-provider-response|private\\response|rawResponse|authorization|data:image|iVBOR|\.mp4/i);
    await assertNoHeadlinePackage(directory); assert.deepEqual((await readdir(directory)).filter((item) => item.includes('.tmp-')), []);
  });
});

test('headline dry run removes its inspection artifacts when metadata publication fails', async () => {
  await withAssets(async (directory, anchor, font) => {
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), dryRun: true, writeJson: async () => { throw new Error('secret-token'); } }), /Unable to publish headline dry-run inspection artifacts/);
    for (const name of ['clip-safe-1.dry-run.txt', 'clip-safe-1.dry-run.json']) await assert.rejects(readFile(join(directory, name)));
    await assertNoHeadlinePackage(directory);
    assert.deepEqual((await readdir(directory)).filter((item) => item.includes('.tmp-')), []);
  });
});

test('short copy under the default ceiling makes only the initial eight-second provider request', async () => {
  await withAssets(async (directory, anchor, font) => {
    let requested: number | undefined;
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', promptAssetIdentity, generatePresenterVideo: async (request) => { requested = request.maxSeconds; return video(request.maxSeconds); } }) });
    assert.equal(requested, 4);
  });
});

test('copy requiring more than eight seconds requests exactly one extension plan', async () => {
  await withAssets(async (directory, anchor, font) => {
    let requested: number | undefined;
    const text = Array.from({ length: 21 }, (_, index) => `word${index}`).join(' ');
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font, text), finisher: fakeFinisher(15), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', promptAssetIdentity, generatePresenterVideo: async (request) => { requested = request.maxSeconds; return video(request.maxSeconds); } }) });
    assert.equal(requested, 9);
    const sidecar = JSON.parse(await readFile(join(directory, 'clip-safe-1.json'), 'utf8'));
    assert.equal(sidecar.speechPlanningDurationSeconds, 9);
    assert.equal(sidecar.rawVeo.durationSeconds, 15);
    assert.equal(sidecar.finalDurationSeconds, 15);
  });
});

test('four-second speech plan retains the initial eight-second provider coverage and rejects provider-plan mismatches before raw media persists', async () => {
  await withAssets(async (directory, anchor, font) => {
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), finisher: fakeFinisher(8) });
    const sidecar = JSON.parse(await readFile(join(directory, 'clip-safe-1.json'), 'utf8'));
    assert.equal(sidecar.speechPlanningDurationSeconds, 4);
    assert.equal(sidecar.finalDurationSeconds, 8);
    await rm(join(directory, 'clip-safe-1.veo.mp4')); await rm(join(directory, 'clip-safe-1.mp4')); await rm(join(directory, 'clip-safe-1.json'));
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', promptAssetIdentity, generatePresenterVideo: async () => ({ ...video(4), rawDurationSeconds: 15 }) }) }), /incompatible with the selected duration plan/);
    await assertNoHeadlinePackage(directory);
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', promptAssetIdentity, generatePresenterVideo: async () => ({ ...video(4), operationId: '/tmp/provider-response' }) }) }), /provenance was unsafe/);
    await assertNoHeadlinePackage(directory);
  });
});

test('sidecar construction or validation failure after finishing leaves no final package', async () => {
  await withAssets(async (directory, anchor, font) => {
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), engineVersion: '' }));
    await assertNoHeadlinePackage(directory);
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), finisher: fakeFinisher(8, 8.1) }));
    await assertNoHeadlinePackage(directory);
  });
});

test('sidecar publication failure leaves no partial package and strict validation rejects unsupported fields', async () => {
  await withAssets(async (directory, anchor, font) => {
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), writeJson: async () => { throw new Error('secret-token'); } }), /Unable to publish headline clip metadata/);
    await assertNoHeadlinePackage(directory);
    const result = await generateHeadlineClip(fakeDependencies(directory, anchor, font)); const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, unsupported: true }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, rawVeo: { ...sidecar.rawVeo, filename: 'clip-safe-1.mp4' } }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, final: { ...sidecar.final, technical: { output: sidecar.final.technical.output } } }));
    validateHeadlineSidecar({ ...sidecar, requestedMaxSeconds: 4 });
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finalDurationSeconds: sidecar.finalDurationSeconds + 1 }));
    assert.equal(sidecar.finishing.policy, 'simple-clip-finishing-policy-v3');
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finishing: { ...sidecar.finishing, policy: 'simple-clip-finishing-policy-v1' } }));
    assert.throws(() => validateHeadlineSidecar({ ...sidecar, finishing: { ...sidecar.finishing, policy: 'file:///tmp/ffmpeg.log' } }));
    const schema = JSON.parse(await readFile(join(process.cwd(), 'schemas', 'headline-clip.schema.json'), 'utf8'));
    assert.equal(schema.properties.schemaVersion.const, '4');
    assert.equal(schema.properties.finalDurationSeconds.maximum, undefined);
    assert.equal(schema.$defs.rawVeo.required.includes('durationSeconds'), true);
    assert.equal(schema.$defs.finishing.properties.policy.const, 'simple-clip-finishing-policy-v3');
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
    await generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), createVideoClient: () => ({ provider: 'google-agent-platform-veo', model: 'veo-3.1-generate-001', promptAssetIdentity, generatePresenterVideo: async (request: { maxSeconds: number }) => ({ ...video(request.maxSeconds), provider: 'google-agent-platform-veo', model: 'veo-3.1-generate-001' }) }) });
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
      finisher: { ...fakeFinisher(8), preflightLowerThird: async () => { throw new Error('selected font cannot fit source'); } },
      createTextClient: () => { textClientCreated = true; throw new Error('text provider must not be created'); },
      createVideoClient: () => { videoClientCreated = true; throw new Error('video provider must not be created'); },
    }), /selected font cannot fit source/);
    assert.equal(textClientCreated, false); assert.equal(videoClientCreated, false);
  });
});

function fakeDependencies(directory: string, anchor: string, font: string, text = 'A short factual presenter sentence.') {
  return { inputFile: manifest, articleId: 'example-article-1', anchorReferencePaths: [anchor], fontPath: font, artifactsRoot: directory, createClipId: () => 'clip-safe-1', createTextClient: () => ({ provider: 'fake-text', model: 'fake-model', generateStructuredJson: async () => ({ provider: 'fake-text', model: 'fake-model', requestId: 'request-1', outputText: JSON.stringify({ text }) }) }), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', promptAssetIdentity, generatePresenterVideo: async (request: { maxSeconds: number }) => video(request.maxSeconds) }), finisher: fakeFinisher(8) };
}
function video(speechPlanningDurationSeconds: number) { const durationPlan = planPresenterVideoDuration(speechPlanningDurationSeconds); const operationIds = Array.from({ length: durationPlan.extensionCount + 1 }, (_, index) => `operation-${index + 1}`); return { provider: 'fake-video', model: 'fake-model', requestId: operationIds[0], operationId: operationIds.at(-1), operationIds, generationOperationCount: durationPlan.extensionCount + 1, mimeType: 'video/mp4', bytes: new Uint8Array([1]), rawDurationSeconds: durationPlan.rawProviderDurationSeconds, durationPlan }; }
function fakeFinisher(rawDurationSeconds: number, finalDurationSeconds = rawDurationSeconds) { return { preflightLowerThird: async (request: { headline: string; sourceDisplayName: string }) => ({ headline: request.headline, sourceDisplayName: request.sourceDisplayName }), finish: async (request: { outputPath: string }) => { await writeFile(request.outputPath, 'finished'); const media = (durationSeconds: number) => ({ durationSeconds, containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48_000, channels: 2 } }); return { outputPath: request.outputPath, ffmpegVersion: 'ffmpeg version fake', durationMs: 1, rawProbe: media(rawDurationSeconds), probe: media(finalDurationSeconds) }; } }; }
async function assertNoHeadlinePackage(directory: string): Promise<void> { for (const name of ['clip-safe-1.veo.mp4', 'clip-safe-1.mp4', 'clip-safe-1.json']) await assert.rejects(readFile(join(directory, name))); }
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
async function withAssets(run: (directory: string, anchor: string, font: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-headline-')); const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); try { await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font'); await run(directory, anchor, font); } finally { await rm(directory, { recursive: true, force: true }); } }
async function withVideoModel(value: string, run: () => Promise<void>) { const prior = { project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION, model: process.env.VIDGEN_VIDEO_MODEL }; try { process.env.GOOGLE_CLOUD_PROJECT = 'vidgen-test-project'; process.env.GOOGLE_CLOUD_LOCATION = 'us-central1'; process.env.VIDGEN_VIDEO_MODEL = value; await run(); } finally { for (const [name, priorValue] of Object.entries({ GOOGLE_CLOUD_PROJECT: prior.project, GOOGLE_CLOUD_LOCATION: prior.location, VIDGEN_VIDEO_MODEL: prior.model })) if (priorValue === undefined) delete process.env[name]; else process.env[name] = priorValue; } }
