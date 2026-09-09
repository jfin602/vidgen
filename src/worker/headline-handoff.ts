import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';
import type { WorkerGeneratedArtifact } from './state.ts';

export const MAX_HEADLINE_STDOUT_BYTES = 16_384;

export type { WorkerGeneratedArtifact } from './state.ts';

export interface HeadlineChild {
  readonly stdout: NodeJS.ReadableStream;
  once(event: 'error' | 'close', listener: (...args: any[]) => void): this;
  kill(): boolean;
}

export interface HeadlineHandoffDependencies {
  readonly spawn?: (command: string, args: readonly string[], options: SpawnOptions) => HeadlineChild;
  readonly readFile?: typeof readFile;
  readonly stat?: typeof stat;
  readonly cwd?: string;
}

export interface HeadlineHandoffInput {
  readonly candidateId: string;
  readonly fixturePath: string;
  readonly artifactsRoot: string;
  readonly anchorReferencePaths: readonly string[];
  readonly fontPath: string;
  readonly maxSeconds: number;
}

/** The Worker trusts only the compact headline CLI completion contract, then rechecks the file itself. */
export async function runHeadlineHandoff(input: HeadlineHandoffInput, dependencies: HeadlineHandoffDependencies = {}): Promise<WorkerGeneratedArtifact> {
  const artifactsRoot = resolve(input.artifactsRoot);
  const args = ['--env-file-if-exists=.env', 'src/cli.ts', 'headline', '--input-file', input.fixturePath, '--article-id', input.candidateId,
    ...input.anchorReferencePaths.flatMap((path) => ['--anchor-reference', path]), '--font-file', input.fontPath, '--max-seconds', String(input.maxSeconds), '--artifacts-root', artifactsRoot];
  const spawn = dependencies.spawn ?? ((command, childArgs, options) => nodeSpawn(command, childArgs, options) as HeadlineChild);
  let child: HeadlineChild;
  try { child = spawn(process.execPath, args, { cwd: dependencies.cwd ?? process.cwd(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (cause) { throw new VidGenError('configuration', 'Unable to start VidGen headline generation.', { cause }); }
  const output = await collectHeadlineOutput(child);
  const artifact = parseHeadlineSuccessOutput(output);
  if (!inside(artifactsRoot, artifact.finalPath) || !inside(artifactsRoot, artifact.metadataPath)) throw new VidGenError('artifact', 'VidGen headline result escaped the Worker artifact root.');
  const inspect = dependencies.stat ?? stat;
  const finalInfo = await inspect(artifact.finalPath).catch(() => undefined);
  const metadataInfo = await inspect(artifact.metadataPath).catch(() => undefined);
  if (finalInfo === undefined || !finalInfo.isFile() || finalInfo.size < 1 || metadataInfo === undefined || !metadataInfo.isFile() || metadataInfo.size < 1) throw new VidGenError('artifact', 'VidGen headline result artifacts could not be verified.');
  const bytes = await (dependencies.readFile ?? readFile)(artifact.finalPath).catch(() => undefined);
  if (bytes === undefined || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new VidGenError('artifact', 'VidGen headline final media hash could not be verified.');
  return artifact;
}

export function parseHeadlineSuccessOutput(output: string): WorkerGeneratedArtifact {
  const lines = output.split('\n').filter((line) => line.length > 0);
  if (lines.length !== 5 || !/^Headline [^\r\n]+ is final_ready\.$/u.test(lines[0]!)) throw new VidGenError('artifact', 'VidGen headline returned an unrecognized result.');
  const values = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const match = /^(final|metadata|sha256|durationSeconds): (.+)$/u.exec(line);
    if (match === null || values.has(match[1]!)) throw new VidGenError('artifact', 'VidGen headline returned an ambiguous result.');
    values.set(match[1]!, match[2]!);
  }
  const finalPath = values.get('final'); const metadataPath = values.get('metadata'); const sha256 = values.get('sha256'); const duration = values.get('durationSeconds');
  if (finalPath === undefined || metadataPath === undefined || sha256 === undefined || duration === undefined || !isAbsolute(finalPath) || !isAbsolute(metadataPath) || /[\0\r\n]/u.test(finalPath) || /[\0\r\n]/u.test(metadataPath) || !/^[a-f0-9]{64}$/u.test(sha256)) throw new VidGenError('artifact', 'VidGen headline returned invalid result fields.');
  const durationSeconds = Number(duration);
  if (!/^(?:\d+\.?\d*|\d*\.\d+)$/u.test(duration) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300) throw new VidGenError('artifact', 'VidGen headline returned an invalid duration.');
  return { finalPath, metadataPath, sha256, durationSeconds };
}

function collectHeadlineOutput(child: HeadlineChild): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const chunks: Buffer[] = []; let bytes = 0; let settled = false;
    const fail = (error: VidGenError) => { if (!settled) { settled = true; try { child.kill(); } catch {} reject(error); } };
    child.stdout.on('data', (chunk: Buffer | string) => { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > MAX_HEADLINE_STDOUT_BYTES) return fail(new VidGenError('artifact', 'VidGen headline output exceeded the supported limit.')); chunks.push(value); });
    child.once('error', (cause) => fail(new VidGenError('configuration', 'VidGen headline could not be started.', { cause })));
    child.once('close', (code: number | null) => { if (settled) return; settled = true; if (code !== 0) reject(new VidGenError('artifact', 'VidGen headline generation failed.')); else resolveOutput(Buffer.concat(chunks).toString('utf8')); });
  });
}

function inside(root: string, path: string): boolean { const value = resolve(path); const valueRelative = relative(root, value); return valueRelative !== '' && !valueRelative.startsWith('..') && !isAbsolute(valueRelative); }
