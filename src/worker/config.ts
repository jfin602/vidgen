import { resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';

export const DEFAULT_WORKER_STATE_ROOT = 'artifacts/worker';
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 60_000;
export const MIN_WORKER_POLL_INTERVAL_MS = 1_000;
export const MAX_WORKER_POLL_INTERVAL_MS = 86_400_000;

export interface WorkerRuntimeConfig {
  readonly stateRoot: string;
  readonly pollIntervalMs: number;
}

/** Validates the intentionally small set of Worker runtime controls. */
export function createWorkerRuntimeConfig(options: {
  readonly stateRoot?: string;
  readonly pollIntervalMs?: number;
} = {}): WorkerRuntimeConfig {
  const stateRoot = options.stateRoot ?? DEFAULT_WORKER_STATE_ROOT;
  if (typeof stateRoot !== 'string' || stateRoot.trim().length === 0 || stateRoot.includes('\0')) {
    throw new VidGenError('configuration', 'Worker state root must be a non-empty safe directory.');
  }
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WORKER_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < MIN_WORKER_POLL_INTERVAL_MS || pollIntervalMs > MAX_WORKER_POLL_INTERVAL_MS) {
    throw new VidGenError('configuration', `Worker poll interval must be a whole number from ${MIN_WORKER_POLL_INTERVAL_MS} through ${MAX_WORKER_POLL_INTERVAL_MS} milliseconds.`);
  }
  return { stateRoot: resolve(stateRoot), pollIntervalMs };
}
