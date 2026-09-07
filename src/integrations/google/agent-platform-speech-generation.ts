import { VidGenError } from '../../core/error.ts';
import type {
  SpeechGenerationClient,
  SpeechGenerationRequest,
  SpeechGenerationResult,
} from '../../core/generated-media.ts';
import { defaultGoogleCloudAccessToken, type GoogleCloudAccessTokenProvider } from './google-cloud-auth.ts';

export const VIDGEN_TTS_MODEL_ENV = 'VIDGEN_TTS_MODEL';
export const VIDGEN_TTS_VOICE_ENV = 'VIDGEN_TTS_VOICE';
export const VIDGEN_TTS_LANGUAGE_CODE_ENV = 'VIDGEN_TTS_LANGUAGE_CODE';
export const GOOGLE_CLOUD_PROJECT_ENV = 'GOOGLE_CLOUD_PROJECT';
export const GOOGLE_AGENT_PLATFORM_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
export const DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_TIMEOUT_MS = 15_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_AUTH_TIMEOUT_MS = 30_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_MAX_RESPONSE_BYTES = 8_000_000;
export const DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_MAX_AUDIO_BYTES = 6_000_000;
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const SAFE_PROJECT = /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,30})$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_ACCESS_TOKEN = /^[A-Za-z0-9._~-]{1,16384}$/;

export type GoogleAgentPlatformTtsEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;

export interface GoogleAgentPlatformTtsRuntimeConfig {
  readonly project: string;
  readonly model: string;
  readonly voice: string;
  readonly languageCode: string;
}

export interface GoogleAgentPlatformSpeechGenerationClientOptions {
  readonly environment?: GoogleAgentPlatformTtsEnvironment;
  readonly fetch?: FetchImplementation;
  readonly getAccessToken?: GoogleCloudAccessTokenProvider;
  readonly timeoutMs?: number;
  readonly authTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxAudioBytes?: number;
}

/** Loads only the Cloud identity and explicit selection required for Gemini TTS. */
export function loadGoogleAgentPlatformTtsRuntimeConfig(
  environment: GoogleAgentPlatformTtsEnvironment = process.env,
): GoogleAgentPlatformTtsRuntimeConfig {
  const project = requiredEnvironmentValue(environment, GOOGLE_CLOUD_PROJECT_ENV);
  const model = requiredEnvironmentValue(environment, VIDGEN_TTS_MODEL_ENV);
  const voice = requiredEnvironmentValue(environment, VIDGEN_TTS_VOICE_ENV);
  const languageCode = requiredEnvironmentValue(environment, VIDGEN_TTS_LANGUAGE_CODE_ENV);
  if (!SAFE_PROJECT.test(project) || !SAFE_NAME.test(model) || !SAFE_NAME.test(voice) || !SAFE_NAME.test(languageCode)) {
    throw new VidGenError('configuration', 'Agent Platform Gemini TTS project, model, voice, or language configuration is invalid.');
  }
  return { project, model, voice, languageCode };
}

/** Stateless Cloud Text-to-Speech adapter for off-screen template voiceover only. */
export class GoogleAgentPlatformSpeechGenerationClient implements SpeechGenerationClient {
  readonly provider = 'google-agent-platform-gemini-tts';
  readonly model: string;
  readonly voice: string;
  private readonly project: string;
  private readonly languageCode: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly getAccessToken: GoogleCloudAccessTokenProvider;
  private readonly timeoutMs: number;
  private readonly authTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAudioBytes: number;

  constructor(options: GoogleAgentPlatformSpeechGenerationClientOptions = {}) {
    const config = loadGoogleAgentPlatformTtsRuntimeConfig(options.environment);
    this.project = config.project;
    this.model = config.model;
    this.voice = config.voice;
    this.languageCode = config.languageCode;
    this.fetchImplementation = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken ?? defaultGoogleCloudAccessToken;
    this.timeoutMs = positiveSafeInteger(options.timeoutMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_TIMEOUT_MS, 'Agent Platform Gemini TTS timeout must be a positive whole number of milliseconds.');
    this.authTimeoutMs = positiveSafeInteger(options.authTimeoutMs ?? DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_AUTH_TIMEOUT_MS, 'Agent Platform Gemini TTS authentication timeout must be a positive whole number of milliseconds.');
    this.maxResponseBytes = positiveSafeInteger(options.maxResponseBytes ?? DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_MAX_RESPONSE_BYTES, 'Agent Platform Gemini TTS maximum response size must be a positive whole number of bytes.');
    this.maxAudioBytes = positiveSafeInteger(options.maxAudioBytes ?? DEFAULT_GOOGLE_AGENT_PLATFORM_TTS_MAX_AUDIO_BYTES, 'Agent Platform Gemini TTS maximum audio size must be a positive whole number of bytes.');
  }

  async generateSpeech(request: SpeechGenerationRequest): Promise<SpeechGenerationResult> {
    validateVoiceoverRequest(request);
    const token = await this.accessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(GOOGLE_AGENT_PLATFORM_TTS_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': this.project },
        body: JSON.stringify({
          input: { text: request.unit.spokenText },
          voice: { languageCode: this.languageCode, name: this.voice, modelName: this.model },
          audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: PCM_SAMPLE_RATE, audioChannelCount: PCM_CHANNELS },
        }),
        redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw providerFailure('Agent Platform Gemini TTS service returned an unsuccessful response.');
      return extractSpeechResult(await parseBoundedJson(response, this.maxResponseBytes), this.provider, this.model, this.voice, this.maxAudioBytes);
    } catch (cause) {
      if (controller.signal.aborted) throw providerFailure('Agent Platform Gemini TTS request timed out.', cause);
      if (cause instanceof VidGenError) throw cause;
      throw providerFailure('Unable to reach the Agent Platform Gemini TTS service.', cause);
    } finally { clearTimeout(timeout); }
  }

  private async accessToken(): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const token = await Promise.race([
        this.getAccessToken(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.authTimeoutMs); }),
      ]);
      if (typeof token !== 'string' || !SAFE_ACCESS_TOKEN.test(token)) throw new Error('invalid token');
      return token;
    } catch (cause) { throw providerFailure('Agent Platform Gemini TTS authentication failed.', cause); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

async function parseBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) throw providerFailure('Agent Platform Gemini TTS response exceeded the maximum supported size.');
  if (response.body === null) throw providerFailure('Agent Platform Gemini TTS response was not valid JSON.');
  const reader = response.body.getReader(); let bytes = 0; let text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw providerFailure('Agent Platform Gemini TTS response exceeded the maximum supported size.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) { if (cause instanceof VidGenError) throw cause; throw providerFailure('Agent Platform Gemini TTS response could not be read.', cause); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(text) as unknown; } catch (cause) { throw providerFailure('Agent Platform Gemini TTS response was not valid JSON.', cause); }
}

function extractSpeechResult(payload: unknown, provider: string, model: string, voice: string, maxAudioBytes: number): SpeechGenerationResult {
  const response = asRecord(payload);
  if (response === undefined || typeof response.audioContent !== 'string' || response.audioContent.length === 0) throw providerFailure('Agent Platform Gemini TTS response did not include audio output.');
  const pcm = decodeBase64(response.audioContent, maxAudioBytes);
  if (pcm.length === 0 || pcm.length % 2 !== 0) throw providerFailure('Agent Platform Gemini TTS response had invalid PCM audio.');
  return { provider, model, voice, mimeType: 'audio/wav', bytes: pcmToWav(pcm), durationSeconds: pcm.length / (PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8)) };
}

function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw providerFailure('Agent Platform Gemini TTS response had malformed audio data.');
  const estimated = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (estimated > maxBytes) throw providerFailure('Agent Platform Gemini TTS audio exceeded the maximum supported size.');
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length !== estimated || bytes.length > maxBytes) throw providerFailure('Agent Platform Gemini TTS response had malformed audio data.');
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
  if (request === null || typeof request !== 'object' || request.unit === undefined) throw new VidGenError('invalid_argument', 'Agent Platform Gemini TTS generation request is invalid.');
  if (request.unit.role.kind !== 'voiceover') throw new VidGenError('generated_media', 'Agent Platform Gemini TTS supports voiceover generated-media units only.');
  if (typeof request.unit.spokenText !== 'string' || request.unit.spokenText.trim().length === 0) throw new VidGenError('generated_media', 'Agent Platform Gemini TTS requires resolved voiceover spoken text.');
}
function requiredEnvironmentValue(environment: GoogleAgentPlatformTtsEnvironment, name: string): string { const value = environment[name]?.trim(); if (value === undefined || value.length === 0) throw new VidGenError('configuration', `Agent Platform Gemini TTS ${name} configuration is required.`); return value; }
function positiveSafeInteger(value: number, message: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new VidGenError('invalid_argument', message); return value; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function providerFailure(message: string, cause?: unknown): VidGenError { return new VidGenError('generated_media', message, cause === undefined ? {} : { cause }); }
function writeAscii(target: Uint8Array, offset: number, value: string): void { for (let i = 0; i < value.length; i += 1) target[offset + i] = value.charCodeAt(i); }
