import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_ARTIFACTS_ROOT, runPhase1Input } from './app/phase-1-input-run.ts';
import { isVidGenError, VidGenError } from './core/error.ts';

export const helpText = `VidGen

Usage:
  vidgen [--help]
  vidgen run [--artifacts-root <directory>]

Available commands:
  help, --help, -h  Show this help message.
  run              Acquire one manifest and persist its CanonicalInput.

Run options:
  --artifacts-root <directory>  Write runs here (default: ${DEFAULT_ARTIFACTS_ROOT}).
`;

export interface HelpCommand {
  readonly kind: 'help';
}

export interface RunCommand {
  readonly kind: 'run';
  readonly artifactsRoot?: string;
}

export type CliCommand = HelpCommand | RunCommand;

export interface CliOutput {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/**
 * Parses the CLI surface without placing transport or persistence work here.
 */
export function parseCliArgs(args: readonly string[]): CliCommand {
  if (args.length === 0) {
    return { kind: 'help' };
  }

  const [command, ...rest] = args;
  if (command === 'help' || command === '--help' || command === '-h') {
    if (rest.length === 0) {
      return { kind: 'help' };
    }

    throw invalidArgument(`Help does not accept arguments: ${formatArgs(rest)}.`);
  }

  if (command.startsWith('-')) {
    throw invalidArgument(`Unknown argument: ${JSON.stringify(command)}.`);
  }

  if (command === 'run') {
    return parseRunCommand(rest);
  }

  throw invalidArgument(`Unknown command: ${JSON.stringify(command)}.`);
}

export interface CliDependencies {
  readonly runInput?: typeof runPhase1Input;
}

export async function runCli(
  args: readonly string[],
  output: CliOutput,
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const command = parseCliArgs(args);
    if (command.kind === 'help') {
      output.writeStdout(helpText);
      return 0;
    }

    const result = await (dependencies.runInput ?? runPhase1Input)({
      ...(command.artifactsRoot === undefined ? {} : { artifactsRoot: command.artifactsRoot }),
    });
    output.writeStdout(
      `Run ${result.runId} is input_ready.\n`
      + `inputFingerprint: ${result.inputFingerprint}\n`
      + `artifacts: ${result.runDirectory}\n`,
    );
    return 0;
  } catch (error) {
    const message = isVidGenError(error)
      ? error.publicMessage
      : 'VidGen failed unexpectedly.';
    const category = isVidGenError(error) ? error.code : 'unexpected';
    output.writeStderr(`Run failed [${category}]: ${message} Run "vidgen --help" for usage.\n`);
    return 2;
  }
}

function parseRunCommand(args: readonly string[]): RunCommand {
  if (args.length === 0) {
    return { kind: 'run' };
  }

  if (args.length === 2 && args[0] === '--artifacts-root') {
    const artifactsRoot = args[1]?.trim();
    if (artifactsRoot === undefined || artifactsRoot.length === 0) {
      throw invalidArgument('--artifacts-root requires a non-empty directory.');
    }
    return { kind: 'run', artifactsRoot };
  }

  if (args[0] === '--artifacts-root') {
    throw invalidArgument('--artifacts-root requires exactly one directory argument.');
  }

  throw invalidArgument(`Run does not accept arguments: ${formatArgs(args)}.`);
}

function invalidArgument(detail: string): VidGenError {
  return new VidGenError('invalid_argument', detail);
}

function formatArgs(args: readonly string[]): string {
  return args.map((arg) => JSON.stringify(arg)).join(', ');
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined
    && import.meta.url === pathToFileURL(resolve(entrypoint)).href;
}

if (isEntrypoint()) {
  process.exitCode = await runCli(process.argv.slice(2), {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  });
}
