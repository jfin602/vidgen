import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { VidGenError, isVidGenError } from './core/error.ts';
import { createWorkerRuntimeConfig, DEFAULT_DAILY_GENERATION_LIMIT, DEFAULT_GENERATION_ATTEMPT_LIMIT, DEFAULT_PUBLICATION_ATTEMPT_LIMIT, DEFAULT_WORKER_MAX_SECONDS, DEFAULT_WORKER_STATE_ROOT } from './worker/config.ts';
import { runNgestWorker, type WorkerMode } from './worker/runtime.ts';
import { WorkerStateStore } from './worker/state.ts';
import { labelWorkerEvaluation, reportWorkerCalibration } from './worker/calibration.ts';

export const workerHelpText = `VidGen Worker

Usage:
  vidgen-worker <observe|generate|live> [--once] [--process-existing] [--max-candidates <n>] [--state-root <directory>] [--poll-interval-ms <milliseconds>] [--anchor-reference <image-path> ...] [--font-file <font-path>] [--max-seconds <4-20>] [--daily-generation-limit <n>] [--generation-attempt-limit <n>] [--publication-attempt-limit <n>]
  vidgen-worker label <article-id> <generate|skip> [--state-root <directory>]
  vidgen-worker report [--state-root <directory>]

Modes:
  observe   Discover and persist evaluation/admission only.
  generate  Evaluate and generate admitted candidates; never publish.
  live      Run the complete admitted candidate flow.

Options:
  --once                Process one bounded snapshot, then exit.
  --process-existing    Explicitly process the first snapshot instead of baselining it.
  --max-candidates <n>  Positive cap per snapshot (default: 1).
  --state-root <dir>    Durable Worker state (default: ${DEFAULT_WORKER_STATE_ROOT}).
  --poll-interval-ms <n>  Bounded polling interval (default: 60000).
  --anchor-reference <path>  Required one to three times for generate/live.
  --font-file <path>      Required for generate/live.
  --max-seconds <4-20>    Headline planning ceiling (default: ${DEFAULT_WORKER_MAX_SECONDS}).
  --daily-generation-limit <n>  Generation starts per UTC day (default: ${DEFAULT_DAILY_GENERATION_LIMIT}).
  --generation-attempt-limit <n>  Generation starts per Article (default: ${DEFAULT_GENERATION_ATTEMPT_LIMIT}).
  --publication-attempt-limit <n>  Poster attempts per unresolved platform (default: ${DEFAULT_PUBLICATION_ATTEMPT_LIMIT}).
`;

export interface WorkerCommand { readonly mode: WorkerMode; readonly once: boolean; readonly processExisting: boolean; readonly maxCandidates: number; readonly stateRoot?: string; readonly pollIntervalMs?: number; readonly anchorReferencePaths?: readonly string[]; readonly fontPath?: string; readonly maxSeconds?: number; readonly dailyGenerationLimit?: number; readonly generationAttemptLimit?: number; readonly publicationAttemptLimit?: number; }
export interface WorkerLabelCommand { readonly kind: 'label'; readonly candidateId: string; readonly label: 'generate' | 'skip'; readonly stateRoot?: string; }
export interface WorkerReportCommand { readonly kind: 'report'; readonly stateRoot?: string; }
export interface WorkerCliOutput { writeStdout(text: string): void; writeStderr(text: string): void; }

export function parseWorkerCliArgs(args: readonly string[]): WorkerCommand | WorkerLabelCommand | WorkerReportCommand | { readonly kind: 'help' } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') { if (args.length > 1) throw invalid('Worker help does not accept arguments.'); return { kind: 'help' }; }
  if (args[0] === 'label') return labelCommand(args.slice(1));
  if (args[0] === 'report') return reportCommand(args.slice(1));
  const [mode, ...rest] = args;
  if (mode !== 'observe' && mode !== 'generate' && mode !== 'live') throw invalid('Worker requires mode observe, generate, or live.');
  let once = false; let processExisting = false; let maxCandidates = 1; const anchors: string[] = []; const values: Partial<Record<'stateRoot' | 'pollIntervalMs' | 'fontPath' | 'maxSeconds' | 'dailyGenerationLimit' | 'generationAttemptLimit' | 'publicationAttemptLimit', string>> = {};
  for (let index = 0; index < rest.length;) {
    const option = rest[index];
    if (option === '--once' || option === '--process-existing') { if (option === '--once' ? once : processExisting) throw invalid(`Worker option ${option} must not be repeated.`); if (option === '--once') once = true; else processExisting = true; index += 1; continue; }
    if (option !== '--max-candidates' && option !== '--state-root' && option !== '--poll-interval-ms' && option !== '--anchor-reference' && option !== '--font-file' && option !== '--max-seconds' && option !== '--daily-generation-limit' && option !== '--generation-attempt-limit' && option !== '--publication-attempt-limit') throw invalid(`Unknown Worker argument: ${JSON.stringify(option)}.`);
    const value = rest[index + 1]; if (value === undefined || value.trim().length === 0) throw invalid(`${option} requires exactly one non-empty value.`);
    if (option === '--max-candidates') { maxCandidates = positive(value, '--max-candidates', 10_000); }
    else if (option === '--anchor-reference') { if (anchors.length >= 3) throw invalid('Worker accepts at most three --anchor-reference values.'); anchors.push(value); }
    else { const key = option === '--state-root' ? 'stateRoot' : option === '--poll-interval-ms' ? 'pollIntervalMs' : option === '--font-file' ? 'fontPath' : option === '--max-seconds' ? 'maxSeconds' : option === '--daily-generation-limit' ? 'dailyGenerationLimit' : option === '--generation-attempt-limit' ? 'generationAttemptLimit' : 'publicationAttemptLimit'; if (values[key] !== undefined) throw invalid(`Worker option ${option} must not be repeated.`); values[key] = value; }
    index += 2;
  }
  const pollIntervalMs = values.pollIntervalMs === undefined ? undefined : positive(values.pollIntervalMs, '--poll-interval-ms', 86_400_000);
  const maxSeconds = values.maxSeconds === undefined ? undefined : ranged(values.maxSeconds, '--max-seconds', 4, 20);
  const dailyGenerationLimit = values.dailyGenerationLimit === undefined ? undefined : positive(values.dailyGenerationLimit, '--daily-generation-limit', 100);
  const generationAttemptLimit = values.generationAttemptLimit === undefined ? undefined : positive(values.generationAttemptLimit, '--generation-attempt-limit', 10);
  const publicationAttemptLimit = values.publicationAttemptLimit === undefined ? undefined : positive(values.publicationAttemptLimit, '--publication-attempt-limit', 10);
  if (mode !== 'observe' && (anchors.length === 0 || values.fontPath === undefined)) throw invalid('Worker generate/live requires one to three --anchor-reference values and --font-file.');
  createWorkerRuntimeConfig({ stateRoot: values.stateRoot, pollIntervalMs, maxSeconds, dailyGenerationLimit, generationAttemptLimit, publicationAttemptLimit });
  return { mode, once, processExisting, maxCandidates, ...(values.stateRoot === undefined ? {} : { stateRoot: values.stateRoot }), ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }), ...(anchors.length === 0 ? {} : { anchorReferencePaths: anchors }), ...(values.fontPath === undefined ? {} : { fontPath: values.fontPath }), ...(maxSeconds === undefined ? {} : { maxSeconds }), ...(dailyGenerationLimit === undefined ? {} : { dailyGenerationLimit }), ...(generationAttemptLimit === undefined ? {} : { generationAttemptLimit }), ...(publicationAttemptLimit === undefined ? {} : { publicationAttemptLimit }) };
}

export async function runWorkerCli(args: readonly string[], output: WorkerCliOutput): Promise<number> {
  try {
    const command = parseWorkerCliArgs(args);
    if ('kind' in command && command.kind === 'help') { output.writeStdout(workerHelpText); return 0; }
    if ('kind' in command && command.kind === 'label') { await labelWorkerEvaluation(new WorkerStateStore(resolve(command.stateRoot ?? DEFAULT_WORKER_STATE_ROOT)), command.candidateId, command.label); output.writeStdout(`Labeled ${command.candidateId}.\n`); return 0; }
    if ('kind' in command && command.kind === 'report') { const report = reportWorkerCalibration(await new WorkerStateStore(resolve(command.stateRoot ?? DEFAULT_WORKER_STATE_ROOT)).load()); output.writeStdout(`${JSON.stringify(report)}\n`); return 0; }
    const config = createWorkerRuntimeConfig(command);
    await runNgestWorker({ store: new WorkerStateStore(config.stateRoot), mode: command.mode, once: command.once, processExisting: command.processExisting, maxCandidates: command.maxCandidates, pollIntervalMs: config.pollIntervalMs, ...(command.anchorReferencePaths === undefined ? {} : { anchorReferencePaths: command.anchorReferencePaths }), ...(command.fontPath === undefined ? {} : { fontPath: command.fontPath }), maxSeconds: config.maxSeconds, dailyGenerationLimit: config.dailyGenerationLimit, generationAttemptLimit: config.generationAttemptLimit, publicationAttemptLimit: config.publicationAttemptLimit });
    output.writeStdout(`Worker ${command.mode} is running.\nstateRoot: ${config.stateRoot}\npollIntervalMs: ${config.pollIntervalMs}\n`);
    return 0;
  } catch (error) {
    const safe = isVidGenError(error) ? error : new VidGenError('unexpected', 'Worker failed unexpectedly.');
    output.writeStderr(`Error [${safe.code}]: ${safe.publicMessage}\n`); return 2;
  }
}

function positive(value: string, option: string, maximum: number): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw invalid(`${option} must be a positive whole number no greater than ${maximum}.`); return number; }
function ranged(value: string, option: string, minimum: number, maximum: number): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw invalid(`${option} must be a whole number from ${minimum} through ${maximum}.`); return number; }
function labelCommand(args: readonly string[]): WorkerLabelCommand {
  const [candidateId, label, ...rest] = args; if (candidateId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(candidateId) || (label !== 'generate' && label !== 'skip')) throw invalid('Worker label requires a safe article ID and generate or skip.');
  return { kind: 'label', candidateId, label, ...stateRootOption(rest) };
}
function reportCommand(args: readonly string[]): WorkerReportCommand { return { kind: 'report', ...stateRootOption(args) }; }
function stateRootOption(args: readonly string[]): { readonly stateRoot?: string } {
  if (args.length === 0) return {}; if (args.length !== 2 || args[0] !== '--state-root' || args[1] === undefined || args[1].trim() === '') throw invalid('Worker label/report accepts only --state-root <directory>.');
  createWorkerRuntimeConfig({ stateRoot: args[1] }); return { stateRoot: args[1] };
}
function invalid(message: string): VidGenError { return new VidGenError('invalid_argument', message); }
function isEntrypoint(): boolean { const entrypoint = process.argv[1]; return entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href; }
if (isEntrypoint()) process.exitCode = await runWorkerCli(process.argv.slice(2), { writeStdout: (text) => process.stdout.write(text), writeStderr: (text) => process.stderr.write(text) });
