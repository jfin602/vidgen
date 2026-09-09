export type WorkerLogLevel = 'info' | 'warn' | 'error';

export interface WorkerLogEvent { readonly timestamp: string; readonly level: WorkerLogLevel; readonly event: string; readonly fields?: Readonly<Record<string, string | number | boolean>>; }
export interface WorkerLogger { emit(event: WorkerLogEvent): void; }

const MAX_LOG_LINE_BYTES = 2_048;
const SAFE_EVENT = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_TEXT = /^[A-Za-z0-9._:-]{1,200}$/u;

/** Logging is never allowed to affect the Worker state machine. */
export function logWorker(logger: WorkerLogger | undefined, timestamp: string, level: WorkerLogLevel, event: string, fields?: Readonly<Record<string, string | number | boolean>>): void {
  try { const safe = safeFields(fields); logger?.emit({ timestamp: validTimestamp(timestamp) ? timestamp : new Date(0).toISOString(), level, event: SAFE_EVENT.test(event) ? event : 'invalid_event', ...(safe === undefined ? {} : { fields: safe }) }); } catch { /* Observability is best effort. */ }
}

/** CLI-only NDJSON rendering; safe fields are deliberately scalar and bounded. */
export function formatWorkerLogEvent(event: WorkerLogEvent): string {
  const safe = safeFields(event.fields);
  const value = { timestamp: validTimestamp(event.timestamp) ? event.timestamp : new Date(0).toISOString(), level: event.level === 'warn' || event.level === 'error' ? event.level : 'info', event: SAFE_EVENT.test(event.event) ? event.event : 'invalid_event', ...(safe === undefined ? {} : { fields: safe }) };
  const line = JSON.stringify(value);
  return Buffer.byteLength(line, 'utf8') <= MAX_LOG_LINE_BYTES ? `${line}\n` : '{"timestamp":"1970-01-01T00:00:00.000Z","level":"error","event":"log_event_oversize"}\n';
}

function validTimestamp(value: string): boolean { return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && !Number.isNaN(Date.parse(value)); }
function safeFields(fields: WorkerLogEvent['fields']): Readonly<Record<string, string | number | boolean>> | undefined {
  if (fields === undefined) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === 'string' ? (SAFE_TEXT.test(value) || (key === 'message' && safePublicMessage(value))) : typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000_000)) safe[key] = value;
  }
  return Object.keys(safe).length === 0 ? undefined : safe;
}
function safePublicMessage(value: string): boolean { return /^[\x20-\x7e]{1,240}$/u.test(value) && !/\b(?:authorization|bearer|token|api[-_ ]?key|cookie)\b/iu.test(value) && !/(?:https?:|file:|(?:^|\s)[A-Za-z]:[\\/]|(?:^|\s)\/)/u.test(value); }
