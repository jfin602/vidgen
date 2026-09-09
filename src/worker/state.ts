import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { VidGenError } from '../core/error.ts';
import { prettyJson, writeJsonAtomically, type AtomicJsonFilesystem } from '../shared/atomic-json.ts';

export const WORKER_STATE_FILE = 'worker-state.json';
export const WORKER_CANDIDATES_DIRECTORY = 'candidates';
export const WORKER_GENERATED_DIRECTORY = 'generated';
export const WORKER_STATE_VERSION = 1;
export type WorkerStageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'blocked' | 'uncertain';
export type WorkerPosterPlatform = 'x' | 'bluesky' | 'reels';

export interface WorkerStage {
  readonly status: WorkerStageStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly failure?: { readonly code: 'stage_failed'; readonly message: 'Worker stage failed.' };
  readonly block?: 'generation_daily_limit' | 'generation_attempt_limit' | 'publication_attempt_limit';
}

export interface WorkerEvaluation {
  readonly metric: string;
  readonly version: string;
  readonly policyId?: string;
  readonly score: number;
  readonly threshold: number;
  readonly decision: 'admitted' | 'skipped';
  readonly evaluatedAt: string;
  /** Compatibility fields for pre-Web-Momentum injected test runners. */
  readonly queryId?: string;
  readonly evidenceId?: string;
  readonly searchId?: string;
  readonly sessionId?: string;
  readonly signature?: readonly string[];
  readonly results?: readonly WorkerEvidence[];
  readonly components?: { readonly breadth: number; readonly saturation: number; readonly freshness: number; readonly reaction: number; };
  readonly budgetBlocked?: true;
}
export interface WorkerEvidence { readonly url: string; readonly title: string; readonly domain: string; readonly publishedAt?: string; readonly excerptHash: string; readonly matchedTerms: readonly string[]; readonly reactionSignal: boolean; }

export interface WorkerCandidateState {
  readonly id: string;
  /** First-snapshot candidates wait for an explicit backfill request. */
  readonly baseline?: true;
  readonly discovery: WorkerStage;
  readonly evaluation: WorkerStage;
  readonly admission: WorkerStage;
  readonly generation: WorkerStage;
  readonly generationAttempts?: number;
  readonly generatedArtifact?: WorkerGeneratedArtifact;
  /** Ready video destinations captured before generation; an empty set is held, not complete. */
  readonly publicationTargets?: readonly WorkerPosterPlatform[];
  readonly publication: Readonly<Record<string, WorkerStage>>;
  readonly publicationAttempts?: Readonly<Record<string, number>>;
  readonly evaluationResult?: WorkerEvaluation;
  readonly ownerLabel?: 'generate' | 'skip';
}

export interface WorkerGeneratedArtifact {
  readonly finalPath: string;
  readonly metadataPath: string;
  readonly sha256: string;
  readonly durationSeconds: number;
}

export interface WorkerState {
  readonly version: 1;
  readonly initialized: boolean;
  readonly generationCounts: Readonly<Record<string, number>>;
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

export interface WorkerStateLoadOptions {
  /** Runtime recovery must first distinguish an active machine-wide generation guard from a crash. */
  readonly recoverInProgress?: boolean;
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

  async load(options: WorkerStateLoadOptions = {}): Promise<WorkerState> {
    let text: string;
    try { text = await this.filesystem.readFile(this.path, 'utf8'); }
    catch (error: unknown) {
      if (isMissingFile(error)) return emptyWorkerState();
      throw new VidGenError('artifact', 'Unable to read Worker state.');
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new VidGenError('artifact', 'Worker state is malformed.'); }
    const state = validateWorkerState(isPlainRecord(value) && value.generationCounts === undefined ? { ...value, generationCounts: {} } : value);
    if (options.recoverInProgress === false) return state;
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

  candidateFixturePath(id: string): string {
    validateCandidateId(id);
    return join(this.root, WORKER_CANDIDATES_DIRECTORY, `${createHash('sha256').update(id).digest('hex')}.json`);
  }

  candidateGenerationArtifactsRoot(id: string): string {
    validateCandidateId(id);
    return join(this.root, WORKER_GENERATED_DIRECTORY, createHash('sha256').update(id).digest('hex'));
  }

  /** The normal simple-headline root sits beside the Worker root. */
  headlineArtifactsRoot(): string { return join(dirname(this.root), 'headline-clips'); }

  /** Publishes a candidate's local manifest before its discovery state advances. */
  async saveCandidateFixture(id: string, fixture: unknown): Promise<void> {
    const path = this.candidateFixturePath(id);
    try {
      await this.filesystem.mkdir(join(this.root, WORKER_CANDIDATES_DIRECTORY), { recursive: true });
      await writeJsonAtomically(this.filesystem, path, fixture, prettyJson, this.createTemporarySuffix);
    } catch {
      throw new VidGenError('artifact', 'Unable to persist Worker candidate fixture.');
    }
  }
}

export function emptyWorkerState(): WorkerState { return { version: 1, initialized: false, generationCounts: {}, candidates: {} }; }

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
  if (state.version !== WORKER_STATE_VERSION || typeof state.initialized !== 'boolean' || !isPlainRecord(state.candidates) || !isPlainRecord(state.generationCounts) || Object.keys(state).some((key) => !['version', 'initialized', 'generationCounts', 'candidates'].includes(key))) throw malformed();
  if (Object.keys(state.candidates).length > 10_000) throw malformed();
  if (Object.keys(state.generationCounts).length > 366 || Object.entries(state.generationCounts).some(([day, count]) => !safeDate(day) || !wholeRange(count, 1, 1_000_000))) throw malformed();
  for (const [id, candidate] of Object.entries(state.candidates)) validateCandidate(candidate, id);
  return state as unknown as WorkerState;
}

export function validateWorkerGeneratedArtifact(value: unknown): WorkerGeneratedArtifact {
  if (!safeGeneratedArtifact(value)) throw malformed();
  return value;
}

export function isWorkerCandidateComplete(candidate: WorkerCandidateState): boolean {
  return candidate.generation.status === 'succeeded'
    && candidate.publicationTargets !== undefined
    && candidate.publicationTargets.length > 0
    && candidate.publicationTargets.every((platform) => candidate.publication[platform]?.status === 'succeeded');
}

export function validateWorkerEvaluation(value: unknown): WorkerEvaluation {
  const evaluation = record(value, 'Worker evaluation result is malformed.');
  if (Object.keys(evaluation).some((key) => !['metric', 'version', 'policyId', 'score', 'threshold', 'decision', 'evaluatedAt', 'queryId', 'evidenceId', 'searchId', 'sessionId', 'signature', 'results', 'components', 'budgetBlocked'].includes(key))
    || !safeLabel(evaluation.metric) || !safeLabel(evaluation.version) || !safeNumber(evaluation.score) || !safeNumber(evaluation.threshold)
    || (evaluation.decision !== 'admitted' && evaluation.decision !== 'skipped') || !safeTimestamp(evaluation.evaluatedAt)
    || (evaluation.policyId !== undefined && !safeLabel(evaluation.policyId)) || (evaluation.queryId !== undefined && !safeLabel(evaluation.queryId)) || (evaluation.evidenceId !== undefined && !safeLabel(evaluation.evidenceId)) || (evaluation.searchId !== undefined && !safeLabel(evaluation.searchId)) || (evaluation.sessionId !== undefined && !safeLabel(evaluation.sessionId))
    || (evaluation.budgetBlocked !== undefined && evaluation.budgetBlocked !== true)) throw malformed();
  if (evaluation.components !== undefined && (!isPlainRecord(evaluation.components) || !['breadth', 'saturation', 'freshness', 'reaction'].every((key) => safeNumber(evaluation.components[key])) || Object.keys(evaluation.components).length !== 4)) throw malformed();
  if (evaluation.signature !== undefined && (!Array.isArray(evaluation.signature) || evaluation.signature.length > 12 || evaluation.signature.some((term) => !safeTerm(term)))) throw malformed();
  if (evaluation.results !== undefined && (!Array.isArray(evaluation.results) || evaluation.results.length > 10 || evaluation.results.some((result) => !safeEvidence(result)))) throw malformed();
  if (evaluation.policyId !== undefined && evaluation.budgetBlocked !== true && (evaluation.searchId === undefined || evaluation.sessionId === undefined || evaluation.signature === undefined || evaluation.results === undefined || evaluation.components === undefined)) throw malformed();
  if (evaluation.policyId !== undefined && (!wholeRange(evaluation.score, 0, 100) || !wholeRange(evaluation.threshold, 0, 100) || (evaluation.components !== undefined && (!wholeRange(evaluation.components.breadth, 0, 40) || !wholeRange(evaluation.components.saturation, 0, 25) || !wholeRange(evaluation.components.freshness, 0, 20) || !wholeRange(evaluation.components.reaction, 0, 15))))) throw malformed();
  return evaluation as unknown as WorkerEvaluation;
}

function validateCandidate(value: unknown, id: string): void {
  if (!safeCandidateId(id)) throw malformed(); const candidate = record(value, 'Worker state is malformed.');
  if (Object.keys(candidate).some((key) => !['id', 'baseline', 'discovery', 'evaluation', 'admission', 'generation', 'generationAttempts', 'generatedArtifact', 'publicationTargets', 'publication', 'publicationAttempts', 'evaluationResult', 'ownerLabel'].includes(key)) || candidate.id !== id || !isPlainRecord(candidate.publication) || !safePublicationTargets(candidate.publicationTargets) || !safePublicationAttempts(candidate.publicationAttempts) || (candidate.baseline !== undefined && candidate.baseline !== true) || (candidate.ownerLabel !== undefined && candidate.ownerLabel !== 'generate' && candidate.ownerLabel !== 'skip') || (candidate.generationAttempts !== undefined && !wholeRange(candidate.generationAttempts, 1, 10)) || (candidate.generatedArtifact !== undefined && !safeGeneratedArtifact(candidate.generatedArtifact))) throw malformed();
  validateStage(candidate.discovery); validateStage(candidate.evaluation); validateStage(candidate.admission); validateStage(candidate.generation);
  for (const [platform, stage] of Object.entries(candidate.publication)) { if (candidate.publicationTargets === undefined ? !safeLabel(platform) : !isWorkerPosterPlatform(platform)) throw malformed(); validateStage(stage); }
  if (candidate.publicationTargets !== undefined && (Object.keys(candidate.publication).some((platform) => !candidate.publicationTargets!.includes(platform as WorkerPosterPlatform)) || Object.keys(candidate.publicationAttempts ?? {}).some((platform) => !candidate.publicationTargets!.includes(platform as WorkerPosterPlatform)))) throw malformed();
  if (candidate.evaluationResult !== undefined) validateWorkerEvaluation(candidate.evaluationResult);
  if (candidate.evaluation.status === 'succeeded' && candidate.evaluationResult === undefined) throw malformed();
  if (candidate.admission.status === 'succeeded' && candidate.evaluationResult?.decision !== 'admitted') throw malformed();
  if (candidate.admission.status === 'skipped' && candidate.evaluationResult?.decision !== 'skipped') throw malformed();
  if (candidate.generation.status === 'succeeded' && candidate.generatedArtifact === undefined) throw malformed();
  if (candidate.generatedArtifact !== undefined && candidate.generation.status !== 'succeeded') throw malformed();
}

function validateStage(value: unknown): void {
  const stage = record(value, 'Worker state is malformed.');
  if (Object.keys(stage).some((key) => !['status', 'startedAt', 'completedAt', 'failure', 'block'].includes(key)) || !['pending', 'running', 'succeeded', 'failed', 'skipped', 'blocked', 'uncertain'].includes(stage.status as string)) throw malformed();
  if (stage.startedAt !== undefined && !safeTimestamp(stage.startedAt)) throw malformed();
  if (stage.completedAt !== undefined && !safeTimestamp(stage.completedAt)) throw malformed();
  if (stage.failure !== undefined && (!isPlainRecord(stage.failure) || stage.failure.code !== 'stage_failed' || stage.failure.message !== 'Worker stage failed.')) throw malformed();
  if (stage.status === 'failed' && stage.failure === undefined) throw malformed();
  if (stage.status !== 'failed' && stage.failure !== undefined) throw malformed();
  if (stage.status === 'blocked' && stage.block === undefined) throw malformed();
  if (stage.status !== 'blocked' && stage.block !== undefined) throw malformed();
  if (stage.block !== undefined && stage.block !== 'generation_daily_limit' && stage.block !== 'generation_attempt_limit' && stage.block !== 'publication_attempt_limit') throw malformed();
}

function isWorkerPosterPlatform(value: unknown): value is WorkerPosterPlatform { return value === 'x' || value === 'bluesky' || value === 'reels'; }
function safePublicationTargets(value: unknown): value is readonly WorkerPosterPlatform[] | undefined {
  const order: readonly WorkerPosterPlatform[] = ['x', 'bluesky', 'reels'];
  return value === undefined || (Array.isArray(value) && value.length <= 3 && value.every(isWorkerPosterPlatform) && new Set(value).size === value.length && value.every((platform, index) => index === 0 || order.indexOf(value[index - 1]!) < order.indexOf(platform)));
}
function safePublicationAttempts(value: unknown): value is Readonly<Record<string, number>> | undefined { return value === undefined || (isPlainRecord(value) && Object.entries(value).every(([platform, attempts]) => safeLabel(platform) && wholeRange(attempts, 1, 10))); }

function safeGeneratedArtifact(value: unknown): value is WorkerGeneratedArtifact {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !['finalPath', 'metadataPath', 'sha256', 'durationSeconds'].includes(key))) return false;
  return typeof value.finalPath === 'string' && isAbsolute(value.finalPath) && value.finalPath.length <= 4_096 && !/[\0\r\n]/u.test(value.finalPath)
    && typeof value.metadataPath === 'string' && isAbsolute(value.metadataPath) && value.metadataPath.length <= 4_096 && !/[\0\r\n]/u.test(value.metadataPath)
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.sha256)
    && typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0 && value.durationSeconds <= 300;
}

function validateCandidateId(value: string): void { if (!safeCandidateId(value)) throw new VidGenError('invalid_argument', 'Worker candidate ID is unsafe.'); }
function safeCandidateId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value); }
function validateTimestamp(value: string): void { if (!safeTimestamp(value)) throw new VidGenError('invalid_argument', 'Worker clock produced an invalid timestamp.'); }
function safeTimestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && !Number.isNaN(Date.parse(value)); }
function safeLabel(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(value) && !/(?:token|secret|api[_-]?key|bearer|authorization)/iu.test(value); }
function safeNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000; }
function wholeRange(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max; }
function safeTerm(value: unknown): value is string { return typeof value === 'string' && /^[\p{L}\p{N}]{2,64}$/u.test(value); }
function safeEvidence(value: unknown): boolean {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !['url', 'title', 'domain', 'publishedAt', 'excerptHash', 'matchedTerms', 'reactionSignal'].includes(key))) return false;
  if (typeof value.url !== 'string' || !safeEvidenceUrl(value.url) || typeof value.title !== 'string' || value.title.length > 300 || /[\u0000-\u001f\u007f]/u.test(value.title) || typeof value.domain !== 'string' || !/^[a-z0-9.-]{1,253}$/u.test(value.domain) || typeof value.excerptHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.excerptHash) || !Array.isArray(value.matchedTerms) || value.matchedTerms.length > 12 || value.matchedTerms.some((term) => !safeTerm(term)) || typeof value.reactionSignal !== 'boolean') return false;
  return value.publishedAt === undefined || (typeof value.publishedAt === 'string' && safeDate(value.publishedAt));
}
function safeEvidenceUrl(value: string): boolean { try { const url = new URL(value); return value.length <= 2_000 && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash && !!url.hostname; } catch { return false; } }
function safeDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)); }
function record(value: unknown, message: string): Record<string, unknown> { if (!isPlainRecord(value)) throw new VidGenError('artifact', message); return value; }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function malformed(): VidGenError { return new VidGenError('artifact', 'Worker state is malformed.'); }
function isMissingFile(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'; }
