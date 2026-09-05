import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildCanonicalInput, type CanonicalInput } from '../core/canonical-input.ts';
import { isVidGenError, VidGenError, type VidGenErrorCode } from '../core/error.ts';
import {
  fetchNgestVidGenManifestPage,
  type NgestVidGenEnvironment,
  type NgestVidGenManifestPage,
} from '../integrations/ngest/vidgen-manifest.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const CANONICAL_INPUT_ARTIFACT_NAME = '01-canonical-input.json';
export const RUN_METADATA_ARTIFACT_NAME = 'run.json';
export const DEFAULT_ARTIFACTS_ROOT = 'artifacts/runs';

export type Phase1RunStatus = 'running' | 'input_ready' | 'failed';

export interface Phase1RunMetadata {
  readonly runId: string;
  readonly status: Phase1RunStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly engineVersion: string;
  readonly inputFingerprint?: string;
  readonly canonicalInputArtifact?: string;
  readonly failure?: {
    readonly code: VidGenErrorCode;
    readonly message: string;
  };
}

export interface Phase1RunResult {
  readonly runId: string;
  readonly inputFingerprint: string;
  readonly artifactsRoot: string;
  readonly runDirectory: string;
  readonly canonicalInputPath: string;
  readonly canonicalInput: CanonicalInput;
}

/** Filesystem boundary for durable Phase 1 artifacts, injectable for tests. */
export interface Phase1ArtifactStore {
  createRunDirectory(artifactsRoot: string, runId: string): Promise<string>;
  writeRunMetadata(runDirectory: string, metadata: Phase1RunMetadata): Promise<void>;
  writeCanonicalInput(runDirectory: string, canonicalInput: CanonicalInput): Promise<void>;
}

export interface Phase1InputRunDependencies {
  readonly artifactsRoot?: string;
  readonly environment?: NgestVidGenEnvironment;
  readonly fetchManifest?: (environment: NgestVidGenEnvironment) => Promise<NgestVidGenManifestPage>;
  readonly buildInput?: (manifest: NgestVidGenManifestPage) => CanonicalInput;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly artifactStore?: Phase1ArtifactStore;
  readonly engineVersion?: string;
}

/**
 * Acquires exactly one ngest manifest, creates CanonicalInput, and makes the
 * result observable through a single filesystem-backed run directory.
 */
export async function runPhase1Input(
  dependencies: Phase1InputRunDependencies = {},
): Promise<Phase1RunResult> {
  const artifactsRoot = resolve(dependencies.artifactsRoot ?? DEFAULT_ARTIFACTS_ROOT);
  const environment = dependencies.environment ?? process.env;
  const fetchManifest = dependencies.fetchManifest ?? fetchNgestVidGenManifestPage;
  const buildInput = dependencies.buildInput ?? buildCanonicalInput;
  const now = dependencies.now ?? (() => new Date());
  const engineVersion = dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION;
  const artifactStore = dependencies.artifactStore ?? createFilesystemArtifactStore();
  const runId = validateRunId((dependencies.createRunId ?? randomUUID)());
  const startedAt = formatTimestamp(now());

  let runDirectory: string | undefined;
  let inputFingerprint: string | undefined;
  let canonicalInput: CanonicalInput | undefined;
  let canonicalInputWritten = false;

  try {
    runDirectory = await persistArtifact(() => artifactStore.createRunDirectory(artifactsRoot, runId));
    await persistArtifact(() => artifactStore.writeRunMetadata(runDirectory, {
      runId,
      status: 'running',
      startedAt,
      engineVersion,
    }));

    const manifest = await fetchManifest(environment);
    canonicalInput = buildInput(manifest);
    inputFingerprint = canonicalInput.inputFingerprint;

    await persistArtifact(() => artifactStore.writeCanonicalInput(runDirectory, canonicalInput));
    canonicalInputWritten = true;

    const endedAt = formatTimestamp(now());
    const metadata: Phase1RunMetadata = {
      runId,
      status: 'input_ready',
      startedAt,
      endedAt,
      engineVersion,
      inputFingerprint,
      canonicalInputArtifact: CANONICAL_INPUT_ARTIFACT_NAME,
    };
    await persistArtifact(() => artifactStore.writeRunMetadata(runDirectory, metadata));

    return {
      runId,
      inputFingerprint,
      artifactsRoot,
      runDirectory,
      canonicalInputPath: join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME),
      canonicalInput,
    };
  } catch (error) {
    const safeError = sanitizeRunError(error, environment);
    if (runDirectory !== undefined) {
      const failedMetadata: Phase1RunMetadata = {
        runId,
        status: 'failed',
        startedAt,
        endedAt: formatTimestamp(now()),
        engineVersion,
        ...(inputFingerprint === undefined ? {} : { inputFingerprint }),
        ...(canonicalInputWritten ? { canonicalInputArtifact: CANONICAL_INPUT_ARTIFACT_NAME } : {}),
        failure: { code: safeError.code, message: safeError.publicMessage },
      };

      try {
        await artifactStore.writeRunMetadata(runDirectory, failedMetadata);
      } catch {
        // The original safe failure remains the observable CLI outcome. A
        // completely unavailable filesystem cannot guarantee a run record.
      }
    }

    throw safeError;
  }
}

export interface AtomicJsonFilesystem {
  mkdir(path: string, options: { readonly recursive?: boolean }): Promise<string | undefined>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface FilesystemArtifactStoreDependencies {
  readonly filesystem?: AtomicJsonFilesystem;
  readonly serializeJson?: (value: unknown) => string;
  readonly createTemporarySuffix?: () => string;
}

/** Creates the default atomically-written filesystem artifact store. */
export function createFilesystemArtifactStore(
  dependencies: FilesystemArtifactStoreDependencies = {},
): Phase1ArtifactStore {
  const filesystem = dependencies.filesystem ?? { mkdir, writeFile, rename, unlink };
  const serializeJson = dependencies.serializeJson ?? prettyJson;
  const createTemporarySuffix = dependencies.createTemporarySuffix ?? randomUUID;

  return {
    async createRunDirectory(artifactsRoot: string, runId: string): Promise<string> {
      const runDirectory = join(artifactsRoot, runId);
      await filesystem.mkdir(artifactsRoot, { recursive: true });
      await filesystem.mkdir(runDirectory, {});
      return runDirectory;
    },
    writeRunMetadata(runDirectory, metadata): Promise<void> {
      return writeJsonAtomically(
        filesystem,
        join(runDirectory, RUN_METADATA_ARTIFACT_NAME),
        metadata,
        serializeJson,
        createTemporarySuffix,
      );
    },
    writeCanonicalInput(runDirectory, canonicalInput): Promise<void> {
      return writeJsonAtomically(
        filesystem,
        join(runDirectory, CANONICAL_INPUT_ARTIFACT_NAME),
        canonicalInput,
        serializeJson,
        createTemporarySuffix,
      );
    },
  };
}

/** Serializes before creating a temp file, then publishes with an atomic rename. */
export async function writeJsonAtomically(
  filesystem: Pick<AtomicJsonFilesystem, 'writeFile' | 'rename' | 'unlink'>,
  finalPath: string,
  value: unknown,
  serializeJson: (value: unknown) => string = prettyJson,
  createTemporarySuffix: () => string = randomUUID,
): Promise<void> {
  const contents = `${serializeJson(value)}\n`;
  const temporaryPath = `${finalPath}.tmp-${createTemporarySuffix()}`;
  let temporaryFileCreated = false;

  try {
    await filesystem.writeFile(temporaryPath, contents, 'utf8');
    temporaryFileCreated = true;
    await filesystem.rename(temporaryPath, finalPath);
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await filesystem.unlink(temporaryPath);
      } catch {
        // A failed cleanup must not replace the useful persistence failure.
      }
    }
    throw error;
  }
}

function prettyJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError('Value is not JSON-serializable.');
  }
  return serialized;
}

async function persistArtifact<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new VidGenError('artifact', 'Unable to persist Phase 1 run artifacts.');
  }
}

function validateRunId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new VidGenError('invalid_argument', 'Generated run ID is not safe for a run directory.');
  }
  return value;
}

function formatTimestamp(value: Date): string {
  if (Number.isNaN(value.valueOf())) {
    throw new VidGenError('invalid_argument', 'Run clock produced an invalid timestamp.');
  }
  return value.toISOString();
}

function sanitizeRunError(error: unknown, environment: NgestVidGenEnvironment): VidGenError {
  if (isVidGenError(error) && messageIsSafe(error.publicMessage, environment)) {
    return error;
  }
  return new VidGenError('unexpected', 'Phase 1 input run failed unexpectedly.');
}

function messageIsSafe(message: string, environment: NgestVidGenEnvironment): boolean {
  const bearerToken = environment.NGEST_VIDGEN_BEARER_TOKEN;
  return !/authorization/i.test(message)
    && (bearerToken === undefined || !message.includes(bearerToken));
}
