import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';
import { prettyJson, writeJsonAtomically, type AtomicJsonFilesystem } from '../shared/atomic-json.ts';

export const WORKER_STATE_FILE = 'worker-state.json';
export const WORKER_STATE_VERSION = 1;
export type WorkerStageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'uncertain';

export interface WorkerStage {
  readonly status: WorkerStageStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failure?: { readonly code: 'stage_failed'; readonly message: 'Worker stage failed.' };
}

export interface WorkerEvaluation {
  readonly metric: string;
  readonly version: string;
  readonly score: number;
  readonly threshold: number;
  readonly decision: 'admitted' | 'skipped';
  readonly evaluatedAt: string;
  readonly queryId: string;
  readonly evidenceId: string;
}

export interface WorkerCandidateState {
  readonly id: string;
  /** First-snapshot candidates wait for an explicit backfill request. */
  readonly baseline?: true;
  readonly discovery: WorkerStage;
  readonly evaluation: WorkerStage;
  readonly admission: WorkerStage;
  readonly generation: WorkerStage;
  readonly publication: Readonly<Record<string, WorkerStage>>;
  readonly evaluationResult?: WorkerEvaluation;
}

export interface WorkerState {
  readonly version: 1;
  readonly initialized: boolean;
  readonly candidates: Readonly<Record<string, WorkerCandidateState>>;
}

export interface WorkerStateFilesystem extends AtomicJsonFilesystem {
  mkdir(path: string, options: { readonly recursive?: boolean }): Promise<string | undefined>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

export interface WorkerStateStoreDependencies {
  readonly filesystem?: WorkerStateFilesystem;
  readonly createTemporarySuffix?: () => string;
}

/** A small, atomically published state file; no queue or database is needed yet. */
export class WorkerStateStore {
  readonly root: string;
  readonly path: string;
  private readonly filesystem: WorkerStateFilesystem;
  private readonly createTemporarySuffix?: () => string;

  constructor(root: string, dependencies: WorkerStateStoreDependencies = {}) {
    this.root = resolve(root);
    this.path = join(this.root, WORKER_STATE_FILE);
    this.filesystem = dependencies.filesystem ?? { mkdir, readFile, writeFile, rename, unlink };
    this.createTemporarySuffix = dependencies.createTemporarySuffix;
  }

  async load(): Promise<WorkerState> {
    let text: string;
    try { text = await this.filesystem.readFile(this.path, 'utf8'); }
    catch (error: unknown) {
      if (isMissingFile(error)) return emptyWorkerState();
      throw new VidGenError('artifact', 'Unable to read Worker state.');
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new VidGenError('artifact', 'Worker state is malformed.'); }
    const state = validateWorkerState(value);
    const recovered = recoverInProgressStages(state);
    if (recovered !== state) await this.save(recovered);
    return recovered;
  }

  async save(state: WorkerState): Promise<void> {
    validateWorkerState(state);
    try {
      await this.filesystem.mkdir(this.root, { recursive: true });
      await writeJsonAtomically(this.filesystem, this.path, state, prettyJson, this.createTemporarySuffix);
    } catch {
      throw new VidGenError('artifact', 'Unable to persist Worker state.');
    }
  }
}

export function emptyWorkerState(): WorkerState { return { version: 1, initialized: false, candidates: {} }; }

export function createDiscoveredCandidate(id: string, at: string): WorkerCandidateState {
  validateCandidateId(id); validateTimestamp(at);
  return {
    id,
    discovery: { status: 'succeeded', completedAt: at },
    evaluation: { status: 'pending' }, admission: { status: 'pending' }, generation: { status: 'pending' }, publication: {},
  };
}

/** Treat a crash during external work as uncertain, never as a retry or success. */
export function recoverInProgressStages(state: WorkerState): WorkerState {
  let changed = false;
  const candidates = Object.fromEntries(Object.entries(state.candidates).map(([id, candidate]) => {
    const replace = (stage: WorkerStage) => stage.status === 'running' ? (changed = true, { ...stage, status: 'uncertain' as const }) : stage;
    const publication = Object.fromEntries(Object.entries(candidate.publication).map(([platform, stage]) => [platform, replace(stage)]));
    const next = { ...candidate, discovery: replace(candidate.discovery), evaluation: replace(candidate.evaluation), admission: replace(candidate.admission), generation: replace(candidate.generation), publication };
    return [id, next];
  }));
  return changed ? { ...state, candidates } : state;
}

export function validateWorkerState(value: unknown): WorkerState {
  const state = record(value, 'Worker state is malformed.');
  if (state.version !== WORKER_STATE_VERSION || typeof state.initialized !== 'boolean' || !isPlainRecord(state.candidates) || Object.keys(state).some((key) => !['version', 'initialized', 'candidates'].includes(key))) throw malformed();
  if (Object.keys(state.candidates).length > 10_000) throw malformed();
  for (const [id, candidate] of Object.entries(state.candidates)) validateCandidate(candidate, id);
  return state as unknown as WorkerState;
}

export function validateWorkerEvaluation(value: unknown): WorkerEvaluation {
  const evaluation = record(value, 'Worker evaluation result is malformed.');
  if (Object.keys(evaluation).some((key) => !['metric', 'version', 'score', 'threshold', 'decision', 'evaluatedAt', 'queryId', 'evidenceId'].includes(key))
    || !safeLabel(evaluation.metric) || !safeLabel(evaluation.version) || !safeNumber(evaluation.score) || !safeNumber(evaluation.threshold)
    || (evaluation.decision !== 'admitted' && evaluation.decision !== 'skipped') || !safeTimestamp(evaluation.evaluatedAt)
    || !safeLabel(evaluation.queryId) || !safeLabel(evaluation.evidenceId)) throw malformed();
  return evaluation as unknown as WorkerEvaluation;
}

function validateCandidate(value: unknown, id: string): void {
  if (!safeCandidateId(id)) throw malformed(); const candidate = record(value, 'Worker state is malformed.');
  if (Object.keys(candidate).some((key) => !['id', 'baseline', 'discovery', 'evaluation', 'admission', 'generation', 'publication', 'evaluationResult'].includes(key)) || candidate.id !== id || !isPlainRecord(candidate.publication) || (candidate.baseline !== undefined && candidate.baseline !== true)) throw malformed();
  validateStage(candidate.discovery); validateStage(candidate.evaluation); validateStage(candidate.admission); validateStage(candidate.generation);
  for (const [platform, stage] of Object.entries(candidate.publication)) { if (!safeLabel(platform)) throw malformed(); validateStage(stage); }
  if (candidate.evaluationResult !== undefined) validateWorkerEvaluation(candidate.evaluationResult);
  if (candidate.evaluation.status === 'succeeded' && candidate.evaluationResult === undefined) throw malformed();
  if (candidate.admission.status === 'succeeded' && candidate.evaluationResult?.decision !== 'admitted') throw malformed();
  if (candidate.admission.status === 'skipped' && candidate.evaluationResult?.decision !== 'skipped') throw malformed();
}

function validateStage(value: unknown): void {
  const stage = record(value, 'Worker state is malformed.');
  if (Object.keys(stage).some((key) => !['status', 'startedAt', 'completedAt', 'failure'].includes(key)) || !['pending', 'running', 'succeeded', 'failed', 'skipped', 'uncertain'].includes(stage.status as string)) throw malformed();
  if (stage.startedAt !== undefined && !safeTimestamp(stage.startedAt)) throw malformed();
  if (stage.completedAt !== undefined && !safeTimestamp(stage.completedAt)) throw malformed();
  if (stage.failure !== undefined && (!isPlainRecord(stage.failure) || stage.failure.code !== 'stage_failed' || stage.failure.message !== 'Worker stage failed.')) throw malformed();
  if (stage.status === 'failed' && stage.failure === undefined) throw malformed();
  if (stage.status !== 'failed' && stage.failure !== undefined) throw malformed();
}

function validateCandidateId(value: string): void { if (!safeCandidateId(value)) throw new VidGenError('invalid_argument', 'Worker candidate ID is unsafe.'); }
function safeCandidateId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value); }
function validateTimestamp(value: string): void { if (!safeTimestamp(value)) throw new VidGenError('invalid_argument', 'Worker clock produced an invalid timestamp.'); }
function safeTimestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && !Number.isNaN(Date.parse(value)); }
function safeLabel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(value) && !/(?:token|secret|api[_-]?key|bearer|authorization)/iu.test(value); }
function safeNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000; }
function record(value: unknown, message: string): Record<string, unknown> { if (!isPlainRecord(value)) throw new VidGenError('artifact', message); return value; }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function malformed(): VidGenError { return new VidGenError('artifact', 'Worker state is malformed.'); }
function isMissingFile(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'; }
