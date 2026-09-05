import assert from 'node:assert/strict';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import type { JsonObject } from '../../../src/shared/json.ts';
import {
  DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES,
  GOOGLE_GEMINI_INTERACTIONS_ENDPOINT,
  GoogleGeminiStructuredTextModelClient,
  type FetchImplementation,
  type GoogleGeminiEnvironment,
} from '../../../src/integrations/google/gemini-interactions.ts';

const apiKey = 'gemini-test-key-never-surface';
const storyText = 'story text that must never appear in public errors';
const responseSchema: JsonObject = { type: 'object', properties: { slots: { type: 'array' } } };

test('Google Gemini adapter sends one current stateless Interactions structured-output request', async () => {
  let called = 0;
  let requestUrl: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  const client = clientFor(async (input, requestInit) => {
    called += 1;
    requestUrl = input;
    init = requestInit;
    return jsonResponse(completedInteraction());
  });

  const result = await client.generateStructuredJson({
    systemInstruction: 'Follow the supplied schema.',
    input: storyText,
    responseSchema,
  });

  assert.equal(called, 1);
  assert.equal(String(requestUrl), GOOGLE_GEMINI_INTERACTIONS_ENDPOINT);
  assert.equal(init?.method, 'POST');
  assert.equal(init?.redirect, 'error');
  assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
  assert.equal(new Headers(init?.headers).get('x-goog-api-key'), apiKey);
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    model: 'gemini-test-model',
    store: false,
    system_instruction: 'Follow the supplied schema.',
    input: storyText,
    response_format: [{
      type: 'text',
      mime_type: 'application/json',
      schema: responseSchema,
    }],
  });
  for (const prohibited of [
    'previous_interaction_id', 'tools', 'background', 'agent', 'agent_config', 'web_search', 'stream',
  ]) {
    assert.equal(Object.hasOwn(body, prohibited), false, `${prohibited} must not be sent`);
  }
  assert.deepEqual(result, {
    provider: 'google-gemini',
    model: 'gemini-provider-model',
    requestId: 'interaction-123',
    outputText: '{"slots":[]}',
  });
});

test('Google Gemini adapter returns configured model and safely joins consecutive text blocks', async () => {
  const client = clientFor(async () => jsonResponse({
    status: 'completed',
    steps: [{
      type: 'model_output',
      content: [
        { type: 'text', text: '{"slots":' },
        { type: 'text', text: '[]}' },
      ],
    }],
  }));

  const result = await client.generateStructuredJson(validRequest());
  assert.deepEqual(result, {
    provider: 'google-gemini',
    model: 'gemini-test-model',
    outputText: '{"slots":[]}',
  });
});

test('missing Google Gemini key or model fails before fetch activity', () => {
  let calls = 0;
  const fakeFetch: FetchImplementation = async () => {
    calls += 1;
    return jsonResponse(completedInteraction());
  };

  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { VIDGEN_TEXT_MODEL: 'gemini-test-model' }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: apiKey }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: '  ', VIDGEN_TEXT_MODEL: 'gemini-test-model' }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
  assert.throws(
    () => new GoogleGeminiStructuredTextModelClient({
      environment: { GEMINI_API_KEY: apiKey, VIDGEN_TEXT_MODEL: '  ' }, fetch: fakeFetch,
    }),
    hasCode('configuration'),
  );
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

test('Google Gemini adapter rejects oversized bodies and malformed/non-text completed interactions', async (context) => {
  await context.test('oversized body', async () => {
    const client = clientFor(async () => new Response('x'.repeat(DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES + 1)));
    await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
  });

  for (const [name, payload] of [
    ['missing model output', { status: 'completed', steps: [] }],
    ['non-text model output', { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'function_call', name: 'unsafe' }] }] }],
    ['blank model output', { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '  ' }] }] }],
  ]) {
    await context.test(name, async () => {
      const client = clientFor(async () => jsonResponse(payload));
      await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
    });
  }
});

test('Google Gemini adapter never accepts incomplete, failed, or action-required interactions', async (context) => {
  for (const status of ['requires_action', 'incomplete', 'failed'] as const) {
    await context.test(status, async () => {
      const client = clientFor(async () => jsonResponse({
        status,
        steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"slots":[]}' }] }],
      }));
      await assert.rejects(client.generateStructuredJson(validRequest()), hasCode('text_model'));
    });
  }
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
    VIDGEN_TEXT_MODEL: 'gemini-test-model',
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

function completedInteraction(): object {
  return {
    id: 'interaction-123',
    model: 'gemini-provider-model',
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"slots":[]}' }] }],
  };
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
