import { VidGenError } from '../../core/error.ts';
import type {
  SpeechGenerationClient,
  SpeechGenerationRequest,
  SpeechGenerationResult,
} from '../../core/generated-media.ts';

export const VIDGEN_TTS_MODEL_ENV = 'VIDGEN_TTS_MODEL';
export const VIDGEN_TTS_VOICE_ENV = 'VIDGEN_TTS_VOICE';
export const GOOGLE_GEMINI_TTS_INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const DEFAULT_GOOGLE_GEMINI_TTS_TIMEOUT_MS = 15_000;
export const DEFAULT_GOOGLE_GEMINI_TTS_MAX_RESPONSE_BYTES = 8_000_000;
export const DEFAULT_GOOGLE_GEMINI_TTS_MAX_AUDIO_BYTES = 6_000_000;
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

export type GoogleGeminiTtsEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;

export interface GoogleGeminiTtsRuntimeConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
}

export interface GoogleGeminiSpeechGenerationClientOptions {
  readonly environment?: GoogleGeminiTtsEnvironment;
  readonly fetch?: FetchImplementation;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxAudioBytes?: number;
}

/** Loads only runtime-only Google TTS credentials and explicit selections. */
export function loadGoogleGeminiTtsRuntimeConfig(
  environment: GoogleGeminiTtsEnvironment = process.env,
): GoogleGeminiTtsRuntimeConfig {
  const model = requiredEnvironmentValue(environment, VIDGEN_TTS_MODEL_ENV);
  const voice = requiredEnvironmentValue(environment, VIDGEN_TTS_VOICE_ENV);
  if (!isSafeConfigurationName(model) || !isSafeConfigurationName(voice)) {
    throw new VidGenError('configuration', 'Google Gemini TTS model or voice configuration is invalid.');
  }
  return { apiKey: requiredEnvironmentValue(environment, 'GEMINI_API_KEY'), model, voice };
}

/** Thin, stateless Gemini TTS adapter for off-screen template voiceover only. */
export class GoogleGeminiSpeechGenerationClient implements SpeechGenerationClient {
  readonly provider = 'google-gemini';
  readonly model: string;
  readonly voice: string;
  private readonly apiKey: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAudioBytes: number;

  constructor(options: GoogleGeminiSpeechGenerationClientOptions = {}) {
    const config = loadGoogleGeminiTtsRuntimeConfig(options.environment);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.voice = config.voice;
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = positiveSafeInteger(options.timeoutMs ?? DEFAULT_GOOGLE_GEMINI_TTS_TIMEOUT_MS, 'Google Gemini TTS timeout must be a positive whole number of milliseconds.');
    this.maxResponseBytes = positiveSafeInteger(options.maxResponseBytes ?? DEFAULT_GOOGLE_GEMINI_TTS_MAX_RESPONSE_BYTES, 'Google Gemini TTS maximum response size must be a positive whole number of bytes.');
    this.maxAudioBytes = positiveSafeInteger(options.maxAudioBytes ?? DEFAULT_GOOGLE_GEMINI_TTS_MAX_AUDIO_BYTES, 'Google Gemini TTS maximum audio size must be a positive whole number of bytes.');
  }

  async generateSpeech(request: SpeechGenerationRequest): Promise<SpeechGenerationResult> {
    validateVoiceoverRequest(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(GOOGLE_GEMINI_TTS_INTERACTIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          model: this.model,
          input: request.unit.spokenText,
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: this.voice }] },
        }),
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        throw providerFailure('Google Gemini TTS service returned an unsuccessful response.');
      }
      const payload = await parseBoundedJson(response, this.maxResponseBytes);
      return extractSpeechResult(payload, this.provider, this.model, this.voice, this.maxAudioBytes);
    } catch (cause) {
      if (controller.signal.aborted) {
        throw providerFailure('Google Gemini TTS request timed out.', cause);
      }
      if (cause instanceof VidGenError) throw cause;
      throw providerFailure('Unable to reach the Google Gemini TTS service.', cause);
    } finally { clearTimeout(timeout); }
  }
}

async function parseBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) throw providerFailure('Google Gemini TTS response exceeded the maximum supported size.');
  if (response.body === null) throw providerFailure('Google Gemini TTS response was not valid JSON.');
  const reader = response.body.getReader(); let bytes = 0; let text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw providerFailure('Google Gemini TTS response exceeded the maximum supported size.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) { if (cause instanceof VidGenError) throw cause; throw providerFailure('Google Gemini TTS response could not be read.', cause); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; } catch (cause) { throw providerFailure('Google Gemini TTS response was not valid JSON.', cause); }
}

function extractSpeechResult(payload: unknown, provider: string, configuredModel: string, voice: string, maxAudioBytes: number): SpeechGenerationResult {
  const interaction = asRecord(payload);
  if (interaction === undefined || interaction.status !== 'completed') throw providerFailure('Google Gemini TTS response was not a completed interaction.');
  const requestId = optionalNonBlankString(interaction.id);
  if (Object.hasOwn(interaction, 'id') && requestId === undefined) throw providerFailure('Google Gemini TTS response had an invalid interaction identifier.');
  const actualModel = optionalNonBlankString(interaction.model);
  if (Object.hasOwn(interaction, 'model') && actualModel === undefined) throw providerFailure('Google Gemini TTS response had an invalid model identifier.');
  const outputAudio = asRecord(interaction.output_audio);
  if (outputAudio === undefined || typeof outputAudio.data !== 'string' || outputAudio.data.length === 0) throw providerFailure('Google Gemini TTS response did not include audio output.');
  const pcm = decodeBase64(outputAudio.data, maxAudioBytes);
  if (pcm.length === 0 || pcm.length % 2 !== 0) throw providerFailure('Google Gemini TTS response had invalid PCM audio.');
  const bytes = pcmToWav(pcm);
  const durationSeconds = pcm.length / (PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8));
  return {
    provider, model: actualModel ?? configuredModel, voice, mimeType: 'audio/wav', bytes, durationSeconds,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw providerFailure('Google Gemini TTS response had malformed audio data.');
  const estimated = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (estimated > maxBytes) throw providerFailure('Google Gemini TTS audio exceeded the maximum supported size.');
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length !== estimated || bytes.length > maxBytes) throw providerFailure('Google Gemini TTS response had malformed audio data.');
  return bytes;
}

/** Deterministically wraps documented mono 24 kHz signed 16-bit PCM as WAV. */
export function pcmToWav(pcm: Uint8Array): Uint8Array {
  if (pcm.length === 0 || pcm.length % 2 !== 0 || pcm.length > 0xffff_ffff - 36) throw new VidGenError('generated_media', 'PCM audio cannot be represented as a WAV artifact.');
  const wav = new Uint8Array(44 + pcm.length); const view = new DataView(wav.buffer);
  writeAscii(wav, 0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); writeAscii(wav, 8, 'WAVE'); writeAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, PCM_CHANNELS, true); view.setUint32(24, PCM_SAMPLE_RATE, true);
  view.setUint32(28, PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), true); view.setUint16(32, PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8), true); view.setUint16(34, PCM_BITS_PER_SAMPLE, true);
  writeAscii(wav, 36, 'data'); view.setUint32(40, pcm.length, true); wav.set(pcm, 44); return wav;
}

function validateVoiceoverRequest(request: SpeechGenerationRequest): void {
  if (request === null || typeof request !== 'object' || request.unit === undefined) throw new VidGenError('invalid_argument', 'Google Gemini TTS generation request is invalid.');
  if (request.unit.role.kind !== 'voiceover') throw new VidGenError('generated_media', 'Google Gemini TTS supports voiceover generated-media units only.');
  if (typeof request.unit.spokenText !== 'string' || request.unit.spokenText.trim().length === 0) throw new VidGenError('generated_media', 'Google Gemini TTS requires resolved voiceover spoken text.');
}
function requiredEnvironmentValue(environment: GoogleGeminiTtsEnvironment, name: string): string { const value = environment[name]?.trim(); if (value === undefined || value.length === 0) throw new VidGenError('configuration', `Google Gemini ${name} configuration is required.`); return value; }
function isSafeConfigurationName(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function positiveSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function optionalNonBlankString(value: unknown): string | undefined { return typeof value === 'string' && value.trim().length > 0 ? value : undefined; }
function providerFailure(message: string, cause?: unknown): VidGenError { return new VidGenError('generated_media', message, cause === undefined ? {} : { cause }); }
function writeAscii(target: Uint8Array, offset: number, value: string): void { for (let i = 0; i < value.length; i += 1) target[offset + i] = value.charCodeAt(i); }
