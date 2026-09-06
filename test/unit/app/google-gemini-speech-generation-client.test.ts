import assert from 'node:assert/strict';
import test from 'node:test';

import { VidGenError } from '../../../src/core/error.ts';
import type { GeneratedMediaUnit } from '../../../src/core/generated-media.ts';
import {
  GOOGLE_GEMINI_TTS_INTERACTIONS_ENDPOINT,
  GoogleGeminiSpeechGenerationClient,
  type FetchImplementation,
  type GoogleGeminiSpeechGenerationClientOptions,
} from '../../../src/integrations/google/gemini-speech-generation.ts';

const apiKey = 'tts-test-key-never-surface';
const narration = 'The exact validated narration belongs to this voiceover.';
const base64 = Buffer.from([1, 0, 2, 0]).toString('base64');

test('Gemini TTS submits exactly the supplied voiceover narration and wraps documented PCM as WAV', async () => {
  let call: { url: string | URL | Request; init: RequestInit } | undefined;
  const client = clientFor(async (url, init = {}) => { call = { url, init }; return audioResponse(); });
  const result = await client.generateSpeech({ unit: voiceoverUnit() });
  assert.equal(String(call?.url), GOOGLE_GEMINI_TTS_INTERACTIONS_ENDPOINT);
  assert.equal(call?.init.method, 'POST'); assert.equal(call?.init.redirect, 'error');
  const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
  assert.deepEqual(body, { model: 'gemini-tts-test', input: narration, response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] } });
  assert.equal(JSON.stringify(body).includes('A display-only headline'), false);
  assert.deepEqual(result, { provider: 'google-gemini', model: 'provider-tts', voice: 'Kore', requestId: 'interaction-1', mimeType: 'audio/wav', bytes: wav([1, 0, 2, 0]), durationSeconds: 4 / 48_000 });
  const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
  assert.equal(Buffer.from(result.bytes.subarray(0, 4)).toString(), 'RIFF'); assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 16); assert.equal(view.getUint32(40, true), 4);
});

test('Gemini TTS rejects non-voiceover units and missing/path-shaped runtime config before fetch', async () => {
  let calls = 0; const fake: FetchImplementation = async () => { calls += 1; return audioResponse(); };
  for (const environment of [
    { VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore' }, { GEMINI_API_KEY: apiKey, VIDGEN_TTS_VOICE: 'Kore' },
    { GEMINI_API_KEY: apiKey, VIDGEN_TTS_MODEL: 'gemini-tts-test' }, { GEMINI_API_KEY: apiKey, VIDGEN_TTS_MODEL: '../bad', VIDGEN_TTS_VOICE: 'Kore' },
    { GEMINI_API_KEY: apiKey, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore/unsafe' },
  ]) assert.throws(() => new GoogleGeminiSpeechGenerationClient({ environment, fetch: fake }), hasConfiguration);
  const client = clientFor(fake);
  await assert.rejects(client.generateSpeech({ unit: { ...voiceoverUnit(), role: { id: 'opening-anchor', kind: 'presenter' } } }), hasGeneratedMedia);
  assert.equal(calls, 0);
});

test('Gemini TTS fails safely for malformed, incomplete, non-audio, oversized and network responses', async (context) => {
  const cases: readonly [string, FetchImplementation, ClientOptions?][] = [
    ['redirect', async () => new Response('', { status: 302 }), undefined], ['HTTP', async () => new Response(`${apiKey} ${narration}`, { status: 503 }), undefined],
    ['invalid JSON', async () => new Response('{bad'), undefined], ['incomplete', async () => json({ status: 'in_progress', output_audio: { data: base64 } }), undefined],
    ['failed', async () => json({ status: 'failed', error: { message: `${apiKey} ${narration}` } }), undefined], ['action required', async () => json({ status: 'requires_action' }), undefined],
    ['missing audio', async () => json({ status: 'completed', steps: [] }), undefined], ['blank audio', async () => json({ status: 'completed', output_audio: { data: '' } }), undefined],
    ['malformed base64', async () => json({ status: 'completed', output_audio: { data: '###' } }), undefined], ['unaligned PCM', async () => json({ status: 'completed', output_audio: { data: Buffer.from([1]).toString('base64') } }), undefined],
    ['oversized body', async () => new Response('12345'), { maxResponseBytes: 4 }], ['oversized audio', async () => audioResponse(), { maxAudioBytes: 3 }],
  ];
  for (const [name, fetch, options] of cases) await context.test(name, async () => {
    await assert.rejects(clientFor(fetch, options).generateSpeech({ unit: voiceoverUnit() }), safeError);
  });
  await context.test('timeout', async () => {
    const client = clientFor(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))), { timeoutMs: 1 });
    await assert.rejects(client.generateSpeech({ unit: voiceoverUnit() }), safeError);
  });
});

type ClientOptions = Omit<GoogleGeminiSpeechGenerationClientOptions, 'environment' | 'fetch'>;
function clientFor(fetch: FetchImplementation, options: ClientOptions = {}): GoogleGeminiSpeechGenerationClient { return new GoogleGeminiSpeechGenerationClient({ environment: { GEMINI_API_KEY: apiKey, VIDGEN_TTS_MODEL: 'gemini-tts-test', VIDGEN_TTS_VOICE: 'Kore' }, fetch, ...options }); }
function voiceoverUnit(): GeneratedMediaUnit { return { unitId: 'u03', segment: { id: 'content', startSeconds: 5, endSeconds: 15 }, role: { id: 'content-voiceover', kind: 'voiceover' }, targetDurationSeconds: 10, content: [{ slotId: 'narration', usage: 'spoken', text: narration }, { slotId: 'headline', usage: 'display', text: 'A display-only headline' }], spokenText: narration }; }
function audioResponse(): Response { return json({ id: 'interaction-1', status: 'completed', model: 'provider-tts', output_audio: { data: base64 } }); }
function json(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }); }
function wav(pcm: number[]): Uint8Array { const result = new Uint8Array(44 + pcm.length); const view = new DataView(result.buffer); Buffer.from('RIFF').copy(result, 0); view.setUint32(4, 36 + pcm.length, true); Buffer.from('WAVEfmt ').copy(result, 8); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); Buffer.from('data').copy(result, 36); view.setUint32(40, pcm.length, true); result.set(pcm, 44); return result; }
function hasConfiguration(error: unknown): boolean { return error instanceof VidGenError && error.code === 'configuration'; }
function hasGeneratedMedia(error: unknown): boolean { return error instanceof VidGenError && error.code === 'generated_media'; }
function safeError(error: unknown): boolean { const message = error instanceof Error ? error.message : String(error); assert.equal(message.includes(apiKey), false); assert.equal(message.includes(narration), false); assert.equal(message.includes(base64), false); return hasGeneratedMedia(error); }
