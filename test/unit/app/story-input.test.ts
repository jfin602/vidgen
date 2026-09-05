import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildCanonicalInput } from '../../../src/core/canonical-input.ts';
import { VidGenError } from '../../../src/core/error.ts';
import {
  buildStoryInput,
  fingerprintStoryInput,
  selectCanonicalArticle,
} from '../../../src/core/story-input.ts';
import { validManifest } from '../../fixtures/canonical-input.ts';

test('StoryInput selects the caller-requested article rather than the first feed article', () => {
  const canonicalInput = buildCanonicalInput(validManifest());
  const story = buildStoryInput(canonicalInput, 'article-2');

  assert.equal(story.article.articleId, 'article-2');
  assert.equal(story.article.originalUrl, 'https://publisher.example.test/story-2');
  assert.deepEqual(story.article.source, { configKey: 'publisher-main', displayName: 'Publisher Main' });
  assert.equal('articles' in story, false);
  assert.equal(JSON.stringify(story).includes('article-1'), false);
});

test('StoryInput requires an explicit, unambiguous articleId without exposing feed contents', () => {
  const canonicalInput = buildCanonicalInput(validManifest());

  for (const articleId of [undefined, '', 'missing-article']) {
    assert.throws(
      () => buildStoryInput(canonicalInput, articleId),
      hasStorySelectionCode,
    );
  }

  const duplicate = buildCanonicalInput(validManifest());
  const duplicateArticle = { ...duplicate.feed.articles[1], articleId: 'article-1' };
  const ambiguousInput = {
    ...duplicate,
    feed: { ...duplicate.feed, articles: [duplicate.feed.articles[0], duplicateArticle] },
  };
  assert.throws(() => selectCanonicalArticle(ambiguousInput, 'article-1'), hasStorySelectionCode);
});

test('StoryInput fingerprint covers selected story semantics and excludes feed/provenance-only changes', () => {
  const firstInput = buildCanonicalInput(validManifest());
  const first = buildStoryInput(firstInput, 'article-1');
  assert.match(first.storyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(
    fingerprintStoryInput(first.article, first.profile, first.publication, first.control),
    first.storyFingerprint,
  );

  const unrelatedChanged = validManifest();
  unrelatedChanged.articles[1].headline = 'Changed unrelated headline';
  unrelatedChanged.articles.reverse();
  assert.equal(buildStoryInput(buildCanonicalInput(unrelatedChanged), 'article-1').storyFingerprint, first.storyFingerprint);

  const selectedChanged = validManifest();
  selectedChanged.articles[0].headline = 'Changed selected headline';
  assert.notEqual(buildStoryInput(buildCanonicalInput(selectedChanged), 'article-1').storyFingerprint, first.storyFingerprint);

  const controlChanged = validManifest();
  controlChanged.control.production = { captions: false };
  assert.notEqual(buildStoryInput(buildCanonicalInput(controlChanged), 'article-1').storyFingerprint, first.storyFingerprint);

  const profileChanged = validManifest();
  profileChanged.profile.displayName = 'Changed Profile';
  assert.notEqual(buildStoryInput(buildCanonicalInput(profileChanged), 'article-1').storyFingerprint, first.storyFingerprint);

  const publicationChanged = validManifest();
  publicationChanged.publication.name = 'Changed Publication';
  assert.notEqual(buildStoryInput(buildCanonicalInput(publicationChanged), 'article-1').storyFingerprint, first.storyFingerprint);

  const provenanceChanged = validManifest();
  provenanceChanged.apiVersion = '2026-10-01';
  provenanceChanged.snapshotRevision = { revision: 8 };
  const provenanceOnlyInput = buildCanonicalInput(provenanceChanged);
  const provenanceOnly = buildStoryInput({
    ...provenanceOnlyInput,
    inputFingerprint: 'b'.repeat(64),
  }, 'article-1');
  assert.equal(provenanceOnly.storyFingerprint, first.storyFingerprint);
  assert.equal(provenanceOnly.provenance.sourceInputFingerprint, 'b'.repeat(64));
  assert.equal(provenanceOnly.provenance.ngestApiVersion, '2026-10-01');
  assert.deepEqual(provenanceOnly.provenance.snapshotRevision, { revision: 8 });
});

test('StoryInput schema parses and matches runtime field and strictness intent', () => {
  const schema = JSON.parse(readFileSync('schemas/story-input.schema.json', 'utf8')) as Record<string, any>;

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'schemaVersion', 'article', 'profile', 'publication', 'control', 'storyFingerprint', 'provenance',
  ]);
  assert.deepEqual(Object.keys(schema.properties).sort(), [
    'article', 'control', 'profile', 'provenance', 'publication', 'schemaVersion', 'storyFingerprint',
  ]);
  assert.equal(schema.properties.provenance.additionalProperties, false);
  assert.deepEqual(schema.properties.provenance.required, ['sourceInputFingerprint', 'ngestApiVersion']);
  assert.deepEqual(Object.keys(schema.properties.provenance.properties).sort(), [
    'ngestApiVersion', 'snapshotRevision', 'sourceInputFingerprint',
  ]);
});

function hasStorySelectionCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'story_selection';
}
