import { resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';

export const DEFAULT_WORKER_STATE_ROOT = 'artifacts/worker';
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 60_000;
export const MIN_WORKER_POLL_INTERVAL_MS = 1_000;
export const MAX_WORKER_POLL_INTERVAL_MS = 86_400_000;
export const DEFAULT_WORKER_MAX_SECONDS = 8;
export const DEFAULT_DAILY_GENERATION_LIMIT = 1;
export const DEFAULT_GENERATION_ATTEMPT_LIMIT = 2;
export const DEFAULT_PUBLICATION_ATTEMPT_LIMIT = 2;
export const DEFAULT_WORKER_QUEUE_EXPIRATION_DAYS = 3;
export const MAX_WORKER_QUEUE_EXPIRATION_DAYS = 365;

export interface WorkerRuntimeConfig {
  readonly stateRoot: string;
  readonly pollIntervalMs: number;
  readonly maxSeconds: number;
  readonly dailyGenerationLimit: number;
  readonly generationAttemptLimit: number;
  readonly publicationAttemptLimit: number;
  readonly queueExpirationDays: number;
  readonly presenterSourcesFile?: string;
}

/** Validates the intentionally small set of Worker runtime controls. */
export function createWorkerRuntimeConfig(options: {
  readonly stateRoot?: string;
  readonly pollIntervalMs?: number;
  readonly maxSeconds?: number;
  readonly dailyGenerationLimit?: number;
  readonly generationAttemptLimit?: number;
  readonly publicationAttemptLimit?: number;
  readonly queueExpirationDays?: number;
  readonly requirePresenterSourcesFile?: boolean;
  readonly environment?: Pick<NodeJS.ProcessEnv, 'VIDGEN_WORKER_QUEUE_EXPIRATION_DAYS' | 'VIDGEN_WORKER_PRESENTER_SOURCES_FILE'>;
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
  const publicationAttemptLimit = options.publicationAttemptLimit ?? DEFAULT_PUBLICATION_ATTEMPT_LIMIT;
  const queueExpirationDays = options.queueExpirationDays ?? queueExpirationFromEnvironment(options.environment ?? process.env);
  const presenterSourcesFile = (options.environment ?? process.env).VIDGEN_WORKER_PRESENTER_SOURCES_FILE;
  if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 4 || maxSeconds > 20) throw new VidGenError('configuration', 'Worker max seconds must be a whole number from 4 through 20.');
  if (!Number.isSafeInteger(dailyGenerationLimit) || dailyGenerationLimit < 1 || dailyGenerationLimit > 100) throw new VidGenError('configuration', 'Worker daily generation limit must be a whole number from 1 through 100.');
  if (!Number.isSafeInteger(generationAttemptLimit) || generationAttemptLimit < 1 || generationAttemptLimit > 10) throw new VidGenError('configuration', 'Worker generation attempt limit must be a whole number from 1 through 10.');
  if (!Number.isSafeInteger(publicationAttemptLimit) || publicationAttemptLimit < 1 || publicationAttemptLimit > 10) throw new VidGenError('configuration', 'Worker publication attempt limit must be a whole number from 1 through 10.');
  if (!Number.isSafeInteger(queueExpirationDays) || queueExpirationDays < 1 || queueExpirationDays > MAX_WORKER_QUEUE_EXPIRATION_DAYS) throw new VidGenError('configuration', `Worker queue expiration must be a whole number from 1 through ${MAX_WORKER_QUEUE_EXPIRATION_DAYS} days.`);
  if (options.requirePresenterSourcesFile === true && (presenterSourcesFile === undefined || presenterSourcesFile.trim().length === 0)) throw new VidGenError('configuration', 'Worker generate/live requires VIDGEN_WORKER_PRESENTER_SOURCES_FILE.');
  if (presenterSourcesFile !== undefined && (presenterSourcesFile.trim().length === 0 || /[\0-\x1f\x7f]/u.test(presenterSourcesFile))) throw new VidGenError('configuration', 'Worker presenter-source manifest path is invalid.');
  return { stateRoot: resolve(stateRoot), pollIntervalMs, maxSeconds, dailyGenerationLimit, generationAttemptLimit, publicationAttemptLimit, queueExpirationDays, ...(presenterSourcesFile === undefined ? {} : { presenterSourcesFile: presenterSourcesFile.trim() }) };
}

function queueExpirationFromEnvironment(environment: Pick<NodeJS.ProcessEnv, 'VIDGEN_WORKER_QUEUE_EXPIRATION_DAYS'>): number {
  const value = environment.VIDGEN_WORKER_QUEUE_EXPIRATION_DAYS;
  if (value === undefined) return DEFAULT_WORKER_QUEUE_EXPIRATION_DAYS;
  if (!/^\d+$/u.test(value)) throw new VidGenError('configuration', 'Worker queue expiration must be a positive whole number of days.');
  return Number(value);
}
