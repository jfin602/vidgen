import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import type { AssemblyPlan } from '../../../src/app/assembly-input.ts';
import { buildRenderArgs, FFMPEG_ASSEMBLY_POLICY, LocalFfmpegRenderer } from '../../../src/integrations/ffmpeg/ffmpeg-renderer.ts';
import { VidGenError } from '../../../src/core/error.ts';

const capabilityFilters = ' ... scale ... pad ... fps ... setsar ... trim ... setpts ... atrim ... asetpts ... aresample ... aformat ... apad ... concat ... loudnorm ... drawtext ... drawbox ... ';
const capabilityEncoders = ' V..... libx264\n A..... aac\n';

test('capability preflight is argv-only and fails closed for missing operations', async () => {
  const calls: any[] = [];
  const renderer = new LocalFfmpegRenderer({ executable: 'fake-ffmpeg', spawn: (command, args, options) => { calls.push({ command, args, options }); return child(outputFor(args)); } });
  const facts = await renderer.preflight();
  assert.equal(facts.version, 'ffmpeg version fake-build');
  assert.deepEqual(calls.map((call) => call.args), [['-hide_banner', '-version'], ['-hide_banner', '-encoders'], ['-hide_banner', '-filters']]);
  assert.ok(calls.every((call) => call.options.shell === false));
  await assert.rejects(new LocalFfmpegRenderer({ spawn: (_command, args) => child(args.includes('-encoders') ? 'A..... aac' : outputFor(args)) }).preflight(), hasConfiguration);
  await assert.rejects(new LocalFfmpegRenderer({ spawn: (_command, args) => child(args.includes('-filters') ? capabilityFilters.replace(' loudnorm ', ' ') : outputFor(args)) }).preflight(), hasConfiguration);
  await assert.doesNotReject(new LocalFfmpegRenderer({ spawn: (_command, args) => child(args.includes('-filters') ? capabilityFilters.replace(' drawtext ', ' ').replace(' drawbox ', ' ') : outputFor(args)) }).preflight(false));
  await assert.rejects(new LocalFfmpegRenderer({ spawn: (_command, args) => child(args.includes('-filters') ? capabilityFilters.replace(' drawtext ', ' ') : outputFor(args)) }).preflight(true), hasConfiguration);
});

test('renderer builds one deterministic graph with explicit stream maps and exact timelines', async () => {
  await withWorkingDirectory(async (workDirectory) => {
    let renderArgs: readonly string[] | undefined;
    const renderer = new LocalFfmpegRenderer({ spawn: (_command, args) => { if (args.includes('-filter_complex')) renderArgs = args; return child(outputFor(args)); } });
    const result = await renderer.render({ assemblyPlan: plan(), workDirectory, outputPath: join(workDirectory, 'candidate.mp4') });
    assert.equal(result.outputPath, join(workDirectory, 'candidate.mp4'));
    const args = renderArgs!; const graph = args[args.indexOf('-filter_complex') + 1]!;
    assert.deepEqual(inputPaths(args), ['intro.mp4', 'hook.mp4', 'content.mp4', 'voice.wav', 'support.mp4', 'closing.mp4', 'outro.mp4']);
    assert.match(graph, /\[0:v:0\].*trim=duration=2/);
    assert.match(graph, /\[1:v:0\].*trim=duration=5/);
    assert.match(graph, /\[2:v:0\].*trim=duration=10/);
    assert.match(graph, /\[4:v:0\].*trim=duration=13/);
    assert.match(graph, /\[5:v:0\].*trim=duration=12/);
    assert.match(graph, /\[6:v:0\].*trim=duration=3/);
    assert.match(graph, /\[3:a:0\]asetpts=PTS-STARTPTS.*apad,atrim=duration=10/);
    assert.doesNotMatch(graph, /\[2:a:0\]/); // content native audio is replaced by u03 voiceover
    assert.match(graph, /\[1:a:0\]asetpts=PTS-STARTPTS/); // presenter audio survives
    assert.match(graph, /anullsrc=r=48000:cl=stereo/); // closing and standardized silence
    assert.match(graph, /scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=w=1080:h=1920:x=\(ow-iw\)\/2:y=\(oh-ih\)\/2:color=black,setsar=1,fps=30/);
    assert.match(graph, /concat=n=6:v=1:a=1\[vcat\]\[acat\]/);
    assert.match(graph, /loudnorm=I=-16:LRA=11:TP=-1.5/);
    assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '[vcat]', '-map', '[aout]']);
    for (const option of ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4']) assert.ok(args.includes(option));
    assert.equal(FFMPEG_ASSEMBLY_POLICY.loudnorm.integratedLufs, -16);
  });
});

test('display text and font are staged under safe filenames and hostile text cannot alter the graph', async () => {
  await withWorkingDirectory(async (workDirectory) => {
    const fontPath = join(workDirectory, 'caller-font.ttf'); await writeFile(fontPath, 'font');
    const hostile = "quote' : ; [x] \\ % ,\nsecond line";
    let graph = ''; let stagedText = '';
    const renderer = new LocalFfmpegRenderer({ spawn: (_command, args) => {
      if (args.includes('-filter_complex')) { graph = args[args.indexOf('-filter_complex') + 1]!; stagedText = requireRead(join(workDirectory, 'display-000.txt')); }
      return child(outputFor(args));
    } });
    await renderer.render({ assemblyPlan: plan([hostile]), workDirectory, outputPath: join(workDirectory, 'candidate.mp4'), fontPath });
    assert.equal(stagedText, hostile);
    assert.match(graph, /drawbox=.*drawtext=fontfile=font\.ttf:textfile=display-000\.txt:expansion=none/);
    assert.doesNotMatch(graph, /quote|second line|\[x\]|\\/);
    assert.equal(graph.split(';').length, 18); // hostile semicolon cannot add a graph node
    await assert.rejects(readFile(join(workDirectory, 'display-000.txt')), /ENOENT/);
    await assert.rejects(readFile(join(workDirectory, 'font.ttf')), /ENOENT/);
  });
});

test('renderer requires a font only for display and reports bounded safe process failures', async () => {
  await withWorkingDirectory(async (workDirectory) => {
    let calls = 0;
    await assert.rejects(new LocalFfmpegRenderer({ spawn: () => { calls += 1; return child(''); } }).render({ assemblyPlan: plan(['text']), workDirectory, outputPath: join(workDirectory, 'candidate.mp4') }), hasAssembly);
    assert.equal(calls, 0);
    await assert.rejects(new LocalFfmpegRenderer({ spawn: () => child('secret absolute path and hostile text', '', 1) }).render({ assemblyPlan: plan(), workDirectory, outputPath: join(workDirectory, 'candidate.mp4') }), (error: unknown) => error instanceof VidGenError && error.publicMessage === 'FFmpeg capability check failed.');
    let terminated = false;
    await assert.rejects(new LocalFfmpegRenderer({ timeoutMs: 5, spawn: () => silentChild(() => { terminated = true; }) }).preflight(), (error: unknown) => error instanceof VidGenError && error.publicMessage === 'FFmpeg timed out.');
    assert.equal(terminated, true);
    await assert.rejects(new LocalFfmpegRenderer({ maxStdoutBytes: 2, spawn: () => child('too much output') }).preflight(), hasAssembly);
    await assert.rejects(new LocalFfmpegRenderer({ spawn: () => child('') }).render({ assemblyPlan: plan(), workDirectory, outputPath: join(workDirectory, '..', 'outside.mp4') }), hasAssembly);
    await assert.rejects(new LocalFfmpegRenderer({ spawn: () => child('') }).render({ assemblyPlan: plan(), workDirectory, outputPath: join(workDirectory, 'clip.mp4') }), hasAssembly);
    const stagePath = join(workDirectory, 'font.ttf'); await writeFile(stagePath, 'font');
    await assert.rejects(new LocalFfmpegRenderer({ spawn: () => child('') }).render({ assemblyPlan: plan(['text']), workDirectory, outputPath: join(workDirectory, 'candidate.mp4'), fontPath: stagePath }), hasAssembly);
  });
});

test('renderer includes only supplied standardized wrappers in canonical composition order', () => {
  const full = plan();
  for (const [assets, paths, pairs] of [
    [full.standardizedAssets, ['intro.mp4', 'hook.mp4', 'content.mp4', 'voice.wav', 'support.mp4', 'closing.mp4', 'outro.mp4'], 6],
    [{ intro: full.standardizedAssets.intro }, ['intro.mp4', 'hook.mp4', 'content.mp4', 'voice.wav', 'support.mp4', 'closing.mp4'], 5],
    [{ outro: full.standardizedAssets.outro }, ['hook.mp4', 'content.mp4', 'voice.wav', 'support.mp4', 'closing.mp4', 'outro.mp4'], 5],
    [{}, ['hook.mp4', 'content.mp4', 'voice.wav', 'support.mp4', 'closing.mp4'], 4],
  ] as const) {
    const args = buildRenderArgs({ ...full, standardizedAssets: assets, expectedFinalDurationSeconds: 40 + (assets.intro?.probe.durationSeconds ?? 0) + (assets.outro?.probe.durationSeconds ?? 0) }, 'candidate.mp4');
    assert.deepEqual(inputPaths(args), paths);
    assert.match(args[args.indexOf('-filter_complex') + 1]!, new RegExp(`concat=n=${pairs}:v=1:a=1`));
  }
});

function plan(displayText: readonly string[] = []): AssemblyPlan {
  const video = (path: string, duration: number, audio = false) => ({ identity: { path, basename: path, byteSize: 1, sha256: 'a'.repeat(64) }, probe: { durationSeconds: duration, containerNames: ['mp4'], streamTypes: audio ? ['video', 'audio'] as const : ['video'] as const, video: { codecName: 'h264', width: 720, height: 1280, pixelFormat: 'yuv420p', averageFrameRate: { numerator: 30, denominator: 1, value: 30 } }, ...(audio ? { audio: { codecName: 'aac', sampleRate: 48000, channels: 2 } } : {}) } });
  const voice = { identity: { path: 'voice.wav', basename: 'voice.wav', byteSize: 1, sha256: 'b'.repeat(64) }, probe: { durationSeconds: 9, containerNames: ['wav'], streamTypes: ['audio'] as const, audio: { codecName: 'pcm_s16le', sampleRate: 24000, channels: 1 } }, unitId: 'u03', role: { id: 'voice', kind: 'voiceover' as const }, segment: { id: 'content', startSeconds: 5, endSeconds: 15 }, targetDurationSeconds: 10 };
  const segment = (id: string, startSeconds: number, endSeconds: number, path: string, audio: boolean, text: readonly string[] = []) => ({ id, startSeconds, endSeconds, targetDurationSeconds: endSeconds - startSeconds, visual: { ...video(path, endSeconds - startSeconds, audio), unitId: `visual-${id}`, role: { id: `role-${id}`, kind: 'presenter' as const }, segment: { id, startSeconds, endSeconds }, targetDurationSeconds: endSeconds - startSeconds }, displayText: text });
  const content = segment('content', 5, 15, 'content.mp4', true); return { storyRunId: 'run', storyFingerprint: 'c'.repeat(64), clipPlanFingerprint: 'd'.repeat(64), generatedMediaFingerprint: 'e'.repeat(64), template: { id: 'test-template', version: '1' }, output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264' }, standardizedAssets: { intro: video('intro.mp4', 2), outro: video('outro.mp4', 3) }, storyDurationSeconds: 40, expectedFinalDurationSeconds: 45, storySegments: [segment('hook', 0, 5, 'hook.mp4', true, displayText), { ...content, voiceover: voice }, segment('support', 15, 28, 'support.mp4', true), segment('closing', 28, 40, 'closing.mp4', false)] };
}
function outputFor(args: readonly string[]): string { if (args.includes('-version')) return 'ffmpeg version fake-build\n'; if (args.includes('-encoders')) return capabilityEncoders; if (args.includes('-filters')) return capabilityFilters; return ''; }
function child(stdoutText: string, stderrText = '', code = 0): any { const emitter = new EventEmitter() as any; emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => true; process.nextTick(() => { emitter.stdout.end(stdoutText); emitter.stderr.end(stderrText); emitter.emit('close', code); }); return emitter; }
function silentChild(onKill: () => void = () => undefined): any { const emitter = new EventEmitter() as any; emitter.stdout = new PassThrough(); emitter.stderr = new PassThrough(); emitter.kill = () => { onKill(); return true; }; return emitter; }
function inputPaths(args: readonly string[]): string[] { return args.flatMap((arg, index) => arg === '-i' ? [args[index + 1]!] : []); }
function requireRead(path: string): string { return readFileSync(path, 'utf8'); }
function hasAssembly(error: unknown): boolean { return error instanceof VidGenError && error.code === 'assembly'; }
function hasConfiguration(error: unknown): boolean { return error instanceof VidGenError && error.code === 'configuration'; }
async function withWorkingDirectory(run: (directory: string) => Promise<void>): Promise<void> { const directory = await mkdtemp(join(tmpdir(), 'vidgen-render-')); try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); } }
