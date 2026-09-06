import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import {
  DEFAULT_NGEST_TIMEOUT_MS,
  fetchNgestVidGenManifestPage,
  loadNgestVidGenRuntimeConfig,
  type NgestVidGenEnvironment,
} from '../../../src/integrations/ngest/vidgen-manifest.ts';

const bearer = 'vidgen-test-secret-never-surface';

test('ngest Distribution ingress constructs an encoded request and adapts its wire', async () => {
  let authorization: string | undefined;
  let accept: string | undefined;
  let requestUrl: string | undefined;
  await withServer((request, response) => {
    authorization = request.headers.authorization;
    accept = request.headers.accept;
    requestUrl = request.url;
    sendJson(response, page({ profileKey: 'daily/briefing news' }));
  }, async (baseUrl) => {
    const manifest = await fetchNgestVidGenManifestPage(environment(baseUrl, { NGEST_PROFILE_KEY: 'daily/briefing news' }));
    assert.equal(manifest.apiVersion, 'v1');
    assert.deepEqual(manifest.articles.map((article) => article.articleId), ['article-1']);
    assert.deepEqual(manifest.articles[0]?.categories, ['News', 'Technology']);
    assert.equal(manifest.articles[0]?.originalUrl, 'https://publisher.example.test/a?exact=1');
    assert.deepEqual(manifest.control, { version: '1', editorial: {}, script: {}, production: {} });
    assert.equal(JSON.stringify(manifest).includes('digest'), false);
    assert.equal(JSON.stringify(manifest).includes('generatedAt'), false);
  });
  assert.equal(requestUrl, '/api/v1/distribution/daily%2Fbriefing%20news');
  assert.equal(authorization, `Bearer ${bearer}`);
  assert.match(accept ?? '', /application\/json/);
});

test('ngest Distribution configuration is required, bounded, and HTTPS except loopback', () => {
  assert.throws(() => loadNgestVidGenRuntimeConfig({}), hasCode('configuration'));
  const loopback = loadNgestVidGenRuntimeConfig(environment('http://127.0.0.1:8090'));
  assert.equal(loopback.endpoint.href, 'http://127.0.0.1:8090/api/v1/distribution/daily-briefing');
  assert.equal(loopback.timeoutMs, DEFAULT_NGEST_TIMEOUT_MS);
  assert.equal(loadNgestVidGenRuntimeConfig(environment('https://ngest.example.test', { NGEST_TIMEOUT_MS: '25' })).timeoutMs, 25);
  assert.throws(() => loadNgestVidGenRuntimeConfig(environment('http://ngest.example.test')), hasCode('configuration'));
  assert.throws(() => loadNgestVidGenRuntimeConfig(environment('https://ngest.example.test', { NGEST_TIMEOUT_MS: '0' })), hasCode('configuration'));
});

test('ngest Distribution rejects redirects and authentication failures without following credentials', async (context) => {
  for (const [name, status] of [['redirect', 302], ['unauthorized', 401], ['forbidden', 403]] as const) {
    await context.test(name, async () => {
      await withServer((_request, response) => {
        response.writeHead(status, status === 302 ? { location: 'https://elsewhere.example.test' } : {});
        response.end();
      }, async (baseUrl) => {
        await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl)), hasCode(status === 302 ? 'ngest_http' : 'ngest_authentication'));
      });
    });
  }
});

test('ngest Distribution rejects malformed pages and a Profile mismatch', async (context) => {
  await context.test('malformed page', async () => {
    await withServer((_request, response) => sendJson(response, { apiVersion: 'v1', items: [] }), async (baseUrl) => {
      await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl)), hasCode('ngest_manifest'));
    });
  });
  await context.test('Profile mismatch', async () => {
    await withServer((_request, response) => sendJson(response, page({ profileKey: 'other-profile' })), async (baseUrl) => {
      await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl)), (error: unknown) => error instanceof VidGenError
        && error.code === 'ngest_manifest' && /configured Profile/.test(error.publicMessage));
    });
  });
});

test('ngest Distribution aggregates ordered pages only from one coherent snapshot', async (context) => {
  await context.test('ordered continuation', async () => {
    const requests: string[] = [];
    await withServer((request, response) => {
      requests.push(request.url ?? '');
      sendJson(response, request.url === '/api/v1/distribution/daily-briefing'
        ? page({ nextCursor: 'second cursor', articleId: 'article-1' })
        : page({ nextCursor: null, articleId: 'article-2' }));
    }, async (baseUrl) => {
      const manifest = await fetchNgestVidGenManifestPage(environment(baseUrl));
      assert.deepEqual(manifest.articles.map((article) => article.articleId), ['article-1', 'article-2']);
      assert.equal(manifest.nextCursor, null);
    });
    assert.deepEqual(requests, ['/api/v1/distribution/daily-briefing', '/api/v1/distribution/daily-briefing?cursor=second+cursor']);
  });
  for (const [name, second] of [
    ['snapshot drift', page({ snapshotRevision: 'changed', nextCursor: null })],
    ['Profile drift', page({ profileKey: 'other-profile', nextCursor: null })],
    ['Publication drift', page({ publication: 'Other News', nextCursor: null })],
    ['repeated cursor', page({ nextCursor: 'again' })],
  ] as const) {
    await context.test(name, async () => {
      let requestCount = 0;
      await withServer((_request, response) => {
        requestCount += 1;
        sendJson(response, requestCount === 1 ? page({ nextCursor: 'again' }) : second);
      }, async (baseUrl) => {
        await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl)), hasCode('ngest_manifest'));
      });
    });
  }
});

test('ngest Distribution bounds each request with a timeout and keeps secrets out of public errors', async (context) => {
  await context.test('timeout', async () => {
    await withServer(() => undefined, async (baseUrl) => {
      const startedAt = Date.now();
      await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl, { NGEST_TIMEOUT_MS: '25' })), hasCode('ngest_timeout'));
      assert.ok(Date.now() - startedAt < 1_000);
    });
  });
  await context.test('error body', async () => {
    await withServer((_request, response) => {
      response.writeHead(503);
      response.end(`untrusted ${bearer}`);
    }, async (baseUrl) => {
      await assert.rejects(fetchNgestVidGenManifestPage(environment(baseUrl)), (error: unknown) => {
        assert.equal(String(error).includes(bearer), false);
        return error instanceof VidGenError && error.code === 'ngest_http';
      });
    });
  });
});

function environment(baseUrl: string, overrides: NgestVidGenEnvironment = {}): NgestVidGenEnvironment {
  return { NGEST_BASE_URL: baseUrl, NGEST_PROFILE_KEY: 'daily-briefing', NGEST_BEARER_TOKEN: bearer, ...overrides };
}
function page(overrides: { readonly profileKey?: string; readonly publication?: string; readonly snapshotRevision?: string; readonly nextCursor?: string | null; readonly articleId?: string } = {}): object {
  return {
    apiVersion: 'v1', generatedAt: '2026-09-06T00:00:00.000Z', snapshotRevision: overrides.snapshotRevision ?? 'snapshot-1',
    profile: { configKey: overrides.profileKey ?? 'daily-briefing', displayName: 'Daily Briefing' }, publication: { name: overrides.publication ?? 'VidGen News' },
    digest: { generatedAt: '2026-09-06T00:00:00.000Z', overview: 'ignored' },
    items: [{
      articleId: overrides.articleId ?? 'article-1', headline: 'A governed headline', originalUrl: 'https://publisher.example.test/a?exact=1',
      effectiveFeedDate: '2026-09-06', feedDateSource: 'published_at', publishedAt: null, author: null, summary: null, imageUrl: null,
      source: { configKey: 'publisher', displayName: 'Publisher' }, categories: [{ configKey: 'news', displayName: 'News' }, { configKey: 'technology', displayName: 'Technology' }],
    }], nextCursor: overrides.nextCursor ?? null,
  };
}
function sendJson(response: ServerResponse, value: object): void { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); }
function hasCode(code: VidGenError['code']): (error: unknown) => boolean { return (error: unknown) => error instanceof VidGenError && error.code === code; }
async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error === undefined ? resolve() : reject(error)));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
}
