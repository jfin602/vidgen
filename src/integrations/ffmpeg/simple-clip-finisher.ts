import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

import { VidGenError } from '../../core/error.ts';
import { assertSimpleClipMaxSeconds } from '../../core/simple-clip-copy.ts';
import type { FfmpegDependencies, FfmpegRenderResult } from './ffmpeg-renderer.ts';
import { LocalFfmpegRenderer } from './ffmpeg-renderer.ts';
import { type FfprobeDependencies, type LocalMediaProbe, probeLocalMedia } from './ffprobe.ts';
import { assertRegularLocalFile } from './local-file.ts';

export const SIMPLE_CLIP_FINISHING_POLICY = Object.freeze({
  version: 'simple-clip-finishing-policy-v1',
  output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264', pixelFormat: 'yuv420p' },
  audio: { encoder: 'aac', sampleRate: 48_000, channels: 2, bitrate: '192k' },
  loudnorm: { integratedLufs: -16, loudnessRange: 11, truePeakDb: -1.5 },
  lowerThird: { version: 'headline-source-v1', headlineLines: 3, sourceLines: 1, charactersPerLine: 42 },
} as const);

export const SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS = 1 / SIMPLE_CLIP_FINISHING_POLICY.output.fps;

export interface SimpleLowerThird {
  readonly headline: string;
  readonly sourceDisplayName: string;
}

export interface SimpleClipFinishingRequest extends SimpleLowerThird {
  readonly rawPresenterVideoPath: string;
  readonly fontPath: string;
  readonly maxSeconds: number;
  /** Actual final duration selected by the provider plan, not merely its ceiling. */
  readonly plannedDurationSeconds: number;
  readonly workDirectory: string;
  readonly outputPath: string;
}

export interface SimpleClipFinisherDependencies extends FfmpegDependencies {
  readonly ffprobe?: FfprobeDependencies;
  readonly probe?: (path: string, dependencies?: FfprobeDependencies) => Promise<LocalMediaProbe>;
}

export interface SimpleClipFinishResult extends FfmpegRenderResult {
  readonly probe: LocalMediaProbe;
}

/** Validates the lower third before a caller spends on provider generation. */
export function validateSimpleLowerThird(headline: string, sourceDisplayName: string): SimpleLowerThird {
  return {
    headline: wrapFullText(headline, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.charactersPerLine, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.headlineLines, 'headline'),
    sourceDisplayName: wrapFullText(sourceDisplayName, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.charactersPerLine, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.sourceLines, 'source display name'),
  };
}

/** Enforces the post-render MP4 contract without exposing FFprobe output. */
export function validateSimpleFinishedCandidate(probe: LocalMediaProbe, request: Pick<SimpleClipFinishingRequest, 'maxSeconds' | 'plannedDurationSeconds'>): void {
  const duration = validateDurationRequest(request);
  if (!probe.containerNames.includes('mp4') || probe.streamTypes.length !== 2 || probe.streamTypes.filter((type) => type === 'video').length !== 1 || probe.streamTypes.filter((type) => type === 'audio').length !== 1 || probe.video === undefined || probe.audio === undefined) throw invalidSimpleClip('Finished simple clip has an unsupported stream layout.');
  if (probe.video.codecName !== 'h264' || probe.video.width !== 1080 || probe.video.height !== 1920 || probe.video.pixelFormat !== 'yuv420p' || probe.video.averageFrameRate.numerator !== 30 || probe.video.averageFrameRate.denominator !== 1) throw invalidSimpleClip('Finished simple clip does not meet the required video format.');
  if (probe.audio.codecName !== 'aac' || probe.audio.sampleRate !== 48_000 || probe.audio.channels !== 2) throw invalidSimpleClip('Finished simple clip does not meet the required audio format.');
  if (Math.abs(probe.durationSeconds - duration) > SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS || probe.durationSeconds > request.maxSeconds + SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS) throw invalidSimpleClip('Finished simple clip duration does not match the planned duration.');
}

/** One raw presenter video becomes one normalized lower-third candidate. */
export class LocalSimpleClipFinisher {
  readonly #dependencies: SimpleClipFinisherDependencies;
  readonly #renderer: LocalFfmpegRenderer;

  constructor(dependencies: SimpleClipFinisherDependencies = {}) {
    this.#dependencies = dependencies;
    this.#renderer = new LocalFfmpegRenderer(dependencies);
  }

  async preflight(): Promise<{ readonly version: string }> { return this.#renderer.preflight(true); }

  async finish(request: SimpleClipFinishingRequest): Promise<SimpleClipFinishResult> {
    if (request === null || typeof request !== 'object') throw invalidSimpleClip('Simple clip finishing request is invalid.');
    const lowerThird = validateSimpleLowerThird(request.headline, request.sourceDisplayName);
    const duration = validateDurationRequest(request);
    const { workDirectory, outputPath } = await validateBoundary(request);
    await assertRegularLocalFile(request.rawPresenterVideoPath);
    await assertRegularLocalFile(request.fontPath, { maxBytes: 100_000_000 });
    const probe = this.#dependencies.probe ?? probeLocalMedia;
    const rawProbe = await probe(request.rawPresenterVideoPath, this.#dependencies.ffprobe);
    requireRawPresenterCoverage(rawProbe, duration);
    const capabilities = await this.preflight();
    const staged = await stageAssets(request, lowerThird, workDirectory);
    const started = Date.now();
    try {
      await this.#renderer.run(buildSimpleClipFinishArgs(request.rawPresenterVideoPath, outputPath, duration, staged), 'FFmpeg could not finish the simple clip candidate.', workDirectory);
      const candidateProbe = await probe(outputPath, this.#dependencies.ffprobe);
      validateSimpleFinishedCandidate(candidateProbe, request);
      return { outputPath, ffmpegVersion: capabilities.version, durationMs: Date.now() - started, probe: candidateProbe };
    } finally {
      await Promise.all(staged.map((path) => rm(path, { force: true }).catch(() => undefined)));
    }
  }
}

/** Exported so the simple graph can be inspected without a cinematic plan. */
export function buildSimpleClipFinishArgs(rawPresenterVideoPath: string, outputPath: string, plannedDurationSeconds: number, stagedPaths: readonly string[]): readonly string[] {
  const duration = positiveDuration(plannedDurationSeconds);
  const [fontPath, headlinePath, sourcePath] = stagedPaths.map((path) => basename(path));
  if (fontPath !== 'font.ttf' || headlinePath !== 'simple-headline.txt' || sourcePath !== 'simple-source.txt') throw invalidSimpleClip('Simple clip display staging failed.');
  const graph = [
    `[0:v:0]setpts=PTS-STARTPTS,scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=w=1080:h=1920:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,fps=30,trim=duration=${duration},setpts=PTS-STARTPTS,drawbox=x=54:y=1410:w=972:h=390:color=black@0.72:t=fill,drawtext=fontfile=font.ttf:textfile=simple-headline.txt:expansion=none:fontcolor=white:fontsize=54:x=90:y=1460:line_spacing=12,drawtext=fontfile=font.ttf:textfile=simple-source.txt:expansion=none:fontcolor=white:fontsize=36:x=90:y=1730[vout]`,
    `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS,loudnorm=I=-16:LRA=11:TP=-1.5,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[aout]`,
  ].join(';');
  return ['-hide_banner', '-y', '-i', rawPresenterVideoPath, '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', outputPath];
}

function requireRawPresenterCoverage(probe: LocalMediaProbe, duration: number): void {
  if (probe.streamTypes.length !== 2 || probe.streamTypes.filter((type) => type === 'video').length !== 1 || probe.streamTypes.filter((type) => type === 'audio').length !== 1 || probe.video === undefined || probe.audio === undefined) throw invalidSimpleClip('Raw presenter video requires one usable video stream and one usable audio stream.');
  if (probe.durationSeconds + SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS < duration) throw invalidSimpleClip('Raw presenter video is shorter than the planned final duration.');
}

function validateDurationRequest(request: Pick<SimpleClipFinishingRequest, 'maxSeconds' | 'plannedDurationSeconds'>): number {
  assertSimpleClipMaxSeconds(request.maxSeconds);
  const duration = positiveDuration(request.plannedDurationSeconds);
  if (duration > request.maxSeconds) throw invalidSimpleClip('Planned final duration exceeds maxSeconds.');
  return duration;
}

function positiveDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) throw invalidSimpleClip('Planned final duration must be a whole number from 1 through 20.');
  return value;
}

function wrapFullText(value: string, charactersPerLine: number, maximumLines: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > (charactersPerLine * maximumLines) + maximumLines - 1 || value.trim() !== value || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value)) throw invalidSimpleClip(`Simple clip ${label} must be non-blank display text.`);
  const lines: string[] = [];
  let line = '';
  for (const token of value.split(/(\s+)/u)) {
    if (token.length === 0) continue;
    if (/\n/u.test(token)) {
      const parts = token.split(/(\n)/u);
      for (const part of parts) {
        if (part === '\n') { lines.push(line); line = ''; }
        else line += part;
      }
      continue;
    }
    if (line.length + token.length <= charactersPerLine) { line += token; continue; }
    if (/^\s+$/u.test(token)) { line += token; continue; }
    if (line.trim().length === 0 || token.length > charactersPerLine) throw invalidSimpleClip(`Simple clip ${label} cannot fit the deterministic lower third.`);
    lines.push(line);
    line = token;
  }
  lines.push(line);
  if (lines.length > maximumLines || lines.some((line) => line.length > charactersPerLine || line.trim().length === 0)) throw invalidSimpleClip(`Simple clip ${label} cannot fit the deterministic lower third.`);
  return lines.join('\n');
}

async function validateBoundary(request: SimpleClipFinishingRequest): Promise<{ readonly workDirectory: string; readonly outputPath: string }> {
  if (typeof request.workDirectory !== 'string' || request.workDirectory.trim().length === 0 || typeof request.outputPath !== 'string' || request.outputPath.trim().length === 0 || typeof request.rawPresenterVideoPath !== 'string' || request.rawPresenterVideoPath.trim().length === 0 || typeof request.fontPath !== 'string' || request.fontPath.trim().length === 0) throw invalidSimpleClip('Simple clip local inputs, work directory, and candidate path are required.');
  const workDirectory = resolve(request.workDirectory); const outputPath = resolve(request.outputPath);
  const info = await stat(workDirectory).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw invalidSimpleClip('Simple clip work directory is unavailable.');
  const fromWork = relative(workDirectory, outputPath);
  if (fromWork.length === 0 || fromWork === '..' || fromWork.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(workDirectory, fromWork) !== outputPath || basename(outputPath).toLowerCase() === 'clip.mp4') throw invalidSimpleClip('Simple clip candidate path is outside its work directory.');
  if (resolve(request.fontPath) === resolve(workDirectory, 'font.ttf') || resolve(request.rawPresenterVideoPath) === outputPath) throw invalidSimpleClip('Simple clip inputs must not use engine staging or candidate paths.');
  return { workDirectory, outputPath };
}

async function stageAssets(request: SimpleClipFinishingRequest, lowerThird: SimpleLowerThird, workDirectory: string): Promise<readonly string[]> {
  const paths: string[] = [];
  try {
    await mkdir(workDirectory, { recursive: true });
    for (const [name, content] of [['font.ttf', undefined], ['simple-headline.txt', lowerThird.headline], ['simple-source.txt', lowerThird.sourceDisplayName]] as const) {
      const path = resolve(workDirectory, name);
      if (content === undefined) await copyFile(request.fontPath, path); else await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
      paths.push(path);
    }
    return paths;
  } catch (cause) {
    await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    throw new VidGenError('simple_clip', 'Unable to stage simple clip display assets.', { cause });
  }
}

function invalidSimpleClip(message: string): VidGenError { return new VidGenError('simple_clip', message); }
