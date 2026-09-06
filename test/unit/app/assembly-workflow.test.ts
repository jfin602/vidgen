import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assembleStoryWorkspace, fingerprintAssembly, validateFinalCandidate, validateFinalClipManifest } from '../../../src/app/assembly-workflow.ts';
import type { AssemblyPlan } from '../../../src/app/assembly-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import type { LocalMediaProbe } from '../../../src/integrations/ffmpeg/ffprobe.ts';
import { writeJsonAtomically } from '../../../src/shared/atomic-json.ts';

const hash = 'a'.repeat(64);

test('manual assembly performs one fresh render, atomically publishes final evidence, and persists only safe provenance', async () => {
  await withDirectory(async (directory) => {
    const intro = join(directory, 'owner-intro.mp4'); const outro = join(directory, 'owner-outro.mp4');
    await writeFile(intro, 'intro'); await writeFile(outro, 'outro');
    let renders = 0;
    const result = await assembleStoryWorkspace({
      storyDirectory: directory, introPath: intro, outroPath: outro, qualifyInputs: async () => plan(intro, outro),
      createAssemblyRunId: () => 'assembly-1', now: () => new Date('2026-09-05T00:00:00.000Z'),
      createRenderer: () => ({ preflight: async () => ({ version: 'ffmpeg version test-build' }), render: async ({ outputPath }) => { renders += 1; await writeFile(outputPath, 'candidate'); return { outputPath, ffmpegVersion: 'ffmpeg version test-build', durationMs: 1 }; } }),
      probe: async () => finalProbe(),
    });
    assert.equal(renders, 1);
    assert.equal(result.finalPath, 'final/clip.mp4');
    assert.equal(await readFile(join(directory, 'final', 'clip.mp4'), 'utf8'), 'candidate');
    const manifest = JSON.parse(await readFile(join(directory, 'final-clip.json'), 'utf8'));
    validateFinalClipManifest(manifest);
    assert.equal(manifest.template.id, 'synthetic-template');
    const durable = JSON.stringify(manifest) + await readFile(join(directory, 'assembly-run.json'), 'utf8');
    assert.equal(durable.includes(directory), false);
    assert.equal(durable.includes('display text'), false);
    assert.deepEqual((await readdir(join(directory, 'final'))).sort(), ['clip.mp4']);
  });
});

test('bad post-render technical facts never publish a final clip and leave failed provenance', async () => {
  await withDirectory(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'i'); await writeFile(outro, 'o');
    await assert.rejects(assembleStoryWorkspace({
      storyDirectory: directory, introPath: intro, outroPath: outro, qualifyInputs: async () => plan(intro, outro), createAssemblyRunId: () => 'assembly-2',
      createRenderer: () => ({ preflight: async () => ({ version: 'ffmpeg version test-build' }), render: async ({ outputPath }) => { await writeFile(outputPath, 'candidate'); return { outputPath, ffmpegVersion: 'ffmpeg version test-build', durationMs: 1 }; } }),
      probe: async () => ({ ...finalProbe(), video: { ...finalProbe().video!, width: 100 } }),
    }), (error: unknown) => error instanceof VidGenError && error.code === 'assembly');
    await assert.rejects(readFile(join(directory, 'final-clip.json')));
    await assert.rejects(readFile(join(directory, 'final', 'clip.mp4')));
    assert.equal(JSON.parse(await readFile(join(directory, 'assembly-run.json'), 'utf8')).status, 'failed');
  });
});

test('terminal final-ready persistence failure removes a newly published clip and records failed state where possible', async () => {
  await withDirectory(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'i'); await writeFile(outro, 'o');
    await assert.rejects(assembleStoryWorkspace({
      storyDirectory: directory, introPath: intro, outroPath: outro, qualifyInputs: async () => plan(intro, outro), createAssemblyRunId: () => 'assembly-3',
      createRenderer: () => ({ preflight: async () => ({ version: 'ffmpeg version test-build' }), render: async ({ outputPath }) => { await writeFile(outputPath, 'candidate'); return { outputPath, ffmpegVersion: 'ffmpeg version test-build', durationMs: 1 }; } }), probe: async () => finalProbe(),
      writeJson: async (filesystem, path, value, serialize, suffix) => {
        if ((value as { status?: string }).status === 'final_ready') throw new Error('simulated terminal failure');
        await writeJsonAtomically(filesystem, path, value, serialize, suffix);
      },
    }), (error: unknown) => error instanceof VidGenError && error.code === 'artifact');
    await assert.rejects(readFile(join(directory, 'final-clip.json')));
    await assert.rejects(readFile(join(directory, 'final', 'clip.mp4')));
    assert.equal(JSON.parse(await readFile(join(directory, 'assembly-run.json'), 'utf8')).status, 'failed');
  });
});

test('each explicit assembly invocation renders again rather than using a final render cache', async () => {
  await withDirectory(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); await writeFile(intro, 'i'); await writeFile(outro, 'o');
    let renders = 0; let ids = 0;
    const dependencies = { storyDirectory: directory, introPath: intro, outroPath: outro, qualifyInputs: async () => plan(intro, outro), createAssemblyRunId: () => `assembly-${++ids}`, probe: async () => finalProbe(), createRenderer: () => ({ preflight: async () => ({ version: 'ffmpeg version test-build' }), render: async ({ outputPath }: { outputPath: string }) => { renders += 1; await writeFile(outputPath, `candidate-${renders}`); return { outputPath, ffmpegVersion: 'ffmpeg version test-build', durationMs: 1 }; } }) };
    await assembleStoryWorkspace(dependencies); await assembleStoryWorkspace(dependencies);
    assert.equal(renders, 2);
  });
});

test('fingerprints include safe assembly semantics but no path identity', () => {
  const left = plan('/private/intro-a.mp4', '/private/outro.mp4');
  const right = { ...plan('/different/path/intro-a.mp4', '/different/path/outro.mp4'), standardizedAssets: { ...plan('/different/path/intro-a.mp4', '/different/path/outro.mp4').standardizedAssets, intro: { ...plan('/different/path/intro-a.mp4', '/different/path/outro.mp4').standardizedAssets.intro, identity: { ...plan('/different/path/intro-a.mp4', '/different/path/outro.mp4').standardizedAssets.intro.identity, sha256: 'b'.repeat(64) } } } } as AssemblyPlan;
  assert.equal(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test' }), fingerprintAssembly({ plan: { ...left, standardizedAssets: { ...left.standardizedAssets, intro: { ...left.standardizedAssets.intro, identity: { ...left.standardizedAssets.intro.identity, path: '/other/location/intro.mp4' } } } }, ffmpegVersion: 'ffmpeg version test' }));
  assert.notEqual(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test' }), fingerprintAssembly({ plan: right, ffmpegVersion: 'ffmpeg version test' }));
  assert.notEqual(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test' }), fingerprintAssembly({ plan: { ...left, generatedMediaFingerprint: 'd'.repeat(64) }, ffmpegVersion: 'ffmpeg version test' }));
  assert.notEqual(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test' }), fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test', assemblyPolicy: { version: 'changed-policy' } }));
  assert.notEqual(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test', font: { path: 'font.ttf', basename: 'font.ttf', sha256: 'e'.repeat(64), byteSize: 4 } }), fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test', font: { path: 'other.ttf', basename: 'other.ttf', sha256: 'f'.repeat(64), byteSize: 4 } }));
  assert.notEqual(fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version test' }), fingerprintAssembly({ plan: left, ffmpegVersion: 'ffmpeg version changed' }));
});

test('font is required only for display text and is never persisted as a source path', async () => {
  await withDirectory(async (directory) => {
    const intro = join(directory, 'intro.mp4'); const outro = join(directory, 'outro.mp4'); const font = join(directory, 'approved.otf');
    await writeFile(intro, 'i'); await writeFile(outro, 'o'); await writeFile(font, 'font-bytes');
    let constructed = 0;
    await assert.rejects(assembleStoryWorkspace({ storyDirectory: directory, introPath: intro, outroPath: outro, qualifyInputs: async () => displayPlan(intro, outro), createRenderer: () => { constructed += 1; throw new Error('must not construct'); } }), (error: unknown) => error instanceof VidGenError && error.code === 'invalid_argument');
    assert.equal(constructed, 0);
    await assert.rejects(assembleStoryWorkspace({ storyDirectory: directory, introPath: intro, outroPath: outro, fontPath: font, qualifyInputs: async () => plan(intro, outro) }), (error: unknown) => error instanceof VidGenError && error.code === 'invalid_argument');
    await assembleStoryWorkspace({ storyDirectory: directory, introPath: intro, outroPath: outro, fontPath: font, qualifyInputs: async () => displayPlan(intro, outro), createAssemblyRunId: () => 'assembly-font', createRenderer: () => ({ preflight: async () => ({ version: 'ffmpeg version test-build' }), render: async ({ outputPath }) => { await writeFile(outputPath, 'candidate'); return { outputPath, ffmpegVersion: 'ffmpeg version test-build', durationMs: 1 }; } }), probe: async () => finalProbe() });
    const durable = await readFile(join(directory, 'final-clip.json'), 'utf8');
    assert.equal(durable.includes(font), false);
    assert.equal(JSON.parse(durable).font.basename, 'approved.otf');
  });
});

test('final candidate contract rejects incorrect rational fps and technical outputs', () => {
  const input = plan('intro.mp4', 'outro.mp4');
  validateFinalCandidate(finalProbe(), input);
  for (const altered of [
    { ...finalProbe(), streamTypes: ['video'] as const },
    { ...finalProbe(), video: { ...finalProbe().video!, codecName: 'hevc' } },
    { ...finalProbe(), video: { ...finalProbe().video!, averageFrameRate: { numerator: 30000, denominator: 1001, value: 29.97 } } },
    { ...finalProbe(), audio: { ...finalProbe().audio!, sampleRate: 44_100 } },
    { ...finalProbe(), durationSeconds: 99 },
  ]) assert.throws(() => validateFinalCandidate(altered, input), (error: unknown) => error instanceof VidGenError && error.code === 'assembly');
});

test('final clip schema is present and declares strict durable objects', () => {
  const schema = JSON.parse(readFileSync('schemas/final-clip.schema.json', 'utf8')) as Record<string, any>;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.output.$ref, '#/$defs/output');
  assert.equal(schema.$defs.output.additionalProperties, false);
  assert.equal(schema.$defs.standardizedAsset.additionalProperties, false);
});

function plan(introPath: string, outroPath: string): AssemblyPlan {
  const media = (path: string, durationSeconds: number) => ({ identity: { path, basename: path.split(/[\\/]/u).at(-1)!, sha256: hash, byteSize: 5 }, probe: { durationSeconds, containerNames: ['mp4'], streamTypes: ['video', 'audio'] as const, video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } });
  const visual = { ...media('visual.mp4', 40), unitId: 'visual-1', role: { id: 'visual', kind: 'video' as const }, segment: { id: 'story', startSeconds: 0, endSeconds: 40 }, targetDurationSeconds: 40 };
  return { storyRunId: 'story-1', storyFingerprint: hash, clipPlanFingerprint: 'b'.repeat(64), generatedMediaFingerprint: 'c'.repeat(64), template: { id: 'synthetic-template', version: '1' }, output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264' }, standardizedAssets: { intro: media(introPath, 2), outro: media(outroPath, 3) }, storyDurationSeconds: 40, expectedFinalDurationSeconds: 45, storySegments: [{ id: 'story', startSeconds: 0, endSeconds: 40, targetDurationSeconds: 40, visual, displayText: [] }] };
}
function displayPlan(introPath: string, outroPath: string): AssemblyPlan { const value = plan(introPath, outroPath); return { ...value, storySegments: [{ ...value.storySegments[0]!, displayText: ['display text'] }] }; }

function finalProbe(): LocalMediaProbe { return { durationSeconds: 45, containerNames: ['mov', 'mp4'], streamTypes: ['video', 'audio'], video: { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } }; }
async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> { const directory = await mkdtemp(join(tmpdir(), 'vidgen-assembly-workflow-')); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
