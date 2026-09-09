import { VidGenError } from '../core/error.ts';
import { createDiscoveredCandidate, type WorkerCandidateState, type WorkerEvaluation, type WorkerStage, type WorkerState, WorkerStateStore, validateWorkerEvaluation } from './state.ts';

export type WorkerMode = 'observe' | 'generate' | 'live';

export interface WorkerStageRunners {
  readonly evaluate?: (candidateId: string) => Promise<WorkerEvaluation>;
  readonly generate?: (candidateId: string) => Promise<void>;
  readonly publish?: (candidateId: string, platform: string) => Promise<void>;
}

export interface WorkerCycleOptions {
  readonly store: WorkerStateStore;
  readonly discoveredCandidateIds: readonly string[];
  readonly mode: WorkerMode;
  readonly processExisting?: boolean;
  readonly maxCandidates: number;
  readonly publicationPlatforms?: readonly string[];
  readonly runners?: WorkerStageRunners;
  readonly now?: () => Date;
}

export interface WorkerRunOptions extends Omit<WorkerCycleOptions, 'discoveredCandidateIds'> {
  readonly once?: boolean;
  readonly discover: () => Promise<readonly string[]>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs: number;
}

/** Runs one bounded snapshot. Discovery is injected; this foundation does not poll ngest itself. */
export async function runWorkerCycle(options: WorkerCycleOptions): Promise<WorkerState> {
  if (!Number.isSafeInteger(options.maxCandidates) || options.maxCandidates < 1) throw new VidGenError('invalid_argument', 'Worker max candidates must be a positive whole number.');
  const now = options.now ?? (() => new Date());
  let state = await options.store.load();
  const initial = !state.initialized;
  const candidateIds = [...new Set(options.discoveredCandidateIds)];
  for (const id of candidateIds) if (state.candidates[id] === undefined) state = addCandidate(state, id, timestamp(now()), initial && !options.processExisting);
  if (initial) { state = { ...state, initialized: true }; await options.store.save(state); if (!options.processExisting) return state; }
  if (options.processExisting) state = clearBaseline(state, new Set(candidateIds));
  let processed = 0;
  for (const id of candidateIds) {
    if (processed >= options.maxCandidates) break;
    const candidate = state.candidates[id];
    if (candidate === undefined || candidate.baseline === true) continue;
    const next = await processCandidate(state, candidate, options.mode, options.publicationPlatforms ?? [], options.runners ?? {}, options.store, now);
    state = next.state;
    if (next.didWork) processed += 1;
  }
  await options.store.save(state);
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

async function processCandidate(state: WorkerState, candidate: WorkerCandidateState, mode: WorkerMode, platforms: readonly string[], runners: WorkerStageRunners, store: WorkerStateStore, now: () => Date): Promise<{ state: WorkerState; didWork: boolean }> {
  let next = state; let current = candidate; let didWork = false;
  if (current.evaluation.status === 'pending' && runners.evaluate !== undefined) {
    didWork = true; ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'evaluation', store, now, async () => {
      const evaluation = validateWorkerEvaluation(await runners.evaluate!(current.id));
      return { evaluationResult: evaluation, admission: { status: evaluation.decision === 'admitted' ? 'succeeded' : 'skipped', completedAt: timestamp(now()) } };
    }));
  }
  if (mode === 'observe' || current.admission.status !== 'succeeded' || current.generation.status !== 'pending' || runners.generate === undefined) return { state: next, didWork };
  didWork = true; ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'generation', store, now, () => runners.generate!(current.id).then(() => ({}))));
  if (mode !== 'live' || current.generation.status !== 'succeeded' || runners.publish === undefined) return { state: next, didWork };
  for (const platform of platforms) {
    if (current.publication[platform]?.status === 'succeeded') continue;
    if (current.publication[platform]?.status !== undefined && current.publication[platform]?.status !== 'pending') continue;
    didWork = true; ({ state: next, candidate: current } = await runExternalStage(next, current.id, 'publication', store, now, () => runners.publish!(current.id, platform).then(() => ({})), platform));
  }
  return { state: next, didWork };
}

async function runExternalStage(state: WorkerState, candidateId: string, stageName: 'evaluation' | 'generation' | 'publication', store: WorkerStateStore, now: () => Date, run: () => Promise<Partial<WorkerCandidateState>>, platform?: string): Promise<{ state: WorkerState; candidate: WorkerCandidateState }> {
  let next = replaceStage(state, candidateId, stageName, { status: 'running', startedAt: timestamp(now()) }, platform);
  await store.save(next);
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
function timestamp(now: Date): string { if (Number.isNaN(now.valueOf())) throw new VidGenError('invalid_argument', 'Worker clock produced an invalid timestamp.'); return now.toISOString(); }
