import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isVidGenError, VidGenError } from './core/error.ts';

export const helpText = `VidGen

Usage:
  vidgen [--help]

Available commands:
  help, --help, -h  Show this help message.
`;

export interface HelpCommand {
  readonly kind: 'help';
}

export type CliCommand = HelpCommand;

export interface CliOutput {
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

/**
 * Parses the currently available command surface. Later commands can be added
 * here while their execution remains outside this boundary.
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

  throw invalidArgument(`Unknown command: ${JSON.stringify(command)}.`);
}

export function runCli(args: readonly string[], output: CliOutput): number {
  try {
    const command = parseCliArgs(args);
    if (command.kind === 'help') {
      output.writeStdout(helpText);
      return 0;
    }
  } catch (error) {
    const message = isVidGenError(error)
      ? error.publicMessage
      : 'VidGen failed unexpectedly.';
    output.writeStderr(`${message} Run "vidgen --help" for usage.\n`);
    return 2;
  }
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
  process.exitCode = runCli(process.argv.slice(2), {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  });
}
