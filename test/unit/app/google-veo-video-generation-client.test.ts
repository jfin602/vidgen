import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApprovedReferenceImage, GeneratedMediaUnit } from '../../../src/core/generated-media.ts';
import { VidGenError } from '../../../src/core/error.ts';
import {
  GOOGLE_VEO_API_BASE,
  GoogleVeoVideoGenerationClient,
  partitionPresenterSpeech,
  type FetchImplementation,
  type GoogleVeoEnvironment,
  type GoogleVeoVideoGenerationClientOptions,
} from '../../../src/integrations/google/veo-video-generation.ts';

const apiKey = 'veo-test-key-never-surface';
const storyText = 'A city council approved the pilot program after a public meeting.';
const imageBase64 = Buffer.from([3, 4, 5]).toString('base64');
const generatedVideoUri = 'https://generativelanguage.googleapis.com/download/v1beta/files/video-1';

test('Google Veo starts, polls, and immediately downloads one bounded content result', async () => {
  const calls: FetchCall[] = [];
  const client = clientFor(sequenceFetch(calls, [
    operation('operations/initial', false),
    completedOperation('operations/initial'),
    videoResponse([1, 2, 3]),
  ]));

  const result = await client.generateVideo({ unit: contentUnit(8) });

  assert.deepEqual(result, {
    provider: 'google-veo', model: 'veo-test-model', requestId: 'operations/initial', operationId: 'operations/initial',
    operationIds: ['operations/initial'], generationOperationCount: 1,
    mimeType: 'video/mp4', bytes: videoBytes([1, 2, 3]), durationSeconds: 8,
  });
  assert.equal(String(calls[0]!.url), `${GOOGLE_VEO_API_BASE}/models/veo-test-model:predictLongRunning`);
  assert.equal(String(calls[1]!.url), `${GOOGLE_VEO_API_BASE}/operations/initial`);
  assert.equal(String(calls[2]!.url), generatedVideoUri);
  const body = parseBody(calls[0]!);
  assert.deepEqual(body.parameters, { aspectRatio: '9:16', durationSeconds: '8', numberOfVideos: 1, resolution: '720p' });
  assert.equal((body.instances as Array<Record<string, unknown>>)[0]!.prompt?.toString().includes(storyText), true);
  assert.equal(JSON.stringify(body).includes('referenceImages'), false);
  assert.equal(new Headers(calls[2]!.init.headers).get('x-goog-api-key'), apiKey);
});

test('Google Veo presenter sends only supplied reference images and assigned exact dialogue', async () => {
  const calls: FetchCall[] = [];
  const image: ApprovedReferenceImage = { mimeType: 'image/png', bytes: new Uint8Array([3, 4, 5]), sha256: 'a'.repeat(64) };
  const client = clientFor(sequenceFetch(calls, [operation('operations/presenter', true, generatedVideoUri), videoResponse([9])])) ;

  await client.generateVideo({ unit: presenterUnit(5, 'Speak this exact line.'), referenceImages: [image, image] });

  const instance = (parseBody(calls[0]!).instances as Array<Record<string, unknown>>)[0]!;
  assert.match(String(instance.prompt), /speak only this exact assigned dialogue: "Speak this exact line\."/i);
  const references = instance.referenceImages as Array<Record<string, unknown>>;
  assert.equal(references.length, 2);
  assert.equal(JSON.stringify(references).includes(imageBase64), true);
  assert.equal(JSON.stringify(references).includes('http'), false);
});

test('Google Veo presenter rejects missing, excessive, or unsupported references before network', async (context) => {
  for (const images of [undefined, [], Array.from({ length: 4 }, () => image()), [{ ...image(), mimeType: 'image/gif' }]] as const) {
    await context.test(String(images?.length ?? 0), async () => {
      let calls = 0;
      const client = clientFor(async () => { calls += 1; return videoResponse([1]); });
      await assert.rejects(client.generateVideo({ unit: presenterUnit(5), ...(images === undefined ? {} : { referenceImages: images }) }), hasGeneratedMediaCode);
      assert.equal(calls, 0);
    });
  }
});

test('Google Veo performs each bounded extension with the just-downloaded prior video', async () => {
  const calls: FetchCall[] = [];
  const client = clientFor(sequenceFetch(calls, [
    operation('operations/initial', true, generatedVideoUri), videoResponse([8, 8]),
    operation('operations/extension', true, `${generatedVideoUri}-extended`), videoResponse([9, 9, 9]),
  ]), { extensionEnabled: true });

  const result = await client.generateVideo({ unit: contentUnit(9) });

  assert.deepEqual(result.operationIds, ['operations/initial', 'operations/extension']);
  assert.equal(result.generationOperationCount, 2);
  assert.equal(result.durationSeconds, 15);
  const extension = parseBody(calls[2]!);
  assert.equal(JSON.stringify(extension).includes(Buffer.from(videoBytes([8, 8])).toString('base64')), true);
  assert.match(String((extension.instances as Array<Record<string, unknown>>)[0]!.prompt), /Continue the same supplied visual treatment/);
  assert.equal(String((extension.instances as Array<Record<string, unknown>>)[0]!.prompt).includes('invented second story'), false);
});

test('Google Veo fails before network when required extension is not enabled for the configured model', async () => {
  let calls = 0;
  const client = clientFor(async () => { calls += 1; return videoResponse([1]); });
  await assert.rejects(client.generateVideo({ unit: contentUnit(9) }), (error: unknown) =>
    error instanceof VidGenError && error.publicMessage.includes('extension is required'),
  );
  assert.equal(calls, 0);
});

test('Google Veo assigns partitioned presenter dialogue across extension operations without rewriting it', async () => {
  const calls: FetchCall[] = [];
  const spokenText = 'First statement is precise. Second statement remains precise. Third statement is also precise.';
  const client = clientFor(sequenceFetch(calls, [
    operation('operations/presenter-initial', true), videoResponse([1]),
    operation('operations/presenter-extension', true, `${generatedVideoUri}-presenter-extension`), videoResponse([2]),
  ]), { extensionEnabled: true });

  await client.generateVideo({ unit: presenterUnit(9, spokenText), referenceImages: [image()] });

  const initialPrompt = String((parseBody(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt);
  const extensionPrompt = String((parseBody(calls[2]!).instances as Array<Record<string, unknown>>)[0]!.prompt);
  const dialogue = [initialPrompt, extensionPrompt].map((prompt) => {
    const match = /assigned dialogue: "([\s\S]*?)"\. Do not add dialogue\./.exec(prompt);
    assert.notEqual(match, null);
    return match![1]!;
  });
  assert.equal(dialogue.join(' '), spokenText.replace(/\s+/g, ' ').trim());
  assert.match(extensionPrompt, /same presenter, appearance, setting, and scene continuity/);
});

test('presenter dialogue chunks reconstruct exactly after whitespace normalization', () => {
  const spokenText = 'First sentence, with punctuation.\n\nSecond sentence stays exact! Third?';
  const chunks = partitionPresenterSpeech(spokenText, 3);
  assert.deepEqual(chunks.join(' '), spokenText.replace(/\s+/g, ' ').trim());
  assert.equal(chunks.some((chunk) => /[^\s]/.test(chunk)), true);
  assert.equal(chunks.every((chunk) => !chunk.includes('\n')), true);
});

test('Google Veo enforces timeout and fails safely for provider/download failures', async (context) => {
  const cases: readonly [string, FetchImplementation, ClientOptions | undefined][] = [
    ['HTTP failure', async () => new Response(`${apiKey} ${storyText}`, { status: 503 }), undefined],
    ['malformed JSON', async () => new Response('{bad'), undefined],
    ['failed operation', sequenceFetch([], [operation('operations/fail', true, undefined, true)]), undefined],
    ['missing video', sequenceFetch([], [operation('operations/missing', true)]), undefined],
    ['oversized operation', async () => new Response('12345'), { maxPollResponseBytes: 4 }],
    ['oversized video', sequenceFetch([], [operation('operations/large', true), videoResponse([1, 2, 3, 4, 5])]), { maxDownloadBytes: 4 }],
    ['invalid video body', sequenceFetch([], [operation('operations/body', true), new Response('not a video', { status: 200, headers: { 'content-type': 'video/mp4' } })]), undefined],
    ['unsafe download URI', sequenceFetch([], [operation('operations/unsafe', true, 'https://evil.example/video')]), undefined],
    ['unsafe redirect', sequenceFetch([], [operation('operations/redirect', true), new Response(null, { status: 302, headers: { location: 'https://evil.example/video' } })]), undefined],
  ];
  for (const [name, fakeFetch, options] of cases) {
    await context.test(name, async () => {
      const client = clientFor(fakeFetch, options);
      await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeGeneratedMediaError);
    });
  }

  await context.test('total polling timeout', async () => {
    let clock = 0;
    const client = clientFor(sequenceFetch([], [operation('operations/wait', false)]), {
      totalTimeoutMs: 10, pollIntervalMs: 1, now: () => clock, sleep: async () => { clock = 10; },
    });
    await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeGeneratedMediaError);
  });
});

test('Google Veo never forwards a credential to a non-Google download host', async () => {
  const calls: FetchCall[] = [];
  const client = clientFor(sequenceFetch(calls, [operation('operations/unsafe', true, 'https://evil.example/video')]));
  await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeGeneratedMediaError);
  assert.equal(calls.every((call) => String(call.url).includes('googleapis.com')), true);
  assert.equal(calls.every((call) => new Headers(call.init.headers).get('x-goog-api-key') === apiKey), true);
});

test('missing, blank, and path-shaped video runtime configuration fail before fetch', () => {
  let calls = 0;
  const fakeFetch: FetchImplementation = async () => { calls += 1; return videoResponse([1]); };
  for (const environment of [
    { VIDGEN_VIDEO_MODEL: 'veo-test-model' },
    { GEMINI_API_KEY: apiKey },
    { GEMINI_API_KEY: ' ', VIDGEN_VIDEO_MODEL: 'veo-test-model' },
    { GEMINI_API_KEY: apiKey, VIDGEN_VIDEO_MODEL: '../unsafe' },
    { GEMINI_API_KEY: apiKey, VIDGEN_VIDEO_MODEL: 'veo/model?key=x' },
  ]) {
    assert.throws(() => new GoogleVeoVideoGenerationClient({ environment, fetch: fakeFetch }), hasConfigurationCode);
  }
  assert.equal(calls, 0);
});

interface FetchCall { readonly url: string | URL | Request; readonly init: RequestInit; }

function clientFor(
  fakeFetch: FetchImplementation,
  options: ClientOptions = {},
  environmentOverrides: GoogleVeoEnvironment = {},
): GoogleVeoVideoGenerationClient {
  return new GoogleVeoVideoGenerationClient({
    environment: { GEMINI_API_KEY: apiKey, VIDGEN_VIDEO_MODEL: 'veo-test-model', ...environmentOverrides },
    fetch: fakeFetch,
    pollIntervalMs: 1,
    sleep: async () => {},
    ...options,
  });
}

type ClientOptions = Omit<GoogleVeoVideoGenerationClientOptions, 'environment' | 'fetch'>;

function sequenceFetch(calls: FetchCall[], responses: Response[]): FetchImplementation {
  return async (url, init = {}) => {
    calls.push({ url, init });
    const response = responses.shift();
    if (response === undefined) {
      throw new Error('unexpected fetch');
    }
    return response;
  };
}

function operation(name: string, done: boolean, uri: string | undefined = generatedVideoUri, failed = false): Response {
  const payload: Record<string, unknown> = { name, done };
  if (failed) {
    payload.error = { message: `${apiKey} ${storyText}` };
  } else if (done && uri !== undefined) {
    payload.response = { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } };
  }
  return jsonResponse(payload);
}

function completedOperation(name: string): Response {
  return operation(name, true);
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

function videoResponse(bytes: number[]): Response {
  return new Response(videoBytes(bytes), { status: 200, headers: { 'content-type': 'video/mp4' } });
}

function videoBytes(bytes: number[]): Uint8Array {
  return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, ...bytes]);
}

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function contentUnit(targetDurationSeconds: number): GeneratedMediaUnit {
  return {
    unitId: 'u02', segment: { id: 'content', startSeconds: 5, endSeconds: 5 + targetDurationSeconds },
    role: { id: 'content-video', kind: 'video' }, targetDurationSeconds,
    content: [{ slotId: 'narration', usage: 'spoken', text: storyText }], spokenText: storyText,
  };
}

function presenterUnit(targetDurationSeconds: number, spokenText = storyText): GeneratedMediaUnit {
  return {
    unitId: 'u01', segment: { id: 'hook', startSeconds: 0, endSeconds: targetDurationSeconds },
    role: { id: 'opening-anchor', kind: 'presenter' }, targetDurationSeconds,
    content: [{ slotId: 'hook', usage: 'spoken', text: spokenText }, { slotId: 'headline', usage: 'display', text: 'A display-only headline' }],
    spokenText,
  };
}

function image(): ApprovedReferenceImage {
  return { mimeType: 'image/png', bytes: new Uint8Array([3, 4, 5]), sha256: 'b'.repeat(64) };
}

function hasGeneratedMediaCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'generated_media';
}

function hasConfigurationCode(error: unknown): boolean {
  return error instanceof VidGenError && error.code === 'configuration';
}

function safeGeneratedMediaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  assert.equal(message.includes(apiKey), false);
  assert.equal(message.includes(storyText), false);
  assert.equal(message.includes(imageBase64), false);
  return hasGeneratedMediaCode(error);
}
