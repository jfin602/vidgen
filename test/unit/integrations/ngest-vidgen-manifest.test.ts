import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import {
  DEFAULT_NGEST_VIDGEN_TIMEOUT_MS,
  fetchNgestVidGenManifestPage,
  loadNgestVidGenRuntimeConfig,
  type NgestVidGenEnvironment,
} from '../../../src/integrations/ngest/vidgen-manifest.ts';

const fakeBearerToken = 'vidgen-test-secret-never-surface';

test('ngest ingress sends its bearer credential and returns a typed complete page', async () => {
  let authorization: string | undefined;
  let accept: string | undefined;
  await withServer((request, response) => {
    authorization = request.headers.authorization;
    accept = request.headers.accept;
    sendJson(response, validManifest());
  }, async (endpoint) => {
    const page = await fetchNgestVidGenManifestPage(environmentFor(endpoint));

    assert.equal(page.apiVersion, '2026-09-01');
    assert.deepEqual(page.articles, [{ id: 'article-1' }]);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(page.snapshotRevision, { revision: 7 });
  });

  assert.equal(authorization, `Bearer ${fakeBearerToken}`);
  assert.match(accept ?? '', /application\/json/);
});

test('missing ngest configuration fails before any network request', async () => {
  let requests = 0;
  await withServer((_request, response) => {
    requests += 1;
    sendJson(response, validManifest());
  }, async () => {
    await assert.rejects(
      fetchNgestVidGenManifestPage({}),
      hasCode('configuration'),
    );
  });

  assert.equal(requests, 0);
});

test('ngest configuration permits loopback HTTP and rejects non-loopback HTTP', () => {
  const loopback = loadNgestVidGenRuntimeConfig(environmentFor('http://127.0.0.1:8090/manifest'));
  assert.equal(loopback.endpoint.protocol, 'http:');
  assert.equal(loopback.timeoutMs, DEFAULT_NGEST_VIDGEN_TIMEOUT_MS);
  assert.equal(
    loadNgestVidGenRuntimeConfig(environmentFor('https://ngest.example.test/manifest', {
      NGEST_VIDGEN_TIMEOUT_MS: '25',
    })).timeoutMs,
    25,
  );

  assert.throws(
    () => loadNgestVidGenRuntimeConfig(environmentFor('http://ngest.example.test/manifest')),
    hasCode('configuration'),
  );
  assert.throws(
    () => loadNgestVidGenRuntimeConfig(environmentFor('https://ngest.example.test/manifest', {
      NGEST_VIDGEN_TIMEOUT_MS: '0',
    })),
    hasCode('configuration'),
  );
});

test('ngest ingress classifies 401 and 403 as authentication failures', async (context) => {
  for (const status of [401, 403]) {
    await context.test(`HTTP ${status}`, async () => {
      await withServer((_request, response) => {
        response.writeHead(status);
        response.end('untrusted response body');
      }, async (endpoint) => {
        await assert.rejects(
          fetchNgestVidGenManifestPage(environmentFor(endpoint)),
          hasCode('ngest_authentication'),
        );
      });
    });
  }
});

test('ngest ingress classifies 5xx responses and redirects as HTTP failures without exposing bodies', async () => {
  await withServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://elsewhere.example.test/manifest' });
      response.end();
      return;
    }

    response.writeHead(503);
    response.end('untrusted response body');
  }, async (endpoint) => {
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(endpoint)),
      hasCode('ngest_http'),
    );
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(`${endpoint}/redirect`)),
      hasCode('ngest_http'),
    );
  });
});

test('ngest ingress rejects invalid JSON and malformed transport envelopes', async (context) => {
  await context.test('invalid JSON', async () => {
    await withServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{not JSON');
    }, async (endpoint) => {
      await assert.rejects(
        fetchNgestVidGenManifestPage(environmentFor(endpoint)),
        hasCode('ngest_invalid_json'),
      );
    });
  });

  await context.test('malformed envelope', async () => {
    await withServer((_request, response) => {
      sendJson(response, { apiVersion: '2026-09-01', articles: [] });
    }, async (endpoint) => {
      await assert.rejects(
        fetchNgestVidGenManifestPage(environmentFor(endpoint)),
        hasCode('ngest_manifest'),
      );
    });
  });
});

test('ngest ingress fails closed rather than returning a partial page with nextCursor', async () => {
  await withServer((_request, response) => {
    sendJson(response, validManifest('next-page-token'));
  }, async (endpoint) => {
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(endpoint)),
      (error: unknown) => error instanceof VidGenError
        && error.code === 'ngest_unsupported_continuation'
        && error.publicMessage === 'Ngest VidGen manifest continuation is not supported.',
    );
  });
});

test('ngest ingress classifies socket failures as transport failures', async () => {
  await withServer((request) => {
    request.socket.destroy();
  }, async (endpoint) => {
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(endpoint)),
      hasCode('transport'),
    );
  });
});

test('ngest ingress bounds requests with AbortSignal timeout', async () => {
  await withServer(() => {
    // Deliberately leave the response open until the client's signal aborts.
  }, async (endpoint) => {
    const startedAt = Date.now();
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(endpoint, { NGEST_VIDGEN_TIMEOUT_MS: '25' })),
      hasCode('ngest_timeout'),
    );
    assert.ok(Date.now() - startedAt < 1_000, 'request should be aborted promptly');
  });
});

test('ngest ingress never surfaces its bearer token in public errors', async () => {
  await withServer((_request, response) => {
    response.writeHead(503);
    response.end(`response body containing ${fakeBearerToken}`);
  }, async (endpoint) => {
    await assert.rejects(
      fetchNgestVidGenManifestPage(environmentFor(endpoint)),
      (error: unknown) => {
        const surfaced = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        assert.equal(surfaced.includes(fakeBearerToken), false);
        return error instanceof VidGenError && error.code === 'ngest_http';
      },
    );
  });
});

function environmentFor(
  endpoint: string,
  overrides: NgestVidGenEnvironment = {},
): NgestVidGenEnvironment {
  return {
    NGEST_VIDGEN_URL: endpoint,
    NGEST_VIDGEN_BEARER_TOKEN: fakeBearerToken,
    ...overrides,
  };
}

function validManifest(nextCursor: string | null = null): object {
  return {
    apiVersion: '2026-09-01',
    snapshotRevision: { revision: 7 },
    profile: { id: 'profile-1' },
    publication: { id: 'publication-1' },
    articles: [{ id: 'article-1' }],
    control: { version: '1' },
    nextCursor,
  };
}

function sendJson(response: ServerResponse, value: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function hasCode(code: VidGenError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VidGenError && error.code === code;
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (endpoint: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await listen(server);

  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    await run(`http://127.0.0.1:${(address as AddressInfo).port}`);
  } finally {
    await close(server);
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
