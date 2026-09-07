import assert from 'node:assert/strict';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import type { JsonObject } from '../../../src/shared/json.ts';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES,
  buildGoogleGeminiAgentPlatformEndpoint,
  GoogleGeminiStructuredTextModelClient,
  type FetchImplementation,
  type GoogleGeminiEnvironment,
} from '../../../src/integrations/google/gemini-agent-platform.ts';

const apiKey = 'gemini-test-key-never-surface';
const storyText = 'story text that must never appear in public errors';
const responseSchema: JsonObject = { type: 'object', properties: { slots: { type: 'array' } } };

const project = 'vidgen-test-project';
const model = 'gemini-test-model';
const endpoint = buildGoogleGeminiAgentPlatformEndpoint(project, model);

test('Google Gemini adapter sends one project/global Agent Platform structured-output request', async () => {
  let called = 0;
  let requestUrl: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  const client = clientFor(async (input, requestInit) => {
    called += 1;
    requestUrl = input;
    init = requestInit;
    return jsonResponse(completedGenerateContentResponse());
  });

  const result = await client.generateStructuredJson({
    systemInstruction: 'Follow the supplied schema.',
    input: storyText,
    responseSchema,
  });

  assert.equal(called, 1);
  assert.equal(endpoint, 'https://aiplatform.googleapis.com/v1/projects/vidgen-test-project/locations/global/publishers/google/models/gemini-test-model:generateContent');
  assert.equal(String(requestUrl), endpoint);
  assert.equal(init?.method, 'POST');
  assert.equal(init?.redirect, 'error');
  assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(init?.headers).get('x-goog-api-key'), apiKey);
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    systemInstruction: { parts: [{ text: 'Follow the supplied schema.' }] },
    contents: [{ role: 'user', parts: [{ text: storyText }] }],
    generationConfig: {
      candidateCount: 1,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });
  for (const prohibited of [
    'model', 'store', 'input', 'response_format', 'tools', 'stream',
  ]) {
    assert.equal(Object.hasOwn(body, prohibited), false, `${prohibited} must not be sent`);
  }
  assert.deepEqual(result, {
    provider: 'google-agent-platform',
    model: 'gemini-provider-model',
    requestId: 'response-123',
    outputText: '{"slots":[]}',
  });
});

test('Google Gemini adapter returns neutral provenance and ignores provider-only part metadata', async () => {
  const client = clientFor(async () => jsonResponse({
    candidates: [{ content: { parts: [{ text: '{"slots":[]}', thoughtSignature: 'do-not-persist' }] } }],
    responseId: 'response-123',
    modelVersion: 'gemini-provider-model',
    usageMetadata: { promptTokenCount: 99 },
  }));

  const result = await client.generateStructuredJson(validRequest());
  assert.deepEqual(result, {
    provider: 'google-agent-platform',
    model: 'gemini-provider-model',
    requestId: 'response-123',
    outputText: '{"slots":[]}',
  });
});

test('missing, blank, or unsafe Agent Platform project, key, or model fails before fetch activity', () => {
  let calls = 0;
  const fakeFetch: FetchImplementation = async () => {
    calls += 1;
    return jsonResponse(completedGenerateContentResponse());
  };

  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TEXT_MODEL: model }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: apiKey, GOOGLE_CLOUD_PROJECT: project }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: apiKey, VIDGEN_TEXT_MODEL: model }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: '  ', GOOGLE_CLOUD_PROJECT: project, VIDGEN_TEXT_MODEL: model }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: apiKey, GOOGLE_CLOUD_PROJECT: project, VIDGEN_TEXT_MODEL: '  ' }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  for (const environment of [
    { GEMINI_API_KEY: apiKey, GOOGLE_CLOUD_PROJECT: '  ', VIDGEN_TEXT_MODEL: model },
    { GEMINI_API_KEY: apiKey, GOOGLE_CLOUD_PROJECT: 'bad/project', VIDGEN_TEXT_MODEL: model },
    { GEMINI_API_KEY: 'bad key', GOOGLE_CLOUD_PROJECT: project, VIDGEN_TEXT_MODEL: model },
    { GEMINI_API_KEY: apiKey, GOOGLE_CLOUD_PROJECT: project, VIDGEN_TEXT_MODEL: '../unsafe-model' },
  ]) {
    assert.throws(() => new GoogleGeminiStructuredTextModelClient({ environment, fetch: fakeFetch }), hasCode('configuration'));
  }
  assert.equal(calls, 0);
});

test('Google Gemini adapter aborts a timed out injected fetch', async () => {
  let aborted = false;
  const client = clientFor(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    assert.ok(init?.signal !== null && init?.signal !== undefined);
    init.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  }), { timeoutMs: 10 });

  await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
  assert.equal(aborted, true);
});

test('Google Gemini adapter fails safely for redirects, HTTP failures, and invalid JSON', async (context) => {
  const cases: readonly [string, FetchImplementation][] = [
    ['redirect', async () => new Response('', { status: 302, headers: { location: 'https://unexpected.example' } })],
    ['HTTP failure', async () => new Response(`provider response ${storyText} ${apiKey}`, { status: 503 })],
    ['invalid JSON', async () => new Response(`{${storyText}`, { status: 200 })],
  ];

  for (const [name, fakeFetch] of cases) {
    await context.test(name, async () => {
      const client = clientFor(fakeFetch);
      await assert.rejects(client.generateStructuredJson(validRequest()), (error: unknown) => {
        assertPublicErrorIsSafe(error);
        return error instanceof VidGenError && error.code === 'text_model';
      });
    });
  }
});

test('Google Gemini adapter rejects blocked, missing, empty, multi, ambiguous, malformed, and oversized responses', async (context) => {
  await context.test('oversized body', async () => {
    const client = clientFor(async () => new Response('x'.repeat(DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES + 1)));
    await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
  });

  for (const [name, payload] of [
    ['blocked', { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{"slots":[]}' }] } }] }],
    ['missing model output', { candidates: [] }],
    ['empty model output', { candidates: [{ content: { parts: [{ text: '  ' }] } }] }],
    ['multiple candidates', { candidates: [candidate(), candidate()] }],
    ['ambiguous content', { candidates: [{ content: { parts: [{ text: '{"slots":' }, { text: '[]}' }] } }] }],
    ['malformed model output', { candidates: [{ content: { parts: [{ inlineData: { data: 'unsafe' } }] } }] }],
  ]) {
    await context.test(name, async () => {
      const client = clientFor(async () => jsonResponse(payload));
      await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
    });
  }
});

test('active structured-text adapter contains no legacy Gemini Developer endpoint', () => {
  const source = readFileSync('src/integrations/google/gemini-agent-platform.ts', 'utf8');
  assert.equal(source.includes('generativelanguage.googleapis.com'), false);
});

function clientFor(
  fetch: FetchImplementation,
  options: { readonly timeoutMs?: number } = {},
): GoogleGeminiStructuredTextModelClient {
  return new GoogleGeminiStructuredTextModelClient({
    environment: environment(),
    fetch,
    ...options,
  });
}

function environment(overrides: GoogleGeminiEnvironment = {}): GoogleGeminiEnvironment {
  return {
    GEMINI_API_KEY: apiKey,
    GOOGLE_CLOUD_PROJECT: project,
    VIDGEN_TEXT_MODEL: model,
    ...overrides,
  };
}

function validRequest() {
  return {
    systemInstruction: 'Follow the supplied schema.',
    input: storyText,
    responseSchema,
  };
}

function completedGenerateContentResponse(): object {
  return {
    responseId: 'response-123',
    modelVersion: 'gemini-provider-model',
    candidates: [candidate()],
  };
}

function candidate() {
  return { content: { parts: [{ text: '{"slots":[]}' }] } };
}

function jsonResponse(payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function hasCode(code: VidGenError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VidGenError && error.code === code;
}

function assertPublicErrorIsSafe(error: unknown): void {
  const publicValue = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  assert.equal(publicValue.includes(apiKey), false);
  assert.equal(publicValue.includes(storyText), false);
}
