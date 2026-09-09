import { VidGenError } from '../core/error.ts';
import { type WorkerState, WorkerStateStore } from './state.ts';
import { WEB_MOMENTUM_METRIC, WEB_MOMENTUM_VERSION } from './web-momentum.ts';

export interface CalibrationReport {
  readonly metric: typeof WEB_MOMENTUM_METRIC;
  readonly version: typeof WEB_MOMENTUM_VERSION;
  readonly labeledCount: number;
  readonly confusion: { readonly truePositive: number; readonly falsePositive: number; readonly trueNegative: number; readonly falseNegative: number; };
  readonly precision: number | null;
  readonly recall: number | null;
}

/** Owner labels are local calibration metadata; they never modify admission. */
export async function labelWorkerEvaluation(store: WorkerStateStore, candidateId: string, label: 'generate' | 'skip'): Promise<void> {
  const state = await store.load(); const candidate = state.candidates[candidateId];
  if (candidate === undefined || candidate.evaluation.status !== 'succeeded' || candidate.evaluationResult?.metric !== WEB_MOMENTUM_METRIC || candidate.evaluationResult.version !== WEB_MOMENTUM_VERSION) throw new VidGenError('invalid_argument', 'Worker candidate has no current Web Momentum evaluation to label.');
  await store.save({ ...state, candidates: { ...state.candidates, [candidateId]: { ...candidate, ownerLabel: label } } });
}
export function reportWorkerCalibration(state: WorkerState): CalibrationReport {
  let truePositive = 0; let falsePositive = 0; let trueNegative = 0; let falseNegative = 0;
  for (const candidate of Object.values(state.candidates)) {
    if (candidate.ownerLabel === undefined || candidate.evaluationResult?.metric !== WEB_MOMENTUM_METRIC || candidate.evaluationResult.version !== WEB_MOMENTUM_VERSION) continue;
    if (candidate.evaluationResult.decision === 'admitted' && candidate.ownerLabel === 'generate') truePositive += 1;
    else if (candidate.evaluationResult.decision === 'admitted') falsePositive += 1;
    else if (candidate.ownerLabel === 'skip') trueNegative += 1;
    else falseNegative += 1;
  }
  const labeledCount = truePositive + falsePositive + trueNegative + falseNegative;
  return { metric: WEB_MOMENTUM_METRIC, version: WEB_MOMENTUM_VERSION, labeledCount, confusion: { truePositive, falsePositive, trueNegative, falseNegative }, precision: truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive), recall: truePositive + falseNegative === 0 ? null : truePositive / (truePositive + falseNegative) };
}
