import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

/** One machine-local guard, deliberately separate from any Worker state root. */
const WORKER_HEADLINE_GENERATION_GUARD_PATH = resolve(process.platform === 'win32'
  ? join(process.env.SystemRoot === undefined ? parse(process.execPath).root : dirname(process.env.SystemRoot), 'ProgramData', 'VidGen')
  : '/var/tmp', 'vidgen-worker-headline-generation.lock');

export interface WorkerGenerationExclusion {
  release(): Promise<void>;
}

export interface WorkerGenerationExclusionDependencies {
  /** Test-only seam; runtime callers always use the machine-wide default. */
  readonly lockPath?: string;
  readonly mkdir?: typeof mkdir;
  readonly writeFile?: typeof writeFile;
  readonly unlink?: typeof unlink;
}

/**
 * Uses exclusive creation rather than interpreting an existing guard. A crash can
 * leave the empty file behind; that is intentionally a manual-reconciliation stop.
 */
export async function acquireWorkerGenerationExclusion(dependencies: WorkerGenerationExclusionDependencies = {}): Promise<WorkerGenerationExclusion | undefined> {
  const lockPath = dependencies.lockPath ?? WORKER_HEADLINE_GENERATION_GUARD_PATH;
  try {
    await (dependencies.mkdir ?? mkdir)(dirname(lockPath), { recursive: true, mode: 0o700 });
    await (dependencies.writeFile ?? writeFile)(lockPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    return undefined;
  }
  let released = false;
  return {
    // ponytail: machine-local guard; add distributed coordination only for multi-host Workers.
    async release(): Promise<void> {
      if (released) return;
      try {
        await (dependencies.unlink ?? unlink)(lockPath);
        released = true;
      } catch {
        // Leave ambiguous ownership closed rather than guessing that another Worker can start.
      }
    },
  };
}
