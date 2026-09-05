import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { VidGenError } from '../../../src/core/error.ts';
import { loadNgestVidGenManifestFile } from '../../../src/integrations/ngest/local-manifest-file.ts';
import { validateNgestVidGenManifestPage } from '../../../src/integrations/ngest/vidgen-manifest.ts';

const fixturePath = new URL('../../fixtures/ngest-vidgen-manifest.json', import.meta.url);
const fixtureFilePath = fileURLToPath(fixturePath);
const bearerSentinel = 'vidgen-test-secret-never-surface';

test('local ngest manifest fixture converges with direct shared validation without runtime configuration', async () => {
  const raw = await readFile(fixturePath, 'utf8');
  const direct = validateNgestVidGenManifestPage(JSON.parse(raw));
  const loaded = await loadNgestVidGenManifestFile(fixtureFilePath);

  assert.deepEqual(loaded, direct);
  assert.equal(loaded.articles.length, 2);
  assert.equal(loaded.nextCursor, null);
});

test('local ngest manifest file rejects invalid JSON without exposing its contents or bearer sentinel', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'invalid.json');
    const contents = `{invalid JSON ${bearerSentinel}}`;
    await writeFile(path, contents, 'utf8');

    await assert.rejects(
      loadNgestVidGenManifestFile(path),
      safelyHasCode('ngest_local_input', contents),
    );
  });
});

test('local ngest manifest file retains shared manifest and continuation failures', async (context) => {
  await withTemporaryDirectory(async (directory) => {
    await context.test('malformed envelope', async () => {
      const path = join(directory, 'malformed.json');
      await writeFile(path, JSON.stringify({ apiVersion: '2026-09-01', articles: [] }), 'utf8');
      await assert.rejects(loadNgestVidGenManifestFile(path), hasCode('ngest_manifest'));
    });

    await context.test('unsupported continuation', async () => {
      const path = join(directory, 'continued.json');
      const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
      fixture.nextCursor = 'next-page-token';
      await writeFile(path, JSON.stringify(fixture), 'utf8');
      await assert.rejects(loadNgestVidGenManifestFile(path), hasCode('ngest_unsupported_continuation'));
    });
  });
});

test('local ngest manifest file safely classifies missing and unreadable paths', async () => {
  await withTemporaryDirectory(async (directory) => {
    await assert.rejects(
      loadNgestVidGenManifestFile(join(directory, 'missing.json')),
      hasCode('ngest_local_input'),
    );

    const unreadablePath = join(directory, 'directory-instead-of-file');
    await mkdir(unreadablePath);
    await assert.rejects(loadNgestVidGenManifestFile(unreadablePath), hasCode('ngest_local_input'));
  });
});

function hasCode(code: VidGenError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VidGenError && error.code === code;
}

function safelyHasCode(
  code: VidGenError['code'],
  rawContents: string,
): (error: unknown) => boolean {
  return (error: unknown) => {
    const surfaced = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    assert.equal(surfaced.includes(rawContents), false);
    assert.equal(surfaced.includes(bearerSentinel), false);
    return hasCode(code)(error);
  };
}

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'vidgen-ngest-local-manifest-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
