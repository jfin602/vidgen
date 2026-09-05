import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json.ts';
import type { JsonValue } from '../shared/json.ts';
import {
  type CanonicalArticle,
  type CanonicalControl,
  type CanonicalInput,
} from './canonical-input.ts';
import { VidGenError } from './error.ts';

export const STORY_INPUT_SCHEMA_VERSION = '1';

export interface StoryInputProvenance {
  /** Links this story to its source feed artifact without defining story identity. */
  readonly sourceInputFingerprint: string;
  readonly ngestApiVersion: string;
  readonly snapshotRevision?: JsonValue;
}

/**
 * The durable, single-story handoff into VidGen production. Publisher image
 * metadata remains metadata only and does not grant media-reuse rights.
 */
export interface StoryInput {
  readonly schemaVersion: typeof STORY_INPUT_SCHEMA_VERSION;
  readonly article: CanonicalArticle;
  readonly profile: CanonicalInput['feed']['profile'];
  readonly publication: CanonicalInput['feed']['publication'];
  readonly control: CanonicalControl;
  readonly storyFingerprint: string;
  readonly provenance: StoryInputProvenance;
}

/**
 * Selects one caller-requested Article. This boundary deliberately performs no
 * ranking, fallback, or inference from feed order.
 */
export function selectCanonicalArticle(
  canonicalInput: CanonicalInput,
  articleId: string | undefined,
): CanonicalArticle {
  if (typeof articleId !== 'string' || articleId.trim().length === 0) {
    throw storySelectionError('An explicit articleId is required to select a story.');
  }

  const matches = canonicalInput.feed.articles.filter((article) => article.articleId === articleId);
  if (matches.length === 0) {
    throw storySelectionError('The requested articleId is not available in this CanonicalInput.');
  }

  if (matches.length > 1) {
    throw storySelectionError('The requested articleId is ambiguous in this CanonicalInput.');
  }

  return matches[0];
}

/** Builds the bounded production input for one explicitly selected story. */
export function buildStoryInput(
  canonicalInput: CanonicalInput,
  articleId: string | undefined,
): StoryInput {
  const article = selectCanonicalArticle(canonicalInput, articleId);
  const { profile, publication } = canonicalInput.feed;

  return {
    schemaVersion: STORY_INPUT_SCHEMA_VERSION,
    article,
    profile,
    publication,
    control: canonicalInput.control,
    storyFingerprint: fingerprintStoryInput(article, profile, publication, canonicalInput.control),
    provenance: {
      sourceInputFingerprint: canonicalInput.inputFingerprint,
      ngestApiVersion: canonicalInput.provenance.ngestApiVersion,
      ...(canonicalInput.provenance.snapshotRevision === undefined
        ? {}
        : { snapshotRevision: canonicalInput.provenance.snapshotRevision }),
    },
  };
}

/**
 * Computes the stable identity for production-relevant story semantics only.
 * Feed provenance and unrelated Articles intentionally do not participate.
 */
export function fingerprintStoryInput(
  article: CanonicalArticle,
  profile: CanonicalInput['feed']['profile'],
  publication: CanonicalInput['feed']['publication'],
  control: CanonicalControl,
): string {
  return createHash('sha256')
    .update(canonicalJson({ article, profile, publication, control }))
    .digest('hex');
}

function storySelectionError(message: string): VidGenError {
  return new VidGenError('story_selection', message);
}
