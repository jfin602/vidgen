import { createHash } from 'node:crypto';

import type { NgestVidGenManifestPage } from '../integrations/ngest/vidgen-manifest.ts';
import { canonicalJson } from '../shared/canonical-json.ts';
import { isJsonValue, type JsonObject, type JsonValue } from '../shared/json.ts';
import { VidGenError } from './error.ts';

export const CANONICAL_INPUT_SCHEMA_VERSION = '1';

export interface CanonicalSource {
  readonly configKey: string;
  readonly displayName: string;
}

/** Publisher metadata only; its presence never grants media reuse rights. */
export interface CanonicalArticle {
  readonly articleId: string;
  readonly headline: string;
  readonly originalUrl: string;
  readonly effectiveFeedDate: string;
  readonly feedDateSource: string;
  readonly publishedAt: string | null;
  readonly author: string | null;
  readonly summary: string | null;
  /** Upstream metadata only; it is not an authorization to reuse publisher media. */
  readonly imageUrl: string | null;
  readonly source: CanonicalSource;
  readonly categories: readonly string[];
}

export interface CanonicalFeed {
  readonly profile: {
    readonly configKey: string;
    readonly displayName: string;
  };
  readonly publication: {
    readonly name: string;
  };
  /** Preserves ngest's governed article order exactly. */
  readonly articles: readonly CanonicalArticle[];
}

/**
 * Stage objects retain only JSON-safe administrator input until their field
 * semantics are deliberately contracted in a later phase.
 */
export interface CanonicalControl {
  readonly version: string;
  readonly editorial: JsonObject;
  readonly script: JsonObject;
  readonly production: JsonObject;
}

export interface CanonicalInputProvenance {
  readonly ngestApiVersion: string;
  readonly snapshotRevision?: JsonValue;
}

/** The durable Phase 1 handoff from ngest transport into VidGen stages. */
export interface CanonicalInput {
  readonly schemaVersion: typeof CANONICAL_INPUT_SCHEMA_VERSION;
  readonly feed: CanonicalFeed;
  readonly control: CanonicalControl;
  readonly inputFingerprint: string;
  readonly provenance: CanonicalInputProvenance;
}

/** Selects and validates generation-relevant feed semantics from transport data. */
export function normalizeCanonicalFeed(value: Pick<
  NgestVidGenManifestPage,
  'profile' | 'publication' | 'articles'
>): CanonicalFeed {
  const profile = requireObject(value.profile, 'profile');
  const publication = requireObject(value.publication, 'publication');

  return {
    profile: {
      configKey: requireString(profile, 'configKey', 'profile.configKey'),
      displayName: requireString(profile, 'displayName', 'profile.displayName'),
    },
    publication: {
      name: requireString(publication, 'name', 'publication.name'),
    },
    articles: value.articles.map((article, index) => normalizeArticle(article, index)),
  };
}

/** Validates the stable control shell while preserving provisional stage fields. */
export function normalizeCanonicalControl(value: unknown): CanonicalControl {
  const control = requireObject(value, 'control');
  for (const key of Object.keys(control)) {
    if (!['version', 'editorial', 'script', 'production'].includes(key)) {
      throw invalidCanonicalInput(`control.${key} is not a supported control branch.`);
    }
  }

  assertNoSecretKeys(control, 'control');

  return {
    version: requireString(control, 'version', 'control.version'),
    editorial: normalizeStage(control, 'editorial'),
    script: normalizeStage(control, 'script'),
    production: normalizeStage(control, 'production'),
  };
}

/** Builds the VidGen-owned artifact without promoting transport state into identity. */
export function buildCanonicalInput(manifest: NgestVidGenManifestPage): CanonicalInput {
  const feed = normalizeCanonicalFeed(manifest);
  const control = normalizeCanonicalControl(manifest.control);
  const provenance: CanonicalInputProvenance = Object.hasOwn(manifest, 'snapshotRevision')
    ? {
      ngestApiVersion: manifest.apiVersion,
      snapshotRevision: cloneJsonValue(manifest.snapshotRevision as JsonValue),
    }
    : { ngestApiVersion: manifest.apiVersion };

  return {
    schemaVersion: CANONICAL_INPUT_SCHEMA_VERSION,
    feed,
    control,
    inputFingerprint: fingerprintCanonicalInput(feed, control),
    provenance,
  };
}

/** Computes the stable SHA-256 identity over generation-relevant input only. */
export function fingerprintCanonicalInput(
  feed: CanonicalFeed,
  control: CanonicalControl,
): string {
  return createHash('sha256')
    .update(canonicalJson({ feed, control }))
    .digest('hex');
}

function normalizeArticle(value: unknown, index: number): CanonicalArticle {
  const article = requireObject(value, `articles[${index}]`);
  const source = requireObject(article.source, `articles[${index}].source`);
  const originalUrl = requireString(article, 'originalUrl', `articles[${index}].originalUrl`);
  validatePublisherUrl(originalUrl, `articles[${index}].originalUrl`);

  const categories = article.categories;
  if (!Array.isArray(categories)) {
    throw invalidCanonicalInput(`articles[${index}].categories must be an array of non-empty strings.`);
  }

  return {
    articleId: requireString(article, 'articleId', `articles[${index}].articleId`),
    headline: requireString(article, 'headline', `articles[${index}].headline`),
    originalUrl,
    effectiveFeedDate: requireString(
      article,
      'effectiveFeedDate',
      `articles[${index}].effectiveFeedDate`,
    ),
    feedDateSource: requireString(article, 'feedDateSource', `articles[${index}].feedDateSource`),
    publishedAt: requireNullableString(article, 'publishedAt', `articles[${index}].publishedAt`),
    author: requireNullableString(article, 'author', `articles[${index}].author`),
    summary: requireNullableString(article, 'summary', `articles[${index}].summary`),
    imageUrl: requireNullableString(article, 'imageUrl', `articles[${index}].imageUrl`),
    source: {
      configKey: requireString(source, 'configKey', `articles[${index}].source.configKey`),
      displayName: requireString(source, 'displayName', `articles[${index}].source.displayName`),
    },
    categories: categories.map((category, categoryIndex) => {
      if (typeof category !== 'string' || category.trim().length === 0) {
        throw invalidCanonicalInput(
          `articles[${index}].categories[${categoryIndex}] must be a non-empty string.`,
        );
      }

      return category.trim();
    }),
  };
}

function normalizeStage(control: JsonObject, name: 'editorial' | 'script' | 'production'): JsonObject {
  if (!Object.hasOwn(control, name)) {
    return {};
  }

  const stage = requireObject(control[name], `control.${name}`);
  return cloneJsonValue(stage) as JsonObject;
}

function requireObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !isJsonValue(value)) {
    throw invalidCanonicalInput(`${label} must be a JSON object.`);
  }

  return value;
}

function requireString(object: JsonObject, key: string, label: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidCanonicalInput(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function requireNullableString(object: JsonObject, key: string, label: string): string | null {
  const value = object[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidCanonicalInput(`${label} must be a non-empty string or null.`);
  }

  return value.trim();
}

function validatePublisherUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidCanonicalInput(`${label} must be an absolute HTTP(S) URL.`);
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.hostname.length === 0
    || url.username.length > 0
    || url.password.length > 0
  ) {
    throw invalidCanonicalInput(`${label} must be an absolute HTTP(S) URL.`);
  }
}

function assertNoSecretKeys(value: JsonValue, path: string, depth = 0): void {
  // This deliberately small guard prevents obvious secret-shaped input; it is
  // not a substitute for a future, fully contracted control schema.
  if (depth > 32) {
    throw invalidCanonicalInput('control nesting exceeds the supported safety limit.');
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (/(bearer|token|password|credential|secret|api[-_]?key)/i.test(key)) {
        throw invalidCanonicalInput(`${path}.${key} must not contain a secret-bearing key.`);
      }

      assertNoSecretKeys(value[key], `${path}.${key}`, depth + 1);
    }
  }
}

function cloneJsonValue(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function invalidCanonicalInput(message: string): VidGenError {
  return new VidGenError('canonical_input', message);
}
