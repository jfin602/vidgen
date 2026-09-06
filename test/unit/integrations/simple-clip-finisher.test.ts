import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import {
  buildSimpleClipFinishArgs,
  LocalSimpleClipFinisher,
  SIMPLE_CLIP_FINISHING_POLICY,
  validateSimpleFinishedCandidate,
  validateSimpleLowerThird,
} from '../../../src/integrations/ffmpeg/simple-clip-finisher.ts';
import type { LocalMediaProbe } from '../../../src/integrations/ffmpeg/ffprobe.ts';

const filters = ' ... scale ... pad ... fps ... setsar ... trim ... setpts ... atrim ... asetpts ... aresample ... aformat ... apad ... concat ... loudnorm ... drawtext ... drawbox ... ';

test('simple lower third wraps all text without truncation and rejects text that cannot fit', () => {
  const headline = 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  const lowerThird = validateSimpleLowerThird(headline, 'Example News');
  assert.equal(lowerThird.headline.replace(/\n/gu, ''), headline);
  assert.equal(lowerThird.sourceDisplayName, 'Example News');
  assert.throws(() => validateSimpleLowerThird('x'.repeat(43), 'Example News'), hasSimpleClip);
  assert.throws(() => validateSimpleLowerThird('Headline', 'x'.repeat(43)), hasSimpleClip);
});

test('simple finisher stages hostile article text, trims sub-eight coverage, and keeps FFmpeg argv-only', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); const candidate = join(directory, 'candidate.mp4');
    await writeFile(raw, 'raw'); await writeFile(font, 'font');
    const calls: any[] = []; let graph = ''; let stagedHeadline = ''; let stagedSource = '';
    const finisher = new LocalSimpleClipFinisher({
      spawn: (_command, args, options) => {
        calls.push({ args, options });
        if (args.includes('-filter_complex')) {
          graph = args[args.indexOf('-filter_complex') + 1]!;
          stagedHeadline = requireRead(join(directory, 'simple-headline.txt'));
          stagedSource = requireRead(join(directory, 'simple-source.txt'));
        }
        return child(outputFor(args));
      },
      probe: async (path) => path === raw ? rawProbe(8) : finalProbe(4),
    });
    const hostileHeadline = "quote' : ; [x] \\ % ,\nsecond line";
    const result = await finisher.finish({ rawPresenterVideoPath: raw, fontPath: font, headline: hostileHeadline, sourceDisplayName: 'Source ; [safe]', maxSeconds: 4, plannedDurationSeconds: 4, workDirectory: directory, outputPath: candidate });
    assert.equal(result.probe.durationSeconds, 4);
    assert.equal(stagedHeadline, hostileHeadline);
    assert.equal(stagedSource, 'Source ; [safe]');
    assert.match(graph, /trim=duration=4/);
    assert.match(graph, /atrim=duration=4/);
    assert.match(graph, /loudnorm=I=-16:LRA=11:TP=-1.5/);
    assert.match(graph, /drawtext=fontfile=font\.ttf:textfile=simple-headline\.txt:expansion=none/);
    assert.match(graph, /textfile=simple-source\.txt:expansion=none/);
    assert.doesNotMatch(graph, /quote|second line|\[x\]|Source/);
    assert.equal(graph.split(';').length, 2);
    assert.ok(calls.every((call) => call.options.shell === false));
    await assert.rejects(readFile(join(directory, 'font.ttf')));
    await assert.rejects(readFile(join(directory, 'simple-headline.txt')));
    await assert.rejects(readFile(join(directory, 'simple-source.txt')));
  });
});

test('simple finisher accepts eight and fifteen-second coverage but rejects missing streams and short raw duration before FFmpeg', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); await writeFile(raw, 'raw'); await writeFile(font, 'font');
    for (const [plannedDurationSeconds, rawDuration] of [[8, 8], [15, 15]] as const) {
      let calls = 0;
      const finisher = new LocalSimpleClipFinisher({ spawn: (_command, args) => { calls += 1; return child(outputFor(args)); }, probe: async (path) => path === raw ? rawProbe(rawDuration) : finalProbe(plannedDurationSeconds) });
      await finisher.finish(request(directory, raw, font, plannedDurationSeconds, 20));
      assert.ok(calls > 0);
    }
    let calls = 0;
    const missingAudio = new LocalSimpleClipFinisher({ spawn: () => { calls += 1; return child(''); }, probe: async () => ({ ...rawProbe(8), streamTypes: ['video'] as const, audio: undefined }) });
    await assert.rejects(missingAudio.finish(request(directory, raw, font, 8, 8)), hasSimpleClip);
    const shortRaw = new LocalSimpleClipFinisher({ spawn: () => { calls += 1; return child(''); }, probe: async () => rawProbe(7) });
    await assert.rejects(shortRaw.finish(request(directory, raw, font, 8, 8)), hasSimpleClip);
    assert.equal(calls, 0);
  });
});

test('post-probe validation enforces exact normalized output and frame-scale duration tolerance', () => {
  const request = { maxSeconds: 8, plannedDurationSeconds: 8 };
  validateSimpleFinishedCandidate(finalProbe(8 + (1 / 30)), request);
  for (const altered of [
    { ...finalProbe(8), durationSeconds: 8.04 },
    { ...finalProbe(8), video: { ...finalProbe(8).video!, width: 720 } },
    { ...finalProbe(8), video: { ...finalProbe(8).video!, averageFrameRate: { numerator: 30000, denominator: 1001, value: 29.97 } } },
    { ...finalProbe(8), audio: { ...finalProbe(8).audio!, channels: 1 } },
    { ...finalProbe(8), streamTypes: ['video'] as const },
  ]) assert.throws(() => validateSimpleFinishedCandidate(altered, request), hasSimpleClip);
  assert.throws(() => validateSimpleFinishedCandidate(finalProbe(8), { maxSeconds: 4, plannedDurationSeconds: 8 }), hasSimpleClip);
  assert.equal(SIMPLE_CLIP_FINISHING_POLICY.output.width, 1080);
});

test('simple finishing process failures stay bounded and never expose diagnostics', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); await writeFile(raw, 'raw'); await writeFile(font, 'font');
    const finisher = new LocalSimpleClipFinisher({ maxStderrBytes: 2, spawn: (_command, args) => child(outputFor(args), args.includes('-filter_complex') ? 'secret /private/path hostile headline' : ''), probe: async (path) => path === raw ? rawProbe(8) : finalProbe(8) });
    await assert.rejects(finisher.finish(request(directory, raw, font, 8, 8)), (error: unknown) => error instanceof VidGenError && error.publicMessage === 'FFmpeg diagnostic output exceeded the supported limit.');
  });
});

test('simple finish graph has one input and no cinematic concat path', () => {
  const args = buildSimpleClipFinishArgs('raw.mp4', 'candidate.mp4', 15, ['font.ttf', 'simple-headline.txt', 'simple-source.txt']);
  assert.deepEqual(args.filter((item) => item === '-i').length, 1);
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.doesNotMatch(graph, /concat|AssemblyPlan|voiceover/i);
  assert.match(graph, /trim=duration=15/);
});

function request(directory: string, raw: string, font: string, plannedDurationSeconds: number, maxSeconds: number) { return { rawPresenterVideoPath: raw, fontPath: font, headline: 'A safe headline', sourceDisplayName: 'Example News', maxSeconds, plannedDurationSeconds, workDirectory: directory, outputPath: join(directory, `candidate-${plannedDurationSeconds}.mp4`) }; }
function rawProbe(durationSeconds: number): LocalMediaProbe { return { durationSeconds, containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: video(), audio: audio() }; }
function finalProbe(durationSeconds: number): LocalMediaProbe { return { durationSeconds, containerNames: ['mov', 'mp4'], streamTypes: ['video', 'audio'], video: video(), audio: audio() }; }
function video() { return { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }; }
function audio() { return { codecName: 'aac', sampleRate: 48_000, channels: 2 }; }
function outputFor(args: readonly string[]): string { if (args.includes('-version')) return 'ffmpeg version fake-build\n'; if (args.includes('-encoders')) return ' V..... libx264\n A..... aac\n'; if (args.includes('-filters')) return filters; return ''; }
function child(stdoutText: string, stderrText = ''): any { const emitter = new EventEmitter() as any; emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => true; process.nextTick(() => { emitter.stdout.end(stdoutText); emitter.stderr.end(stderrText); emitter.emit('close', 0); }); return emitter; }
function requireRead(path: string): string { return readFileSync(path, 'utf8'); }
function hasSimpleClip(error: unknown): boolean { return error instanceof VidGenError && error.code === 'simple_clip'; }
async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> { const directory = await mkdtemp(join(tmpdir(), 'vidgen-simple-finisher-')); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
