import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { VidGenError } from '../../core/error.ts';

export const DEFAULT_MAX_LOCAL_MEDIA_BYTES = 1_000_000_000;

/** Safe, non-durable identity facts for an explicit regular local file. */
export interface LocalFileIdentity {
  /** Execution-only absolute path. Do not persist this value in provenance. */
  readonly path: string;
  readonly basename: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface LocalFileOptions {
  readonly maxBytes?: number;
}

/** Rejects URLs, pipes, devices, directories, symlinks, and blank paths. */
export async function assertRegularLocalFile(input: string, options: LocalFileOptions = {}): Promise<{ readonly path: string; readonly byteSize: number; readonly basename: string }> {
  const maxBytes = positiveMax(options.maxBytes ?? DEFAULT_MAX_LOCAL_MEDIA_BYTES);
  if (!isExplicitLocalPath(input)) throw invalidLocalFile('Media input must be an explicit local regular file.');
  const path = resolve(input);
  let link;
  let info;
  try {
    link = await lstat(path);
    info = await stat(path);
  } catch (cause) {
    throw new VidGenError('artifact', 'Required local media file is unavailable.', { cause });
  }
  if (!link.isFile() || !info.isFile() || info.size < 1 || info.size > maxBytes) {
    throw invalidLocalFile('Media input is not a supported regular local file.');
  }
  const name = basename(path);
  if (name.length === 0 || name.length > 255) throw invalidLocalFile('Media input basename is unsafe.');
  return { path, byteSize: info.size, basename: name };
}

/** Streams current file bytes into SHA-256 and verifies the configured bound. */
export async function identifyLocalFile(input: string, options: LocalFileOptions = {}): Promise<LocalFileIdentity> {
  const maxBytes = positiveMax(options.maxBytes ?? DEFAULT_MAX_LOCAL_MEDIA_BYTES);
  const initial = await assertRegularLocalFile(input, { maxBytes });
  const hash = createHash('sha256');
  let byteSize = 0;
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(initial.path);
      stream.on('data', (chunk: Buffer) => {
        byteSize += chunk.length;
        if (byteSize > maxBytes) {
          stream.destroy(new Error('media exceeds byte limit'));
          return;
        }
        hash.update(chunk);
      });
      stream.once('error', reject);
      stream.once('end', resolvePromise);
    });
  } catch (cause) {
    throw invalidLocalFile('Unable to read local media within the supported size.', cause);
  }
  // Re-stat after streaming so a replacement that grows beyond the configured
  // size cannot pass based on the earlier pre-read stat alone.
  const final = await assertRegularLocalFile(initial.path, { maxBytes });
  if (byteSize < 1 || byteSize !== initial.byteSize || final.byteSize !== byteSize) {
    throw invalidLocalFile('Local media changed while its identity was verified.');
  }
  return { path: initial.path, basename: initial.basename, byteSize, sha256: hash.digest('hex') };
}

function isExplicitLocalPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const input = value.trim();
  return input !== '-'
    && !/^(?:https?|file|pipe):/i.test(input)
    && !/^[a-z][a-z0-9+.-]*:\/\//i.test(input)
    && !/^\\\\\.\\/u.test(input)
    && !/^\/dev\//u.test(input);
}

function positiveMax(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', 'Local media byte limit must be a positive integer.');
  return value;
}

function invalidLocalFile(message: string, cause?: unknown): VidGenError {
  return new VidGenError('assembly', message, cause === undefined ? {} : { cause });
}
