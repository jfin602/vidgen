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
  assertSimpleLowerThirdPixels,
  buildSimpleClipFinishArgs,
  buildSimpleLowerThirdLayout,
  buildSimpleLowerThirdMeasurementArgs,
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
  assert.equal(lowerThird.headline.replace(/\n/gu, ' '), headline);
  assert.equal(lowerThird.sourceDisplayName, 'Example News');
  for (const length of [33, 43]) {
    assert.throws(() => validateSimpleLowerThird('x'.repeat(length), 'Example News'), hasSimpleClip);
    assert.throws(() => validateSimpleLowerThird('Headline', 'x'.repeat(length)), hasSimpleClip);
  }
});

test('simple lower third consumes automatic wrap separators without changing governed headline semantics', () => {
  const headline = '‘Possible Love’: What The Critics Are Saying About Lee Chang-dong’s Korean Drama — Venice';
  const lowerThird = validateSimpleLowerThird(headline, 'Example News');
  const lines = lowerThird.headline.split('\n');
  assert.deepEqual(lines, ['‘Possible Love’: What The', 'Critics Are Saying About Lee', 'Chang-dong’s Korean Drama —', 'Venice']);
  assert.deepEqual(lines.map((line) => line.length), [25, 28, 27, 6]);
  assert.ok(lines.every((line) => line.trim() === line));
  assert.equal(lines.join(' '), headline);
  const exactWord = validateSimpleLowerThird(`Prefix ${'x'.repeat(32)}`, 'Example News').headline.split('\n');
  assert.deepEqual(exactWord, ['Prefix', 'x'.repeat(32)]);
  assert.ok(exactWord.every((line) => line.length <= 32 && line.trim() === line));
});

test('simple lower-third derives its full-width, bottom-anchored height from actual wrapped lines', () => {
  for (const [lineCount, height] of [[1, 236], [2, 296], [5, 476]] as const) {
    const lowerThird = validateSimpleLowerThird(wrappedLineHeadline(lineCount), 'Example News');
    const layout = buildSimpleLowerThirdLayout(lowerThird);
    assert.equal(lowerThird.headline.split('\n').length, lineCount);
    assert.deepEqual(layout.outer, { x: 0, y: 1920 - height, width: 1080, height });
    assert.equal(layout.outer.y + layout.outer.height, SIMPLE_CLIP_FINISHING_POLICY.output.height);
  }
  const veniceLowerThird = validateSimpleLowerThird('‘Possible Love’: What The Critics Are Saying About Lee Chang-dong’s Korean Drama — Venice', 'Example News');
  const venice = buildSimpleLowerThirdLayout(veniceLowerThird);
  assert.equal(veniceLowerThird.headline.split('\n').length, 4);
  assert.equal(venice.headline.height, 224);
  assert.deepEqual(venice.outer, { x: 0, y: 1504, width: 1080, height: 416 });
  assert.equal(SIMPLE_CLIP_FINISHING_POLICY.lowerThird.panel.color, '0x336699');
  assert.equal(SIMPLE_CLIP_FINISHING_POLICY.lowerThird.panel.opacity, 0.77);
  assert.equal(JSON.stringify(SIMPLE_CLIP_FINISHING_POLICY.lowerThird).includes('620'), false);
});

test('Venice headline uses uncropped selected-font bounds to keep its final line and source separate', () => {
  const headline = "'Possible Love': What The Critics Are Saying About Lee Chang-dong's Korean Drama - Venice";
  const lowerThird = validateSimpleLowerThird(headline, 'Deadline');
  assert.equal(lowerThird.headline.split('\n').at(-1), 'Venice');
  assert.equal(lowerThird.headline.replace(/\n/gu, ' '), headline);
  const glyphBounds = {
    headline: { left: 180, right: 899, top: 6, bottom: 270 },
    source: { left: 470, right: 609, top: 5, bottom: 43 },
  };
  const layout = buildSimpleLowerThirdLayout(lowerThird, glyphBounds);
  const headlineTop = layout.headline.y + glyphBounds.headline.top;
  const headlineBottom = layout.headline.y + glyphBounds.headline.bottom;
  const sourceTop = layout.source.y + glyphBounds.source.top;
  const sourceBottom = layout.source.y + glyphBounds.source.bottom;
  assert.equal(sourceTop, headlineBottom + 1 + layout.source.separation);
  assert.ok(headlineTop >= layout.outer.y + SIMPLE_CLIP_FINISHING_POLICY.lowerThird.padding.top);
  assert.ok(sourceBottom < layout.outer.y + layout.outer.height - SIMPLE_CLIP_FINISHING_POLICY.lowerThird.padding.bottom);
  assertSimpleLowerThirdPixels(layoutPixels([[glyphBounds.headline.left, headlineTop], [glyphBounds.headline.right, headlineBottom], [glyphBounds.source.left, sourceTop], [glyphBounds.source.right, sourceBottom]]), layout, glyphBounds);
  assert.throws(() => assertSimpleLowerThirdPixels(layoutPixels([[glyphBounds.headline.left, headlineTop], [glyphBounds.headline.right, headlineBottom - 1], [glyphBounds.source.left, sourceTop], [glyphBounds.source.right, sourceBottom]]), layout, glyphBounds), hasSimpleClip);
});

test('simple lower-third finishing, selected-font measurement, and pixel validation share the derived layout', () => {
  const lowerThird = validateSimpleLowerThird(wrappedLineHeadline(2), 'Example News');
  const layout = buildSimpleLowerThirdLayout(lowerThird);
  const { text } = SIMPLE_CLIP_FINISHING_POLICY.lowerThird;
  assert.equal(layout.headline.x, 96); assert.equal(layout.source.x, 96); assert.equal(text.width, 888);
  assertSimpleLowerThirdPixels(layoutPixels([[layout.headline.x, layout.headline.y], [text.x + text.width - 1, layout.headline.y + layout.headline.height - 1], [layout.source.x, layout.source.y], [text.x + text.width - 1, layout.source.y + layout.source.height - 1]]), layout);
  assert.throws(() => assertSimpleLowerThirdPixels(layoutPixels([[layout.headline.x, layout.headline.y], [text.x + text.width, layout.headline.y], [layout.source.x, layout.source.y]]), layout), hasSimpleClip);
  assert.throws(() => assertSimpleLowerThirdPixels(layoutPixels([[layout.headline.x + 5, layout.headline.y], [text.x + text.width - 1, layout.headline.y + layout.headline.height - 1], [layout.source.x, layout.source.y], [text.x + text.width - 1, layout.source.y + layout.source.height - 1]]), layout), hasSimpleClip);
  const measurement = buildSimpleLowerThirdMeasurementArgs(layout, ['font.ttf', 'simple-headline.txt', 'simple-source.txt']).join(' ');
  const finishing = buildSimpleClipFinishArgs('raw.mp4', 'candidate.mp4', layout, ['font.ttf', 'simple-headline.txt', 'simple-source.txt']).join(' ');
  for (const expression of ['fontsize=44:x=96:y=1672:boxw=888:text_align=C:line_spacing=16', 'fontsize=32:x=96:y=1832:boxw=888:text_align=C']) {
    assert.match(measurement, new RegExp(expression)); assert.match(finishing, new RegExp(expression));
  }
  assert.doesNotMatch(measurement, /Example News/);
});

test('simple finisher stages hostile article text, retains sub-eight speech coverage, and keeps FFmpeg argv-only', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); const candidate = join(directory, 'candidate.mp4');
    await writeFile(raw, 'raw'); await writeFile(font, 'font');
    const calls: any[] = []; let graph = ''; let stagedHeadline = ''; let stagedSource = '';
    const finisher = new LocalSimpleClipFinisher({
      measureLowerThird: () => undefined,
      spawn: (_command, args, options) => {
        calls.push({ args, options });
        if (args.includes('-filter_complex')) {
          graph = args[args.indexOf('-filter_complex') + 1]!;
          stagedHeadline = requireRead(join(directory, 'simple-headline.txt'));
          stagedSource = requireRead(join(directory, 'simple-source.txt'));
        }
        return child(outputFor(args));
      },
      probe: async (path) => path === raw ? rawProbe(8) : finalProbe(8),
    });
    const hostileHeadline = "quote' : ; [x] \\ % ,\nsecond line";
    const result = await finisher.finish({ rawPresenterVideoPath: raw, fontPath: font, headline: hostileHeadline, sourceDisplayName: 'Source ; [safe]', workDirectory: directory, outputPath: candidate });
    assert.equal(result.probe.durationSeconds, 8);
    assert.equal(stagedHeadline, hostileHeadline);
    assert.equal(stagedSource, 'Source ; [safe]');
    assert.doesNotMatch(graph, /\b(?:a)?trim=/);
    assert.ok(calls.some((call) => call.args.includes('-shortest')));
    assert.match(graph, /loudnorm=I=-16:LRA=11:TP=-1.5/);
    assert.match(graph, /drawbox=x=0:y=1624:w=1080:h=296:color=0x336699@0\.77:t=fill/);
    assert.doesNotMatch(graph, /color=0x336699:t=fill/);
    assert.doesNotMatch(graph, /drawbox=.*color=(?:black|0x000000)(?:@|:)/);
    assert.match(graph, /fontsize=44:x=96:y=1672:boxw=888:text_align=C:line_spacing=16/);
    assert.match(graph, /fontsize=32:x=96:y=1832:boxw=888:text_align=C/);
    assert.doesNotMatch(graph, /boxh=/);
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

test('simple finisher retains eight and fifteen-second provider coverage but rejects missing streams before FFmpeg', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); await writeFile(raw, 'raw'); await writeFile(font, 'font');
    for (const rawDuration of [8, 15] as const) {
      let calls = 0;
      const finisher = new LocalSimpleClipFinisher({ measureLowerThird: () => undefined, spawn: (_command, args) => { calls += 1; return child(outputFor(args)); }, probe: async (path) => path === raw ? rawProbe(rawDuration) : finalProbe(rawDuration) });
      await finisher.finish(request(directory, raw, font));
      assert.ok(calls > 0);
    }
    let calls = 0;
    const missingAudio = new LocalSimpleClipFinisher({ measureLowerThird: () => undefined, spawn: () => { calls += 1; return child(''); }, probe: async () => ({ ...rawProbe(8), streamTypes: ['video'] as const, audio: undefined }) });
    await assert.rejects(missingAudio.finish(request(directory, raw, font)), hasSimpleClip);
    assert.equal(calls, 0);
  });
});

test('post-probe validation enforces exact normalized output and raw-duration frame-scale tolerance', () => {
  validateSimpleFinishedCandidate(finalProbe(8 + (1 / 30)), 8);
  for (const altered of [
    { ...finalProbe(8), durationSeconds: 8.04 },
    { ...finalProbe(8), video: { ...finalProbe(8).video!, width: 720 } },
    { ...finalProbe(8), video: { ...finalProbe(8).video!, averageFrameRate: { numerator: 30000, denominator: 1001, value: 29.97 } } },
    { ...finalProbe(8), audio: { ...finalProbe(8).audio!, channels: 1 } },
    { ...finalProbe(8), streamTypes: ['video'] as const },
  ]) assert.throws(() => validateSimpleFinishedCandidate(altered, 8), hasSimpleClip);
  assert.throws(() => validateSimpleFinishedCandidate(finalProbe(8), 0), hasSimpleClip);
  assert.equal(SIMPLE_CLIP_FINISHING_POLICY.output.width, 1080);
});

test('simple finishing process failures stay bounded and never expose diagnostics', async () => {
  await withDirectory(async (directory) => {
    const raw = join(directory, 'raw.mp4'); const font = join(directory, 'approved.ttf'); await writeFile(raw, 'raw'); await writeFile(font, 'font');
    const finisher = new LocalSimpleClipFinisher({ measureLowerThird: () => undefined, maxStderrBytes: 2, spawn: (_command, args) => child(outputFor(args), args.includes('-filter_complex') ? 'secret /private/path hostile headline' : ''), probe: async (path) => path === raw ? rawProbe(8) : finalProbe(8) });
    await assert.rejects(finisher.finish(request(directory, raw, font, 8, 8)), (error: unknown) => error instanceof VidGenError && error.publicMessage === 'FFmpeg diagnostic output exceeded the supported limit.');
  });
});

test('simple finish graph has one input and no cinematic concat path', () => {
  const args = buildSimpleClipFinishArgs('raw.mp4', 'candidate.mp4', buildSimpleLowerThirdLayout(validateSimpleLowerThird('A safe headline', 'Example News')), ['font.ttf', 'simple-headline.txt', 'simple-source.txt']);
  assert.deepEqual(args.filter((item) => item === '-i').length, 1);
  const graph = args[args.indexOf('-filter_complex') + 1]!;
  assert.doesNotMatch(graph, /concat|AssemblyPlan|voiceover/i);
  assert.doesNotMatch(graph, /\b(?:a)?trim=/);
  assert.ok(args.includes('-shortest'));
});

function request(directory: string, raw: string, font: string) { return { rawPresenterVideoPath: raw, fontPath: font, headline: 'A safe headline', sourceDisplayName: 'Example News', workDirectory: directory, outputPath: join(directory, 'candidate.mp4') }; }
function wrappedLineHeadline(lineCount: number): string { return Array.from({ length: lineCount }, () => 'x'.repeat(32)).join(' '); }
function rawProbe(durationSeconds: number): LocalMediaProbe { return { durationSeconds, containerNames: ['mp4'], streamTypes: ['video', 'audio'], video: video(), audio: audio() }; }
function finalProbe(durationSeconds: number): LocalMediaProbe { return { durationSeconds, containerNames: ['mov', 'mp4'], streamTypes: ['video', 'audio'], video: video(), audio: audio() }; }
function video() { return { codecName: 'h264', width: 1080, height: 1920, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }; }
function audio() { return { codecName: 'aac', sampleRate: 48_000, channels: 2 }; }
function outputFor(args: readonly string[]): string { if (args.includes('-version')) return 'ffmpeg version fake-build\n'; if (args.includes('-encoders')) return ' V..... libx264\n A..... aac\n'; if (args.includes('-filters')) return filters; return ''; }
function child(stdoutText: string, stderrText = ''): any { const emitter = new EventEmitter() as any; emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => true; process.nextTick(() => { emitter.stdout.end(stdoutText); emitter.stderr.end(stderrText); emitter.emit('close', 0); }); return emitter; }
function requireRead(path: string): string { return readFileSync(path, 'utf8'); }
function hasSimpleClip(error: unknown): boolean { return error instanceof VidGenError && error.code === 'simple_clip'; }
function layoutPixels(points: readonly (readonly [number, number])[]): Uint8Array { const pixels = new Uint8Array(1080 * 1920); for (const [x, y] of points) pixels[(y * 1080) + x] = 255; return pixels; }
async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> { const directory = await mkdtemp(join(tmpdir(), 'vidgen-simple-finisher-')); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
