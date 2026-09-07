import assert from 'node:assert/strict';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import type { GeneratedMediaUnit } from '../../../src/core/generated-media.ts';
import {
  GOOGLE_AGENT_PLATFORM_TTS_ENDPOINT,
  GoogleAgentPlatformSpeechGenerationClient,
  type FetchImplementation,
  type GoogleAgentPlatformSpeechGenerationClientOptions,
} from '../../../src/integrations/google/agent-platform-speech-generation.ts';

const token = 'tts-test-token-never-surface';
const project = 'vidgen-test-project';
const narration = 'The exact validated narration belongs to this voiceover.';
const base64 = Buffer.from([1, 0, 2, 0]).toString('base64');

test('Agent Platform Gemini TTS submits exactly the supplied voiceover narration and wraps documented PCM as WAV', async () => {
  let call: { url: string | URL | Request; init: RequestInit } | undefined;
  const client = clientFor(async (url, init = {}) => { call = { url, init }; return audioResponse(); });
  const result = await client.generateSpeech({ unit: voiceoverUnit() });
  assert.equal(String(call?.url), GOOGLE_AGENT_PLATFORM_TTS_ENDPOINT);
  assert.equal(call?.init.method, 'POST'); assert.equal(call?.init.redirect, 'error');
  const headers = new Headers(call?.init.headers);
  assert.equal(headers.get('authorization'), `Bearer ${token}`);
  assert.equal(headers.get('x-goog-user-project'), project);
  assert.equal(headers.get('x-goog-api-key'), null);
  const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
  assert.deepEqual(body, { input: { text: narration }, voice: { languageCode: 'en-US', name: 'Kore', modelName: 'gemini-tts-test' }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, audioChannelCount: 1 } });
  assert.equal(JSON.stringify(body).includes('A display-only headline'), false);
  assert.deepEqual(result, { provider: 'google-agent-platform-gemini-tts', model: 'gemini-tts-test', voice: 'Kore', mimeType: 'audio/wav', bytes: wav([1, 0, 2, 0]), durationSeconds: 4 / 48_000 });
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  assert.equal(Buffer.from(result.bytes.subarray(0, 4)).toString(), 'RIFF'); assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16); assert.equal(view.getUint32(40, true), 4);
});

test('Agent Platform Gemini TTS rejects non-voiceover units and missing/path-shaped runtime config before provider work', async () => {
  let calls = 0; const fake: FetchImplementation = async () => { calls += 1; return audioResponse(); };
  for (const environment of [
    { VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' }, { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' },
    { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' }, { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore' },
    { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: '../bad', VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' }, { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore/unsafe', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' },
    { GOOGLE_CLOUD_PROJECT: 'bad/project', VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en-US' }, { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en/US' },
  ]) assert.throws(() => new GoogleAgentPlatformSpeechGenerationClient({ environment, fetch: fake }), hasConfiguration);
  const client = clientFor(fake);
  await assert.rejects(client.generateSpeech({ unit: { ...voiceoverUnit(), role: { id: 'opening-anchor', kind: 'presenter' } } }), hasGeneratedMedia);
  assert.equal(calls, 0);
});

test('Agent Platform Gemini TTS fails safely for auth, malformed, non-audio, oversized and network responses', async (context) => {
  const cases: readonly [string, FetchImplementation, ClientOptions?][] = [
    ['auth', async () => audioResponse(), { getAccessToken: async () => { throw new Error(`${token} ${narration}`); } }], ['redirect', async () => new Response('', { status: 302 }), undefined], ['HTTP', async () => new Response(`${token} ${narration}`, { status: 503 }), undefined],
    ['invalid JSON', async () => new Response('{bad'), undefined], ['incomplete', async () => json({ status: 'in_progress', output_audio: { data: base64 } }), undefined],
    ['missing audio', async () => json({}), undefined], ['blank audio', async () => json({ audioContent: '' }), undefined],
    ['malformed base64', async () => json({ audioContent: '###' }), undefined], ['unaligned PCM', async () => json({ audioContent: Buffer.from([1]).toString('base64') }), undefined],
    ['oversized body', async () => new Response('12345'), { maxResponseBytes: 4 }], ['oversized audio', async () => audioResponse(), { maxAudioBytes: 3 }],
  ];
  for (const [name, fetch, options] of cases) await context.test(name, async () => {
    await assert.rejects(clientFor(fetch, options).generateSpeech({ unit: voiceoverUnit() }), safeError);
  });
  await context.test('timeout', async () => {
    const client = clientFor(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))), { timeoutMs: 1 });
    await assert.rejects(client.generateSpeech({ unit: voiceoverUnit() }), safeError);
  });
  await context.test('authentication timeout', async () => {
    let calls = 0;
    const client = clientFor(async () => { calls += 1; return audioResponse(); }, { getAccessToken: async () => new Promise(() => {}), authTimeoutMs: 1 });
    await assert.rejects(client.generateSpeech({ unit: voiceoverUnit() }), safeError);
    assert.equal(calls, 0);
  });
});

type ClientOptions = Omit<GoogleAgentPlatformSpeechGenerationClientOptions, 'environment' | 'fetch'>;
function clientFor(fetch: FetchImplementation, options: ClientOptions = {}): GoogleAgentPlatformSpeechGenerationClient { return new GoogleAgentPlatformSpeechGenerationClient({ environment: { GOOGLE_CLOUD_PROJECT: project, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore', VIDGEN_TTS_LANGUAGE_CODE: 'en-US', GEMINI_API_KEY: 'must-not-be-read' }, fetch, getAccessToken: async () => token, ...options }); }
function voiceoverUnit(): GeneratedMediaUnit { return { unitId: 'u03', segment: { id: 'content', startSeconds: 5, endSeconds: 15 }, role: { id: 'content-voiceover', kind: 'voiceover' }, targetDurationSeconds: 10, content: [{ slotId: 'narration', usage: 'spoken', text: narration }, { slotId: 'headline', usage: 'display', text: 'A display-only headline' }], spokenText: narration }; }
function audioResponse(): Response { return json({ audioContent: base64 }); }
function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }); }
function wav(pcm: number[]): Uint8Array { const result = new Uint8Array(44 + pcm.length); const view = new DataView(result.buffer); Buffer.from('RIFF').copy(result, 0); view.setUint32(4, 36 + pcm.length, true); Buffer.from('WAVEfmt ').copy(result, 8); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); Buffer.from('data').copy(result, 36); view.setUint32(40, pcm.length, true); result.set(pcm, 44); return result; }
function hasConfiguration(error: unknown): boolean { return error instanceof VidGenError && error.code === 'configuration'; }
function hasGeneratedMedia(error: unknown): boolean { return error instanceof VidGenError && error.code === 'generated_media'; }
function safeError(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); assert.equal(message.includes(token), false); assert.equal(message.includes(narration), false); assert.equal(message.includes(base64), false); return hasGeneratedMedia(error); }
