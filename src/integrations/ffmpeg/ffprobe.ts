import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';

import { VidGenError } from '../../core/error.ts';
import { assertRegularLocalFile } from './local-file.ts';

export const DEFAULT_FFPROBE_TIMEOUT_MS = 15_000;
export const DEFAULT_FFPROBE_STDOUT_BYTES = 256_000;
export const DEFAULT_FFPROBE_STDERR_BYTES = 64_000;

export interface VideoProbeStream {
  readonly codecName: string;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: string;
  readonly averageFrameRate: { readonly numerator: number; readonly denominator: number; readonly value: number };
}

export interface AudioProbeStream {
  readonly codecName: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly channelLayout?: string;
}

/** VidGen-owned technical facts; this deliberately excludes FFprobe's raw envelope. */
export interface LocalMediaProbe {
  readonly durationSeconds: number;
  readonly containerNames: readonly string[];
  readonly streamTypes: readonly ('video' | 'audio' | 'subtitle' | 'data' | 'attachment')[];
  readonly video?: VideoProbeStream;
  readonly audio?: AudioProbeStream;
}

export interface FfprobeChild {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: 'error' | 'close', listener: (...args: any[]) => void): this;
  kill(): boolean;
}

export interface FfprobeDependencies {
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly spawn?: (command: string, args: readonly string[], options: SpawnOptions) => FfprobeChild;
}

/**
 * Probes one already-local file. The argv uses no shell and permits FFprobe's
 * file protocol only; callers receive compact parsed facts rather than JSON.
 */
export async function probeLocalMedia(path: string, dependencies: FfprobeDependencies = {}): Promise<LocalMediaProbe> {
  const input = await assertRegularLocalFile(path);
  const timeoutMs = boundedPositive(dependencies.timeoutMs ?? DEFAULT_FFPROBE_TIMEOUT_MS, 'FFprobe timeout must be positive.');
  const maxStdoutBytes = boundedPositive(dependencies.maxStdoutBytes ?? DEFAULT_FFPROBE_STDOUT_BYTES, 'FFprobe stdout limit must be positive.');
  const maxStderrBytes = boundedPositive(dependencies.maxStderrBytes ?? DEFAULT_FFPROBE_STDERR_BYTES, 'FFprobe stderr limit must be positive.');
  const executable = dependencies.executable ?? 'ffprobe';
  if (typeof executable !== 'string' || executable.trim().length === 0) throw new VidGenError('configuration', 'FFprobe executable is not configured.');
  const args = [
    '-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
    'format=format_name,duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,channels,channel_layout',
    '-of', 'json', input.path,
  ] as const;
  const spawn = dependencies.spawn ?? ((command, childArgs, options) => nodeSpawn(command, childArgs, options) as ChildProcessWithoutNullStreams);
  let child: FfprobeChild;
  try {
    child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    throw new VidGenError('configuration', 'Unable to start FFprobe.', { cause });
  }
  const stdout = await collectProcessOutput(child, timeoutMs, maxStdoutBytes, maxStderrBytes);
  return parseFfprobeJson(stdout);
}

export function parseFrameRate(value: unknown): VideoProbeStream['averageFrameRate'] {
  if (typeof value !== 'string' || !/^([1-9]\d{0,8})\/([1-9]\d{0,8})$/.test(value)) throw invalidProbe('FFprobe reported an invalid frame rate.');
  const [, numeratorText, denominatorText] = /^([1-9]\d{0,8})\/([1-9]\d{0,8})$/.exec(value)!;
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  const rate = numerator / denominator;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000) throw invalidProbe('FFprobe reported an invalid frame rate.');
  return { numerator, denominator, value: rate };
}

export function parseFfprobeJson(text: string): LocalMediaProbe {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (cause) { throw invalidProbe('FFprobe returned invalid JSON.', cause); }
  if (!record(parsed) || !record(parsed.format) || !Array.isArray(parsed.streams)) throw invalidProbe('FFprobe returned incomplete media facts.');
  const formatName = parsed.format.format_name;
  const duration = positiveFinite(parsed.format.duration);
  if (typeof formatName !== 'string' || formatName.trim().length === 0 || duration === undefined) throw invalidProbe('FFprobe returned invalid media facts.');
  const containerNames = [...new Set(formatName.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (containerNames.length === 0) throw invalidProbe('FFprobe returned invalid media facts.');
  const streamTypes: LocalMediaProbe['streamTypes'] = [];
  const videos: VideoProbeStream[] = [];
  const audios: AudioProbeStream[] = [];
  for (const item of parsed.streams) {
    if (!record(item) || typeof item.codec_type !== 'string') throw invalidProbe('FFprobe returned malformed stream facts.');
    const type = item.codec_type;
    if (type !== 'video' && type !== 'audio' && type !== 'subtitle' && type !== 'data' && type !== 'attachment') throw invalidProbe('FFprobe reported an unsupported stream type.');
    streamTypes.push(type);
    if (type === 'video') videos.push(parseVideo(item));
    if (type === 'audio') audios.push(parseAudio(item));
  }
  return { durationSeconds: duration, containerNames, streamTypes, ...(videos.length === 0 ? {} : { video: videos[0]! }), ...(audios.length === 0 ? {} : { audio: audios[0]! }) };
}

async function collectProcessOutput(child: FfprobeChild, timeoutMs: number, maxStdout: number, maxStderr: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error?: VidGenError, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error); else resolve(text!);
    };
    const fail = (message: string, cause?: unknown) => { try { child.kill(); } catch {} finish(invalidProbe(message, cause)); };
    const timer = setTimeout(() => fail('FFprobe timed out.'), timeoutMs);
    child.stdout.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > maxStdout) return fail('FFprobe output exceeded the supported limit.');
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (stderrBytes > maxStderr) fail('FFprobe diagnostic output exceeded the supported limit.');
    });
    child.once('error', (cause) => finish(new VidGenError('configuration', 'FFprobe could not be started.', { cause })));
    child.once('close', (code: number | null) => {
      if (code !== 0) return finish(invalidProbe('FFprobe could not inspect local media.'));
      finish(undefined, Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function parseVideo(value: Record<string, unknown>): VideoProbeStream {
  const codecName = nonBlank(value.codec_name);
  const width = positiveInteger(value.width, 32_768);
  const height = positiveInteger(value.height, 32_768);
  const pixelFormat = nonBlank(value.pix_fmt);
  if (codecName === undefined || width === undefined || height === undefined || pixelFormat === undefined) throw invalidProbe('FFprobe returned malformed video stream facts.');
  return { codecName, width, height, pixelFormat, averageFrameRate: parseFrameRate(value.avg_frame_rate) };
}
function parseAudio(value: Record<string, unknown>): AudioProbeStream {
  const codecName = nonBlank(value.codec_name);
  const sampleRate = typeof value.sample_rate === 'string' && /^\d+$/.test(value.sample_rate) ? positiveInteger(Number(value.sample_rate), 384_000) : undefined;
  const channels = positiveInteger(value.channels, 64);
  if (codecName === undefined || sampleRate === undefined || channels === undefined) throw invalidProbe('FFprobe returned malformed audio stream facts.');
  const layout = nonBlank(value.channel_layout);
  return { codecName, sampleRate, channels, ...(layout === undefined ? {} : { channelLayout: layout }) };
}
function positiveFinite(value: unknown): number | undefined { if (typeof value !== 'string' || !/^(?:\d+\.?\d*|\d*\.\d+)$/.test(value)) return undefined; const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 && parsed <= 86_400 ? parsed : undefined; }
function positiveInteger(value: unknown, maximum: number): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : undefined; }
function nonBlank(value: unknown): string | undefined { return typeof value === 'string' && value.trim().length > 0 && value.length <= 255 ? value : undefined; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function boundedPositive(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1 || value > 300_000) throw new VidGenError('invalid_argument', message); return value; }
function invalidProbe(message: string, cause?: unknown): VidGenError { return new VidGenError('assembly', message, cause === undefined ? {} : { cause }); }
