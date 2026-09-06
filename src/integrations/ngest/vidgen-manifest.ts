import { canonicalJson } from '../../shared/canonical-json.ts';
import { VidGenError } from '../../core/error.ts';
import { isJsonValue, type JsonObject, type JsonValue } from '../../shared/json.ts';

export const NGEST_BASE_URL_ENV = 'NGEST_BASE_URL';
export const NGEST_PROFILE_KEY_ENV = 'NGEST_PROFILE_KEY';
export const NGEST_BEARER_TOKEN_ENV = 'NGEST_BEARER_TOKEN';
export const NGEST_TIMEOUT_MS_ENV = 'NGEST_TIMEOUT_MS';
export const DEFAULT_NGEST_TIMEOUT_MS = 10_000;
export const MAX_NGEST_TIMEOUT_MS = 60_000;
export const MAX_NGEST_DISTRIBUTION_PAGES = 1_000;

export type NgestVidGenEnvironment = Readonly<Record<string, string | undefined>>;

/** Runtime-only information for the live ngest boundary. */
export interface NgestVidGenRuntimeConfig {
  readonly endpoint: URL;
  readonly profileKey: string;
  readonly bearerToken: string;
  readonly timeoutMs: number;
}

/** The existing VidGen-shaped transport object consumed by CanonicalInput. */
export interface NgestVidGenManifestPage {
  readonly apiVersion: string;
  readonly profile: JsonObject;
  readonly publication: JsonObject;
  readonly articles: readonly JsonObject[];
  readonly control: JsonObject;
  readonly nextCursor: null;
  readonly snapshotRevision?: JsonValue;
}

interface DistributionProfile { readonly configKey: string; readonly displayName: string; }
interface DistributionPublication { readonly name: string; }
interface DistributionArticle {
  readonly articleId: string;
  readonly headline: string;
  readonly originalUrl: string;
  readonly effectiveFeedDate: string;
  readonly feedDateSource: string;
  readonly publishedAt: string | null;
  readonly author: string | null;
  readonly summary: string | null;
  readonly imageUrl: string | null;
  readonly source: DistributionProfile;
  readonly categories: readonly DistributionProfile[];
}
interface DistributionPage {
  readonly apiVersion: string;
  readonly generatedAt: string;
  readonly snapshotRevision: string;
  readonly profile: DistributionProfile;
  readonly publication: DistributionPublication;
  readonly digest: JsonValue;
  readonly items: readonly DistributionArticle[];
  readonly nextCursor: string | null;
}

/** Reads and validates only the runtime configuration required by this client. */
export function loadNgestVidGenRuntimeConfig(
  environment: NgestVidGenEnvironment = process.env,
): NgestVidGenRuntimeConfig {
  const baseUrl = parseBaseUrl(requiredEnvironmentValue(environment, NGEST_BASE_URL_ENV));
  const profileKey = requiredEnvironmentValue(environment, NGEST_PROFILE_KEY_ENV);
  const bearerToken = requiredEnvironmentValue(environment, NGEST_BEARER_TOKEN_ENV);
  return {
    endpoint: new URL(`/api/v1/distribution/${encodeURIComponent(profileKey)}`, baseUrl),
    profileKey,
    bearerToken,
    timeoutMs: parseTimeout(environment[NGEST_TIMEOUT_MS_ENV]),
  };
}

/**
 * Acquires a coherent complete Distribution snapshot, then adapts it to the
 * existing VidGen manifest boundary. Local VidGen-shaped fixtures never enter
 * this Distribution-only parser.
 */
export async function fetchNgestVidGenManifestPage(
  environment: NgestVidGenEnvironment = process.env,
): Promise<NgestVidGenManifestPage> {
  const config = loadNgestVidGenRuntimeConfig(environment);
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let firstPage: DistributionPage | undefined;
  const articles: JsonObject[] = [];

  for (let pageCount = 0; pageCount < MAX_NGEST_DISTRIBUTION_PAGES; pageCount += 1) {
    const pageUrl = new URL(config.endpoint);
    if (cursor !== undefined) pageUrl.searchParams.set('cursor', cursor);
    const page = await fetchDistributionPage(pageUrl, config);
    if (page.profile.configKey !== config.profileKey) {
      throw malformedDistribution('Ngest Distribution response does not match the configured Profile.');
    }
    if (firstPage === undefined) firstPage = page;
    else if (!sameSnapshotIdentity(firstPage, page)) {
      throw malformedDistribution('Ngest Distribution response changed during continuation.');
    }
    articles.push(...page.items.map(adaptArticle));
    if (page.nextCursor === null) return adaptSnapshot(firstPage, articles);
    if (cursors.has(page.nextCursor)) {
      throw malformedDistribution('Ngest Distribution response repeated a continuation cursor.');
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw malformedDistribution('Ngest Distribution response exceeded the continuation limit.');
}

async function fetchDistributionPage(url: URL, config: NgestVidGenRuntimeConfig): Promise<DistributionPage> {
  const signal = AbortSignal.timeout(config.timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${config.bearerToken}` },
      redirect: 'manual',
      signal,
    });
  } catch {
    throw transportFailure(signal);
  }
  if (response.status === 401 || response.status === 403) {
    throw new VidGenError('ngest_authentication', 'Ngest Distribution authentication or authorization failed.');
  }
  if (!response.ok) {
    throw new VidGenError('ngest_http', 'Ngest Distribution endpoint returned an unsuccessful response.');
  }
  let payload: unknown;
  try { payload = await response.json(); } catch {
    if (signal.aborted) throw transportFailure(signal);
    throw new VidGenError('ngest_invalid_json', 'Ngest Distribution endpoint returned invalid JSON.');
  }
  return validateDistributionPage(payload);
}

function adaptSnapshot(page: DistributionPage, articles: readonly JsonObject[]): NgestVidGenManifestPage {
  return {
    apiVersion: page.apiVersion,
    profile: { configKey: page.profile.configKey, displayName: page.profile.displayName },
    publication: { name: page.publication.name },
    articles,
    control: { version: '1', editorial: {}, script: {}, production: {} },
    nextCursor: null,
    snapshotRevision: page.snapshotRevision,
  };
}

function adaptArticle(article: DistributionArticle): JsonObject {
  return {
    articleId: article.articleId,
    headline: article.headline,
    originalUrl: article.originalUrl,
    effectiveFeedDate: article.effectiveFeedDate,
    feedDateSource: article.feedDateSource,
    publishedAt: article.publishedAt,
    author: article.author,
    summary: article.summary,
    imageUrl: article.imageUrl,
    source: { configKey: article.source.configKey, displayName: article.source.displayName },
    categories: article.categories.map((category) => category.displayName),
  };
}

function sameSnapshotIdentity(first: DistributionPage, page: DistributionPage): boolean {
  return canonicalJson(first.snapshotRevision) === canonicalJson(page.snapshotRevision)
    && first.profile.configKey === page.profile.configKey
    && first.profile.displayName === page.profile.displayName
    && first.publication.name === page.publication.name;
}

/** Validates only the current Distribution v1 wire; fixture validation remains below. */
function validateDistributionPage(value: unknown): DistributionPage {
  if (!isJsonObject(value)) throw malformedDistribution();
  const profile = distributionProfile(value.profile);
  const publication = distributionPublication(value.publication);
  if (
    !nonEmptyString(value.apiVersion) || !nonEmptyString(value.generatedAt)
    || !nonEmptyString(value.snapshotRevision)
    || !Object.hasOwn(value, 'digest') || !isJsonValue(value.digest)
    || !Array.isArray(value.items) || !value.items.every((item) => distributionArticle(item) !== undefined)
    || !validCursor(value.nextCursor) || profile === undefined || publication === undefined
  ) throw malformedDistribution();
  return {
    apiVersion: value.apiVersion,
    generatedAt: value.generatedAt,
    snapshotRevision: value.snapshotRevision,
    profile,
    publication,
    digest: value.digest,
    items: value.items as DistributionArticle[],
    nextCursor: value.nextCursor,
  };
}

function distributionArticle(value: unknown): DistributionArticle | undefined {
  if (!isJsonObject(value) || !nonEmptyString(value.articleId) || !nonEmptyString(value.headline)
    || !nonEmptyString(value.originalUrl) || !nonEmptyString(value.effectiveFeedDate)
    || !nonEmptyString(value.feedDateSource) || !nullableString(value.publishedAt)
    || !nullableString(value.author) || !nullableString(value.summary) || !nullableString(value.imageUrl)
    || !Array.isArray(value.categories)) return undefined;
  const source = distributionProfile(value.source);
  const categories = value.categories.map(distributionProfile);
  if (source === undefined || categories.some((category) => category === undefined)) return undefined;
  return { ...value, source, categories: categories as DistributionProfile[] } as DistributionArticle;
}

function distributionProfile(value: unknown): DistributionProfile | undefined {
  if (!isJsonObject(value) || !nonEmptyString(value.configKey) || !nonEmptyString(value.displayName)) return undefined;
  return { configKey: value.configKey, displayName: value.displayName };
}

function distributionPublication(value: unknown): DistributionPublication | undefined {
  return isJsonObject(value) && nonEmptyString(value.name) ? { name: value.name } : undefined;
}

function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function nullableString(value: unknown): value is string | null { return value === null || nonEmptyString(value); }
function validCursor(value: unknown): value is string | null { return value === null || nonEmptyString(value); }

/** Existing local VidGen-shaped fixture validator. */
export function validateNgestVidGenManifestPage(value: unknown): NgestVidGenManifestPage {
  if (!isJsonObject(value)) throw malformedManifest();
  const { apiVersion, profile, publication, articles, control, nextCursor } = value;
  if (
    typeof apiVersion !== 'string' || apiVersion.trim().length === 0
    || !isJsonObject(profile) || !isJsonObject(publication)
    || !Array.isArray(articles) || !articles.every(isJsonObject) || !isJsonObject(control)
  ) throw malformedManifest();
  if (Object.hasOwn(value, 'snapshotRevision') && !isJsonValue(value.snapshotRevision)) throw malformedManifest();
  if (nextCursor !== undefined && nextCursor !== null) {
    if (typeof nextCursor !== 'string' || nextCursor.trim().length === 0) throw malformedManifest();
    throw new VidGenError('ngest_unsupported_continuation', 'Ngest VidGen manifest continuation is not supported.');
  }
  return Object.hasOwn(value, 'snapshotRevision')
    ? { apiVersion, profile, publication, articles, control, nextCursor: null, snapshotRevision: value.snapshotRevision }
    : { apiVersion, profile, publication, articles, control, nextCursor: null };
}

function requiredEnvironmentValue(environment: NgestVidGenEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new VidGenError('configuration', `Ngest Distribution ${name} configuration is required.`);
  }
  return value;
}

function parseBaseUrl(value: string): URL {
  let baseUrl: URL;
  try { baseUrl = new URL(value); } catch { throw invalidBaseUrl(); }
  if ((baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:')
    || baseUrl.username.length > 0 || baseUrl.password.length > 0) throw invalidBaseUrl();
  if (baseUrl.protocol === 'http:' && !isLoopbackHost(baseUrl.hostname)) {
    throw new VidGenError('configuration', 'Ngest Distribution base URL must use HTTPS unless it targets a loopback host.');
  }
  return baseUrl;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return DEFAULT_NGEST_TIMEOUT_MS;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) throw invalidTimeout();
  const timeoutMs = Number(normalized);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_NGEST_TIMEOUT_MS) throw invalidTimeout();
  return timeoutMs;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function invalidBaseUrl(): VidGenError {
  return new VidGenError('configuration', 'Ngest Distribution base URL must be an absolute HTTP(S) URL without credentials.');
}
function invalidTimeout(): VidGenError {
  return new VidGenError('configuration', `Ngest Distribution timeout must be a whole number between 1 and ${MAX_NGEST_TIMEOUT_MS} milliseconds.`);
}
function transportFailure(signal: AbortSignal): VidGenError {
  return signal.aborted
    ? new VidGenError('ngest_timeout', 'Ngest Distribution request timed out.')
    : new VidGenError('transport', 'Unable to reach the Ngest Distribution endpoint.');
}
function malformedDistribution(message = 'Ngest Distribution response has an invalid envelope.'): VidGenError {
  return new VidGenError('ngest_manifest', message);
}
function malformedManifest(): VidGenError {
  return new VidGenError('ngest_manifest', 'Ngest VidGen response has an invalid manifest envelope.');
}
function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value);
}
