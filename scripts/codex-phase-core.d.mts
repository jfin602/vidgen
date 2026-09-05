/* eslint-disable @typescript-eslint/no-explicit-any */

export interface BaseParsedPrompt {
  readonly number: number;
  readonly filename: string;
  readonly task: string;
  readonly taskPhase: number;
  readonly title: string;
  readonly recommendation: string;
  readonly model: string;
  readonly reasoning: string;
  readonly kind: 'implementation' | 'closeout';
  readonly text: string;
}

export interface PhasePrompt extends BaseParsedPrompt {
  readonly mode: 'phase';
  readonly targetVersion: string;
}

export interface CorrectionPrompt extends BaseParsedPrompt {
  readonly mode: 'correction';
  readonly unchangedVersion: string;
}

export type ParsedPrompt = PhasePrompt | CorrectionPrompt;

export interface PhasePlan {
  readonly mode: 'phase';
  readonly phase: number;
  readonly folderName: string;
  readonly roadmapFamily: 'pre-1.0' | 'post-1.0' | 'post-2.0';
  readonly roadmapMajor: 0 | 1 | 2;
  readonly prompts: readonly [PhasePrompt, ...PhasePrompt[]];
  readonly implementations: readonly PhasePrompt[];
  readonly closeout: PhasePrompt;
}

export interface CorrectionPlan {
  readonly mode: 'correction';
  readonly phase: number;
  readonly folderName: string;
  readonly correctionSlug: string;
  readonly unchangedVersion: string;
  readonly prompts: readonly [CorrectionPrompt, ...CorrectionPrompt[]];
  readonly implementations: readonly CorrectionPrompt[];
  readonly closeout: CorrectionPrompt;
}

export type TaskStackPlan = PhasePlan | CorrectionPlan;

export const MODEL_CONFIGS: Readonly<
  Record<string, Readonly<{ model: string; reasoning: string }>>
>;

export function resolveModelConfig(recommendation: string): {
  readonly model: string;
  readonly reasoning: string;
};
export function parsePrompt(filename: string, text: string): ParsedPrompt;
export function buildPlan(
  entries: readonly { filename: string; text: string }[],
  folderName: string,
): TaskStackPlan;
export function roadmapVersionFor(
  plan: Readonly<{ phase: number; roadmapMajor: 0 | 1 | 2 }>,
  promptNumber: number,
): string;
export function roadmapFamilyLabel(
  roadmapFamily: PhasePlan['roadmapFamily'],
): string;
export function promptCommitSubject(
  plan: TaskStackPlan,
  prompt: ParsedPrompt,
): string;
export function detectCompletedPromptPrefix(
  plan: TaskStackPlan,
  history: readonly { readonly sha: string; readonly subject: string }[],
  packageVersion: string,
): {
  readonly completedCount: number;
  readonly completed: readonly {
    readonly prompt: ParsedPrompt;
    readonly commitSha: string;
  }[];
  readonly nextPrompt: ParsedPrompt | undefined;
  readonly previousVersion: string;
};
export function assertVersionCompatible(
  actual: string,
  prompt: PhasePrompt,
  previousVersion: string,
): void;
export function assertVersionCompatible(
  actual: string,
  prompt: CorrectionPrompt,
  previousVersion?: string,
): void;
export function assertPostPrompt(arguments_: {
  readonly exitCode: number | null;
  readonly version: string;
  readonly prompt: ParsedPrompt;
  readonly packageLockExists: boolean;
  readonly coherent?: boolean;
}): void;
export function interpretEvent(...arguments_: any[]): any;
export function createEventTracker(...arguments_: any[]): any;
export function applyEventObservation(...arguments_: any[]): any;
export function createStructuredEventProcessor(...arguments_: any[]): any;
export function printableAscii(...arguments_: any[]): any;
export function style(...arguments_: any[]): any;
export function stripAnsi(...arguments_: any[]): any;
export function formatElapsed(...arguments_: any[]): any;
export function formatUsage(...arguments_: any[]): any;
export function renderDashboard(...arguments_: any[]): any;
export function isColorEnabled(...arguments_: any[]): any;
export function createDisplaySession(...arguments_: any[]): any;
export function startElapsedRedraw(...arguments_: any[]): any;
export function renderFailureSummary(...arguments_: any[]): any;
export function renderSuccessHandoff(...arguments_: any[]): any;
export function renderCloseoutFinalResponse(...arguments_: any[]): any;
export function hasCursorControls(...arguments_: any[]): any;
export function isAscii(...arguments_: any[]): any;
