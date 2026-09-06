import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { createSampleStoryFixture, sampleStoryFilename } from '../../../src/app/sample-story-fixture.ts';
import { createStoryWorkspace } from '../../../src/app/story-workspace.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

const secret = 'vidgen-test-secret-never-surface';

test('sample story fixture selects one governed Article, validates it, and feeds the local story workspace', async () => {
  await withTemporaryDirectory(async (root) => {
    const result = await createSampleStoryFixture({
      articleUrl: 'https://publisher.example.test/story-2',
      artifactsRoot: join(root, 'samples'),
      fetchManifest: async () => validManifest(),
    });

    assert.equal(result.articleId, 'article-2');
    assert.equal(basename(result.outputPath), sampleStoryFilename('https://publisher.example.test/story-2'));
    assert.match(basename(result.outputPath), /^article-[a-f0-9]{24}\.json$/);
    const fixture = await loadNgestVidGenManifestFile(result.outputPath);
    assert.equal(fixture.articles.length, 1);
    assert.equal(fixture.articles[0]!.articleId, 'article-2');
    assert.deepEqual(fixture.profile, validManifest().profile);
    assert.deepEqual(fixture.publication, validManifest().publication);
    assert.deepEqual(fixture.control, validManifest().control);
    assert.deepEqual(fixture.snapshotRevision, validManifest().snapshotRevision);
    assert.equal(fixture.nextCursor, null);

    const story = await createStoryWorkspace({
      inputFile: result.outputPath,
      articleId: result.articleId,
      artifactsRoot: join(root, 'stories'),
      createStoryRunId: () => 'sample-story',
    });
    assert.equal(story.storyInput.article.articleId, 'article-2');
  });
});

test('sample story fixture requires one exact governed URL, allowing only a terminal slash', async (context) => {
  await context.test('terminal slash', async () => {
    await withTemporaryDirectory(async (root) => {
      const result = await createSampleStoryFixture({
        articleUrl: 'https://publisher.example.test/story-1/',
        artifactsRoot: root,
        fetchManifest: async () => validManifest(),
      });
      assert.equal(result.articleId, 'article-1');
      assert.equal(basename(result.outputPath), sampleStoryFilename('https://publisher.example.test/story-1'));
    });
  });

  for (const articleUrl of ['not a URL', '/relative', 'ftp://publisher.example.test/story', ' https://publisher.example.test/story-1']) {
    await context.test(`malformed ${JSON.stringify(articleUrl)}`, async () => {
      await assert.rejects(createSampleStoryFixture({ articleUrl }), hasCode('invalid_argument'));
    });
  }

  await context.test('zero and ambiguous selection', async () => {
    await assert.rejects(
      createSampleStoryFixture({ articleUrl: 'https://publisher.example.test/missing', fetchManifest: async () => validManifest() }),
      hasCode('story_selection'),
    );
    const ambiguous = validManifest();
    ambiguous.articles = [...ambiguous.articles, { ...ambiguous.articles[0]! }];
    await assert.rejects(
      createSampleStoryFixture({ articleUrl: 'https://publisher.example.test/story-1', fetchManifest: async () => ambiguous }),
      hasCode('story_selection'),
    );
  });
});

test('sample fixture publication is atomic and errors do not surface secrets', async () => {
  const writes: string[] = [];
  const unlinked: string[] = [];
  await assert.rejects(
    createSampleStoryFixture({
      articleUrl: 'https://publisher.example.test/story-1',
      artifactsRoot: 'sample-output',
      fetchManifest: async () => validManifest(),
      createTemporarySuffix: () => 'test',
      filesystem: {
        mkdir: async () => undefined,
        writeFile: async (path) => { writes.push(path); },
        rename: async () => { throw new Error(secret); },
        unlink: async (path) => { unlinked.push(path); },
      },
    }),
    (error: unknown) => {
      const surfaced = error instanceof Error ? error.message : String(error);
      assert.equal(surfaced.includes(secret), false);
      return error instanceof VidGenError && error.code === 'artifact';
    },
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(unlinked, writes);

  await assert.rejects(
    createSampleStoryFixture({
      articleUrl: 'https://publisher.example.test/story-1',
      fetchManifest: async () => { throw new Error(secret); },
    }),
    (error: unknown) => !String(error).includes(secret),
  );
});

function hasCode(code: VidGenError['code']): (error: unknown) => boolean {
  return (error) => error instanceof VidGenError && error.code === code;
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'vidgen-sample-story-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
