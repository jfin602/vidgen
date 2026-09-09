import { VidGenError } from '../../core/error.ts';

export const PARALLEL_SEARCH_ENDPOINT = 'https://api.parallel.ai/v1/search';
export const PARALLEL_API_KEY_ENV = 'PARALLEL_API_KEY';
export const PARALLEL_TIMEOUT_MS_ENV = 'PARALLEL_TIMEOUT_MS';
export const DEFAULT_PARALLEL_TIMEOUT_MS = 10_000;
export const MAX_PARALLEL_TIMEOUT_MS = 60_000;
export const MAX_PARALLEL_RESPONSE_BYTES = 256_000;

export interface ParallelSearchRequest {
  readonly objective: string;
  readonly searchQueries: readonly string[];
  readonly afterDate: string;
}
export interface ParallelSearchResult { readonly searchId: string; readonly sessionId: string; readonly results: readonly unknown[]; }
export interface ParallelSearchOptions { readonly environment?: NodeJS.ProcessEnv; readonly fetch?: typeof fetch; }

/** One deliberately un-retried, bounded Parallel Search call. */
export async function searchParallel(request: ParallelSearchRequest, options: ParallelSearchOptions = {}): Promise<ParallelSearchResult> {
  const environment = options.environment ?? process.env;
  const key = environment[PARALLEL_API_KEY_ENV]?.trim();
  if (!key) throw new VidGenError('configuration', 'Parallel API key configuration is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(request.afterDate) || request.searchQueries.length < 2 || request.searchQueries.length > 3) throw new VidGenError('invalid_argument', 'Parallel Search request is invalid.');
  const timeoutMs = timeout(environment[PARALLEL_TIMEOUT_MS_ENV]);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch ?? fetch)(PARALLEL_SEARCH_ENDPOINT, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ objective: request.objective, search_queries: request.searchQueries, mode: 'fast', max_chars_total: 12_000, advanced_settings: { max_results: 10, source_policy: { after_date: request.afterDate } } }),
    });
    if (!response.ok || response.type === 'opaqueredirect') throw new VidGenError('transport', 'Parallel Search request was unsuccessful.');
    const text = await boundedText(response);
    let value: unknown; try { value = JSON.parse(text); } catch { throw new VidGenError('transport', 'Parallel Search returned an invalid response.'); }
    const record = plainRecord(value);
    if (!record || !safeId(record.search_id) || !safeId(record.session_id) || !Array.isArray(record.results) || record.results.length > 10 || !record.results.every(safeResult)) throw new VidGenError('transport', 'Parallel Search returned an invalid response.');
    return { searchId: record.search_id, sessionId: record.session_id, results: record.results };
  } catch (error) {
    if (error instanceof VidGenError) throw error;
    throw new VidGenError('transport', controller.signal.aborted ? 'Parallel Search request timed out.' : 'Unable to reach Parallel Search.');
  } finally { clearTimeout(timer); }
}

function timeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PARALLEL_TIMEOUT_MS;
  if (!/^\d+$/u.test(value.trim())) throw new VidGenError('configuration', `Parallel timeout must be a whole number from 1 through ${MAX_PARALLEL_TIMEOUT_MS} milliseconds.`);
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PARALLEL_TIMEOUT_MS) throw new VidGenError('configuration', `Parallel timeout must be a whole number from 1 through ${MAX_PARALLEL_TIMEOUT_MS} milliseconds.`);
  return parsed;
}
async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PARALLEL_RESPONSE_BYTES) throw new VidGenError('transport', 'Parallel Search response exceeds the supported size.');
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_PARALLEL_RESPONSE_BYTES) { await reader.cancel(); throw new VidGenError('transport', 'Parallel Search response exceeds the supported size.'); } chunks.push(next.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
function plainRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as Record<string, unknown> : undefined; }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value); }
function safeResult(value: unknown): boolean {
  const result = plainRecord(value); if (!result || typeof result.url !== 'string' || typeof result.title !== 'string') return false;
  try { const url = new URL(result.url); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !!url.hostname && result.url.length <= 2_000; } catch { return false; }
}
