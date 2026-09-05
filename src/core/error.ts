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
  | 'ngest_authentication'
  | 'ngest_http'
  | 'ngest_timeout'
  | 'ngest_invalid_json'
  | 'ngest_local_input'
  | 'ngest_manifest'
  | 'ngest_unsupported_continuation';

export interface VidGenErrorOptions {
  readonly cause?: unknown;
}

/**
 * An application error with a public message that is safe to present to users.
 * The optional cause is retained for local diagnostics and is never rendered by
 * this class or the CLI.
 */
export class VidGenError extends Error {
  readonly code: VidGenErrorCode;
  readonly publicMessage: string;

  constructor(
    code: VidGenErrorCode,
    publicMessage: string,
    options: VidGenErrorOptions = {},
  ) {
    super(publicMessage, options);
    this.name = 'VidGenError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function isVidGenError(value: unknown): value is VidGenError {
  return value instanceof VidGenError;
}
