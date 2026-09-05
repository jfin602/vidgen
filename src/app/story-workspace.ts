import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildCanonicalInput, type CanonicalInput } from '../core/canonical-input.ts';
import { type AssemblyTemplate } from '../core/assembly-template.ts';
import { isVidGenError, VidGenError, type VidGenErrorCode } from '../core/error.ts';
import { buildStoryInput, type StoryInput } from '../core/story-input.ts';
import { getAssemblyTemplate } from '../core/template-registry.ts';
import {
  loadNgestVidGenManifestFile,
} from '../integrations/ngest/local-manifest-file.ts';
import {
  prettyJson,
  type AtomicJsonFilesystem,
  writeJsonAtomically,
} from '../shared/atomic-json.ts';
import { VIDGEN_ENGINE_VERSION } from '../version.ts';

export const DEFAULT_STORY_ARTIFACTS_ROOT = 'artifacts/stories';
export const STORY_RUN_ARTIFACT_NAME = 'story-run.json';
export const STORY_INPUT_ARTIFACT_NAME = 'story.json';

export type StoryRunStatus = 'running' | 'story_ready' | 'failed';

/** Durable state for exactly one manual story-development invocation. */
export interface StoryRunMetadata {
  readonly storyRunId: string;
  readonly status: StoryRunStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly engineVersion: string;
  readonly articleId: string;
  readonly storyFingerprint: string;
  readonly sourceInputFingerprint: string;
  readonly storyInputArtifact: typeof STORY_INPUT_ARTIFACT_NAME;
  readonly template: {
    readonly id: string;
    readonly version: string;
  };
  /** Requirements only: this does not assert any generated asset exists. */
  readonly generatedAssetRoles: readonly {
    readonly id: string;
    readonly kind: 'presenter' | 'video' | 'voiceover';
  }[];
  /** Requirements only: this does not assert standardized files are available. */
  readonly standardizedAssetRoles: readonly {
    readonly id: 'intro' | 'outro';
    readonly placement: 'before-story' | 'after-story';
  }[];
  readonly failure?: {
    readonly code: VidGenErrorCode;
    readonly message: string;
  };
}

export interface StoryWorkspaceResult {
  readonly storyRunId: string;
  readonly artifactsRoot: string;
  readonly storyDirectory: string;
  readonly storyInputPath: string;
  readonly storyRunPath: string;
  readonly storyInput: StoryInput;
  readonly template: Pick<AssemblyTemplate, 'id' | 'version'>;
}

/** Filesystem persistence boundary for an independent story workspace. */
export interface StoryArtifactStore {
  createStoryWorkspace(artifactsRoot: string, storyRunId: string): Promise<string>;
  writeStoryRunMetadata(directory: string, metadata: StoryRunMetadata): Promise<void>;
  writeStoryInput(directory: string, storyInput: StoryInput): Promise<void>;
}

export interface StoryWorkspaceDependencies {
  readonly inputFile: string;
  readonly articleId: string;
  readonly templateId?: string;
  readonly artifactsRoot?: string;
  readonly loadManifest?: typeof loadNgestVidGenManifestFile;
  readonly buildInput?: (manifest: Parameters<typeof buildCanonicalInput>[0]) => CanonicalInput;
  readonly buildStory?: (input: CanonicalInput, articleId: string) => StoryInput;
  readonly getTemplate?: (templateId: string) => AssemblyTemplate;
  readonly createStoryRunId?: () => string;
  readonly now?: () => Date;
  readonly artifactStore?: StoryArtifactStore;
  readonly engineVersion?: string;
}

/**
 * Builds one selected StoryInput from a local ngest-shaped file and initializes
 * its future production workspace. It deliberately stops before retrieval,
 * ClipPlan, provider work, or media assembly.
 */
export async function createStoryWorkspace(
  dependencies: StoryWorkspaceDependencies,
): Promise<StoryWorkspaceResult> {
  const inputFile = requireNonEmpty(dependencies.inputFile, '--input-file requires a non-empty file path.');
  const articleId = requireNonEmpty(dependencies.articleId, '--article-id requires a non-empty articleId.');
  const templateId = dependencies.templateId === undefined
    ? 'default-news-40s'
    : requireNonEmpty(dependencies.templateId, '--template requires a non-empty template ID.');
  const artifactsRoot = resolve(dependencies.artifactsRoot ?? DEFAULT_STORY_ARTIFACTS_ROOT);
  const loadManifest = dependencies.loadManifest ?? loadNgestVidGenManifestFile;
  const buildInput = dependencies.buildInput ?? buildCanonicalInput;
  const buildStory = dependencies.buildStory ?? buildStoryInput;
  const getTemplate = dependencies.getTemplate ?? getAssemblyTemplate;
  const storyRunId = validateStoryRunId((dependencies.createStoryRunId ?? randomUUID)());
  const now = dependencies.now ?? (() => new Date());
  const engineVersion = dependencies.engineVersion ?? VIDGEN_ENGINE_VERSION;
  const artifactStore = dependencies.artifactStore ?? createFilesystemStoryArtifactStore();
  const startedAt = formatTimestamp(now());

  let storyDirectory: string | undefined;
  let storyInput: StoryInput | undefined;
  let template: AssemblyTemplate | undefined;

  try {
    // This sequence intentionally completes all domain validation before a
    // workspace can present itself as ready.
    const manifest = await loadManifest(inputFile);
    const canonicalInput = buildInput(manifest);
    storyInput = buildStory(canonicalInput, articleId);
    template = getTemplate(templateId);

    storyDirectory = await persistArtifact(() => artifactStore.createStoryWorkspace(artifactsRoot, storyRunId));
    const runningMetadata = buildMetadata('running', storyRunId, startedAt, engineVersion, storyInput, template);
    await persistArtifact(() => artifactStore.writeStoryRunMetadata(storyDirectory, runningMetadata));
    await persistArtifact(() => artifactStore.writeStoryInput(storyDirectory, storyInput));

    const readyMetadata = buildMetadata(
      'story_ready', storyRunId, startedAt, engineVersion, storyInput, template, formatTimestamp(now()),
    );
    await persistArtifact(() => artifactStore.writeStoryRunMetadata(storyDirectory, readyMetadata));

    return {
      storyRunId,
      artifactsRoot,
      storyDirectory,
      storyInputPath: join(storyDirectory, STORY_INPUT_ARTIFACT_NAME),
      storyRunPath: join(storyDirectory, STORY_RUN_ARTIFACT_NAME),
      storyInput,
      template: { id: template.id, version: template.version },
    };
  } catch (error) {
    const safeError = sanitizeStoryError(error);
    if (storyDirectory !== undefined && storyInput !== undefined && template !== undefined) {
      const failedMetadata = {
        ...buildMetadata('failed', storyRunId, startedAt, engineVersion, storyInput, template, formatTimestamp(now())),
        failure: { code: safeError.code, message: safeError.publicMessage },
      } satisfies StoryRunMetadata;
      try {
        await artifactStore.writeStoryRunMetadata(storyDirectory, failedMetadata);
      } catch {
        // A fully unavailable filesystem cannot guarantee a failed record.
      }
    }
    throw safeError;
  }
}

export interface FilesystemStoryArtifactStoreDependencies {
  readonly filesystem?: StoryWorkspaceFilesystem;
  readonly serializeJson?: (value: unknown) => string;
  readonly createTemporarySuffix?: () => string;
}

export interface StoryWorkspaceFilesystem extends AtomicJsonFilesystem {
  mkdir(path: string, options: { readonly recursive?: boolean }): Promise<string | undefined>;
}

/** Creates the standard filesystem-backed, atomically persisted story store. */
export function createFilesystemStoryArtifactStore(
  dependencies: FilesystemStoryArtifactStoreDependencies = {},
): StoryArtifactStore {
  const filesystem = dependencies.filesystem ?? { mkdir, writeFile, rename, unlink };
  const serializeJson = dependencies.serializeJson ?? prettyJson;
  const createTemporarySuffix = dependencies.createTemporarySuffix ?? randomUUID;

  return {
    async createStoryWorkspace(artifactsRoot: string, storyRunId: string): Promise<string> {
      const directory = join(artifactsRoot, storyRunId);
      await filesystem.mkdir(artifactsRoot, { recursive: true });
      await filesystem.mkdir(directory, {});
      await filesystem.mkdir(join(directory, 'sources'), {});
      await filesystem.mkdir(join(directory, 'assets'), {});
      await filesystem.mkdir(join(directory, 'assets', 'presenter'), {});
      await filesystem.mkdir(join(directory, 'assets', 'video'), {});
      await filesystem.mkdir(join(directory, 'assets', 'audio'), {});
      await filesystem.mkdir(join(directory, 'final'), {});
      return directory;
    },
    writeStoryRunMetadata(directory, metadata): Promise<void> {
      return writeJsonAtomically(
        filesystem,
        join(directory, STORY_RUN_ARTIFACT_NAME),
        metadata,
        serializeJson,
        createTemporarySuffix,
      );
    },
    writeStoryInput(directory, storyInput): Promise<void> {
      return writeJsonAtomically(
        filesystem,
        join(directory, STORY_INPUT_ARTIFACT_NAME),
        storyInput,
        serializeJson,
        createTemporarySuffix,
      );
    },
  };
}

function buildMetadata(
  status: StoryRunStatus,
  storyRunId: string,
  startedAt: string,
  engineVersion: string,
  storyInput: StoryInput,
  template: AssemblyTemplate,
  endedAt?: string,
): StoryRunMetadata {
  return {
    storyRunId,
    status,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
    engineVersion,
    articleId: storyInput.article.articleId,
    storyFingerprint: storyInput.storyFingerprint,
    sourceInputFingerprint: storyInput.provenance.sourceInputFingerprint,
    storyInputArtifact: STORY_INPUT_ARTIFACT_NAME,
    template: { id: template.id, version: template.version },
    generatedAssetRoles: template.generatedAssetRoles.map(({ id, kind }) => ({ id, kind })),
    standardizedAssetRoles: template.standardizedAssetRoles.map(({ id, placement }) => ({ id, placement })),
  };
}

async function persistArtifact<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new VidGenError('artifact', 'Unable to persist story workspace artifacts.', { cause: error });
  }
}

function requireNonEmpty(value: string | undefined, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VidGenError('invalid_argument', message);
  }
  return value;
}

function validateStoryRunId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) {
    throw new VidGenError('invalid_argument', 'Generated story run ID is not safe for a workspace directory.');
  }
  return value;
}

function formatTimestamp(value: Date): string {
  if (Number.isNaN(value.valueOf())) {
    throw new VidGenError('invalid_argument', 'Story workspace clock produced an invalid timestamp.');
  }
  return value.toISOString();
}

function sanitizeStoryError(error: unknown): VidGenError {
  if (isVidGenError(error) && messageIsSafe(error.publicMessage)) {
    return error;
  }
  return new VidGenError('unexpected', 'Story workspace creation failed unexpectedly.');
}

function messageIsSafe(message: string): boolean {
  return !/authorization|bearer/i.test(message);
}
