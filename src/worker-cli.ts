import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { VidGenError, isVidGenError } from './core/error.ts';
import { createWorkerRuntimeConfig, DEFAULT_WORKER_STATE_ROOT } from './worker/config.ts';
import { runNgestWorker, type WorkerMode } from './worker/runtime.ts';
import { WorkerStateStore } from './worker/state.ts';

export const workerHelpText = `VidGen Worker

Usage:
  vidgen-worker <observe|generate|live> [--once] [--process-existing] [--max-candidates <n>] [--state-root <directory>] [--poll-interval-ms <milliseconds>]

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
`;

export interface WorkerCommand { readonly mode: WorkerMode; readonly once: boolean; readonly processExisting: boolean; readonly maxCandidates: number; readonly stateRoot?: string; readonly pollIntervalMs?: number; }
export interface WorkerCliOutput { writeStdout(text: string): void; writeStderr(text: string): void; }

export function parseWorkerCliArgs(args: readonly string[]): WorkerCommand | { readonly kind: 'help' } {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') { if (args.length > 1) throw invalid('Worker help does not accept arguments.'); return { kind: 'help' }; }
  const [mode, ...rest] = args;
  if (mode !== 'observe' && mode !== 'generate' && mode !== 'live') throw invalid('Worker requires mode observe, generate, or live.');
  let once = false; let processExisting = false; let maxCandidates = 1; const values: Partial<Record<'stateRoot' | 'pollIntervalMs', string>> = {};
  for (let index = 0; index < rest.length;) {
    const option = rest[index];
    if (option === '--once' || option === '--process-existing') { if (option === '--once' ? once : processExisting) throw invalid(`Worker option ${option} must not be repeated.`); if (option === '--once') once = true; else processExisting = true; index += 1; continue; }
    if (option !== '--max-candidates' && option !== '--state-root' && option !== '--poll-interval-ms') throw invalid(`Unknown Worker argument: ${JSON.stringify(option)}.`);
    const value = rest[index + 1]; if (value === undefined || value.trim().length === 0) throw invalid(`${option} requires exactly one non-empty value.`);
    if (option === '--max-candidates') { maxCandidates = positive(value, '--max-candidates', 10_000); }
    else { const key = option === '--state-root' ? 'stateRoot' : 'pollIntervalMs'; if (values[key] !== undefined) throw invalid(`Worker option ${option} must not be repeated.`); values[key] = value; }
    index += 2;
  }
  const pollIntervalMs = values.pollIntervalMs === undefined ? undefined : positive(values.pollIntervalMs, '--poll-interval-ms', 86_400_000);
  createWorkerRuntimeConfig({ stateRoot: values.stateRoot, pollIntervalMs });
  return { mode, once, processExisting, maxCandidates, ...(values.stateRoot === undefined ? {} : { stateRoot: values.stateRoot }), ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }) };
}

export async function runWorkerCli(args: readonly string[], output: WorkerCliOutput): Promise<number> {
  try {
    const command = parseWorkerCliArgs(args);
    if ('kind' in command) { output.writeStdout(workerHelpText); return 0; }
    const config = createWorkerRuntimeConfig(command);
    await runNgestWorker({ store: new WorkerStateStore(config.stateRoot), mode: command.mode, once: command.once, processExisting: command.processExisting, maxCandidates: command.maxCandidates, pollIntervalMs: config.pollIntervalMs });
    output.writeStdout(`Worker ${command.mode} is running.\nstateRoot: ${config.stateRoot}\npollIntervalMs: ${config.pollIntervalMs}\n`);
    return 0;
  } catch (error) {
    const safe = isVidGenError(error) ? error : new VidGenError('unexpected', 'Worker failed unexpectedly.');
    output.writeStderr(`Error [${safe.code}]: ${safe.publicMessage}\n`); return 2;
  }
}

function positive(value: string, option: string, maximum: number): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw invalid(`${option} must be a positive whole number no greater than ${maximum}.`); return number; }
function invalid(message: string): VidGenError { return new VidGenError('invalid_argument', message); }
function isEntrypoint(): boolean { const entrypoint = process.argv[1]; return entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href; }
if (isEntrypoint()) process.exitCode = await runWorkerCli(process.argv.slice(2), { writeStdout: (text) => process.stdout.write(text), writeStderr: (text) => process.stderr.write(text) });
