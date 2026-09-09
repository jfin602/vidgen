import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

import { VidGenError } from '../../core/error.ts';
import type { FfmpegDependencies, FfmpegRenderResult } from './ffmpeg-renderer.ts';
import { LocalFfmpegRenderer } from './ffmpeg-renderer.ts';
import { type FfprobeDependencies, type LocalMediaProbe, probeLocalMedia } from './ffprobe.ts';
import { assertRegularLocalFile } from './local-file.ts';

export const SIMPLE_CLIP_FINISHING_POLICY = Object.freeze({
  version: 'simple-clip-finishing-policy-v4',
  output: { width: 1080, height: 1920, fps: 30, container: 'mp4', videoCodec: 'h264', pixelFormat: 'yuv420p' },
  audio: { encoder: 'aac', sampleRate: 48_000, channels: 2, bitrate: '192k' },
  loudnorm: { integratedLufs: -16, loudnessRange: 11, truePeakDb: -1.5 },
  lowerThird: {
    version: 'headline-source-v4',
    panel: { x: 0, width: 1080, color: '0x336699', opacity: 0.77 },
    text: { x: 96, width: 888 },
    padding: { top: 48, bottom: 48 },
    headline: { fontSize: 32, lineSpacing: 8, lines: 8, charactersPerLine: 40 },
    source: { fontSize: 28, lines: 1, charactersPerLine: 32, height: 36, separation: 40 },
  },
} as const);

export const SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS = 1 / SIMPLE_CLIP_FINISHING_POLICY.output.fps;

export interface SimpleLowerThird {
  readonly headline: string;
  readonly sourceDisplayName: string;
}

export interface SimpleLowerThirdLayout {
  readonly outer: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly headline: { readonly x: number; readonly y: number; readonly fontSize: number; readonly lineSpacing: number; readonly height: number };
  readonly source: { readonly x: number; readonly y: number; readonly fontSize: number; readonly height: number; readonly separation: number };
}

export interface SimpleLowerThirdGlyphBounds {
  readonly headline: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly source: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

export interface SimpleClipFinishingRequest extends SimpleLowerThird {
  readonly rawPresenterVideoPath: string;
  readonly fontPath: string;
  readonly workDirectory: string;
  readonly outputPath: string;
}

export interface SimpleClipFinisherDependencies extends FfmpegDependencies {
  readonly ffprobe?: FfprobeDependencies;
  readonly probe?: (path: string, dependencies?: FfprobeDependencies) => Promise<LocalMediaProbe>;
  /** Test seam; production measures staged glyph pixels through FFmpeg. */
  readonly measureLowerThird?: (lowerThird: SimpleLowerThird) => void | Promise<void>;
}

export interface SimpleClipFinishResult extends FfmpegRenderResult {
  readonly rawProbe: LocalMediaProbe;
  readonly probe: LocalMediaProbe;
}

/** Validates the lower third before a caller spends on provider generation. */
export function validateSimpleLowerThird(headline: string, sourceDisplayName: string): SimpleLowerThird {
  return {
    headline: wrapFullText(headline, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.headline.charactersPerLine, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.headline.lines, 'headline'),
    sourceDisplayName: wrapFullText(sourceDisplayName, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.source.charactersPerLine, SIMPLE_CLIP_FINISHING_POLICY.lowerThird.source.lines, 'source display name'),
  };
}

/** Derives all simple-path geometry from the validated, wrapped headline. */
export function buildSimpleLowerThirdLayout(lowerThird: SimpleLowerThird, glyphBounds?: SimpleLowerThirdGlyphBounds): SimpleLowerThirdLayout {
  const { output, lowerThird: policy } = SIMPLE_CLIP_FINISHING_POLICY;
  const headlineLineCount = lowerThird.headline.split('\n').length;
  const headline = glyphBounds?.headline ?? { left: 0, right: 0, top: 0, bottom: (headlineLineCount * policy.headline.fontSize) + (Math.max(0, headlineLineCount - 1) * policy.headline.lineSpacing) - 1 };
  const source = glyphBounds?.source ?? { left: 0, right: 0, top: 0, bottom: policy.source.height - 1 };
  const headlineBlockHeight = headline.bottom - headline.top + 1;
  const sourceBlockHeight = source.bottom - source.top + 1;
  const panelHeight = policy.padding.top + headlineBlockHeight + policy.source.separation + sourceBlockHeight + policy.padding.bottom;
  const panelY = output.height - panelHeight;
  const headlineY = panelY + policy.padding.top - headline.top;
  const sourceY = headlineY + headline.bottom + 1 + policy.source.separation - source.top;
  return {
    outer: { x: policy.panel.x, y: panelY, width: policy.panel.width, height: panelHeight },
    headline: { x: policy.text.x, y: headlineY, fontSize: policy.headline.fontSize, lineSpacing: policy.headline.lineSpacing, height: headlineBlockHeight },
    source: { x: policy.text.x, y: sourceY, fontSize: policy.source.fontSize, height: sourceBlockHeight, separation: policy.source.separation },
  };
}

/** Enforces the post-render MP4 contract without exposing FFprobe output. */
export function validateSimpleFinishedCandidate(probe: LocalMediaProbe, rawDurationSeconds: number): void {
  const duration = positiveDuration(rawDurationSeconds, 'Raw presenter video duration');
  if (!probe.containerNames.includes('mp4') || probe.streamTypes.length !== 2 || probe.streamTypes.filter((type) => type === 'video').length !== 1 || probe.streamTypes.filter((type) => type === 'audio').length !== 1 || probe.video === undefined || probe.audio === undefined) throw invalidSimpleClip('Finished simple clip has an unsupported stream layout.');
  if (probe.video.codecName !== 'h264' || probe.video.width !== 1080 || probe.video.height !== 1920 || probe.video.pixelFormat !== 'yuv420p' || probe.video.averageFrameRate.numerator !== 30 || probe.video.averageFrameRate.denominator !== 1) throw invalidSimpleClip('Finished simple clip does not meet the required video format.');
  if (probe.audio.codecName !== 'aac' || probe.audio.sampleRate !== 48_000 || probe.audio.channels !== 2) throw invalidSimpleClip('Finished simple clip does not meet the required audio format.');
  if (Math.abs(probe.durationSeconds - duration) > SIMPLE_CLIP_DURATION_TOLERANCE_SECONDS) throw invalidSimpleClip('Finished simple clip duration does not preserve raw presenter coverage.');
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

  /** Validates selected-font glyph bounds before a workflow creates any provider client. */
  async preflightLowerThird(request: Pick<SimpleClipFinishingRequest, 'headline' | 'sourceDisplayName' | 'fontPath' | 'workDirectory'>): Promise<SimpleLowerThird> {
    const lowerThird = validateSimpleLowerThird(request.headline, request.sourceDisplayName);
    if (typeof request.workDirectory !== 'string' || request.workDirectory.trim().length === 0 || typeof request.fontPath !== 'string' || request.fontPath.trim().length === 0) throw invalidSimpleClip('Simple clip font and work directory are required.');
    const workDirectory = resolve(request.workDirectory);
    const info = await stat(workDirectory).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) throw invalidSimpleClip('Simple clip work directory is unavailable.');
    await assertRegularLocalFile(request.fontPath, { maxBytes: 100_000_000 });
    await this.preflight();
    const staged = await stageAssets(request.fontPath, lowerThird, workDirectory);
    try {
      const glyphBounds = this.#dependencies.measureLowerThird === undefined ? await this.#measureGlyphBounds(staged, workDirectory) : undefined;
      await this.#validateStagedLayout(lowerThird, buildSimpleLowerThirdLayout(lowerThird, glyphBounds), glyphBounds, staged, workDirectory);
      return lowerThird;
    }
    finally { await Promise.all(staged.map((path) => rm(path, { force: true }).catch(() => undefined))); }
  }

  async finish(request: SimpleClipFinishingRequest): Promise<SimpleClipFinishResult> {
    if (request === null || typeof request !== 'object') throw invalidSimpleClip('Simple clip finishing request is invalid.');
    const lowerThird = validateSimpleLowerThird(request.headline, request.sourceDisplayName);
    const { workDirectory, outputPath } = await validateBoundary(request);
    await assertRegularLocalFile(request.rawPresenterVideoPath);
    await assertRegularLocalFile(request.fontPath, { maxBytes: 100_000_000 });
    const probe = this.#dependencies.probe ?? probeLocalMedia;
    const rawProbe = await probe(request.rawPresenterVideoPath, this.#dependencies.ffprobe);
    const rawDurationSeconds = requireRawPresenterCoverage(rawProbe);
    const capabilities = await this.preflight();
    const staged = await stageAssets(request.fontPath, lowerThird, workDirectory);
    const started = Date.now();
    try {
      const glyphBounds = this.#dependencies.measureLowerThird === undefined ? await this.#measureGlyphBounds(staged, workDirectory) : undefined;
      const layout = buildSimpleLowerThirdLayout(lowerThird, glyphBounds);
      await this.#validateStagedLayout(lowerThird, layout, glyphBounds, staged, workDirectory);
      await this.#renderer.run(buildSimpleClipFinishArgs(request.rawPresenterVideoPath, outputPath, layout, staged), 'FFmpeg could not finish the simple clip candidate.', workDirectory);
      const candidateProbe = await probe(outputPath, this.#dependencies.ffprobe);
      validateSimpleFinishedCandidate(candidateProbe, rawDurationSeconds);
      return { outputPath, ffmpegVersion: capabilities.version, durationMs: Date.now() - started, rawProbe, probe: candidateProbe };
    } finally {
      await Promise.all(staged.map((path) => rm(path, { force: true }).catch(() => undefined)));
    }
  }

  async #measureGlyphBounds(stagedPaths: readonly string[], workDirectory: string): Promise<SimpleLowerThirdGlyphBounds> {
    const pixelsPath = resolve(workDirectory, 'simple-lower-third-layout.raw');
    try {
      await this.#renderer.run(buildSimpleLowerThirdIntrinsicMeasurementArgs(stagedPaths), 'FFmpeg could not measure simple lower-third text.', workDirectory);
      return simpleLowerThirdGlyphBounds(await readFile(pixelsPath));
    } finally { await rm(pixelsPath, { force: true }).catch(() => undefined); }
  }

  async #validateStagedLayout(lowerThird: SimpleLowerThird, layout: SimpleLowerThirdLayout, glyphBounds: SimpleLowerThirdGlyphBounds | undefined, stagedPaths: readonly string[], workDirectory: string): Promise<void> {
    if (this.#dependencies.measureLowerThird !== undefined) return this.#dependencies.measureLowerThird(lowerThird);
    const pixelsPath = resolve(workDirectory, 'simple-lower-third-layout.raw');
    try {
      await this.#renderer.run(buildSimpleLowerThirdMeasurementArgs(layout, stagedPaths), 'FFmpeg could not validate simple lower-third layout.', workDirectory);
      assertSimpleLowerThirdPixels(await readFile(pixelsPath), layout, glyphBounds);
    } finally { await rm(pixelsPath, { force: true }).catch(() => undefined); }
  }
}

/** Exported so the simple graph can be inspected without a cinematic plan. */
export function buildSimpleClipFinishArgs(rawPresenterVideoPath: string, outputPath: string, layout: SimpleLowerThirdLayout, stagedPaths: readonly string[]): readonly string[] {
  const [fontPath, headlinePath, sourcePath] = stagedPaths.map((path) => basename(path));
  if (fontPath !== 'font.ttf' || headlinePath !== 'simple-headline.txt' || sourcePath !== 'simple-source.txt') throw invalidSimpleClip('Simple clip display staging failed.');
  const graph = [
    `[0:v:0]setpts=PTS-STARTPTS,scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=w=1080:h=1920:x=(ow-iw)/2:y=(oh-ih)/2:color=black,setsar=1,fps=30,drawbox=x=${layout.outer.x}:y=${layout.outer.y}:w=${layout.outer.width}:h=${layout.outer.height}:color=${SIMPLE_CLIP_FINISHING_POLICY.lowerThird.panel.color}@${SIMPLE_CLIP_FINISHING_POLICY.lowerThird.panel.opacity}:t=fill,${lowerThirdDrawtext('simple-headline.txt', layout.headline)},${lowerThirdDrawtext('simple-source.txt', layout.source)}[vout]`,
    `[0:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,asetpts=PTS-STARTPTS,loudnorm=I=-16:LRA=11:TP=-1.5,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[aout]`,
  ].join(';');
  return ['-hide_banner', '-y', '-i', rawPresenterVideoPath, '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-shortest', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', outputPath];
}

/** Renders the actual staged font/text once into pixels; no article text enters this graph. */
export function buildSimpleLowerThirdMeasurementArgs(layout: SimpleLowerThirdLayout, stagedPaths: readonly string[]): readonly string[] {
  const [fontPath, headlinePath, sourcePath] = stagedPaths.map((path) => basename(path));
  if (fontPath !== 'font.ttf' || headlinePath !== 'simple-headline.txt' || sourcePath !== 'simple-source.txt') throw invalidSimpleClip('Simple clip display staging failed.');
  const { output } = SIMPLE_CLIP_FINISHING_POLICY;
  const graph = `${lowerThirdDrawtext('simple-headline.txt', layout.headline)},${lowerThirdDrawtext('simple-source.txt', layout.source)}`;
  return ['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${output.width}x${output.height}:r=1`, '-vf', graph, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'simple-lower-third-layout.raw'];
}

/** Measures uncropped selected-font glyphs before assigning their final boxes. */
export function buildSimpleLowerThirdIntrinsicMeasurementArgs(stagedPaths: readonly string[]): readonly string[] {
  const [fontPath, headlinePath, sourcePath] = stagedPaths.map((path) => basename(path));
  if (fontPath !== 'font.ttf' || headlinePath !== 'simple-headline.txt' || sourcePath !== 'simple-source.txt') throw invalidSimpleClip('Simple clip display staging failed.');
  const { output, lowerThird } = SIMPLE_CLIP_FINISHING_POLICY;
  const headline = { x: lowerThird.text.x, y: 0, fontSize: lowerThird.headline.fontSize, lineSpacing: lowerThird.headline.lineSpacing };
  const source = { x: lowerThird.text.x, y: output.height / 2, fontSize: lowerThird.source.fontSize };
  return ['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${output.width}x${output.height}:r=1`, '-vf', `${lowerThirdDrawtext('simple-headline.txt', headline)},${lowerThirdDrawtext('simple-source.txt', source)}`, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'simple-lower-third-layout.raw'];
}

/** Rejects any actual rendered glyph outside its assigned safe-area block. */
export function assertSimpleLowerThirdPixels(pixels: Uint8Array, layout: SimpleLowerThirdLayout, expected?: SimpleLowerThirdGlyphBounds): void {
  const { output, lowerThird } = SIMPLE_CLIP_FINISHING_POLICY;
  if (pixels.byteLength !== output.width * output.height) throw invalidSimpleClip('Simple lower-third measurement output was invalid.');
  const background = pixels[0]!;
  const expectedSourceTop = expected === undefined ? layout.source.y : layout.source.y + expected.source.top;
  const headline = pixelBounds(pixels, expected === undefined ? layout.headline.y : layout.outer.y, expectedSourceTop, output.width, background);
  const source = pixelBounds(pixels, expectedSourceTop, expected === undefined ? layout.source.y + layout.source.height : layout.outer.y + layout.outer.height, output.width, background);
  const inside = (bounds: PixelBounds) => bounds.left >= lowerThird.text.x && bounds.right < lowerThird.text.x + lowerThird.text.width && bounds.top >= layout.outer.y + lowerThird.padding.top && bounds.bottom < layout.outer.y + layout.outer.height - lowerThird.padding.bottom;
  const centered = (bounds: PixelBounds) => Math.abs((bounds.left + bounds.right) - ((lowerThird.text.x * 2) + lowerThird.text.width - 1)) <= 4;
  const sameSize = (actual: PixelBounds, intrinsic: PixelBounds) => actual.right - actual.left === intrinsic.right - intrinsic.left && actual.bottom - actual.top === intrinsic.bottom - intrinsic.top;
  if (layout.outer.y < 0 || headline === undefined || source === undefined || !inside(headline) || !inside(source) || !centered(headline) || !centered(source) || source.top !== headline.bottom + 1 + layout.source.separation || (expected !== undefined && (!sameSize(headline, expected.headline) || !sameSize(source, expected.source)))) throw invalidSimpleClip('Simple clip text cannot fit the deterministic lower-third safe area.');
}

function lowerThirdDrawtext(textFile: string, text: { readonly x: number; readonly y: number; readonly fontSize: number; readonly height?: number; readonly lineSpacing?: number }): string {
  return `drawtext=fontfile=font.ttf:textfile=${textFile}:expansion=none:fontcolor=white:fontsize=${text.fontSize}:x=${text.x}:y=${text.y}:boxw=${SIMPLE_CLIP_FINISHING_POLICY.lowerThird.text.width}:text_align=C${text.lineSpacing === undefined ? '' : `:line_spacing=${text.lineSpacing}`}`;
}

interface PixelBounds { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; }
function pixelBounds(pixels: Uint8Array, startY: number, endY: number, width: number, background: number): PixelBounds | undefined {
  let left = width; let right = -1; let top = endY; let bottom = -1;
  for (let y = startY; y < endY; y += 1) for (let x = 0; x < width; x += 1) if (pixels[(y * width) + x] !== background) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return right < 0 ? undefined : { left, right, top, bottom };
}

function simpleLowerThirdGlyphBounds(pixels: Uint8Array): SimpleLowerThirdGlyphBounds {
  const { output } = SIMPLE_CLIP_FINISHING_POLICY;
  if (pixels.byteLength !== output.width * output.height) throw invalidSimpleClip('Simple lower-third measurement output was invalid.');
  const background = pixels[0]!;
  const headline = pixelBounds(pixels, 0, output.height / 2, output.width, background);
  const source = pixelBounds(pixels, output.height / 2, output.height, output.width, background);
  if (headline === undefined || source === undefined || headline.bottom === (output.height / 2) - 1 || source.bottom === output.height - 1) throw invalidSimpleClip('Simple clip text cannot fit the deterministic lower-third safe area.');
  return { headline, source: { ...source, top: source.top - (output.height / 2), bottom: source.bottom - (output.height / 2) } };
}

function requireRawPresenterCoverage(probe: LocalMediaProbe): number {
  if (probe.streamTypes.length !== 2 || probe.streamTypes.filter((type) => type === 'video').length !== 1 || probe.streamTypes.filter((type) => type === 'audio').length !== 1 || probe.video === undefined || probe.audio === undefined) throw invalidSimpleClip('Raw presenter video requires one usable video stream and one usable audio stream.');
  return positiveDuration(probe.durationSeconds, 'Raw presenter video duration');
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw invalidSimpleClip(`${label} must be positive.`);
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
    lines.push(line.trimEnd());
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

async function stageAssets(fontPath: string, lowerThird: SimpleLowerThird, workDirectory: string): Promise<readonly string[]> {
  const paths: string[] = [];
  try {
    await mkdir(workDirectory, { recursive: true });
    for (const [name, content] of [['font.ttf', undefined], ['simple-headline.txt', lowerThird.headline], ['simple-source.txt', lowerThird.sourceDisplayName]] as const) {
      const path = resolve(workDirectory, name);
      if (content === undefined) await copyFile(fontPath, path); else await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
      paths.push(path);
    }
    return paths;
  } catch (cause) {
    await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    throw new VidGenError('simple_clip', 'Unable to stage simple clip display assets.', { cause });
  }
}

function invalidSimpleClip(message: string): VidGenError { return new VidGenError('simple_clip', message); }
