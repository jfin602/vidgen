import { createHash } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { DEFAULT_MAX_ANCHOR_REFERENCE_BYTES, loadApprovedAnchorReferences, type ReferenceImageIdentity } from '../core/anchor-reference.ts';
import { VidGenError } from '../core/error.ts';

export const MAX_PRESENTER_SOURCES_MANIFEST_BYTES = 64 * 1024;
export const MAX_PRESENTER_SOURCES = 100;
export const MAX_PRESENTER_SOURCE_PATH_LENGTH = 4_096;

export interface WorkerPresenterSource extends Omit<ReferenceImageIdentity, 'ordinal'> { readonly path: string; }

/** Loads a deliberately small, one-path-per-line Worker-only source pool. */
export async function loadPresenterSourcesFile(path: string): Promise<readonly WorkerPresenterSource[]> {
  if (typeof path !== 'string' || path.trim().length === 0 || !isAbsolute(path) || /[\0\r\n]/u.test(path) || path.length > MAX_PRESENTER_SOURCE_PATH_LENGTH) throw invalid('Worker presenter-source manifest path is invalid.');
  const info = await lstat(path).catch(() => undefined);
  if (info === undefined || !info.isFile() || info.size < 1 || info.size > MAX_PRESENTER_SOURCES_MANIFEST_BYTES) throw invalid('Worker presenter-source manifest must be a non-empty regular file within the supported size.');
  const bytes = await readFile(path).catch(() => undefined);
  const recheck = await stat(path).catch(() => undefined);
  if (bytes === undefined || recheck === undefined || !recheck.isFile() || bytes.byteLength < 1 || bytes.byteLength > MAX_PRESENTER_SOURCES_MANIFEST_BYTES || recheck.size !== bytes.byteLength) throw invalid('Worker presenter-source manifest could not be read safely.');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw invalid('Worker presenter-source manifest must be UTF-8 text.');
  const paths = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (paths.length < 1 || paths.length > MAX_PRESENTER_SOURCES) throw invalid(`Worker presenter-source manifest requires one through ${MAX_PRESENTER_SOURCES} source paths.`);
  const normalized = paths.map((entry) => sourcePath(entry));
  if (new Set(normalized).size !== normalized.length) throw invalid('Worker presenter-source manifest must not contain duplicate source paths.');
  return Promise.all(normalized.map((entry) => loadPresenterSource(entry)));
}

/** Validates a previously selected source without consulting the current pool. */
export async function loadPresenterSource(path: string): Promise<WorkerPresenterSource> {
  const normalized = sourcePath(path);
  const info = await lstat(normalized).catch(() => undefined);
  if (info === undefined || !info.isFile()) throw invalid('Worker presenter source image is missing, invalid, or unsupported.');
  const [reference] = await loadApprovedAnchorReferences([normalized], DEFAULT_MAX_ANCHOR_REFERENCE_BYTES).catch(() => { throw invalid('Worker presenter source image is missing, invalid, or unsupported.'); });
  if (reference === undefined) throw invalid('Worker presenter source image is missing, invalid, or unsupported.');
  const { ordinal: _ordinal, ...identity } = reference.identity;
  return { path: normalized, ...identity };
}

export function selectPresenterSource(articleId: string, sources: readonly WorkerPresenterSource[]): WorkerPresenterSource {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(articleId) || sources.length < 1 || sources.length > MAX_PRESENTER_SOURCES) throw invalid('Worker presenter-source selection is invalid.');
  const index = createHash('sha256').update(articleId).digest().readUInt32BE(0) % sources.length;
  return sources[index]!;
}

export function samePresenterSource(left: WorkerPresenterSource, right: WorkerPresenterSource): boolean {
  return left.path === right.path && left.basename === right.basename && left.mimeType === right.mimeType && left.sha256 === right.sha256 && left.byteSize === right.byteSize;
}

function sourcePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PRESENTER_SOURCE_PATH_LENGTH || /[\0-\x1f\x7f]/u.test(value) || !isAbsolute(value)) throw invalid('Worker presenter-source manifest contains an invalid source path.');
  return resolve(value);
}
function invalid(message: string): VidGenError { return new VidGenError('configuration', message); }
