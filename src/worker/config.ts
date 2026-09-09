import { resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';

export const DEFAULT_WORKER_STATE_ROOT = 'artifacts/worker';
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 60_000;
export const MIN_WORKER_POLL_INTERVAL_MS = 1_000;
export const MAX_WORKER_POLL_INTERVAL_MS = 86_400_000;
export const DEFAULT_WORKER_MAX_SECONDS = 8;
export const DEFAULT_DAILY_GENERATION_LIMIT = 1;
export const DEFAULT_GENERATION_ATTEMPT_LIMIT = 2;

export interface WorkerRuntimeConfig {
  readonly stateRoot: string;
  readonly pollIntervalMs: number;
  readonly maxSeconds: number;
  readonly dailyGenerationLimit: number;
  readonly generationAttemptLimit: number;
}

/** Validates the intentionally small set of Worker runtime controls. */
export function createWorkerRuntimeConfig(options: {
  readonly stateRoot?: string;
  readonly pollIntervalMs?: number;
  readonly maxSeconds?: number;
  readonly dailyGenerationLimit?: number;
  readonly generationAttemptLimit?: number;
} = {}): WorkerRuntimeConfig {
  const stateRoot = options.stateRoot ?? DEFAULT_WORKER_STATE_ROOT;
  if (typeof stateRoot !== 'string' || stateRoot.trim().length === 0 || stateRoot.includes('\0')) {
    throw new VidGenError('configuration', 'Worker state root must be a non-empty safe directory.');
  }
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WORKER_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_WORKER_POLL_INTERVAL_MS || pollIntervalMs > MAX_WORKER_POLL_INTERVAL_MS) {
    throw new VidGenError('configuration', `Worker poll interval must be a whole number from ${MIN_WORKER_POLL_INTERVAL_MS} through ${MAX_WORKER_POLL_INTERVAL_MS} milliseconds.`);
  }
  const maxSeconds = options.maxSeconds ?? DEFAULT_WORKER_MAX_SECONDS;
  const dailyGenerationLimit = options.dailyGenerationLimit ?? DEFAULT_DAILY_GENERATION_LIMIT;
  const generationAttemptLimit = options.generationAttemptLimit ?? DEFAULT_GENERATION_ATTEMPT_LIMIT;
  if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 4 || maxSeconds > 20) throw new VidGenError('configuration', 'Worker max seconds must be a whole number from 4 through 20.');
  if (!Number.isSafeInteger(dailyGenerationLimit) || dailyGenerationLimit < 1 || dailyGenerationLimit > 100) throw new VidGenError('configuration', 'Worker daily generation limit must be a whole number from 1 through 100.');
  if (!Number.isSafeInteger(generationAttemptLimit) || generationAttemptLimit < 1 || generationAttemptLimit > 10) throw new VidGenError('configuration', 'Worker generation attempt limit must be a whole number from 1 through 10.');
  return { stateRoot: resolve(stateRoot), pollIntervalMs, maxSeconds, dailyGenerationLimit, generationAttemptLimit };
}
