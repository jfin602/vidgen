import type { NgestVidGenManifestPage } from '../../src/integrations/ngest/vidgen-manifest.ts';

export function validManifest(): NgestVidGenManifestPage {
  return {
    apiVersion: '2026-09-01',
    snapshotRevision: { revision: 7 },
    profile: {
      configKey: 'daily-briefing',
      displayName: 'Daily Briefing',
    },
    publication: {
      name: 'VidGen News',
    },
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
        source: {
          configKey: 'publisher-main',
          displayName: 'Publisher Main',
        },
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
        source: {
          configKey: 'publisher-main',
          displayName: 'Publisher Main',
        },
        categories: [],
      },
    ],
    control: {
      version: '1',
      editorial: {
        audience: 'general',
        constraints: { locations: ['US', 'CA'] },
      },
      script: { tone: 'measured' },
      production: { captions: true },
    },
    nextCursor: null,
  };
}
