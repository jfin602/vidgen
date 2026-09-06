import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { generateHeadlineClip } from '../../../src/app/headline-workflow.ts';

const manifest = join(process.cwd(), 'test', 'fixtures', 'ngest-vidgen-manifest.json');

test('headline workflow publishes only a safe flat MP4/JSON pair with no local-path provenance', async () => {
  await withDirectory(async (directory) => {
    const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font');
    const result = await generateHeadlineClip(fakeDependencies(directory, anchor, font));
    const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    assert.equal(result.clipId, 'clip-safe-1'); assert.equal(sidecar.schemaVersion, '1'); assert.equal(sidecar.article.articleId, 'example-article-1'); assert.equal(sidecar.requestedMaxSeconds, 20); assert.equal(sidecar.presenterText, 'A short factual presenter sentence.'); assert.equal(sidecar.final.filename, 'clip-safe-1.mp4'); assert.equal(sidecar.references[0].basename, 'anchor.png'); assert.match(sidecar.final.sha256, /^[a-f0-9]{64}$/); assert.doesNotMatch(JSON.stringify(sidecar), new RegExp(directory.replace(/[\\]/g, '\\\\'))); assert.doesNotMatch(JSON.stringify(sidecar), /secret-token|CanonicalControl/i);
    assert.deepEqual((await readdir(directory)).filter((item) => item.startsWith('.tmp-')), []);
  });
});

test('headline workflow removes a newly published MP4 when sidecar publication fails', async () => {
  await withDirectory(async (directory) => {
    const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font');
    await assert.rejects(generateHeadlineClip({ ...fakeDependencies(directory, anchor, font), writeJson: async () => { throw new Error('secret-token'); } }), /Unable to publish headline clip metadata/);
    await assert.rejects(readFile(join(directory, 'clip-safe-1.mp4'))); await assert.rejects(readFile(join(directory, 'clip-safe-1.json')));
  });
});

test('headline workflow uses its duration plan and safely records a real FFmpeg-style version banner', async () => {
  await withDirectory(async (directory) => {
    const anchor = join(directory, 'anchor.png'); const font = join(directory, 'font.ttf'); await writeFile(anchor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); await writeFile(font, 'font');
    let plannedDurationSeconds: number | undefined;
    const dependencies = fakeDependencies(directory, anchor, font);
    const result = await generateHeadlineClip({ ...dependencies, maxSeconds: 20, createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async () => ({ provider: 'fake-video', model: 'fake-model', requestId: 'request-2', operationId: 'operation-1', mimeType: 'video/mp4', bytes: new Uint8Array([1]), rawDurationSeconds: 20, durationPlan: { finalDurationCeilingSeconds: 20, rawProviderDurationSeconds: 15, extensionCount: 1 as const, requiresFinalTrim: false } }) }), finisher: { preflight: async () => ({ version: 'ffmpeg version 7.1.1 Copyright (c) 2000-2026 the FFmpeg developers' }), finish: async (request: { outputPath: string; plannedDurationSeconds: number }) => { plannedDurationSeconds = request.plannedDurationSeconds; await writeFile(request.outputPath, 'finished'); return { outputPath: request.outputPath, ffmpegVersion: 'ffmpeg version 7.1.1 Copyright (c) 2000-2026 the FFmpeg developers', durationMs: 1, probe: { durationSeconds: 15, containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } }; } } });
    const sidecar = JSON.parse(await readFile(result.metadataPath, 'utf8'));
    assert.equal(plannedDurationSeconds, 15); assert.equal(sidecar.plannedDurationSeconds, 15); assert.equal(sidecar.finishing.ffmpegVersion, 'ffmpeg version 7.1.1');
  });
});

function fakeDependencies(directory: string, anchor: string, font: string) {
  return { inputFile: manifest, articleId: 'example-article-1', anchorReferencePaths: [anchor], fontPath: font, artifactsRoot: directory, createClipId: () => 'clip-safe-1', createTextClient: () => ({ provider: 'fake-text', model: 'fake-model', generateStructuredJson: async () => ({ provider: 'fake-text', model: 'fake-model', requestId: 'request-1', outputText: JSON.stringify({ text: 'A short factual presenter sentence.' }) }) }), createVideoClient: () => ({ provider: 'fake-video', model: 'fake-model', generatePresenterVideo: async () => ({ provider: 'fake-video', model: 'fake-model', requestId: 'request-2', operationId: 'operation-1', mimeType: 'video/mp4', bytes: new Uint8Array([1]), rawDurationSeconds: 15, durationPlan: { finalDurationCeilingSeconds: 20, rawProviderDurationSeconds: 15, extensionCount: 1 as const, requiresFinalTrim: false } }) }), finisher: { preflight: async () => ({ version: 'ffmpeg version fake' }), finish: async (request: { outputPath: string }) => { await writeFile(request.outputPath, 'finished'); return { outputPath: request.outputPath, ffmpegVersion: 'ffmpeg version fake', durationMs: 1, probe: { durationSeconds: 15, containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } }; } } };
}
async function withDirectory(run: (directory: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'vidgen-headline-')); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
