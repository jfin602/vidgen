import { VidGenError } from '../../core/error.ts';
import type {
  StructuredTextModelClient,
  StructuredTextModelRequest,
  StructuredTextModelResult,
} from '../../core/structured-text-model.ts';
import { assertJsonValue, type JsonObject } from '../../shared/json.ts';

export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';
export const GOOGLE_CLOUD_PROJECT_ENV = 'GOOGLE_CLOUD_PROJECT';
export const VIDGEN_TEXT_MODEL_ENV = 'VIDGEN_TEXT_MODEL';
export const GOOGLE_GEMINI_AGENT_PLATFORM_LOCATION = 'global';
export const DEFAULT_GOOGLE_GEMINI_TIMEOUT_MS = 10_000;
export const DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES = 1_000_000;

export type GoogleGeminiEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;

/** Runtime-only credentials and model selection for the Google text boundary. */
export interface GoogleGeminiRuntimeConfig {
  readonly apiKey: string;
  readonly project: string;
  readonly model: string;
}

export interface GoogleGeminiStructuredTextModelClientOptions {
  readonly environment?: GoogleGeminiEnvironment;
  readonly fetch?: FetchImplementation;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/** Reads only the credential and explicit model required by the adapter. */
export function loadGoogleGeminiRuntimeConfig(
  environment: GoogleGeminiEnvironment = process.env,
): GoogleGeminiRuntimeConfig {
  return {
    apiKey: requiredEnvironmentValue(environment, GEMINI_API_KEY_ENV),
    project: requiredSafeEnvironmentValue(environment, GOOGLE_CLOUD_PROJECT_ENV, /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,30})$/),
    model: requiredSafeEnvironmentValue(environment, VIDGEN_TEXT_MODEL_ENV, /^[A-Za-z0-9._-]+$/),
  };
}

/** Builds the sole supported project-scoped Gemini text endpoint. */
export function buildGoogleGeminiAgentPlatformEndpoint(project: string, model: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${GOOGLE_GEMINI_AGENT_PLATFORM_LOCATION}/publishers/google/models/${model}:generateContent`;
}

/**
 * Stateless Agent Platform Gemini text adapter. It deliberately has no
 * conversation, tools, background execution, or provider response exposure.
 */
export class GoogleGeminiStructuredTextModelClient implements StructuredTextModelClient {
  readonly provider = 'google-agent-platform';
  readonly model: string;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: GoogleGeminiStructuredTextModelClientOptions = {}) {
    const config = loadGoogleGeminiRuntimeConfig(options.environment);
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.endpoint = buildGoogleGeminiAgentPlatformEndpoint(config.project, config.model);
    this.fetchImplementation = options.fetch ?? fetch;
    this.timeoutMs = positiveSafeInteger(
      options.timeoutMs ?? DEFAULT_GOOGLE_GEMINI_TIMEOUT_MS,
      'Google Gemini timeout must be a positive whole number of milliseconds.',
    );
    this.maxResponseBytes = positiveSafeInteger(
      options.maxResponseBytes ?? DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES,
      'Google Gemini maximum response size must be a positive whole number of bytes.',
    );
  }

  async generateStructuredJson(request: StructuredTextModelRequest): Promise<StructuredTextModelResult> {
    const body = buildRequestBody(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new VidGenError('text_model', 'Google Gemini text-model service returned an unsuccessful response.');
      }

      const payload = await parseBoundedJson(response, this.maxResponseBytes);
      return extractStructuredTextResult(payload, this.provider, this.model);
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new VidGenError('text_model', 'Google Gemini text-model request timed out.', { cause });
      }
      if (cause instanceof VidGenError) {
        throw cause;
      }
      throw new VidGenError('text_model', 'Unable to reach the Google Gemini text-model service.', { cause });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildRequestBody(request: StructuredTextModelRequest): JsonObject {
  if (typeof request.systemInstruction !== 'string' || typeof request.input !== 'string') {
    throw new VidGenError('invalid_argument', 'Structured text-model instructions and input must be strings.');
  }
  assertJsonValue(request.responseSchema);

  return {
    systemInstruction: { parts: [{ text: request.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: request.input }] }],
    generationConfig: {
      candidateCount: 1,
      responseMimeType: 'application/json',
      responseSchema: request.responseSchema,
    },
  };
}

async function parseBoundedJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxResponseBytes) {
    throw providerFailure('Google Gemini text-model response exceeded the maximum supported size.');
  }

  if (response.body === null) {
    throw providerFailure('Google Gemini text-model response was not valid JSON.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxResponseBytes) {
        await reader.cancel();
        throw providerFailure('Google Gemini text-model response exceeded the maximum supported size.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) {
    if (cause instanceof VidGenError) {
      throw cause;
    }
    throw providerFailure('Google Gemini text-model response could not be read.', cause);
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw providerFailure('Google Gemini text-model response was not valid JSON.', cause);
  }
}

function extractStructuredTextResult(
  payload: unknown,
  provider: string,
  configuredModel: string,
): StructuredTextModelResult {
  const response = asRecord(payload);
  if (response === undefined) {
    throw providerFailure('Google Gemini text-model response was malformed.');
  }

  const requestId = optionalSafeProviderIdentifier(response.responseId);
  if (Object.hasOwn(response, 'responseId') && requestId === undefined) {
    throw providerFailure('Google Gemini text-model response had an invalid response identifier.');
  }
  const actualModel = optionalSafeProviderIdentifier(response.modelVersion);
  if (Object.hasOwn(response, 'modelVersion') && actualModel === undefined) {
    throw providerFailure('Google Gemini text-model response had an invalid model identifier.');
  }

  if (!Array.isArray(response.candidates) || response.candidates.length !== 1) {
    throw providerFailure('Google Gemini text-model response did not include model output.');
  }
  const candidate = asRecord(response.candidates[0]);
  const content = candidate === undefined || (candidate.finishReason !== undefined && candidate.finishReason !== 'STOP')
    ? undefined
    : asRecord(candidate.content);
  if (content === undefined || !Array.isArray(content.parts) || content.parts.length !== 1) {
    throw providerFailure('Google Gemini text-model response did not include model output.');
  }

  const part = asRecord(content.parts[0]);
  if (part === undefined || typeof part.text !== 'string') {
    throw providerFailure('Google Gemini text-model response did not include text-only model output.');
  }
  const outputText = part.text;
  if (outputText.trim().length === 0) {
    throw providerFailure('Google Gemini text-model response included empty model output.');
  }

  return requestId === undefined
    ? { provider, model: actualModel ?? configuredModel, outputText }
    : { provider, model: actualModel ?? configuredModel, requestId, outputText };
}

function requiredSafeEnvironmentValue(
  environment: GoogleGeminiEnvironment,
  name: string,
  pattern: RegExp,
): string {
  const value = requiredEnvironmentValue(environment, name);
  if (!pattern.test(value)) {
    throw new VidGenError('configuration', `Google Gemini ${name} configuration is required.`);
  }
  return value;
}

function requiredEnvironmentValue(environment: GoogleGeminiEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new VidGenError('configuration', `Google Gemini ${name} configuration is required.`);
  }
  return value;
}

function positiveSafeInteger(value: number, publicMessage: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new VidGenError('invalid_argument', publicMessage);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalSafeProviderIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^(?!\/)(?![A-Za-z]:[\\/])(?!file:)[A-Za-z0-9._:/@ -]{1,256}$/i.test(value)
    ? value
    : undefined;
}

function providerFailure(publicMessage: string, cause?: unknown): VidGenError {
  return new VidGenError('text_model', publicMessage, cause === undefined ? {} : { cause });
}
