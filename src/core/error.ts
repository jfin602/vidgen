/**
 * Error codes emitted by VidGen-owned boundaries. New codes should be added
 * only when a caller needs a distinct, stable recovery path.
 */
export type VidGenErrorCode =
  | 'unexpected'
  | 'invalid_argument'
  | 'configuration'
  | 'transport'
  | 'artifact'
  | 'canonical_input'
  | 'story_selection'
  | 'assembly_template'
  | 'clip_plan'
  | 'simple_clip'
  | 'generated_media'
  | 'assembly'
  | 'text_model'
  | 'ngest_authentication'
  | 'ngest_http'
  | 'ngest_timeout'
  | 'ngest_invalid_json'
  | 'ngest_local_input'
  | 'ngest_manifest'
  | 'ngest_unsupported_continuation';

export interface SafeProviderDiagnostic {
  readonly providerCode?: number | string;
  readonly providerStatus?: string;
  readonly supportCode?: string;
  readonly providerMessage?: string;
  /** Adapter-owned runtime facts, shown only by explicitly verbose commands. */
  readonly veoStage?: 'auth' | 'start_request' | 'poll_request' | 'operation_parse' | 'result_decode';
  readonly internalError?: string;
  readonly internalMessage?: string;
  /** Adapter-owned terminal Veo facts, shown only by explicitly verbose commands. */
  readonly veoTerminalStatus?: 'RAI_FILTERED' | 'EMPTY_COMPLETED_OPERATION';
  readonly raiMediaFilteredCount?: number;
  readonly raiMediaFilteredReason?: string;
}

export interface VidGenErrorOptions {
  readonly cause?: unknown;
  /** Explicit, sanitized provider facts. Causes remain private. */
  readonly safeProviderDiagnostic?: unknown;
}

/**
 * An application error with a public message that is safe to present to users.
 * The optional cause is retained for local diagnostics and is never rendered by
 * this class or the CLI.
 */
export class VidGenError extends Error {
  readonly code: VidGenErrorCode;
  readonly publicMessage: string;
  readonly safeProviderDiagnostic?: SafeProviderDiagnostic;

  constructor(
    code: VidGenErrorCode,
    publicMessage: string,
    options: VidGenErrorOptions = {},
  ) {
    super(publicMessage, options);
    this.name = 'VidGenError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.safeProviderDiagnostic = sanitizeProviderDiagnostic(options.safeProviderDiagnostic);
  }
}

export function isVidGenError(value: unknown): value is VidGenError {
  return value instanceof VidGenError;
}

/** Keeps a deliberately tiny provider diagnostic boundary safe for CLI output. */
export function sanitizeProviderDiagnostic(value: unknown): SafeProviderDiagnostic | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const providerCode = safeProviderCode(source.providerCode);
  const providerStatus = safeProviderStatus(source.providerStatus);
  const supportCode = safeSupportCode(source.supportCode);
  const providerMessage = safeProviderMessage(source.providerMessage);
  const veoStage = safeVeoStage(source.veoStage);
  const internalError = safeInternalError(source.internalError);
  const internalMessage = safeInternalMessage(source.internalMessage)
    ?? (veoStage === undefined ? undefined : 'Internal runtime error.');
  const veoTerminalStatus = safeVeoTerminalStatus(source.veoTerminalStatus);
  const raiMediaFilteredCount = safeRaiMediaFilteredCount(source.raiMediaFilteredCount);
  const raiMediaFilteredReason = safeRaiMediaFilteredReason(source.raiMediaFilteredReason);
  const diagnostic: SafeProviderDiagnostic = {
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerStatus === undefined ? {} : { providerStatus }),
    ...(supportCode === undefined ? {} : { supportCode }),
    ...(providerMessage === undefined ? {} : { providerMessage }),
    ...(veoStage === undefined ? {} : { veoStage }),
    ...(internalError === undefined ? {} : { internalError }),
    ...(internalMessage === undefined ? {} : { internalMessage }),
    ...(veoTerminalStatus === undefined ? {} : { veoTerminalStatus }),
    ...(raiMediaFilteredCount === undefined ? {} : { raiMediaFilteredCount }),
    ...(raiMediaFilteredReason === undefined ? {} : { raiMediaFilteredReason }),
  };
  return Object.keys(diagnostic).length === 0 ? undefined : diagnostic;
}

function safeProviderCode(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 && value <= 999_999 ? value : undefined;
  return typeof value === 'string' && /^(?:\d{1,6}|[A-Z][A-Z0-9_]{0,63})$/.test(value) && !sensitive(value) ? value : undefined;
}
function safeProviderStatus(value: unknown): string | undefined { return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_ -]{0,127}$/.test(value) && !sensitive(value) ? value : undefined; }
function safeSupportCode(value: unknown): string | undefined { return (typeof value === 'string' || typeof value === 'number') && /^\d{1,16}$/.test(String(value)) ? String(value) : undefined; }
function safeProviderMessage(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\x20-\x7e]{1,240}$/.test(value) && !/[{}\[\]"]/u.test(value) && !sensitive(value) && !/(?:file:|(?:^|[\s'(])(?:[A-Za-z]:[\\/]|[\\/]))/iu.test(value) ? value : undefined;
}
function safeVeoStage(value: unknown): SafeProviderDiagnostic['veoStage'] | undefined {
  return value === 'auth' || value === 'start_request' || value === 'poll_request' || value === 'operation_parse' || value === 'result_decode' ? value : undefined;
}
function safeVeoTerminalStatus(value: unknown): SafeProviderDiagnostic['veoTerminalStatus'] | undefined { return value === 'RAI_FILTERED' || value === 'EMPTY_COMPLETED_OPERATION' ? value : undefined; }
function safeRaiMediaFilteredCount(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 4 ? value : undefined; }
function safeRaiMediaFilteredReason(value: unknown): string | undefined {
  return typeof value === 'string' && RAI_MEDIA_FILTERED_REASONS.has(value) ? value : undefined;
}
function safeInternalError(value: unknown): string | undefined { return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : undefined; }
function safeInternalMessage(value: unknown): string | undefined {
  const message = safeProviderMessage(value);
  return message !== undefined && /^(?:Cannot |Invalid |The |Failed |Unexpected |Stream |Response |Body |Buffer |JSON |Reader |Operation |Abort|Timeout|Out of memory|Expected |Maximum call stack)/u.test(message) ? message : undefined;
}
function sensitive(value: string): boolean { return /\b(?:authorization|bearer|token|api[-_ ]?key|x-goog-api-key|cookie)\b/iu.test(value); }

const RAI_MEDIA_FILTERED_REASONS = new Set([
  'OBSCENE', 'SEXUALLY_EXPLICIT', 'IDENTITY_ATTACK', 'VIOLENCE_ABUSE', 'CSAI', 'SPII', 'CELEBRITY', 'FACE_IMG', 'WATERMARK_IMG', 'MEMORIZATION_IMG', 'CSAI_IMG', 'PORN_IMG', 'VIOLENCE_IMG', 'CHILD_IMG', 'TOXIC', 'SENSITIVE_WORD', 'PERSON_IMG', 'ICA_IMG', 'SEXUAL_IMG', 'IU_IMG', 'RACY_IMG', 'PEDO_IMG', 'DEATH_HARM_TRAGEDY', 'HEALTH', 'FIREARMS_WEAPONS', 'RELIGIOUS_BELIEF', 'ILLICIT_DRUGS', 'WAR_CONFLICT', 'POLITICS', 'HATE_SYMBOL_IMG', 'CHILD_TEXT', 'DANGEROUS_CONTENT', 'RECITATION_TEXT', 'CELEBRITY_IMG', 'WATERMARK_IMG_REMOVAL',
]);
