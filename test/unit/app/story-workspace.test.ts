import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  STORY_INPUT_ARTIFACT_NAME,
  STORY_RUN_ARTIFACT_NAME,
  createFilesystemStoryArtifactStore,
  createStoryWorkspace,
} from '../../../src/app/story-workspace.ts';
import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { buildStoryInput } from '../../../src/core/story-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { validateNgestVidGenManifestPage } from '../../../src/integrations/ngest/vidgen-manifest.ts';
import { VIDGEN_ENGINE_VERSION } from '../../../src/version.ts';

const fixturePath = fileURLToPath(new URL('../../fixtures/ngest-vidgen-manifest.json', import.meta.url));

test('manual story workspace selects the requested second Article and persists only StoryInput', async () => {
  await withTemporaryDirectory(async (root) => {
    const result = await createStoryWorkspace({
      inputFile: fixturePath,
      articleId: 'example-article-2',
      artifactsRoot: root,
      createStoryRunId: () => 'story-run-2',
      now: fixedClock(),
    });

    assert.equal(result.storyRunId, 'story-run-2');
    assert.equal(result.storyInput.article.articleId, 'example-article-2');
    assert.equal(result.template.id, 'default-news-40s');
    assert.equal(result.template.version, '2');

    const story = await readJson(result.storyInputPath);
    const expected = buildStoryInput(
      buildCanonicalInput(validateNgestVidGenManifestPage(JSON.parse(await readFile(fixturePath, 'utf8')))),
      'example-article-2',
    );
    assert.deepEqual(story, expected);
    assert.equal(JSON.stringify(story).includes('article-1'), false);
    assert.equal('articles' in story, false);

    const metadata = await readJson(result.storyRunPath);
    assert.deepEqual(metadata, {
      storyRunId: 'story-run-2',
      status: 'story_ready',
      startedAt: '2026-09-05T12:00:00.000Z',
      endedAt: '2026-09-05T12:00:01.000Z',
      engineVersion: VIDGEN_ENGINE_VERSION,
      articleId: 'example-article-2',
      storyFingerprint: expected.storyFingerprint,
      sourceInputFingerprint: expected.provenance.sourceInputFingerprint,
      storyInputArtifact: STORY_INPUT_ARTIFACT_NAME,
      template: { id: 'default-news-40s', version: '2' },
      generatedAssetRoles: [
        { id: 'opening-anchor', kind: 'presenter' },
        { id: 'content-video', kind: 'video' },
        { id: 'content-voiceover', kind: 'voiceover' },
        { id: 'supporting-anchor', kind: 'presenter' },
      ],
      standardizedAssetRoles: [
        { id: 'intro', placement: 'before-story' },
        { id: 'outro', placement: 'after-story' },
      ],
    });
    assert.equal(JSON.stringify(metadata).includes('available'), false);
    assert.equal(JSON.stringify(metadata).includes('clipPlan'), false);

    assert.deepEqual(await workspaceNames(result.storyDirectory), [
      'assets',
      'assets/audio',
      'assets/presenter',
      'assets/video',
      'final',
      'sources',
      STORY_RUN_ARTIFACT_NAME,
      STORY_INPUT_ARTIFACT_NAME,
    ]);
    assert.equal((await readdir(result.storyDirectory)).includes('ngest-vidgen-manifest.json'), false);
  });
});

test('identical story input creates independent safe workspaces with a stable fingerprint', async () => {
  await withTemporaryDirectory(async (root) => {
    const first = await createStoryWorkspace({
      inputFile: fixturePath,
      articleId: 'example-article-1',
      artifactsRoot: root,
      createStoryRunId: () => 'story-run-first',
      now: fixedClock(),
    });
    const second = await createStoryWorkspace({
      inputFile: fixturePath,
      articleId: 'example-article-1',
      artifactsRoot: root,
      createStoryRunId: () => 'story-run-second',
      now: fixedClock(),
    });

    assert.notEqual(first.storyRunId, second.storyRunId);
    assert.notEqual(first.storyDirectory, second.storyDirectory);
    assert.equal(first.storyInput.storyFingerprint, second.storyInput.storyFingerprint);
  });
});

test('a story run directory is never derived from unsafe Article ID text', async () => {
  await withTemporaryDirectory(async (root) => {
    const inputPath = join(root, 'unsafe-article-id.json');
    const manifest = JSON.parse(await readFile(fixturePath, 'utf8')) as { articles: Array<{ articleId: string }> };
    manifest.articles[1].articleId = '../../unsafe-article-id';
    await writeFile(inputPath, JSON.stringify(manifest), 'utf8');

    const result = await createStoryWorkspace({
      inputFile: inputPath,
      articleId: '../../unsafe-article-id',
      artifactsRoot: root,
      createStoryRunId: () => 'safe-uuid-like-story-run',
      now: fixedClock(),
    });

    assert.equal(result.storyDirectory, join(root, 'safe-uuid-like-story-run'));
    assert.equal((await readJson(result.storyRunPath)).articleId, '../../unsafe-article-id');
  });
});

test('invalid story selection and unknown templates fail before creating a workspace', async () => {
  await withTemporaryDirectory(async (root) => {
    for (const dependencies of [
      { articleId: 'missing-article' },
      { articleId: 'example-article-1', templateId: 'missing-template' },
    ]) {
      await assert.rejects(
        createStoryWorkspace({
          inputFile: fixturePath,
          artifactsRoot: root,
          createStoryRunId: () => 'never-created',
          now: fixedClock(),
          ...dependencies,
        }),
        (error: unknown) => error instanceof VidGenError
          && (error.code === 'story_selection' || error.code === 'assembly_template'),
      );
      await assert.rejects(readdir(join(root, 'never-created')));
    }
  });
});

test('a terminal metadata write failure cannot leave story-run.json story_ready', async () => {
  await withTemporaryDirectory(async (root) => {
    const store = createFilesystemStoryArtifactStore({
      serializeJson: (value) => {
        if (value !== null && typeof value === 'object' && 'status' in value && value.status === 'story_ready') {
          throw new Error('simulated terminal metadata serialization failure');
        }
        return JSON.stringify(value, null, 2);
      },
      createTemporarySuffix: () => 'test',
    });

    await assert.rejects(
      createStoryWorkspace({
        inputFile: fixturePath,
        articleId: 'example-article-1',
        artifactsRoot: root,
        createStoryRunId: () => 'terminal-failure',
        artifactStore: store,
        now: fixedClock(),
      }),
      (error: unknown) => error instanceof VidGenError && error.code === 'artifact',
    );

    const metadata = await readJson(join(root, 'terminal-failure', STORY_RUN_ARTIFACT_NAME));
    assert.equal(metadata.status, 'failed');
    assert.deepEqual(metadata.failure, {
      code: 'artifact',
      message: 'Unable to persist story workspace artifacts.',
    });
  });
});

function fixedClock(): () => Date {
  const dates = [
    new Date('2026-09-05T12:00:00.000Z'),
    new Date('2026-09-05T12:00:01.000Z'),
  ];
  return () => dates.shift() ?? new Date('2026-09-05T12:00:01.000Z');
}

async function readJson(path: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function workspaceNames(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const names = await Promise.all(entries.map(async (entry) => {
    const name = join(prefix, entry.name);
    const displayName = name.replaceAll('\\', '/');
    return entry.isDirectory()
      ? [displayName, ...await workspaceNames(root, name)]
      : [displayName];
  }));
  return names.flat().sort();
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'vidgen-story-workspace-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
