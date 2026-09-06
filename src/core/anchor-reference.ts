import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { VidGenError } from './error.ts';

export const DEFAULT_MAX_ANCHOR_REFERENCE_BYTES = 10_000_000;

/** A VidGen-approved, in-memory presenter reference image; no remote URL crosses this boundary. */
export interface ApprovedReferenceImage {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/** Creates a reference-image value with a VidGen-computed byte identity. */
export function createApprovedReferenceImage(
  mimeType: string,
  bytes: Uint8Array,
): ApprovedReferenceImage {
  if (mimeType.trim().length === 0 || bytes.length === 0) {
    throw invalidReference('An approved reference image requires MIME type and bytes.');
  }
  return { mimeType, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export interface ReferenceImageIdentity {
  readonly ordinal: number;
  readonly basename: string;
  readonly mimeType: string;
  readonly sha256: string;
  readonly byteSize: number;
}

export interface ApprovedAnchorReference {
  readonly image: ApprovedReferenceImage;
  readonly identity: ReferenceImageIdentity;
}

/** Loads local, signature-checked presenter references for either production path. */
export async function loadApprovedAnchorReferences(
  paths: readonly string[],
  maxBytes: number,
): Promise<readonly ApprovedAnchorReference[]> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new VidGenError('invalid_argument', 'Anchor-reference byte limit must be positive.');
  }
  const loaded: ApprovedAnchorReference[] = [];
  for (const [index, path] of paths.entries()) {
    if (typeof path !== 'string' || path.trim().length === 0 || /^\w+:\/\//.test(path)) throw invalidReference('Anchor references must be explicit local files.');
    const name = basename(path);
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name)) throw invalidReference('Anchor-reference basename is unsafe.');
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw invalidReference('Anchor-reference file is empty or exceeds the supported size.');
    const bytes = new Uint8Array(await readFile(path));
    // Recheck bytes read after stat: a replacement must not bypass the bound.
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw invalidReference('Anchor-reference file is empty or exceeds the supported size.');
    const mimeType = imageMime(bytes);
    if (mimeType === undefined) throw invalidReference('Anchor-reference file type is unsupported.');
    const image = createApprovedReferenceImage(mimeType, bytes);
    loaded.push({ image, identity: { ordinal: index + 1, basename: name, mimeType, sha256: image.sha256, byteSize: bytes.byteLength } });
  }
  return loaded;
}

export function assertApprovedAnchorReferenceCount(references: readonly unknown[]): void {
  if (references.length < 1 || references.length > 3) {
    throw invalidReference('Presenter media requires one to three approved local anchor references.');
  }
}

/** Checks an in-memory reference before it enters a provider-neutral request. */
export function assertApprovedReferenceImage(image: ApprovedReferenceImage): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
    || image.bytes.byteLength < 1
    || !/^[a-f0-9]{64}$/.test(image.sha256)
    || createHash('sha256').update(image.bytes).digest('hex') !== image.sha256) {
    throw invalidReference('Presenter media received an unsupported approved reference image.');
  }
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

function invalidReference(message: string): VidGenError {
  return new VidGenError('invalid_argument', message);
}
