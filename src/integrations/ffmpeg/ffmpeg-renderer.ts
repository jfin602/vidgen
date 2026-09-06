import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

import type { AssemblyPlan, QualifiedMediaFile } from '../../app/assembly-input.ts';
import { VidGenError } from '../../core/error.ts';
import { assertRegularLocalFile } from './local-file.ts';

/**
 * Engine-owned rendering defaults.  P3 may safely include this descriptor in
 * provenance/fingerprints; it deliberately excludes executable paths and time.
 */
export const FFMPEG_ASSEMBLY_POLICY = Object.freeze({
  version: 'ffmpeg-assembly-policy-v1',
  videoNormalization: 'setpts-scale-fit-centered-black-pad-square-sar-target-fps',
  video: { encoder: 'libx264', crf: 20, preset: 'medium', pixelFormat: 'yuv420p' },
  audio: { encoder: 'aac', sampleRate: 48_000, channels: 2, bitrate: '192k' },
  voiceoverPolicy: 'declared-voiceover-replaces-visual-audio-then-silence-pad-trim',
  loudnorm: { filter: 'loudnorm', integratedLufs: -16, loudnessRange: 11, truePeakDb: -1.5 },
  displayTreatment: 'lower-third-drawbox-drawtext-v1',
} as const);

export const DEFAULT_FFMPEG_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_FFMPEG_STDOUT_BYTES = 64_000;
export const DEFAULT_FFMPEG_STDERR_BYTES = 128_000;
const MAX_FFMPEG_TIMEOUT_MS = 30 * 60_000;
const MAX_FFMPEG_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface FfmpegChild {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: 'error' | 'close', listener: (...args: any[]) => void): this;
  kill(): boolean;
}

export interface FfmpegDependencies {
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly spawn?: (command: string, args: readonly string[], options: SpawnOptions) => FfmpegChild;
}

export interface FfmpegRenderRequest {
  readonly assemblyPlan: AssemblyPlan;
  /** Caller-owned temporary directory. No durable output belongs here. */
  readonly workDirectory: string;
  /** Must be inside workDirectory. */
  readonly outputPath: string;
  /** Required only if any AssemblyPlan segment has display text. */
  readonly fontPath?: string;
}

export interface FfmpegRenderResult {
  readonly outputPath: string;
  readonly ffmpegVersion: string;
  readonly durationMs: number;
}

export interface FfmpegCapabilities {
  readonly version: string;
}

const REQUIRED_FILTERS = ['scale', 'pad', 'fps', 'setsar', 'trim', 'setpts', 'atrim', 'asetpts', 'aresample', 'aformat', 'apad', 'concat', 'loudnorm'] as const;
const DISPLAY_FILTERS = ['drawtext', 'drawbox'] as const;

/** A thin local-only, no-shell execution boundary for a P1-qualified plan. */
export class LocalFfmpegRenderer {
  readonly #dependencies: FfmpegDependencies;
  #capabilities?: FfmpegCapabilities;

  constructor(dependencies: FfmpegDependencies = {}) { this.#dependencies = dependencies; }

  async preflight(needsDisplayText = false): Promise<FfmpegCapabilities> {
    if (this.#capabilities !== undefined) {
      if (needsDisplayText) await this.requireDisplayFilters();
      return this.#capabilities;
    }
    const versionOutput = await this.run(['-hide_banner', '-version'], 'FFmpeg capability check failed.');
    const version = versionOutput.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim();
    if (version === undefined || !/^ffmpeg version\s+/iu.test(version)) throw configuration('FFmpeg version could not be identified.');
    const encoders = await this.run(['-hide_banner', '-encoders'], 'FFmpeg capability check failed.');
    if (!hasToken(encoders, 'libx264') || !hasToken(encoders, 'aac')) throw configuration('Configured FFmpeg lacks required H.264/AAC encoders.');
    const filters = await this.run(['-hide_banner', '-filters'], 'FFmpeg capability check failed.');
    if (!REQUIRED_FILTERS.every((filter) => hasFilter(filters, filter))) throw configuration('Configured FFmpeg lacks required assembly filters.');
    this.#capabilities = { version };
    if (needsDisplayText) await this.requireDisplayFilters(filters);
    return this.#capabilities;
  }

  async render(request: FfmpegRenderRequest): Promise<FfmpegRenderResult> {
    const needsDisplayText = request.assemblyPlan.storySegments.some((segment) => segment.displayText.length > 0);
    const { workDirectory, outputPath } = await validateRenderBoundary(request, needsDisplayText);
    const capabilities = await this.preflight(needsDisplayText);
    const staged = await stageDisplayAssets(request, workDirectory, needsDisplayText);
    const started = Date.now();
    try {
      const args = buildRenderArgs(request.assemblyPlan, outputPath, staged);
      await this.run(args, 'FFmpeg could not render the temporary candidate.', workDirectory);
      return { outputPath, ffmpegVersion: capabilities.version, durationMs: Date.now() - started };
    } finally {
      await Promise.all(staged.map((path) => rm(path, { force: true }).catch(() => undefined)));
    }
  }

  async requireDisplayFilters(filters?: string): Promise<void> {
    const observed = filters ?? await this.run(['-hide_banner', '-filters'], 'FFmpeg capability check failed.');
    if (!DISPLAY_FILTERS.every((filter) => hasFilter(observed, filter))) throw configuration('Configured FFmpeg lacks required display-text filters.');
  }

  async run(args: readonly string[], failureMessage: string, cwd?: string): Promise<string> {
    const executable = this.#dependencies.executable ?? 'ffmpeg';
    if (typeof executable !== 'string' || executable.trim().length === 0) throw configuration('FFmpeg executable is not configured.');
    const spawn = this.#dependencies.spawn ?? ((command, childArgs, options) => nodeSpawn(command, childArgs, options) as ChildProcessWithoutNullStreams);
    let child: FfmpegChild;
    try {
      child = spawn(executable, args, { shell: false, windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (cause) {
      throw configuration('Unable to start configured FFmpeg.', cause);
    }
    return collectProcessOutput(child, this.#dependencies, failureMessage);
  }
}

/** Exported for deterministic tests and P3 provenance inspection. */
export function buildRenderArgs(plan: AssemblyPlan, outputPath: string, stagedPaths: readonly string[] = []): readonly string[] {
  const args: string[] = ['-hide_banner', '-y'];
  args.push('-i', plan.standardizedAssets.intro.identity.path);
  for (const segment of plan.storySegments) {
    args.push('-i', segment.visual.identity.path);
    if (segment.voiceover !== undefined) args.push('-i', segment.voiceover.identity.path);
  }
  args.push('-i', plan.standardizedAssets.outro.identity.path);

  let cursor = 0;
  const intro = { input: cursor++, media: plan.standardizedAssets.intro };
  const stories = plan.storySegments.map((segment, segmentIndex) => {
    const visual = { input: cursor++, media: segment.visual };
    const voiceover = segment.voiceover === undefined ? undefined : { input: cursor++, media: segment.voiceover };
    return { segment, segmentIndex, visual, voiceover };
  });
  const outro = { input: cursor, media: plan.standardizedAssets.outro };
  const graph: string[] = [];
  const pairs: { readonly video: string; readonly audio: string }[] = [];
  pairs.push(normalizeStandardized(graph, intro.input, intro.media, 'intro', plan));
  for (const item of stories) pairs.push(normalizeStory(graph, item, plan, stagedPaths));
  pairs.push(normalizeStandardized(graph, outro.input, outro.media, 'outro', plan));
  graph.push(`${pairs.map((pair) => `[${pair.video}][${pair.audio}]`).join('')}concat=n=${pairs.length}:v=1:a=1[vcat][acat]`);
  graph.push(`[acat]loudnorm=I=-16:LRA=11:TP=-1.5,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[aout]`);
  args.push('-filter_complex', graph.join(';'), '-map', '[vcat]', '-map', '[aout]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(plan.output.fps), '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', outputPath);
  return args;
}

function normalizeStandardized(graph: string[], input: number, media: QualifiedMediaFile, label: string, plan: AssemblyPlan) {
  const duration = media.probe.durationSeconds;
  graph.push(videoChain(input, `${label}v`, duration, plan));
  graph.push(audioChain(input, `${label}a`, duration, media.probe.audio !== undefined));
  return { video: `${label}v`, audio: `${label}a` };
}
function normalizeStory(graph: string[], item: { readonly segment: AssemblyPlan['storySegments'][number]; readonly segmentIndex: number; readonly visual: { readonly input: number; readonly media: QualifiedMediaFile }; readonly voiceover?: { readonly input: number; readonly media: QualifiedMediaFile } }, plan: AssemblyPlan, stagedPaths: readonly string[]) {
  const label = `s${item.segmentIndex}`;
  graph.push(videoChain(item.visual.input, `${label}v0`, item.segment.targetDurationSeconds, plan));
  const stageIndex = plan.storySegments.slice(0, item.segmentIndex + 1).filter((segment) => segment.displayText.length > 0).length - 1;
  if (item.segment.displayText.length > 0) {
    // stagedPaths[0] is the staged font; display text starts at index one.
    const textFile = basename(stagedPaths[stageIndex + 1] ?? '');
    if (!/^display-\d{3}\.txt$/u.test(textFile)) throw new VidGenError('assembly', 'Display text staging failed.');
    // textfile keeps untrusted text outside the filter expression and
    // expansion=none also preserves literal percent sequences in that text.
    graph.push(`[${label}v0]drawbox=x=54:y=1480:w=972:h=300:color=black@0.72:t=fill,drawtext=fontfile=font.ttf:textfile=${textFile}:expansion=none:fontcolor=white:fontsize=54:x=90:y=1530:line_spacing=12[${label}v]`);
  } else graph.push(`[${label}v0]null[${label}v]`);
  if (item.voiceover !== undefined) graph.push(audioChain(item.voiceover.input, `${label}a`, item.segment.targetDurationSeconds, true));
  else graph.push(audioChain(item.visual.input, `${label}a`, item.segment.targetDurationSeconds, item.visual.media.probe.audio !== undefined));
  return { video: `${label}v`, audio: `${label}a` };
}
function videoChain(input: number, output: string, duration: number, plan: AssemblyPlan): string {
  return `[${input}:v:0]setpts=PTS-STARTPTS,scale=w=${plan.output.width}:h=${plan.output.height}:force_original_aspect_ratio=decrease,pad=w=${plan.output.width}:h=${plan.output.height}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,fps=${plan.output.fps},trim=duration=${seconds(duration)},setpts=PTS-STARTPTS[${output}]`;
}
function audioChain(input: number, output: string, duration: number, hasAudio: boolean): string {
  const source = hasAudio ? `[${input}:a:0]asetpts=PTS-STARTPTS` : 'anullsrc=r=48000:cl=stereo';
  return `${source},aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${seconds(duration)},asetpts=PTS-STARTPTS[${output}]`;
}
function seconds(value: number): string { if (!Number.isFinite(value) || value <= 0) throw new VidGenError('assembly', 'Assembly plan contains an invalid duration.'); return String(value); }

async function validateRenderBoundary(request: FfmpegRenderRequest, needsDisplayText: boolean): Promise<{ readonly workDirectory: string; readonly outputPath: string }> {
  if (!request || !request.assemblyPlan) throw new VidGenError('assembly', 'A validated assembly plan is required.');
  if (typeof request.workDirectory !== 'string' || request.workDirectory.trim().length === 0 || typeof request.outputPath !== 'string' || request.outputPath.trim().length === 0) throw new VidGenError('assembly', 'Render work directory and temporary output path are required.');
  const workDirectory = resolve(request.workDirectory);
  const outputPath = resolve(request.outputPath);
  const info = await stat(workDirectory).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new VidGenError('assembly', 'Render work directory is unavailable.');
  const pathFromWork = relative(workDirectory, outputPath);
  if (pathFromWork.length === 0 || pathFromWork === '..' || pathFromWork.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(workDirectory, pathFromWork) !== outputPath) throw new VidGenError('assembly', 'Temporary output path is outside the render work directory.');
  if (basename(outputPath).toLowerCase() === 'clip.mp4') throw new VidGenError('assembly', 'Renderer cannot publish a durable final clip.');
  if (needsDisplayText && request.fontPath === undefined) throw new VidGenError('assembly', 'A validated local font is required for display text.');
  if (request.fontPath !== undefined) {
    const font = await assertRegularLocalFile(request.fontPath, { maxBytes: 100_000_000 });
    if (needsDisplayText && font.path === resolve(workDirectory, 'font.ttf')) {
      throw new VidGenError('assembly', 'Font input must not use the renderer staging filename.');
    }
  }
  return { workDirectory, outputPath };
}
async function stageDisplayAssets(request: FfmpegRenderRequest, workDirectory: string, needsDisplayText: boolean): Promise<readonly string[]> {
  if (!needsDisplayText) return [];
  const paths: string[] = [];
  try {
    await mkdir(workDirectory, { recursive: true });
    const font = resolve(workDirectory, 'font.ttf');
    await copyFile(request.fontPath!, font);
    paths.push(font);
    let index = 0;
    for (const segment of request.assemblyPlan.storySegments) if (segment.displayText.length > 0) {
      const path = resolve(workDirectory, `display-${String(index++).padStart(3, '0')}.txt`);
      await writeFile(path, segment.displayText.join('\n'), { encoding: 'utf8', flag: 'wx' });
      paths.push(path);
    }
    return paths;
  } catch (cause) {
    await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    throw new VidGenError('assembly', 'Unable to stage deterministic display assets.', { cause });
  }
}
async function collectProcessOutput(child: FfmpegChild, dependencies: FfmpegDependencies, failureMessage: string): Promise<string> {
  const timeoutMs = boundedPositive(dependencies.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS, MAX_FFMPEG_TIMEOUT_MS, 'FFmpeg timeout must be positive and bounded.');
  const maxStdout = boundedPositive(dependencies.maxStdoutBytes ?? DEFAULT_FFMPEG_STDOUT_BYTES, MAX_FFMPEG_CAPTURE_BYTES, 'FFmpeg stdout limit must be positive and bounded.');
  const maxStderr = boundedPositive(dependencies.maxStderrBytes ?? DEFAULT_FFMPEG_STDERR_BYTES, MAX_FFMPEG_CAPTURE_BYTES, 'FFmpeg stderr limit must be positive and bounded.');
  return new Promise((resolvePromise, reject) => {
    const stdout: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let done = false;
    const finish = (error?: Error, value?: string) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolvePromise(value!); };
    const fail = (message: string, code: 'assembly' | 'configuration' = 'assembly', cause?: unknown) => { try { child.kill(); } catch {} finish(new VidGenError(code, message, cause === undefined ? {} : { cause })); };
    const timer = setTimeout(() => fail('FFmpeg timed out.'), timeoutMs);
    child.stdout.on('data', (value: Buffer | string) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); stdoutBytes += bytes.length; if (stdoutBytes > maxStdout) fail('FFmpeg output exceeded the supported limit.'); else stdout.push(bytes); });
    child.stderr.on('data', (value: Buffer | string) => { stderrBytes += Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value); if (stderrBytes > maxStderr) fail('FFmpeg diagnostic output exceeded the supported limit.'); });
    child.once('error', (cause) => finish(new VidGenError('configuration', 'Configured FFmpeg could not be started.', { cause })));
    child.once('close', (code: number | null) => { if (code !== 0) finish(new VidGenError('assembly', failureMessage)); else finish(undefined, Buffer.concat(stdout).toString('utf8')); });
  });
}
function boundedPositive(value: number, maximum: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new VidGenError('invalid_argument', message); return value; }
function hasToken(text: string, token: string): boolean { return new RegExp(`(^|[^A-Za-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}([^A-Za-z0-9_]|$)`, 'iu').test(text); }
function hasFilter(text: string, filter: string): boolean { return new RegExp(`\\b${filter}\\b`, 'iu').test(text); }
function configuration(message: string, cause?: unknown): VidGenError { return new VidGenError('configuration', message, cause === undefined ? {} : { cause }); }
