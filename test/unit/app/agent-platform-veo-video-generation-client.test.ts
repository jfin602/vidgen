import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createApprovedReferenceImage, type GeneratedMediaUnit } from '../../../src/core/generated-media.ts';
import { planPresenterVideoDuration } from '../../../src/core/presenter-video.ts';
import { VidGenError } from '../../../src/core/error.ts';
import { join } from 'node:path';
import {
  GOOGLE_CLOUD_LOCATION_ENV,
  GOOGLE_CLOUD_PROJECT_ENV,
  VIDGEN_VIDEO_MODEL_ENV,
  GOOGLE_AGENT_PLATFORM_VEO_API_BASE,
  GoogleAgentPlatformVeoVideoGenerationClient,
  type FetchImplementation,
  type GoogleAgentPlatformVeoEnvironment,
  type GoogleAgentPlatformVeoVideoGenerationClientOptions,
} from '../../../src/integrations/google/agent-platform-veo-video-generation.ts';
import { loadVeoPromptSpec, renderVeoPrompt } from '../../../src/integrations/google/veo-prompt-spec.ts';

const project = 'vidgen-test-project';
const model = 'veo-3.1-generate-001';
const token = 'agent-platform-test-token-never-surface';
const storyText = 'A city council approved the pilot program after a public meeting.';
const image = createApprovedReferenceImage('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3]));
const promptFile = join(process.cwd(), 'test', 'fixtures', 'veo-prompts.json');

test('Agent Platform Veo uses injected ADC bearer auth and documented regional inline request/result shapes', async () => {
  const calls: FetchCall[] = []; let authCalls = 0;
  const client = clientFor(sequenceFetch(calls, [operation('one', true, videoBytes([1]))]), { getAccessToken: async () => { authCalls += 1; return token; } });
  const result = await client.generateVideo({ unit: contentUnit(8) });
  assert.deepEqual(result, { provider: 'google-agent-platform-veo', model, requestId: operationName('one'), operationId: operationName('one'), operationIds: [operationName('one')], generationOperationCount: 1, mimeType: 'video/mp4', bytes: videoBytes([1]), durationSeconds: 8 });
  assert.equal(authCalls, 1);
  assert.equal(String(calls[0]!.url), `${GOOGLE_AGENT_PLATFORM_VEO_API_BASE}/projects/${project}/locations/us-central1/publishers/google/models/${model}:predictLongRunning`);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`); assert.equal(headers.get('x-goog-api-key'), null);
  assert.deepEqual(body(calls[0]!).parameters, { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', sampleCount: 1 });
  assert.match(String((body(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt), /^CINEMATIC_CONTENT_INITIAL:/);
  assert.equal(JSON.stringify(body(calls[0]!)).includes('storageUri'), false);
});

test('Agent Platform Veo sends one to three PNG/JPEG asset references exactly and rejects WebP before ADC/network', async () => {
  const calls: FetchCall[] = [];
  const jpeg = createApprovedReferenceImage('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 4]));
  const client = clientFor(sequenceFetch(calls, [operation('refs', true, videoBytes([2]))]));
  await client.generateVideo({ unit: presenterUnit(8), referenceImages: [image, jpeg, image] });
  const references = (body(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.referenceImages as Array<Record<string, unknown>>;
  assert.deepEqual(references, [
    { image: { bytesBase64Encoded: Buffer.from(image.bytes).toString('base64'), mimeType: 'image/png' }, referenceType: 'asset' },
    { image: { bytesBase64Encoded: Buffer.from(jpeg.bytes).toString('base64'), mimeType: 'image/jpeg' }, referenceType: 'asset' },
    { image: { bytesBase64Encoded: Buffer.from(image.bytes).toString('base64'), mimeType: 'image/png' }, referenceType: 'asset' },
  ]);
  assert.match(String((body(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt), new RegExp(`DIALOGUE=${storyText}`));
  let authCalls = 0; let fetchCalls = 0;
  const webp = createApprovedReferenceImage('image/webp', new Uint8Array([1]));
  const rejecting = clientFor(async () => { fetchCalls += 1; return operation('bad', true, videoBytes([1])); }, { getAccessToken: async () => { authCalls += 1; return token; } });
  await assert.rejects(rejecting.generateVideo({ unit: presenterUnit(8), referenceImages: [webp] }), safeError);
  assert.equal(authCalls, 0); assert.equal(fetchCalls, 0);
});

test('all seven Veo request shapes use the configured templates and preserve dynamic values', async () => {
  const prompts: string[] = [];
  const collect = async (run: (client: GoogleAgentPlatformVeoVideoGenerationClient) => Promise<void>, responses: Response[]) => {
    const calls: FetchCall[] = []; await run(clientFor(sequenceFetch(calls, responses))); prompts.push(...calls.map((call) => String((body(call).instances as Array<Record<string, unknown>>)[0]!.prompt)));
  };
  await collect((client) => client.generatePresenterVideo({ spokenText: 'short dialogue', referenceImages: [image], maxSeconds: 4 }), [operation('simple-initial', true, videoBytes([1]))]);
  await collect((client) => client.generatePresenterVideo({ spokenText: Array.from({ length: 22 }, (_, index) => `word${index}`).join(' '), referenceImages: [image], maxSeconds: 9 }), [operation('simple-with-extension', true, videoBytes([1])), operation('simple-extension', true, videoBytes([2]))]);
  await collect((client) => client.generateVideo({ unit: presenterUnit(9), referenceImages: [image] }), [operation('presenter-initial', true, videoBytes([1])), operation('presenter-extension', true, videoBytes([2]))]);
  await collect((client) => client.generateVideo({ unit: contentUnit(9) }), [operation('content-initial', true, videoBytes([1])), operation('content-extension', true, videoBytes([2]))]);
  assert.deepEqual(prompts.map((prompt) => prompt.split(':')[0]), ['SIMPLE_INITIAL', 'SIMPLE_INITIAL_EXTENSION', 'SIMPLE_EXTENSION', 'CINEMATIC_PRESENTER_INITIAL', 'CINEMATIC_PRESENTER_EXTENSION', 'CINEMATIC_CONTENT_INITIAL', 'CINEMATIC_CONTENT_EXTENSION']);
  assert.equal(prompts[0]!.includes('DIALOGUE=short dialogue'), true);
  assert.equal(prompts[3]!.includes(`spoken hook: ${storyText}`), true);
  assert.equal(prompts[4]!.includes(`spoken hook: ${storyText}`), true);
  assert.equal(prompts[5]!.includes(`spoken narration: ${storyText}`), true);
  assert.equal(prompts[6]!.includes(`spoken narration: ${storyText}`), true);
  assert.equal(prompts.some((prompt) => prompt.includes('undefined')), false);
  assert.equal(prompts.some((prompt) => prompt.includes('{{')), false);
});

test('prompt specs fail safely, substitute once, and use one stable byte snapshot', async () => {
  const loaded = loadVeoPromptSpec({ VIDGEN_VEO_PROMPT_FILE: promptFile });
  assert.equal(renderVeoPrompt('simplePresenterInitial', loaded.templates.simplePresenterInitial, { dialogue: '{{context}}', context: 'ignored', retainedExtensionSeconds: 'ignored' }).includes('{{context}}'), true);
  await withPromptFile(async (path) => {
    const source = JSON.parse(await readFile(promptFile, 'utf8')) as Record<string, string>;
    await writeFile(path, JSON.stringify({ ...source, simplePresenterInitial: 'changed {{dialogue}}' }));
    const snapshotCalls: FetchCall[] = []; const first = new GoogleAgentPlatformVeoVideoGenerationClient({ environment: environment(path), fetch: sequenceFetch(snapshotCalls, [operation('snapshot', true, videoBytes([1]))]), getAccessToken: async () => token, pollIntervalMs: 1, sleep: async () => {} });
    await writeFile(path, JSON.stringify({ ...source, simplePresenterInitial: 'later {{dialogue}}' }));
    const calls: FetchCall[] = []; const stable = new GoogleAgentPlatformVeoVideoGenerationClient({ environment: environment(path), fetch: sequenceFetch(calls, [operation('later', true, videoBytes([1]))]), getAccessToken: async () => token, pollIntervalMs: 1, sleep: async () => {} });
    const firstCalls: FetchCall[] = []; const fixed = new GoogleAgentPlatformVeoVideoGenerationClient({ environment: environment(promptFile), fetch: sequenceFetch(firstCalls, [operation('fixed', true, videoBytes([1]))]), getAccessToken: async () => token, pollIntervalMs: 1, sleep: async () => {} });
    await first.generatePresenterVideo({ spokenText: 'literal {{context}}', referenceImages: [image], maxSeconds: 4 });
    await stable.generatePresenterVideo({ spokenText: 'dialogue', referenceImages: [image], maxSeconds: 4 });
    await fixed.generatePresenterVideo({ spokenText: 'dialogue', referenceImages: [image], maxSeconds: 4 });
    assert.match(String((body(snapshotCalls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt), /^changed literal \{\{context\}\}/);
    assert.match(String((body(firstCalls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt), /^SIMPLE_INITIAL:/);
    assert.match(String((body(calls[0]!).instances as Array<Record<string, unknown>>)[0]!.prompt), /^later /);
  });
  await withPromptFile(async (path) => {
    await writeFile(path, JSON.stringify({ simplePresenterInitial: 'x' }));
    let auth = 0; let network = 0;
    assert.throws(() => new GoogleAgentPlatformVeoVideoGenerationClient({ environment: environment(path), fetch: async () => { network += 1; return operation('never', true, videoBytes([1])); }, getAccessToken: async () => { auth += 1; return token; } }), (error: unknown) => hasConfiguration(error) && !String(error).includes(path));
    assert.equal(auth, 0); assert.equal(network, 0);
    const source = JSON.parse(await readFile(promptFile, 'utf8')) as Record<string, string>;
    await writeFile(path, JSON.stringify({ ...source, simplePresenterInitial: '{{unknown}}' }));
    assert.throws(() => new GoogleAgentPlatformVeoVideoGenerationClient({ environment: environment(path) }), hasConfiguration);
  });
});

test('Agent Platform Veo accepts a name-only start as pending and polls its exact full operation name', async () => {
  const calls: FetchCall[] = []; const name = operationName('poll-id');
  const client = clientFor(sequenceFetch(calls, [operation('poll-id'), operation('poll-id', true, videoBytes([3]))]));
  const result = await client.generateVideo({ unit: contentUnit(8) });
  assert.equal(String(calls[1]!.url), `${GOOGLE_AGENT_PLATFORM_VEO_API_BASE}/projects/${project}/locations/us-central1/publishers/google/models/${model}:fetchPredictOperation`);
  assert.deepEqual(body(calls[1]!), { operationName: name });
  assert.deepEqual(result, { provider: 'google-agent-platform-veo', model, requestId: name, operationId: name, operationIds: [name], generationOperationCount: 1, mimeType: 'video/mp4', bytes: videoBytes([3]), durationSeconds: 8 });
});

test('Agent Platform Veo emits bounded operation progress without provider payloads', async () => {
  const events: unknown[] = [];
  await clientFor(sequenceFetch([], [operation('progress'), operation('progress', false), operation('progress', true, videoBytes([3]))]), { onProgress: (event) => events.push(event) }).generateVideo({ unit: contentUnit(8) });
  assert.deepEqual(events, [{ stage: 'operation_started', operationNumber: 1 }, { stage: 'operation_pending', operationNumber: 1, pollNumber: 1 }, { stage: 'operation_completed', operationNumber: 1 }]);
  assert.doesNotMatch(JSON.stringify(events), /bytesBase64Encoded|authorization|Bearer|DIALOGUE/);
});

test('Agent Platform Veo accepts name-only and explicit false poll responses as pending', async () => {
  for (const [name, pending] of [
    ['name-only', operation('pending')],
    ['explicit false', operation('pending', false)],
  ] as const) {
    const calls: FetchCall[] = [];
    const result = await clientFor(sequenceFetch(calls, [operation('start'), pending, operation('pending', true, videoBytes([4]))])).generateVideo({ unit: contentUnit(8) });
    assert.equal(calls.length, 3, name);
    assert.equal(result.operationId, operationName('start'), name);
    assert.deepEqual(body(calls[1]!), { operationName: operationName('start') }, name);
    assert.deepEqual(body(calls[2]!), { operationName: operationName('start') }, name);
  }
});

test('Agent Platform Veo bounds indefinitely name-only pending operations', async () => {
  const calls: FetchCall[] = [];
  const client = clientFor(sequenceFetch(calls, [operation('pending'), operation('pending'), operation('pending')]), { totalTimeoutMs: 2, now: () => 0 });
  await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeError);
  assert.equal(calls.length, 3);
});

test('Agent Platform Veo decodes only one bounded valid inline MP4 result', async (context) => {
  const cases: readonly [string, unknown, ClientOptions?][] = [
    ['malformed character', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: 'AA!A' }] } }, undefined],
    ['invalid padding', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: 'AA=A' }] } }, undefined],
    ['non-multiple-of-four', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: 'AAA' }] } }, undefined],
    ['filtered', { response: { raiMediaFilteredCount: 1, videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }] } }, undefined],
    ['empty', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: '' }] } }, undefined],
    ['wrong MIME', { response: { videos: [{ mimeType: 'video/webm', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }] } }, undefined],
    ['bad signature', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString('base64') }] } }, undefined],
    ['multiple', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }, { mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([2])).toString('base64') }] } }, undefined],
    ['oversized encoded', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1, 2, 3])).toString('base64') }] } }, { maxVideoBytes: 8 }],
    ['oversized decoded', { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(videoBytes([1])).toString('base64') }] } }, { maxVideoBytes: 8 }],
  ];
  for (const [name, response, options] of cases) await context.test(name, async () => {
    const client = clientFor(sequenceFetch([], [json({ name: operationName('invalid'), done: true, ...response })]), options);
    await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), safeError);
  });
});

test('Agent Platform Veo decodes an 8 MiB inline MP4 without stack overflow', async () => {
  const bytes = new Uint8Array(8 * 1024 * 1024); bytes.set(videoBytes([])); bytes.fill(0x61, 8);
  const client = clientFor(sequenceFetch([], [operation('large-inline', true, bytes)]), { maxVideoBytes: bytes.byteLength });
  const result = await client.generateVideo({ unit: contentUnit(8) });
  assert.equal(result.bytes.byteLength, bytes.byteLength);
  assert.deepEqual(result.bytes.subarray(0, 8), bytes.subarray(0, 8));
});

test('Agent Platform Veo rejects oversized encoded input before Base64 decoding', async () => {
  const encoded = Buffer.from(videoBytes([1, 2, 3])).toString('base64');
  const originalFrom = Buffer.from; let decoded = false;
  Object.defineProperty(Buffer, 'from', { configurable: true, writable: true, value: (value: string, encoding?: BufferEncoding) => { if (encoding === 'base64') decoded = true; return originalFrom(value, encoding); } });
  try {
    await assert.rejects(clientFor(sequenceFetch([], [json({ name: operationName('encoded-limit'), done: true, response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: encoded }] } })]), { maxVideoBytes: 8 }).generateVideo({ unit: contentUnit(8) }), safeError);
    assert.equal(decoded, false);
  } finally { Object.defineProperty(Buffer, 'from', { configurable: true, writable: true, value: originalFrom }); }
});

test('Agent Platform Veo preserves simple retained-window speech timing and uses exactly one extension from 4 through 20 seconds', async (context) => {
  for (let seconds = 4; seconds <= 20; seconds += 1) await context.test(`${seconds} seconds`, async () => {
    const words = Array.from({ length: Math.floor((Math.min(seconds, 15) * 150) / 60) }, (_, index) => `word${index + 1}`).join(' ');
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
      assert.match(prompts[1]!, new RegExp(`within ${Math.min(seconds, 15) - 8} seconds`));
    }
  });
});

test('Agent Platform Veo preserves cinematic extension provenance and safely rejects auth, HTTP, malformed operation, and provider failures', async (context) => {
  await context.test('extension provenance', async () => {
    const calls: FetchCall[] = [];
    const result = await clientFor(sequenceFetch(calls, [operation('initial', true, videoBytes([7])), operation('extension', true, videoBytes([8]))])).generateVideo({ unit: contentUnit(9) });
    assert.deepEqual(result.operationIds, [operationName('initial'), operationName('extension')]); assert.equal(result.durationSeconds, 15);
    assert.equal(JSON.stringify(body(calls[1]!)).includes(Buffer.from(videoBytes([7])).toString('base64')), true);
    assert.match(String((body(calls[1]!).instances as Array<Record<string, unknown>>)[0]!.prompt), /^CINEMATIC_CONTENT_EXTENSION:/);
  });
  const cases: readonly [string, FetchImplementation, ClientOptions?][] = [
    ['auth', async () => operation('never', true, videoBytes([1])), { getAccessToken: async () => { throw new Error(token); } }],
    ['HTTP', async () => new Response(token, { status: 503 }), undefined],
    ['bad JSON', async () => new Response('{bad'), undefined],
    ['malformed operation done string', async () => json({ name: operationName('x'), done: 'true' }), undefined],
    ['malformed operation done number', async () => json({ name: operationName('x'), done: 1 }), undefined],
    ['provider failure', async () => json({ name: operationName('x'), done: true, error: { message: token } }), undefined],
  ];
  for (const [name, fetch, options] of cases) await context.test(name, async () => {
    await assert.rejects(clientFor(fetch, options).generateVideo({ unit: contentUnit(8) }), safeError);
  });
});

test('Agent Platform Veo retains only sanitized terminal operation diagnostics', async () => {
  const terminal = json({ name: operationName('failure'), done: true, error: { code: 3, status: 'INVALID_ARGUMENT', message: 'Request rejected by provider.', details: [{ metadata: { supportCode: '15236754', authorization: `Bearer ${token}` } }] } });
  await assert.rejects(clientFor(sequenceFetch([], [terminal])).generateVideo({ unit: contentUnit(8) }), (error: unknown) => error instanceof VidGenError && error.code === 'generated_media' && error.safeProviderDiagnostic?.providerCode === 3 && error.safeProviderDiagnostic.providerStatus === 'INVALID_ARGUMENT' && error.safeProviderDiagnostic.supportCode === '15236754' && error.safeProviderDiagnostic.providerMessage === 'Request rejected by provider.' && !String(error).includes(token));
  for (const message of [`Bearer ${token}`, `bad\n${token}`, 'file:///tmp/provider-response', 'C:\\secrets\\provider-response', 'x'.repeat(500), `{"authorization":"Bearer ${token}"}`]) {
    const response = json({ name: operationName('unsafe'), done: true, error: { code: 3, status: 'INVALID_ARGUMENT', message } });
    await assert.rejects(clientFor(sequenceFetch([], [response])).generateVideo({ unit: contentUnit(8) }), (error: unknown) => error instanceof VidGenError && error.safeProviderDiagnostic?.providerCode === 3 && error.safeProviderDiagnostic.providerStatus === 'INVALID_ARGUMENT' && error.safeProviderDiagnostic.providerMessage === undefined && !String(error).includes(token) && !String(error).includes(message));
  }
  const tokenCode = json({ name: operationName('token-code'), done: true, error: { code: token, status: 'INVALID_ARGUMENT', message: 'Request rejected.' } });
  await assert.rejects(clientFor(sequenceFetch([], [tokenCode])).generateVideo({ unit: contentUnit(8) }), (error: unknown) => error instanceof VidGenError && error.safeProviderDiagnostic?.providerCode === undefined && !String(error).includes(token));
});

test('Agent Platform Veo classifies native runtime failures without exposing provider or media data', async (context) => {
  const unsafe = `Bearer ${token}; ${storyText}; C:\\secrets\\response.json; {"authorization":"Bearer ${token}"}; AAAA-video-bytes`;
  const runtimeError = (stage: string) => (error: unknown) => {
    const diagnostic = error instanceof VidGenError ? error.safeProviderDiagnostic : undefined;
    assert.equal(error instanceof VidGenError && error.code === 'generated_media', true);
    assert.equal(diagnostic?.veoStage, stage);
    assert.equal(diagnostic?.internalError === 'TypeError' || diagnostic?.internalError === 'RangeError', true);
    assert.equal(diagnostic?.internalMessage, 'Internal runtime error.');
    const rendered = `${String(error)}\n${JSON.stringify(diagnostic)}`;
    for (const value of [token, storyText, 'C:\\secrets\\response.json', '{"authorization"', 'AAAA-video-bytes']) assert.equal(rendered.includes(value), false);
    return true;
  };
  await context.test('auth', async () => {
    await assert.rejects(clientFor(async () => operation('never', true, videoBytes([1])), { getAccessToken: async () => { throw new TypeError("Cannot read properties of undefined (reading 'value')"); } }).generateVideo({ unit: contentUnit(8) }), (error: unknown) => error instanceof VidGenError && error.code === 'generated_media' && error.safeProviderDiagnostic?.veoStage === 'auth' && error.safeProviderDiagnostic.internalError === 'TypeError' && error.safeProviderDiagnostic.internalMessage === "Cannot read properties of undefined (reading 'value')");
  });
  await context.test('start fetch', async () => {
    await assert.rejects(clientFor(async () => { throw new TypeError(unsafe); }).generateVideo({ unit: contentUnit(8) }), runtimeError('start_request'));
  });
  await context.test('poll fetch', async () => {
    let calls = 0;
    await assert.rejects(clientFor(async () => {
      calls += 1;
      if (calls === 1) return operation('pending');
      throw new TypeError(unsafe);
    }).generateVideo({ unit: contentUnit(8) }), runtimeError('poll_request'));
  });
  await context.test('response stream', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError(unsafe)); } });
    await assert.rejects(clientFor(async () => new Response(stream, { status: 200 })).generateVideo({ unit: contentUnit(8) }), runtimeError('operation_parse'));
  });
  await context.test('terminal operation inspection', async () => {
    const client = clientFor(sequenceFetch([], [json({ ignored: true })]));
    const originalParse = JSON.parse;
    JSON.parse = (() => new Proxy({ name: operationName('native'), done: true }, { get(target, property, receiver) { if (property === 'done') throw new RangeError(unsafe); return Reflect.get(target, property, receiver); } })) as typeof JSON.parse;
    try {
      await assert.rejects(client.generateVideo({ unit: contentUnit(8) }), runtimeError('operation_parse'));
    } finally { JSON.parse = originalParse; }
  });
  await context.test('inline MP4 decoding', async () => {
    const originalFrom = Buffer.from;
    Object.defineProperty(Buffer, 'from', { configurable: true, writable: true, value: (value: string, encoding?: BufferEncoding) => { if (encoding === 'base64') throw new RangeError(unsafe); return originalFrom(value, encoding); } });
    try {
      await assert.rejects(clientFor(sequenceFetch([], [operation('decode', true, videoBytes([1]))])).generateVideo({ unit: contentUnit(8) }), runtimeError('result_decode'));
    } finally { Object.defineProperty(Buffer, 'from', { configurable: true, writable: true, value: originalFrom }); }
  });
});

test('Agent Platform Veo ignores native progress callback failures', async () => {
  const result = await clientFor(sequenceFetch([], [operation('progress-error', true, videoBytes([1]))]), { onProgress: () => { throw new TypeError(`Bearer ${token}`); } }).generateVideo({ unit: contentUnit(8) });
  assert.equal(result.operationId, operationName('progress-error'));
});

test('unsafe Agent Platform configuration fails in construction before auth or network', () => {
  let authCalls = 0; let fetchCalls = 0;
  for (const environment of [
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'europe-west4', [VIDGEN_VIDEO_MODEL_ENV]: model },
    { [GOOGLE_CLOUD_PROJECT_ENV]: '../unsafe', [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VIDEO_MODEL_ENV]: model },
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VIDEO_MODEL_ENV]: 'veo-3.1-fast-generate-preview' },
    { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VIDEO_MODEL_ENV]: 'publishers/google/models/veo-3.1-generate-001' },
  ]) assert.throws(() => clientFor(async () => { fetchCalls += 1; return operation('x', true, videoBytes([1])); }, { getAccessToken: async () => { authCalls += 1; return token; } }, environment), hasConfiguration);
  assert.equal(authCalls, 0); assert.equal(fetchCalls, 0);
});

interface FetchCall { readonly url: string | URL | Request; readonly init: RequestInit; }
type ClientOptions = Omit<GoogleAgentPlatformVeoVideoGenerationClientOptions, 'environment' | 'fetch'>;
function clientFor(fetch: FetchImplementation, options: ClientOptions = {}, overrides: GoogleAgentPlatformVeoEnvironment = {}): GoogleAgentPlatformVeoVideoGenerationClient { return new GoogleAgentPlatformVeoVideoGenerationClient({ environment: { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VIDEO_MODEL_ENV]: model, VIDGEN_VEO_PROMPT_FILE: promptFile, ...overrides }, fetch, getAccessToken: async () => token, pollIntervalMs: 1, sleep: async () => {}, ...options }); }
function environment(path: string): GoogleAgentPlatformVeoEnvironment { return { [GOOGLE_CLOUD_PROJECT_ENV]: project, [GOOGLE_CLOUD_LOCATION_ENV]: 'us-central1', [VIDGEN_VIDEO_MODEL_ENV]: model, VIDGEN_VEO_PROMPT_FILE: path }; }
async function withPromptFile(run: (path: string) => Promise<void>): Promise<void> { const directory = await mkdtemp(join(tmpdir(), 'vidgen-prompts-')); const path = join(directory, 'veo-prompts.json'); try { await run(path); } finally { await rm(directory, { recursive: true, force: true }); } }
function sequenceFetch(calls: FetchCall[], responses: Response[]): FetchImplementation { return async (url, init = {}) => { calls.push({ url, init }); const response = responses.shift(); if (response === undefined) throw new Error('unexpected fetch'); return response; }; }
function operation(id: string, done: boolean, bytes?: Uint8Array): Response { return json({ name: operationName(id), done, ...(done && bytes === undefined ? { response: { videos: [] } } : {}), ...(bytes === undefined ? {} : { response: { videos: [{ mimeType: 'video/mp4', bytesBase64Encoded: Buffer.from(bytes).toString('base64') }] } }) }); }
function operationName(id: string): string { return `projects/${project}/locations/us-central1/publishers/google/models/${model}/operations/${id}`; }
function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }); }
function body(call: FetchCall): Record<string, unknown> { return JSON.parse(String(call.init.body)) as Record<string, unknown>; }
function videoBytes(bytes: number[]): Uint8Array { return new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, ...bytes]); }
function contentUnit(seconds: number): GeneratedMediaUnit { return { unitId: 'u02', segment: { id: 'content', startSeconds: 5, endSeconds: 5 + seconds }, role: { id: 'content-video', kind: 'video' }, targetDurationSeconds: seconds, content: [{ slotId: 'narration', usage: 'spoken', text: storyText }], spokenText: storyText }; }
function presenterUnit(seconds: number): GeneratedMediaUnit { return { unitId: 'u01', segment: { id: 'hook', startSeconds: 0, endSeconds: seconds }, role: { id: 'opening-anchor', kind: 'presenter' }, targetDurationSeconds: seconds, content: [{ slotId: 'hook', usage: 'spoken', text: storyText }], spokenText: storyText }; }
function assignedDialogue(prompt: string): string { const match = /DIALOGUE=([\s\S]*?)\./.exec(prompt); assert.notEqual(match, null); return match![1]!; }
function hasConfiguration(error: unknown): boolean { return error instanceof VidGenError && error.code === 'configuration'; }
function safeError(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); assert.equal(message.includes(token), false); assert.equal(message.includes(storyText), false); return error instanceof VidGenError && error.code === 'generated_media'; }
