import assert from 'node:assert/strict';
import test from 'node:test';

import { createApprovedReferenceImage, type GeneratedMediaUnit } from '../../../src/core/generated-media.ts';
import { planPresenterVideoDuration } from '../../../src/core/presenter-video.ts';
import { VidGenError } from '../../../src/core/error.ts';
import {
  GOOGLE_CLOUD_LOCATION_ENV,
  GOOGLE_CLOUD_PROJECT_ENV,
  VIDGEN_VERTEX_VIDEO_MODEL_ENV,
  VERTEX_VEO_API_BASE,
  VertexVeoVideoGenerationClient,
  type FetchImplementation,
  type VertexVeoEnvironment,
  type VertexVeoVideoGenerationClientOptions,
} from '../../../src/integrations/google/vertex-veo-video-generation.ts';

const project = 'vidgen-test-project';
const model = 'veo-3.1-generate-001';
const token = 'vertex-test-token-never-surface';
const storyText = 'A city council approved the pilot program after a public meeting.';
const image = createApprovedReferenceImage('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3]));

test('Vertex Veo uses injected ADC bearer auth and documented regional inline request/result shapes', async () => {
  const calls: FetchCall[] = []; let authCalls = 0;
  const client = clientFor(sequenceFetch(calls, [operation('one', true, videoBytes([1]))]), { getAccessToken: async () => { authCalls += 1; return token; } });
  const result = await client.generateVideo({ unit: contentUnit(8) });
  assert.deepEqual(result, { provider: 'vertex-veo', model, requestId: operationName('one'), operationId: operationName('one'), operationIds: [operationName('one')], generationOperationCount: 1, mimeType: 'video/mp4', bytes: videoBytes([1]), durationSeconds: 8 });
  assert.equal(authCalls, 1);
  assert.equal(String(calls[0]!.url), `${VERTEX_VEO_API_BASE}/projects/${project}/locations/us-central1/publishers/google/models/${model}:predictLongRunning`);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`); assert.equal(headers.get('x-goog-api-key'), null);
  assert.deepEqual(body(calls[0]!).parameters, { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', sampleCount: 1 });
  assert.equal(JSON.stringify(body(calls[0]!)).includes('storageUri'), false);
});

test('Vertex Veo sends one to three PNG/JPEG asset references exactly and rejects WebP before ADC/network', async () => {
  const calls: FetchCall[] = [];
  const jpeg = createApprovedReferenceImage('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 4]));
  const client = clientFor(sequenceFetch(calls, [operation('refs', true, videoBytes([2]))]));
  await client.generateVideo({ unit: presenterUnit(8), referenceImages: [image, jpeg] });
  const references = (body(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.referenceImages as Array<Record<string, unknown>>;
  assert.deepEqual(references, [
    { image: { bytesBase64Encoded: Buffer.from(image.bytes).toString('base64'), mimeType: 'image/png' }, referenceType: 'asset' },
    { image: { bytesBase64Encoded: Buffer.from(jpeg.bytes).toString('base64'), mimeType: 'image/jpeg' }, referenceType: 'asset' },
  ]);
  let authCalls = 0; let fetchCalls = 0;
  const webp = createApprovedReferenceImage('image/webp', new Uint8Array([1]));
  const rejecting = clientFor(async () => { fetchCalls += 1; return operation('bad', true, videoBytes([1])); }, { getAccessToken: async () => { authCalls += 1; return token; } });
  await assert.rejects(rejecting.generateVideo({ unit: presenterUnit(8), referenceImages: [webp] }), safeError);
  assert.equal(authCalls, 0); assert.equal(fetchCalls, 0);
});

test('Vertex Veo polls the exact returned full operation name with fetchPredictOperation', async () => {
  const calls: FetchCall[] = []; const name = operationName('poll-id');
  const client = clientFor(sequenceFetch(calls, [operation('poll-id', false), operation('poll-id', true, videoBytes([3]))]));
  await client.generateVideo({ unit: contentUnit(8) });
  assert.equal(String(calls[1]!.url), `${VERTEX_VEO_API_BASE}/projects/${project}/locations/us-central1/publishers/google/models/${model}:fetchPredictOperation`);
  assert.deepEqual(body(calls[1]!), { operationName: name });
});

test('Vertex Veo decodes only one bounded valid inline MP4 result', async (context) => {
  const cases: readonly [string, unknown, ClientOptions?][] = [
    ['malformed', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: '%%%=' }] } }, undefined],
    ['filtered', { response: { raiMediaFilteredCount: 1, videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }] } }, undefined],
    ['empty', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: '' }] } }, undefined],
    ['wrong MIME', { response: { videos: [{ mimeType: 'video/webm', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }] } }, undefined],
    ['bad signature', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64') }] } }, undefined],
    ['multiple', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }, { mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([2])).toString('base64') }] } }, undefined],
    ['oversized', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1, 2, 3])).toString('base64') }] } }, { maxVideoBytes: 8 }],
  ];
  for (const [name, response, options] of cases) await context.test(name, async () => {
    const client = clientFor(sequenceFetch([], [json({ name: operationName('invalid'), done: true, ...response })]), options);
    await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeError);
  });
});

test('Vertex Veo preserves simple retained-window speech timing and uses exactly one extension from 9 through 15 seconds', async (context) => {
  for (let seconds = 4; seconds <= 15; seconds += 1) await context.test(`${seconds} seconds`, async () => {
    const words = Array.from({ length: Math.floor((seconds * 150) / 60) }, (_, index) => `word${index + 1}`).join(' ');
    const calls: FetchCall[] = []; const responses = seconds <= 8
      ? [operation(`simple-${seconds}`, true, videoBytes([1]))]
      : [operation(`simple-${seconds}-initial`, true, videoBytes([1])), operation(`simple-${seconds}-extension`, true, videoBytes([2]))];
    const result = await clientFor(sequenceFetch(calls, responses)).generatePresenterVideo({ spokenText: words, referenceImages: [image], maxSeconds: seconds });
    assert.equal(result.generationOperationCount, seconds <= 8 ? 1 : 2);
    assert.deepEqual(result.durationPlan, planPresenterVideoDuration(seconds));
    if (seconds > 8) {
      assert.equal(JSON.stringify(body(calls[1]!)).includes(Buffer.from(videoBytes([1])).toString('base64')), true);
      const prompts = calls.map((call) => String((body(call).instances as Array<Record<string, unknown>>)[0]!.prompt));
      const dialogue = prompts.map(assignedDialogue).join(' '); assert.equal(dialogue, words);
      assert.match(prompts[1]!, new RegExp(`first ${seconds - 8} seconds`));
    }
  });
});

test('Vertex Veo preserves cinematic extension provenance and safely rejects auth, HTTP, malformed operation, and provider failures', async (context) => {
  await context.test('extension provenance', async () => {
    const calls: FetchCall[] = [];
    const result = await clientFor(sequenceFetch(calls, [operation('initial', true, videoBytes([7])), operation('extension', true, videoBytes([8]))])).generateVideo({ unit: contentUnit(9) });
    assert.deepEqual(result.operationIds, [operationName('initial'), operationName('extension')]); assert.equal(result.durationSeconds, 15);
    assert.equal(JSON.stringify(body(calls[1]!)).includes(Buffer.from(videoBytes([7])).toString('base64')), true);
  });
  const cases: readonly [string, FetchImplementation, ClientOptions?][] = [
    ['auth', async () => operation('never', true, videoBytes([1])), { getAccessToken: async () => { throw new Error(token); } }],
    ['HTTP', async () => new Response(token, { status: 503 }), undefined],
    ['bad JSON', async () => new Response('{bad'), undefined],
    ['malformed operation', async () => json({ name: operationName('x') }), undefined],
    ['provider failure', async () => json({ name: operationName('x'), done: true, error: { message: token } }), undefined],
  ];
  for (const [name, fetch, options] of cases) await context.test(name, async () => {
    await assert.rejects(clientFor(fetch, options).generateVideo({ unit: contentUnit(8) }), safeError);
  });
});

test('unsafe Vertex configuration fails in construction before auth or network', () => {
  let authCalls = 0; let fetchCalls = 0;
  for (const environment of [
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'europe-west4', [VIDGEN_VERTEX_VIDEO_MODEL_ENV]: model },
    { [GOOGLE_CLOUD_PROJECT_ENV]: '../unsafe', [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VERTEX_VIDEO_MODEL_ENV]: model },
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VERTEX_VIDEO_MODEL_ENV]: 'veo-3.1-fast-generate-preview' },
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VERTEX_VIDEO_MODEL_ENV]: 'publishers/google/models/veo-3.1-generate-001' },
  ]) assert.throws(() => clientFor(async () => { fetchCalls += 1; return operation('x', true, videoBytes([1])); }, { getAccessToken: async () => { authCalls += 1; return token; } }, environment), hasConfiguration);
  assert.equal(authCalls, 0); assert.equal(fetchCalls, 0);
});

interface FetchCall { readonly url: string | URL | Request; readonly init: RequestInit; }
type ClientOptions = Omit<VertexVeoVideoGenerationClientOptions, 'environment' | 'fetch'>;
function clientFor(fetch: FetchImplementation, options: ClientOptions = {}, overrides: VertexVeoEnvironment = {}): VertexVeoVideoGenerationClient { return new VertexVeoVideoGenerationClient({ environment: { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VERTEX_VIDEO_MODEL_ENV]: model, ...overrides }, fetch, getAccessToken: async () => token, pollIntervalMs: 1, sleep: async () => {}, ...options }); }
function sequenceFetch(calls: FetchCall[], responses: Response[]): FetchImplementation { return async (url, init = {}) => { calls.push({ url, init }); const response = responses.shift(); if (response === undefined) throw new Error('unexpected fetch'); return response; }; }
function operation(id: string, done: boolean, bytes?: Uint8Array): Response { return json({ name: operationName(id), done, ...(done && bytes === undefined ? { response: { videos: [] } } : {}), ...(bytes === undefined ? {} : { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(bytes).toString('base64') }] } }) }); }
function operationName(id: string): string { return `projects/${project}/locations/us-central1/publishers/google/models/${model}/operations/${id}`; }
function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }); }
function body(call: FetchCall): Record<string, unknown> { return JSON.parse(String(call.init.body)) as Record<string, unknown>; }
function videoBytes(bytes: number[]): Uint8Array { return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, ...bytes]); }
function contentUnit(seconds: number): GeneratedMediaUnit { return { unitId: 'u02', segment: { id: 'content', startSeconds: 5, endSeconds: 5 + seconds }, role: { id: 'content-video', kind: 'video' }, targetDurationSeconds: seconds, content: [{ slotId: 'narration', usage: 'spoken', text: storyText }], spokenText: storyText }; }
function presenterUnit(seconds: number): GeneratedMediaUnit { return { unitId: 'u01', segment: { id: 'hook', startSeconds: 0, endSeconds: seconds }, role: { id: 'opening-anchor', kind: 'presenter' }, targetDurationSeconds: seconds, content: [{ slotId: 'hook', usage: 'spoken', text: storyText }], spokenText: storyText }; }
function assignedDialogue(prompt: string): string { const match = /assigned dialogue: "([\s\S]*?)"\./.exec(prompt); assert.notEqual(match, null); return match![1]!; }
function hasConfiguration(error: unknown): boolean { return error instanceof VidGenError && error.code === 'configuration'; }
function safeError(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); assert.equal(message.includes(token), false); assert.equal(message.includes(storyText), false); return error instanceof VidGenError && error.code === 'generated_media'; }
