import { VidGenError, isVidGenError } from '../core/error.ts';
import { DEFAULT_HEADLINE_ARTIFACTS_ROOT } from '../app/headline-workflow.ts';
import { buildCanonicalInput } from '../core/canonical-input.ts';
import { buildOneArticleFixture } from '../app/sample-story-fixture.ts';
import { buildStoryInput } from '../core/story-input.ts';
import { loadNgestVidGenManifestFile } from '../integrations/ngest/local-manifest-file.ts';
import { fetchNgestVidGenManifestPage, type NgestVidGenEnvironment, type NgestVidGenManifestPage } from '../integrations/ngest/vidgen-manifest.ts';
import { createDiscoveredCandidate, recoverInProgressStages, type WorkerCandidateState, type WorkerEvaluation, type WorkerGeneratedArtifact, type WorkerStage, type WorkerState, WorkerStateStore, validateWorkerEvaluation, validateWorkerGeneratedArtifact } from './state.ts';
import { createMomentumConfig, evaluateWebMomentum, WEB_MOMENTUM_METRIC, WEB_MOMENTUM_POLICY_ID, WEB_MOMENTUM_VERSION } from './web-momentum.ts';
import { runHeadlineHandoff } from './headline-handoff.ts';
import { acquireWorkerGenerationExclusion, type WorkerGenerationExclusion } from './generation-exclusion.ts';
import { findVerifiedPriorProduction } from './prior-production.ts';
import { runPosterCommand, type PosterCommandRunner } from '../app/poster-handoff.ts';
import { DEFAULT_DAILY_GENERATION_LIMIT, DEFAULT_WORKER_QUEUE_EXPIRATION_DAYS, MAX_WORKER_QUEUE_EXPIRATION_DAYS } from './config.ts';
import { loadPresenterSource, loadPresenterSourcesFile, samePresenterSource, selectPresenterSource, type WorkerPresenterSource } from './presenter-sources.ts';
import { logWorker, type WorkerLogger } from './logging.ts';

export type WorkerMode = 'observe' | 'generate' | 'live';
export const WORKER_POSTER_VIDEO_PLATFORMS = ['x', 'bluesky', 'reels'] as const;
const MAX_WORKER_DISCOVERED_CANDIDATES = 10_000;

export interface WorkerStageRunners {
  readonly evaluate?: (candidateId: string) => Promise<WorkerEvaluation>;
  readonly prepareGeneration?: (candidate: WorkerCandidateState) => Promise<WorkerPresenterSource>;
  readonly generate?: (candidateId: string, presenterSource?: WorkerPresenterSource) => Promise<WorkerGeneratedArtifact>;
  readonly doctor?: (platform: typeof WORKER_POSTER_VIDEO_PLATFORMS[number]) => Promise<void>;
  readonly caption?: (candidateId: string) => Promise<string>;
  readonly publish?: (candidateId: string, platform: typeof WORKER_POSTER_VIDEO_PLATFORMS[number], artifact: WorkerGeneratedArtifact, caption: string) => Promise<void>;
}

export interface WorkerCycleOptions {
  readonly store: WorkerStateStore;
  readonly discoveredCandidateIds: readonly string[];
  readonly mode: WorkerMode;
  readonly processExisting?: boolean;
  readonly maxCandidates: number;
  readonly dailyGenerationLimit?: number;
  readonly generationAttemptLimit?: number;
  readonly publicationAttemptLimit?: number;
  readonly queueExpirationDays?: number;
  readonly runners?: WorkerStageRunners;
  /** Test-only seam; runtime uses the machine-wide generation exclusion. */
  readonly acquireGenerationExclusion?: () => Promise<WorkerGenerationExclusion | undefined>;
  readonly now?: () => Date;
  /** Must atomically persist a local fixture before its ID becomes durable state. */
  readonly persistCandidateFixture?: (candidateId: string) => Promise<void>;
  /** Observational only; logger failures are ignored. */
  readonly logger?: WorkerLogger;
}

export interface WorkerRunOptions extends Omit<WorkerCycleOptions, 'discoveredCandidateIds'> {
  readonly once?: boolean;
  readonly discover: () => Promise<readonly string[]>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs: number;
}

export interface NgestWorkerCycleOptions extends Omit<WorkerCycleOptions, 'discoveredCandidateIds' | 'persistCandidateFixture'> {
  readonly environment?: NgestVidGenEnvironment;
  readonly fetchManifest?: (environment: NgestVidGenEnvironment) => Promise<NgestVidGenManifestPage>;
  /** Test-only transport seam; production uses built-in fetch. */
  readonly parallelFetch?: typeof fetch;
  readonly presenterSourcesFile?: string;
  readonly fontPath?: string;
  readonly maxSeconds?: number;
  /** Test-only seam; production uses the shell-free headline handoff. */
  readonly headlineHandoff?: typeof runHeadlineHandoff;
}

export interface NgestWorkerRunOptions extends Omit<NgestWorkerCycleOptions, 'now'> {
  readonly once?: boolean;
  readonly pollIntervalMs: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

/** Runs one bounded snapshot. Discovery is injected; this foundation does not poll ngest itself. */
export async function runWorkerCycle(options: WorkerCycleOptions): Promise<WorkerState> {
  if (!Number.isSafeInteger(options.maxCandidates) || options.maxCandidates < 1) throw new VidGenError('invalid_argument', 'Worker max candidates must be a positive whole number.');
  if (options.dailyGenerationLimit !== undefined && (!Number.isSafeInteger(options.dailyGenerationLimit) || options.dailyGenerationLimit < 1 || options.dailyGenerationLimit > 100)) throw new VidGenError('invalid_argument', 'Worker daily generation limit must be a whole number from 1 through 100.');
  if (options.generationAttemptLimit !== undefined && (!Number.isSafeInteger(options.generationAttemptLimit) || options.generationAttemptLimit < 1 || options.generationAttemptLimit > 10)) throw new VidGenError('invalid_argument', 'Worker generation attempt limit must be a whole number from 1 through 10.');
  if (options.publicationAttemptLimit !== undefined && (!Number.isSafeInteger(options.publicationAttemptLimit) || options.publicationAttemptLimit < 1 || options.publicationAttemptLimit > 10)) throw new VidGenError('invalid_argument', 'Worker publication attempt limit must be a whole number from 1 through 10.');
  if (options.queueExpirationDays !== undefined && (!Number.isSafeInteger(options.queueExpirationDays) || options.queueExpirationDays < 1 || options.queueExpirationDays > MAX_WORKER_QUEUE_EXPIRATION_DAYS)) throw new VidGenError('invalid_argument', `Worker queue expiration must be a whole number from 1 through ${MAX_WORKER_QUEUE_EXPIRATION_DAYS} days.`);
  const now = options.now ?? (() => new Date());
  const log = (level: 'info' | 'warn' | 'error', event: string, fields?: Readonly<Record<string, string | number | boolean>>) => logWorker(options.logger, logTimestamp(), level, event, fields);
  const acquireGenerationExclusion = options.acquireGenerationExclusion ?? acquireWorkerGenerationExclusion;
  let state = await options.store.load({ recoverInProgress: false });
  if (hasAmbiguousGeneration(state)) {
    const recoveryExclusion = await acquireGenerationExclusion();
    if (recoveryExclusion === undefined) { log('warn', 'generation_lock_contended'); return state; }
    state = await options.store.load({ recoverInProgress: false });
    if (hasAmbiguousGeneration(state)) {
      // Keep this newly-created marker: an old generation record has ambiguous provider ownership.
      state = recoverInProgressStages(state); await options.store.save(state);
      log('warn', 'generation_uncertain', { article_id: ambiguousCandidateId(state) ?? 'unknown' });
      return state;
    }
    await recoveryExclusion.release();
  }
  const recovered = recoverInProgressStages(state);
  if (recovered !== state) {
    state = recovered; await options.store.save(state);
    for (const candidate of Object.values(state.candidates)) for (const [platform, publication] of Object.entries(candidate.publication)) {
      if (publication.status === 'uncertain' && WORKER_POSTER_VIDEO_PLATFORMS.includes(platform as typeof WORKER_POSTER_VIDEO_PLATFORMS[number])) log('warn', 'publication_uncertain', { article_id: candidate.id, platform });
    }
  }
  const initial = !state.initialized;
  const candidateIds = [...options.discoveredCandidateIds];
  if (new Set(candidateIds).size !== candidateIds.length) throw new VidGenError('ngest_manifest', 'Ngest snapshot contains ambiguous duplicate Article IDs.');
  const newIds = candidateIds.filter((id) => state.candidates[id] === undefined);
  for (const id of newIds) await options.persistCandidateFixture?.(id);
  for (const id of newIds) state = addCandidate(state, id, timestamp(now()), initial && !options.processExisting);
  for (const id of newIds) log('info', 'candidate_discovered', { article_id: id });
  log('info', 'poll_discovery', { snapshot_article_count: candidateIds.length, newly_discovered_count: newIds.length });
  if (initial) { state = { ...state, initialized: true }; await options.store.save(state); if (!options.processExisting) return state; }
  if (options.processExisting) state = clearBaseline(state, new Set(candidateIds));
  if (!initial && (newIds.length > 0 || options.processExisting)) await options.store.save(state);
  let processed = 0;
  for (const candidate of evaluationBacklog(state)) {
    if (processed >= options.maxCandidates) break;
    const next = await evaluateCandidate(state, candidate, options.runners ?? {}, options.store, now, options.logger);
    state = next.state;
    if (next.didWork) processed += 1;
  }
  state = await exhaustGenerationAttempts(state, options.store, now, options.generationAttemptLimit ?? 2, options.logger);
  state = await expireGenerationQueue(state, options.store, now, options.queueExpirationDays ?? DEFAULT_WORKER_QUEUE_EXPIRATION_DAYS, options.logger);
  logQueue(options, state, now, options.dailyGenerationLimit ?? DEFAULT_DAILY_GENERATION_LIMIT);
  if (options.mode !== 'observe') {
    const dailyGenerationLimit = options.dailyGenerationLimit ?? DEFAULT_DAILY_GENERATION_LIMIT;
    const generationDay = day(now());
    const candidate = generationQueue(state)[0];
    if (candidate !== undefined && generationCount(state, generationDay) >= dailyGenerationLimit) {
      if (candidate.generation.status !== 'blocked' || candidate.generation.block !== 'generation_daily_limit') {
        state = replaceStage(state, candidate.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_daily_limit' });
        await options.store.save(state);
        log('info', 'generation_deferred', { reason: 'daily_limit', article_id: candidate.id });
      }
    } else if (candidate !== undefined) {
      const next = await processGeneration(state, candidate, options.mode, options.runners ?? {}, options.store, now, generationDay, dailyGenerationLimit, options.generationAttemptLimit ?? 2, acquireGenerationExclusion, options.logger);
      state = next.state;
      if (next.generationUnavailable) return options.store.load({ recoverInProgress: false });
    }
    if (candidate === undefined) log('info', 'generation_deferred', { reason: 'no_eligible_candidate' });
    if (options.mode === 'live') for (const candidate of Object.values(state.candidates)) {
      state = (await processPublication(state, candidate, options.runners ?? {}, options.store, now, options.publicationAttemptLimit ?? 2, options.logger)).state;
    }
  }
  await options.store.save(state);
  logQueue(options, state, now, options.dailyGenerationLimit ?? DEFAULT_DAILY_GENERATION_LIMIT);
  return state;
}

/** Long-running wrapper with injectable discovery and sleep for deterministic tests. */
export async function runWorker(options: WorkerRunOptions): Promise<WorkerState> {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (;;) {
    const state = await runWorkerCycle({ ...options, discoveredCandidateIds: await options.discover() });
    if (options.once) return state;
    await sleep(options.pollIntervalMs);
  }
}

/** Polls one already-coherent ngest snapshot and persists its local candidates. */
export async function runNgestWorkerCycle(options: NgestWorkerCycleOptions): Promise<WorkerState> {
  const manifest = await (options.fetchManifest ?? fetchNgestVidGenManifestPage)(options.environment ?? process.env);
  const fixtures = fixturesFromSnapshot(manifest);
  logWorker(options.logger, new Date().toISOString(), 'info', 'poll_snapshot', { article_count: fixtures.size });
  const momentumRunners = options.runners?.evaluate === undefined ? { ...options.runners, evaluate: defaultMomentumEvaluator(options.store, options.environment ?? process.env, options.parallelFetch) } : options.runners;
  if (momentumRunners?.generate === undefined && options.mode !== 'observe' && (options.presenterSourcesFile === undefined || options.fontPath === undefined)) throw new VidGenError('configuration', 'Worker generation requires a presenter-source manifest and a font file.');
  const generationRunners = momentumRunners?.generate === undefined && options.mode !== 'observe'
    ? { ...momentumRunners, prepareGeneration: async (candidate: WorkerCandidateState) => resolvePresenterSource(candidate, options.presenterSourcesFile!, options.logger), generate: (candidateId: string, source?: WorkerPresenterSource) => (options.headlineHandoff ?? runHeadlineHandoff)({ candidateId, fixturePath: options.store.candidateFixturePath(candidateId), artifactsRoot: DEFAULT_HEADLINE_ARTIFACTS_ROOT, anchorReferencePaths: [source!.path], fontPath: options.fontPath!, maxSeconds: options.maxSeconds ?? 8 }) }
    : momentumRunners;
  const runners = options.mode !== 'live' ? generationRunners : {
    ...createPosterRunners(),
    ...generationRunners,
    caption: generationRunners?.caption ?? ((candidateId) => governedCaption(options.store, candidateId)),
  };
  return runWorkerCycle({
    ...options,
    runners,
    discoveredCandidateIds: [...fixtures.keys()],
    persistCandidateFixture: async (id) => options.store.saveCandidateFixture(id, fixtures.get(id)!),
  });
}

/** Long-running ngest wrapper; each iteration fetches exactly one coherent snapshot. */
export async function runNgestWorker(options: NgestWorkerRunOptions): Promise<WorkerState> {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  logWorker(options.logger, logTimestamp(), 'info', 'worker_started', { mode: options.mode, poll_interval_ms: options.pollIntervalMs, max_candidates: options.maxCandidates, daily_generation_limit: options.dailyGenerationLimit ?? DEFAULT_DAILY_GENERATION_LIMIT, generation_attempt_limit: options.generationAttemptLimit ?? 2, publication_attempt_limit: options.publicationAttemptLimit ?? 2, queue_expiration_days: options.queueExpirationDays ?? DEFAULT_WORKER_QUEUE_EXPIRATION_DAYS, presenter_sources_configured: options.presenterSourcesFile !== undefined });
  for (;;) {
    try {
      logWorker(options.logger, logTimestamp(), 'info', 'poll_started');
      const state = await runNgestWorkerCycle(options);
      logWorker(options.logger, logTimestamp(), 'info', 'poll_succeeded', { candidate_count: Object.keys(state.candidates).length });
      if (options.once) return state;
    } catch (error) {
      // Only a transport that never yielded a coherent snapshot is safe to retry.
      if (options.once || !isRetryablePollFailure(error)) throw error;
      logWorker(options.logger, logTimestamp(), 'warn', 'poll_retryable_failure', { code: isVidGenError(error) ? error.code : 'unexpected' });
    }
    await sleep(options.pollIntervalMs);
  }
}

/** A durable selection wins over current-pool changes; only unassigned work reads the pool. */
export async function resolvePresenterSource(candidate: WorkerCandidateState, manifestPath: string, logger?: WorkerLogger): Promise<WorkerPresenterSource> {
  if (candidate.presenterSource !== undefined) {
    const source = await loadPresenterSource(candidate.presenterSource.path);
    if (!samePresenterSource(source, candidate.presenterSource)) throw new VidGenError('configuration', 'Worker selected presenter source has changed.');
    logWorker(logger, new Date().toISOString(), 'info', 'presenter_source_validated', { article_id: candidate.id });
    return source;
  }
  const sources = await loadPresenterSourcesFile(manifestPath);
  logWorker(logger, new Date().toISOString(), 'info', 'presenter_pool_refreshed', { source_count: sources.length });
  return selectPresenterSource(candidate.id, sources);
}

/** Authentication, configuration, malformed snapshots, and durable state failures stay fatal. */
function isRetryablePollFailure(error: unknown): boolean {
  return isVidGenError(error) && (error.code === 'transport' || error.code === 'ngest_timeout');
}

async function evaluateCandidate(state: WorkerState, candidate: WorkerCandidateState, runners: WorkerStageRunners, store: WorkerStateStore, now: () => Date, logger?: WorkerLogger): Promise<{ state: WorkerState; didWork: boolean }> {
  let next = state; let current = candidate; let didWork = false;
  if (current.evaluation.status === 'pending' && runners.evaluate !== undefined) {
    logWorker(logger, logTimestamp(), 'info', 'evaluation_started', { article_id: current.id });
    didWork = true; ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'evaluation', store, now, async () => {
      const evaluation = validateWorkerEvaluation(await runners.evaluate!(current.id));
      return { evaluationResult: evaluation, admission: { status: evaluation.decision === 'admitted' ? 'succeeded' : 'skipped', completedAt: timestamp(now()) } };
    }));
    const result = current.evaluationResult;
    if (current.evaluation.status === 'succeeded' && result !== undefined) logWorker(logger, logTimestamp(), 'info', 'evaluation_completed', { article_id: current.id, score: result.score, threshold: result.threshold, decision: result.decision, budget_blocked: result.budgetBlocked === true });
    else logWorker(logger, logTimestamp(), 'warn', 'evaluation_failed', { article_id: current.id });
  }
  return { state: next, didWork };
}

/** Discovery order is not queue order; unfinished durable evaluations survive feed changes. */
function evaluationBacklog(state: WorkerState): WorkerCandidateState[] {
  return Object.values(state.candidates)
    .filter((candidate) => candidate.baseline !== true && candidate.evaluation.status === 'pending')
    .sort((left, right) => discoveryTime(left).localeCompare(discoveryTime(right)) || left.id.localeCompare(right.id));
}

/** The backlog is derived from durable candidate state, never a second queue. */
function generationQueue(state: WorkerState): WorkerCandidateState[] {
  return Object.values(state.candidates)
    .filter((candidate) => isQualifiedForGeneration(candidate) && ['pending', 'failed', 'blocked'].includes(candidate.generation.status) && (candidate.generation.status !== 'blocked' || candidate.generation.block === 'generation_daily_limit'))
    .sort((left, right) => right.evaluationResult!.score - left.evaluationResult!.score
      || (admissionTime(left) < admissionTime(right) ? -1 : admissionTime(left) > admissionTime(right) ? 1 : 0)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

async function expireGenerationQueue(state: WorkerState, store: WorkerStateStore, now: () => Date, days: number, logger?: WorkerLogger): Promise<WorkerState> {
  const cutoff = now().valueOf() - days * 86_400_000;
  let next = state;
  for (const candidate of generationQueue(state)) {
    if (Date.parse(admissionTime(candidate)) > cutoff) continue;
    next = replaceStage(next, candidate.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'queue_expired' });
    logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'queue_expired', article_id: candidate.id });
  }
  if (next !== state) await store.save(next);
  return next;
}

async function exhaustGenerationAttempts(state: WorkerState, store: WorkerStateStore, now: () => Date, limit: number, logger?: WorkerLogger): Promise<WorkerState> {
  let next = state;
  for (const candidate of Object.values(state.candidates)) {
    if (candidate.generation.status !== 'failed' || (candidate.generationAttempts ?? 0) < limit) continue;
    next = replaceStage(next, candidate.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_attempt_limit' });
    logWorker(logger, logTimestamp(), 'warn', 'generation_attempt_exhausted', { article_id: candidate.id });
  }
  if (next !== state) await store.save(next);
  return next;
}

function hasAmbiguousGeneration(state: WorkerState): boolean { return Object.values(state.candidates).some((candidate) => candidate.generation.status === 'running' || candidate.generation.status === 'uncertain'); }
function ambiguousCandidateId(state: WorkerState): string | undefined { return Object.values(state.candidates).find((candidate) => candidate.generation.status === 'running' || candidate.generation.status === 'uncertain')?.id; }
function logQueue(options: WorkerCycleOptions, state: WorkerState, now: () => Date, limit: number): void {
  const queue = generationQueue(state); const top = queue[0];
  logWorker(options.logger, logTimestamp(), 'info', 'queue_summary', {
    eligible_count: queue.length,
    expired_count: Object.values(state.candidates).filter((candidate) => candidate.generation.block === 'queue_expired').length,
    daily_generation_starts_used: generationCount(state, day(now())),
    daily_generation_limit: limit,
    ...(top === undefined ? {} : { top_article_id: top.id, top_score: top.evaluationResult!.score }),
  });
}
function admissionTime(candidate: WorkerCandidateState): string { return candidate.admission.completedAt ?? candidate.evaluationResult!.evaluatedAt; }
function discoveryTime(candidate: WorkerCandidateState): string { return candidate.discovery.completedAt ?? ''; }

async function processGeneration(state: WorkerState, candidate: WorkerCandidateState, mode: Exclude<WorkerMode, 'observe'>, runners: WorkerStageRunners, store: WorkerStateStore, now: () => Date, generationDay: string, dailyGenerationLimit: number, generationAttemptLimit: number, acquireGenerationExclusion: () => Promise<WorkerGenerationExclusion | undefined>, logger?: WorkerLogger): Promise<{ state: WorkerState; didWork: boolean; generationUnavailable?: true }> {
  let next = state; let current = candidate; let didWork = false;
  if (mode === 'live' && (current.publicationTargets === undefined || (current.publicationTargets.length === 0 && current.generation.status === 'pending'))) {
    const targets: typeof WORKER_POSTER_VIDEO_PLATFORMS[number][] = [];
    if (runners.doctor !== undefined) for (const platform of WORKER_POSTER_VIDEO_PLATFORMS) { try { await runners.doctor(platform); targets.push(platform); logWorker(logger, logTimestamp(), 'info', 'platform_ready', { platform, ready: true }); } catch { logWorker(logger, logTimestamp(), 'warn', 'platform_ready', { platform, ready: false }); } }
    next = mergeCandidate(next, current.id, { publicationTargets: targets, publicationAttempts: {} }, 'generation', current.generation);
    current = next.candidates[current.id]!; await store.save(next); didWork = true;
  }
  const prior = await findVerifiedPriorProduction(store, current.id);
  if (prior !== undefined) {
    next = mergeCandidate(next, current.id, { generatedArtifact: prior }, 'generation', { status: 'succeeded', completedAt: timestamp(now()) });
    await store.save(next); logWorker(logger, logTimestamp(), 'info', 'prior_production_reused', { article_id: current.id }); return { state: next, didWork: true };
  }
  if (mode === 'live' && current.publicationTargets?.length === 0) { logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'poster_not_ready', article_id: current.id }); return { state: next, didWork }; }
  if (runners.generate === undefined) return { state: next, didWork };
  if (current.generation.status === 'blocked' && current.generation.block === 'generation_daily_limit' && generationCount(next, generationDay) < dailyGenerationLimit) {
    next = replaceStage(next, current.id, 'generation', { status: 'pending' }); current = next.candidates[current.id]!; await store.save(next);
  }
  if (current.generation.status === 'failed' && (current.generationAttempts ?? 0) >= generationAttemptLimit) {
    next = replaceStage(next, current.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_attempt_limit' }); await store.save(next); logWorker(logger, logTimestamp(), 'warn', 'generation_attempt_exhausted', { article_id: current.id }); return { state: next, didWork: true };
  }
  if (current.generation.status !== 'pending' && current.generation.status !== 'failed') return { state: next, didWork };
  if (generationCount(next, generationDay) >= dailyGenerationLimit) {
    next = replaceStage(next, current.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_daily_limit' }); await store.save(next); logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'daily_limit', article_id: current.id }); return { state: next, didWork: true };
  }
  const exclusion = await acquireGenerationExclusion();
  if (exclusion === undefined) { logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'generation_lock_contended', article_id: current.id }); return { state: next, didWork, generationUnavailable: true }; }
  let externalWorkStarted = false;
  let resultHandled = false;
  let retainExclusion = false;
  try {
    next = await store.load({ recoverInProgress: false });
    if (hasAmbiguousGeneration(next)) {
      retainExclusion = true;
      logWorker(logger, logTimestamp(), 'warn', 'generation_uncertain', { article_id: ambiguousCandidateId(next) ?? 'unknown' });
      return { state: next, didWork, generationUnavailable: true };
    }
    const latest = next.candidates[current.id];
    if (latest === undefined || !isQualifiedForGeneration(latest)) return { state: next, didWork };
    current = latest;
    if (current.generation.status === 'blocked' && current.generation.block === 'generation_daily_limit' && generationCount(next, generationDay) < dailyGenerationLimit) {
      next = replaceStage(next, current.id, 'generation', { status: 'pending' }); current = next.candidates[current.id]!; await store.save(next);
    }
    if (current.generation.status === 'failed' && (current.generationAttempts ?? 0) >= generationAttemptLimit) {
      next = replaceStage(next, current.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_attempt_limit' }); await store.save(next); return { state: next, didWork: true };
    }
    if (current.generation.status !== 'pending' && current.generation.status !== 'failed') return { state: next, didWork };
    const recheckedPrior = await findVerifiedPriorProduction(store, current.id);
    if (recheckedPrior !== undefined) {
      next = mergeCandidate(next, current.id, { generatedArtifact: recheckedPrior }, 'generation', { status: 'succeeded', completedAt: timestamp(now()) });
      await store.save(next); logWorker(logger, logTimestamp(), 'info', 'prior_production_reused', { article_id: current.id }); return { state: next, didWork: true };
    }
    if (mode === 'live' && current.publicationTargets?.length === 0) { logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'poster_not_ready', article_id: current.id }); return { state: next, didWork }; }
    if (generationCount(next, generationDay) >= dailyGenerationLimit) {
      next = replaceStage(next, current.id, 'generation', { status: 'blocked', completedAt: timestamp(now()), block: 'generation_daily_limit' }); await store.save(next); logWorker(logger, logTimestamp(), 'info', 'generation_deferred', { reason: 'daily_limit', article_id: current.id }); return { state: next, didWork: true };
    }
    let source: WorkerPresenterSource | undefined;
    logWorker(logger, logTimestamp(), 'info', 'generation_selected', { article_id: current.id });
    if (runners.prepareGeneration !== undefined) {
      try { source = await runners.prepareGeneration(current); }
      catch (error) { logWorker(logger, logTimestamp(), 'warn', 'presenter_source_failed', { article_id: current.id, reason: 'validation_failed' }); throw error; }
      if (current.presenterSource === undefined) {
        next = mergeCandidate(next, current.id, { presenterSource: source }, 'generation', current.generation); current = next.candidates[current.id]!; await store.save(next); logWorker(logger, logTimestamp(), 'info', 'presenter_source_selected', { article_id: current.id, ...(safePresenterBasename(source.basename) === undefined ? {} : { basename: safePresenterBasename(source.basename)! }) });
      }
    }
    next = spendGeneration(next, current.id, generationDay); current = next.candidates[current.id]!; await store.save(next);
    logWorker(logger, logTimestamp(), 'info', 'generation_started', { article_id: current.id });
    didWork = true; ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'generation', store, now, async () => ({ generatedArtifact: validateWorkerGeneratedArtifact(await runners.generate!(current.id, source)) }), undefined, () => { externalWorkStarted = true; }));
    logWorker(logger, logTimestamp(), current.generation.status === 'succeeded' ? 'info' : 'warn', current.generation.status === 'succeeded' ? 'generation_succeeded' : 'generation_failed', { article_id: current.id });
    resultHandled = true;
    return { state: next, didWork };
  } finally {
    if (!retainExclusion && (!externalWorkStarted || resultHandled)) await exclusion.release();
  }
}

async function processPublication(state: WorkerState, candidate: WorkerCandidateState, runners: WorkerStageRunners, store: WorkerStateStore, now: () => Date, publicationAttemptLimit: number, logger?: WorkerLogger): Promise<{ state: WorkerState; didWork: boolean }> {
  let next = state; let current = candidate; let didWork = false;
  if (current.generation.status !== 'succeeded' || current.publicationTargets === undefined || runners.publish === undefined || runners.caption === undefined) return { state: next, didWork };
  let caption: string | undefined;
  for (const platform of current.publicationTargets) {
    if (current.publication[platform]?.status === 'succeeded') continue;
    if (current.publication[platform]?.status === 'uncertain' || current.publication[platform]?.status === 'blocked') continue;
    if ((current.publicationAttempts?.[platform] ?? 0) >= publicationAttemptLimit) {
      next = replaceStage(next, current.id, 'publication', { status: 'blocked', completedAt: timestamp(now()), block: 'publication_attempt_limit' }, platform); current = next.candidates[current.id]!; await store.save(next); logWorker(logger, logTimestamp(), 'warn', 'publication_attempt_exhausted', { article_id: current.id, platform }); didWork = true; continue;
    }
    next = spendPublication(next, current.id, platform); current = next.candidates[current.id]!; await store.save(next); didWork = true;
    caption ??= await runners.caption(current.id);
    logWorker(logger, logTimestamp(), 'info', 'publication_started', { article_id: current.id, platform });
    ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'publication', store, now, () => runners.publish!(current.id, platform, current.generatedArtifact!, caption!).then(() => ({})), platform));
    logWorker(logger, logTimestamp(), current.publication[platform]?.status === 'succeeded' ? 'info' : 'warn', current.publication[platform]?.status === 'succeeded' ? 'publication_succeeded' : 'publication_failed', { article_id: current.id, platform });
  }
  return { state: next, didWork };
}

async function runExternalStage(state: WorkerState, candidateId: string, stageName: 'evaluation' | 'generation' | 'publication', store: WorkerStateStore, now: () => Date, run: () => Promise<Partial<WorkerCandidateState>>, platform?: string, onExternalWorkStart?: () => void): Promise<{ state: WorkerState; candidate: WorkerCandidateState }> {
  let next = replaceStage(state, candidateId, stageName, { status: 'running', startedAt: timestamp(now()) }, platform);
  await store.save(next);
  onExternalWorkStart?.();
  try {
    const patch = await run();
    next = mergeCandidate(next, candidateId, patch, stageName, { status: 'succeeded', completedAt: timestamp(now()) }, platform);
  } catch {
    next = replaceStage(next, candidateId, stageName, { status: 'failed', completedAt: timestamp(now()), failure: { code: 'stage_failed', message: 'Worker stage failed.' } }, platform);
  }
  await store.save(next);
  return { state: next, candidate: next.candidates[candidateId]! };
}

function addCandidate(state: WorkerState, id: string, at: string, baseline: boolean): WorkerState { return { ...state, candidates: { ...state.candidates, [id]: { ...createDiscoveredCandidate(id, at), ...(baseline ? { baseline: true as const } : {}) } } }; }
function fixturesFromSnapshot(manifest: NgestVidGenManifestPage): ReadonlyMap<string, NgestVidGenManifestPage> {
  const canonical = buildCanonicalInput(manifest);
  if (canonical.feed.articles.length > MAX_WORKER_DISCOVERED_CANDIDATES) throw new VidGenError('ngest_manifest', 'Ngest snapshot exceeds the Worker candidate limit.');
  const fixtures = new Map<string, NgestVidGenManifestPage>();
  for (const article of canonical.feed.articles) {
    if (fixtures.has(article.articleId)) throw new VidGenError('ngest_manifest', 'Ngest snapshot contains ambiguous duplicate Article IDs.');
    fixtures.set(article.articleId, manifest);
  }
  for (const id of fixtures.keys()) fixtures.set(id, buildOneArticleFixture(manifest, id));
  return fixtures;
}
function clearBaseline(state: WorkerState, ids: ReadonlySet<string>): WorkerState {
  let changed = false;
  const candidates = Object.fromEntries(Object.entries(state.candidates).map(([id, candidate]) => {
    if (!ids.has(id) || candidate.baseline !== true) return [id, candidate];
    changed = true; const { baseline: _baseline, ...ready } = candidate; return [id, ready];
  }));
  return changed ? { ...state, candidates } : state;
}
function replaceStage(state: WorkerState, id: string, name: 'evaluation' | 'generation' | 'publication', stage: WorkerStage, platform?: string): WorkerState { return mergeCandidate(state, id, {}, name, stage, platform); }
function mergeCandidate(state: WorkerState, id: string, patch: Partial<WorkerCandidateState>, name: 'evaluation' | 'generation' | 'publication', stage: WorkerStage, platform?: string): WorkerState {
  const candidate = state.candidates[id]; if (candidate === undefined) throw new VidGenError('artifact', 'Worker candidate state is missing.');
  const publication = name === 'publication' ? { ...candidate.publication, [platform!]: stage } : candidate.publication;
  const staged = name === 'publication' ? { ...candidate, publication } : { ...candidate, [name]: stage };
  return { ...state, candidates: { ...state.candidates, [id]: { ...staged, ...patch, publication: patch.publication ?? staged.publication } } };
}
function generationCount(state: WorkerState, date: string): number { return state.generationCounts[date] ?? 0; }
function isQualifiedForGeneration(candidate: WorkerCandidateState): boolean {
  const evaluation = candidate.evaluationResult;
  return candidate.evaluation.status === 'succeeded'
    && candidate.admission.status === 'succeeded'
    && evaluation?.metric === WEB_MOMENTUM_METRIC
    && evaluation.version === WEB_MOMENTUM_VERSION
    && evaluation.policyId === WEB_MOMENTUM_POLICY_ID
    && evaluation.decision === 'admitted'
    && evaluation.budgetBlocked !== true;
}
function spendGeneration(state: WorkerState, candidateId: string, date: string): WorkerState {
  const candidate = state.candidates[candidateId]; if (candidate === undefined) throw new VidGenError('artifact', 'Worker candidate state is missing.');
  return { ...state, generationCounts: { [date]: generationCount(state, date) + 1 }, candidates: { ...state.candidates, [candidateId]: { ...candidate, generationAttempts: (candidate.generationAttempts ?? 0) + 1 } } };
}
function spendPublication(state: WorkerState, candidateId: string, platform: typeof WORKER_POSTER_VIDEO_PLATFORMS[number]): WorkerState {
  const candidate = state.candidates[candidateId]; if (candidate === undefined) throw new VidGenError('artifact', 'Worker candidate state is missing.');
  return { ...state, candidates: { ...state.candidates, [candidateId]: { ...candidate, publicationAttempts: { ...candidate.publicationAttempts, [platform]: (candidate.publicationAttempts?.[platform] ?? 0) + 1 } } } };
}
function day(value: Date): string { return timestamp(value).slice(0, 10); }
function timestamp(now: Date): string { if (Number.isNaN(now.valueOf())) throw new VidGenError('invalid_argument', 'Worker clock produced an invalid timestamp.'); return now.toISOString(); }
function logTimestamp(): string { return new Date().toISOString(); }
function safePresenterBasename(value: string): string | undefined { return /^[A-Za-z0-9._-]{1,128}$/u.test(value) ? value : undefined; }

async function governedCaption(store: WorkerStateStore, candidateId: string): Promise<string> {
  const fixture = await loadNgestVidGenManifestFile(store.candidateFixturePath(candidateId));
  const story = buildStoryInput(buildCanonicalInput(fixture), candidateId);
  return `"${story.article.headline}" by ${story.article.source.displayName}`;
}

/** Keeps Poster argv construction at the Worker boundary without accepting child output. */
export function createPosterRunners(runPoster: PosterCommandRunner = runPosterCommand): Pick<WorkerStageRunners, 'doctor' | 'publish'> {
  return {
    doctor: (platform) => runPoster(['doctor', platform]),
    publish: (_candidateId, platform, artifact, caption) => runPoster(['post', platform, '--video', artifact.finalPath, '--text', caption]),
  };
}

function defaultMomentumEvaluator(store: WorkerStateStore, environment: NgestVidGenEnvironment, parallelFetch?: typeof fetch): (candidateId: string) => Promise<WorkerEvaluation> {
  return async (candidateId) => {
    const config = createMomentumConfig(environment); const now = new Date(); const today = now.toISOString().slice(0, 10);
    const state = await store.load({ recoverInProgress: false });
    const used = Object.values(state.candidates).filter((candidate) => candidate.evaluationResult?.metric === WEB_MOMENTUM_METRIC && candidate.evaluationResult.version === WEB_MOMENTUM_VERSION && candidate.evaluationResult.policyId === WEB_MOMENTUM_POLICY_ID && candidate.evaluationResult.evaluatedAt.slice(0, 10) === today && candidate.evaluationResult.budgetBlocked !== true).length;
    if (used >= config.dailyEvaluationLimit) return { metric: WEB_MOMENTUM_METRIC, version: WEB_MOMENTUM_VERSION, policyId: WEB_MOMENTUM_POLICY_ID, score: 0, threshold: config.threshold, decision: 'skipped', evaluatedAt: now.toISOString(), budgetBlocked: true };
    const fixture = await loadNgestVidGenManifestFile(store.candidateFixturePath(candidateId));
    return evaluateWebMomentum(buildStoryInput(buildCanonicalInput(fixture), candidateId).article, now, config, { environment, fetch: parallelFetch });
  };
}
