import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCanonicalInput,
  fingerprintCanonicalInput,
  normalizeCanonicalControl,
  normalizeCanonicalFeed,
} from '../../../src/core/canonical-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { canonicalJson } from '../../../src/shared/canonical-json.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

test('canonical input selects the exact feed/control shape and retains provenance separately', () => {
  const manifest = validManifest() as typeof validManifest extends () => infer Result ? Result : never;
  (manifest.articles[0] as Record<string, unknown>).digest = 'ngest editorial digest';
  (manifest.articles[0] as Record<string, unknown>).generatedAt = '2026-09-05T13:00:00Z';
  (manifest as unknown as Record<string, unknown>).endpoint = 'https://ngest.example.test/manifest';
  (manifest as unknown as Record<string, unknown>).bearerToken = 'test-secret';

  const canonical = buildCanonicalInput(manifest);

  assert.deepEqual(canonical, {
    schemaVersion: '1',
    feed: {
      profile: { configKey: 'daily-briefing', displayName: 'Daily Briefing' },
      publication: { name: 'VidGen News' },
      articles: [
        {
          articleId: 'article-1',
          headline: 'First governed headline',
          originalUrl: 'https://publisher.example.test/story-1',
          effectiveFeedDate: '2026-09-05',
          feedDateSource: 'published_at',
          publishedAt: '2026-09-05T12:00:00Z',
          author: 'Jordan Lee',
          summary: 'A governed article summary.',
          imageUrl: 'https://publisher.example.test/image-1.jpg',
          source: { configKey: 'publisher-main', displayName: 'Publisher Main' },
          categories: ['News', 'Technology'],
        },
        {
          articleId: 'article-2',
          headline: 'Second governed headline',
          originalUrl: 'https://publisher.example.test/story-2',
          effectiveFeedDate: '2026-09-04',
          feedDateSource: 'feed_date',
          publishedAt: null,
          author: null,
          summary: null,
          imageUrl: null,
          source: { configKey: 'publisher-main', displayName: 'Publisher Main' },
          categories: [],
        },
      ],
    },
    control: {
      version: '1',
      editorial: { audience: 'general', constraints: { locations: ['US', 'CA'] } },
      script: { tone: 'measured' },
      production: { captions: true },
    },
    inputFingerprint: canonical.inputFingerprint,
    provenance: {
      ngestApiVersion: '2026-09-01',
      snapshotRevision: { revision: 7 },
    },
  });

  const serialized = JSON.stringify(canonical);
  for (const forbidden of ['test-secret', 'ngest.example.test', 'digest', 'generatedAt', 'bearerToken']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('canonical feed preserves article order and normalizes nullable metadata explicitly', () => {
  const manifest = validManifest();
  const feed = normalizeCanonicalFeed(manifest);

  assert.deepEqual(feed.articles.map((article) => article.articleId), ['article-1', 'article-2']);
  assert.deepEqual(
    [feed.articles[1].publishedAt, feed.articles[1].author, feed.articles[1].summary, feed.articles[1].imageUrl],
    [null, null, null, null],
  );
});

test('canonical feed rejects malformed article identity, URL, source, and categories', () => {
  const cases: ReadonlyArray<readonly [string, (manifest: ReturnType<typeof validManifest>) => void]> = [
    ['article identity', (manifest) => { manifest.articles[0].articleId = ''; }],
    ['publisher URL', (manifest) => { manifest.articles[0].originalUrl = 'mailto:editor@example.test'; }],
    ['source identity', (manifest) => { manifest.articles[0].source = { configKey: '', displayName: 'Publisher Main' }; }],
    ['categories', (manifest) => { manifest.articles[0].categories = ['News', '']; }],
  ];

  for (const [name, mutate] of cases) {
    const manifest = validManifest();
    mutate(manifest);
    assert.throws(() => normalizeCanonicalFeed(manifest), hasCanonicalInputCode, name);
  }
});

test('canonical control fills omitted stage objects, preserves provisional nested JSON, and rejects extra branches', () => {
  assert.deepEqual(normalizeCanonicalControl({ version: '1' }), {
    version: '1', editorial: {}, script: {}, production: {},
  });

  const control = normalizeCanonicalControl({
    version: '1',
    editorial: { nested: [{ enabled: true, note: null }] },
    script: {},
    production: {},
  });
  assert.deepEqual(control.editorial, { nested: [{ enabled: true, note: null }] });

  assert.throws(
    () => normalizeCanonicalControl({ version: '1', editorial: {}, script: {}, production: {}, unknown: {} }),
    hasCanonicalInputCode,
  );
});

test('canonical control rejects obvious secret-bearing keys at any nested level', () => {
  for (const control of [
    { version: '1', bearerToken: 'value' },
    { version: '1', editorial: { providerApiKey: 'value' } },
    { version: '1', script: { nested: [{ databasePassword: 'value' }] } },
  ]) {
    assert.throws(() => normalizeCanonicalControl(control), hasCanonicalInputCode);
  }
});

test('canonical JSON sorts object keys recursively while preserving array order', () => {
  assert.equal(
    canonicalJson({ z: { b: 1, a: 2 }, a: [{ d: 4, c: 3 }] }),
    canonicalJson({ a: [{ c: 3, d: 4 }], z: { a: 2, b: 1 } }),
  );
  assert.notEqual(canonicalJson(['first', 'second']), canonicalJson(['second', 'first']));
  assert.throws(() => canonicalJson({ omitted: undefined }), (error: unknown) => error instanceof VidGenError);
});

test('fingerprints are order-insensitive for object keys and sensitive to semantic feed/control changes', () => {
  const first = buildCanonicalInput(validManifest());
  const reordered = validManifest();
  reordered.control = {
    production: { captions: true },
    script: { tone: 'measured' },
    editorial: { constraints: { locations: ['US', 'CA'] }, audience: 'general' },
    version: '1',
  };
  assert.equal(buildCanonicalInput(reordered).inputFingerprint, first.inputFingerprint);

  const reorderedArticles = validManifest();
  reorderedArticles.articles = [...reorderedArticles.articles].reverse();
  assert.notEqual(buildCanonicalInput(reorderedArticles).inputFingerprint, first.inputFingerprint);

  const changedFeed = validManifest();
  changedFeed.articles[0].headline = 'Changed governed headline';
  assert.notEqual(buildCanonicalInput(changedFeed).inputFingerprint, first.inputFingerprint);

  const changedControl = validManifest();
  changedControl.control.script = { tone: 'urgent' };
  assert.notEqual(buildCanonicalInput(changedControl).inputFingerprint, first.inputFingerprint);
});

test('provenance-only snapshot changes do not affect the input fingerprint', () => {
  const first = buildCanonicalInput(validManifest());
  const changedSnapshot = validManifest();
  changedSnapshot.snapshotRevision = { revision: 8, exportedAt: 'later' };

  const second = buildCanonicalInput(changedSnapshot);
  assert.notDeepEqual(second.provenance, first.provenance);
  assert.equal(second.inputFingerprint, first.inputFingerprint);
  assert.equal(fingerprintCanonicalInput(second.feed, second.control), second.inputFingerprint);
});

test('Phase 1 JSON schemas parse and express runtime required and additional-properties policy', () => {
  const feed = readSchema('canonical-feed.schema.json');
  const control = readSchema('canonical-control.schema.json');
  const input = readSchema('canonical-input.schema.json');

  assert.deepEqual(feed.required, ['profile', 'publication', 'articles']);
  assert.equal(feed.additionalProperties, false);
  assert.deepEqual(feed.$defs.article.required, [
    'articleId', 'headline', 'originalUrl', 'effectiveFeedDate', 'feedDateSource',
    'publishedAt', 'author', 'summary', 'imageUrl', 'source', 'categories',
  ]);
  assert.equal(feed.$defs.article.additionalProperties, false);
  assert.equal(feed.$defs.source.additionalProperties, false);

  assert.deepEqual(control.required, ['version', 'editorial', 'script', 'production']);
  assert.equal(control.additionalProperties, false);
  assert.notEqual(control.$defs.stage.additionalProperties, false);

  assert.deepEqual(input.required, ['schemaVersion', 'feed', 'control', 'inputFingerprint', 'provenance']);
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.provenance.additionalProperties, false);
  assert.deepEqual(input.properties.provenance.required, ['ngestApiVersion']);
});

function readSchema(name: string): Record<string, any> {
  return JSON.parse(readFileSync(`schemas/${name}`, 'utf8')) as Record<string, any>;
}

function hasCanonicalInputCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'canonical_input';
}
