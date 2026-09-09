import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { DEFAULT_HEADLINE_ARTIFACTS_ROOT, validateHeadlineSidecar } from '../app/headline-workflow.ts';
import type { WorkerGeneratedArtifact } from './state.ts';
import { WorkerStateStore } from './state.ts';

const MAX_SIDECARS = 1_000;
const MAX_SIDECAR_BYTES = 1_000_000;
const MAX_FINAL_BYTES = 1_000_000_000;

/** Finds only a complete, contract-valid headline package for this governed Article ID. */
export async function findVerifiedPriorProduction(store: WorkerStateStore, articleId: string): Promise<WorkerGeneratedArtifact | undefined> {
  const state = await store.load();
  const recorded = state.candidates[articleId]?.generatedArtifact;
  if (recorded !== undefined && await verifyHeadlineProduction(recorded.metadataPath, articleId, recorded.finalPath)) return recorded;
  for (const directory of new Set([store.candidateGenerationArtifactsRoot(articleId), store.headlineArtifactsRoot(), resolve(DEFAULT_HEADLINE_ARTIFACTS_ROOT)])) {
    const artifact = await findInDirectory(directory, articleId);
    if (artifact !== undefined) return artifact;
  }
  return undefined;
}

async function findInDirectory(directory: string, articleId: string): Promise<WorkerGeneratedArtifact | undefined> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return undefined; }
  if (entries.length > MAX_SIDECARS) return undefined;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/u.test(entry.name)) continue;
    const artifact = await verifyHeadlineProduction(join(directory, entry.name), articleId);
    if (artifact !== undefined) return artifact;
  }
  return undefined;
}

async function verifyHeadlineProduction(metadataPath: string, articleId: string, expectedFinalPath?: string): Promise<WorkerGeneratedArtifact | undefined> {
  try {
    const metadataInfo = await lstat(metadataPath);
    if (!metadataInfo.isFile() || metadataInfo.size < 1 || metadataInfo.size > MAX_SIDECAR_BYTES) return undefined;
    const sidecar = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>;
    validateHeadlineSidecar(sidecar);
    const article = sidecar.article as Record<string, unknown>;
    const final = sidecar.final as Record<string, unknown>;
    if (article.articleId !== articleId || typeof final.filename !== 'string' || typeof final.sha256 !== 'string' || typeof final.byteSize !== 'number' || typeof sidecar.finalDurationSeconds !== 'number' || !Number.isFinite(sidecar.finalDurationSeconds) || sidecar.finalDurationSeconds <= 0 || sidecar.finalDurationSeconds > 300) return undefined;
    const finalPath = resolve(join(resolve(metadataPath, '..'), final.filename));
    if (basename(finalPath) !== final.filename || (expectedFinalPath !== undefined && resolve(expectedFinalPath) !== finalPath)) return undefined;
    const finalInfo = await lstat(finalPath);
    if (!finalInfo.isFile() || finalInfo.size < 1 || finalInfo.size > MAX_FINAL_BYTES || finalInfo.size !== final.byteSize) return undefined;
    if (await hashFile(finalPath) !== final.sha256) return undefined;
    return { finalPath, metadataPath: resolve(metadataPath), sha256: final.sha256, durationSeconds: sidecar.finalDurationSeconds };
  } catch { return undefined; }
}

async function hashFile(path: string): Promise<string | undefined> {
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  } catch { return undefined; }
}
