import { VidGenError } from '../../core/error.ts';
import { isJsonValue, type JsonObject, type JsonValue } from '../../shared/json.ts';

export const NGEST_VIDGEN_URL_ENV = 'NGEST_VIDGEN_URL';
export const NGEST_VIDGEN_BEARER_TOKEN_ENV = 'NGEST_VIDGEN_BEARER_TOKEN';
export const NGEST_VIDGEN_TIMEOUT_MS_ENV = 'NGEST_VIDGEN_TIMEOUT_MS';

/** The conservative default for one authenticated manifest request. */
export const DEFAULT_NGEST_VIDGEN_TIMEOUT_MS = 10_000;
/** Runtime overrides are deliberately bounded to one minute. */
export const MAX_NGEST_VIDGEN_TIMEOUT_MS = 60_000;

export type NgestVidGenEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Runtime-only credentials and endpoint information for the ngest boundary.
 * This value is not a canonical or creative-input model and must not be
 * persisted with downstream artifacts.
 */
export interface NgestVidGenRuntimeConfig {
  readonly endpoint: URL;
  readonly bearerToken: string;
  readonly timeoutMs: number;
}

/**
 * The narrow, complete one-page transport object supplied by ngest. Article
 * and control semantics deliberately remain unvalidated at this boundary.
 */
export interface NgestVidGenManifestPage {
  readonly apiVersion: string;
  readonly profile: JsonObject;
  readonly publication: JsonObject;
  readonly articles: readonly JsonObject[];
  readonly control: JsonObject;
  readonly nextCursor: null;
  readonly snapshotRevision?: JsonValue;
}

/** Reads and validates only the runtime configuration required by this client. */
export function loadNgestVidGenRuntimeConfig(
  environment: NgestVidGenEnvironment = process.env,
): NgestVidGenRuntimeConfig {
  const endpoint = parseEndpoint(requiredEnvironmentValue(environment, NGEST_VIDGEN_URL_ENV));
  const bearerToken = requiredEnvironmentValue(environment, NGEST_VIDGEN_BEARER_TOKEN_ENV);
  const timeoutMs = parseTimeout(environment[NGEST_VIDGEN_TIMEOUT_MS_ENV]);

  return { endpoint, bearerToken, timeoutMs };
}

/**
 * Fetches and validates exactly one complete manifest page. A non-null cursor
 * is rejected because continuation request syntax has not been contracted.
 */
export async function fetchNgestVidGenManifestPage(
  environment: NgestVidGenEnvironment = process.env,
): Promise<NgestVidGenManifestPage> {
  const config = loadNgestVidGenRuntimeConfig(environment);
  const signal = AbortSignal.timeout(config.timeoutMs);
  let response: Response;

  try {
    response = await fetch(config.endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.bearerToken}`,
      },
      // Do not send bearer credentials to a redirect target.
      redirect: 'manual',
      signal,
    });
  } catch {
    throw transportFailure(signal);
  }

  if (response.status === 401 || response.status === 403) {
    throw new VidGenError(
      'ngest_authentication',
      'Ngest VidGen authentication or authorization failed.',
    );
  }

  if (!response.ok) {
    throw new VidGenError('ngest_http', 'Ngest VidGen endpoint returned an unsuccessful response.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) {
      throw transportFailure(signal);
    }

    throw new VidGenError('ngest_invalid_json', 'Ngest VidGen endpoint returned invalid JSON.');
  }

  return validateNgestVidGenManifestPage(payload);
}

/**
 * Validates the producer envelope without promoting transport fields into
 * VidGen editorial/domain models.
 */
export function validateNgestVidGenManifestPage(value: unknown): NgestVidGenManifestPage {
  if (!isJsonObject(value)) {
    throw malformedManifest();
  }

  const { apiVersion, profile, publication, articles, control, nextCursor } = value;
  if (
    typeof apiVersion !== 'string'
    || apiVersion.trim().length === 0
    || !isJsonObject(profile)
    || !isJsonObject(publication)
    || !Array.isArray(articles)
    || !articles.every(isJsonObject)
    || !isJsonObject(control)
  ) {
    throw malformedManifest();
  }

  if (Object.hasOwn(value, 'snapshotRevision') && !isJsonValue(value.snapshotRevision)) {
    throw malformedManifest();
  }

  if (nextCursor !== undefined && nextCursor !== null) {
    if (typeof nextCursor !== 'string' || nextCursor.trim().length === 0) {
      throw malformedManifest();
    }

    throw new VidGenError(
      'ngest_unsupported_continuation',
      'Ngest VidGen manifest continuation is not supported.',
    );
  }

  return Object.hasOwn(value, 'snapshotRevision')
    ? {
      apiVersion,
      profile,
      publication,
      articles,
      control,
      nextCursor: null,
      snapshotRevision: value.snapshotRevision,
    }
    : {
      apiVersion,
      profile,
      publication,
      articles,
      control,
      nextCursor: null,
    };
}

function requiredEnvironmentValue(
  environment: NgestVidGenEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new VidGenError('configuration', `Ngest VidGen ${name} configuration is required.`);
  }

  return value;
}

function parseEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new VidGenError('configuration', 'Ngest VidGen endpoint must be an absolute HTTP(S) URL.');
  }

  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new VidGenError('configuration', 'Ngest VidGen endpoint must be an absolute HTTP(S) URL.');
  }

  if (endpoint.username.length > 0 || endpoint.password.length > 0) {
    throw new VidGenError('configuration', 'Ngest VidGen endpoint must not include URL credentials.');
  }

  if (endpoint.protocol === 'http:' && !isLoopbackHost(endpoint.hostname)) {
    throw new VidGenError(
      'configuration',
      'Ngest VidGen endpoint must use HTTPS unless it targets a loopback host.',
    );
  }

  return endpoint;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_NGEST_VIDGEN_TIMEOUT_MS;
  }

  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw invalidTimeout();
  }

  const timeoutMs = Number(normalized);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_NGEST_VIDGEN_TIMEOUT_MS) {
    throw invalidTimeout();
  }

  return timeoutMs;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function invalidTimeout(): VidGenError {
  return new VidGenError(
    'configuration',
    `Ngest VidGen timeout must be a whole number between 1 and ${MAX_NGEST_VIDGEN_TIMEOUT_MS} milliseconds.`,
  );
}

function transportFailure(signal: AbortSignal): VidGenError {
  return signal.aborted
    ? new VidGenError('ngest_timeout', 'Ngest VidGen request timed out.')
    : new VidGenError('transport', 'Unable to reach the Ngest VidGen endpoint.');
}

function malformedManifest(): VidGenError {
  return new VidGenError('ngest_manifest', 'Ngest VidGen response has an invalid manifest envelope.');
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value);
}
