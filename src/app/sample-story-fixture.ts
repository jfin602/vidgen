import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isVidGenError, VidGenError } from '../core/error.ts';
import {
  fetchNgestVidGenManifestPage,
  validateNgestVidGenManifestPage,
  type NgestVidGenEnvironment,
  type NgestVidGenManifestPage,
} from '../integrations/ngest/vidgen-manifest.ts';
import { prettyJson, writeJsonAtomically, type AtomicJsonFilesystem } from '../shared/atomic-json.ts';

export const DEFAULT_SAMPLE_STORY_ARTIFACTS_ROOT = 'artifacts/samples';

export interface SampleStoryFixtureDependencies {
  readonly articleUrl: string;
  readonly artifactsRoot?: string;
  readonly environment?: NgestVidGenEnvironment;
  readonly fetchManifest?: (environment: NgestVidGenEnvironment) => Promise<NgestVidGenManifestPage>;
  readonly filesystem?: AtomicJsonFilesystem & { mkdir(path: string, options: { readonly recursive?: boolean }): Promise<string | undefined> };
  readonly createTemporarySuffix?: () => string;
}

export interface SampleStoryFixtureResult {
  readonly articleId: string;
  readonly outputPath: string;
}

/** Acquires one governed snapshot and publishes a one-Article local fixture. */
export async function createSampleStoryFixture(
  dependencies: SampleStoryFixtureDependencies,
): Promise<SampleStoryFixtureResult> {
  const articleUrl = validateArticleUrl(dependencies.articleUrl);
  let manifest: NgestVidGenManifestPage;
  try {
    manifest = await (dependencies.fetchManifest ?? fetchNgestVidGenManifestPage)(dependencies.environment ?? process.env);
  } catch (cause) {
    if (isVidGenError(cause) && !/authorization|bearer/i.test(cause.publicMessage)) throw cause;
    throw new VidGenError('unexpected', 'Unable to acquire the governed Article snapshot.', { cause });
  }
  const matches = manifest.articles.filter((article) => typeof article.originalUrl === 'string'
    && urlsMatch(articleUrl, article.originalUrl));
  if (matches.length === 0) throw new VidGenError('story_selection', 'No governed Article matches the supplied URL.');
  if (matches.length !== 1) throw new VidGenError('story_selection', 'The supplied URL matches multiple governed Articles.');

  const article = matches[0]!;
  const fixture = validateNgestVidGenManifestPage({
    apiVersion: manifest.apiVersion,
    profile: manifest.profile,
    publication: manifest.publication,
    articles: [article],
    control: manifest.control,
    nextCursor: null,
    ...(manifest.snapshotRevision === undefined ? {} : { snapshotRevision: manifest.snapshotRevision }),
  });
  const artifactsRoot = resolve(dependencies.artifactsRoot ?? DEFAULT_SAMPLE_STORY_ARTIFACTS_ROOT);
  const outputPath = join(artifactsRoot, sampleStoryFilename(article.originalUrl as string));
  const filesystem = dependencies.filesystem ?? { mkdir, writeFile, rename, unlink };
  try {
    await filesystem.mkdir(artifactsRoot, { recursive: true });
    await writeJsonAtomically(filesystem, outputPath, fixture, prettyJson, dependencies.createTemporarySuffix);
  } catch (cause) {
    throw new VidGenError('artifact', 'Unable to publish the sample story fixture.', { cause });
  }
  return { articleId: article.articleId as string, outputPath };
}

export function sampleStoryFilename(originalUrl: string): string {
  return `article-${createHash('sha256').update(originalUrl).digest('hex').slice(0, 24)}.json`;
}

function validateArticleUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || !/^https?:\/\//i.test(value)) {
    throw new VidGenError('invalid_argument', 'Sample story requires one absolute HTTP(S) Article URL.');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    throw new VidGenError('invalid_argument', 'Sample story requires one absolute HTTP(S) Article URL.');
  }
  return value;
}

function urlsMatch(requested: string, governed: string): boolean {
  return requested === governed
    || (requested.endsWith('/') && requested.slice(0, -1) === governed)
    || (governed.endsWith('/') && governed.slice(0, -1) === requested);
}
