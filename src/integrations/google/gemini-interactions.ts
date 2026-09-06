import { VidGenError } from '../../core/error.ts';
import type {
  StructuredTextModelClient,
  StructuredTextModelRequest,
  StructuredTextModelResult,
} from '../../core/structured-text-model.ts';
import { assertJsonValue, type JsonObject } from '../../shared/json.ts';

export const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';
export const VIDGEN_TEXT_MODEL_ENV = 'VIDGEN_TEXT_MODEL';
export const GOOGLE_GEMINI_INTERACTIONS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta2/interactions';
export const DEFAULT_GOOGLE_GEMINI_TIMEOUT_MS = 10_000;
export const DEFAULT_GOOGLE_GEMINI_MAX_RESPONSE_BYTES = 1_000_000;

export type GoogleGeminiEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchImplementation = typeof fetch;

/** Runtime-only credentials and model selection for the Google text boundary. */
export interface GoogleGeminiRuntimeConfig {
  readonly apiKey: string;
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
    model: requiredEnvironmentValue(environment, VIDGEN_TEXT_MODEL_ENV),
  };
}

/**
 * Stateless Google Gemini Interactions API adapter. It deliberately has no
 * conversation, tools, background execution, or provider response exposure.
 */
export class GoogleGeminiStructuredTextModelClient implements StructuredTextModelClient {
  readonly provider = 'google-gemini';
  readonly model: string;

  private readonly apiKey: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: GoogleGeminiStructuredTextModelClientOptions = {}) {
    const config = loadGoogleGeminiRuntimeConfig(options.environment);
    this.apiKey = config.apiKey;
    this.model = config.model;
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
    const body = buildRequestBody(this.model, request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(GOOGLE_GEMINI_INTERACTIONS_ENDPOINT, {
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

function buildRequestBody(model: string, request: StructuredTextModelRequest): JsonObject {
  if (typeof request.systemInstruction !== 'string' || typeof request.input !== 'string') {
    throw new VidGenError('invalid_argument', 'Structured text-model instructions and input must be strings.');
  }
  assertJsonValue(request.responseSchema);

  // Google currently documents v1beta2 Interactions structured output as a
  // top-level response_format array. Keep this provider-specific wire shape
  // confined to the adapter.
  return {
    model,
    store: false,
    system_instruction: request.systemInstruction,
    input: request.input,
    response_format: [{
      type: 'text',
      mime_type: 'application/json',
      schema: request.responseSchema,
    }],
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
  const interaction = asRecord(payload);
  if (interaction === undefined || interaction.status !== 'completed') {
    throw providerFailure('Google Gemini text-model response was not a completed interaction.');
  }

  const requestId = optionalNonBlankString(interaction.id);
  if (Object.hasOwn(interaction, 'id') && requestId === undefined) {
    throw providerFailure('Google Gemini text-model response had an invalid interaction identifier.');
  }
  const actualModel = optionalNonBlankString(interaction.model);
  if (Object.hasOwn(interaction, 'model') && actualModel === undefined) {
    throw providerFailure('Google Gemini text-model response had an invalid model identifier.');
  }

  if (!Array.isArray(interaction.steps)) {
    throw providerFailure('Google Gemini text-model response did not include model output.');
  }
  const modelOutput = interaction.steps.findLast(
    (step): step is Record<string, unknown> => asRecord(step)?.type === 'model_output',
  );
  if (modelOutput === undefined || !Array.isArray(modelOutput.content) || modelOutput.content.length === 0) {
    throw providerFailure('Google Gemini text-model response did not include model output.');
  }

  const textBlocks = modelOutput.content.map(asRecord);
  if (textBlocks.some((block) => block?.type !== 'text' || typeof block.text !== 'string')) {
    throw providerFailure('Google Gemini text-model response did not include text-only model output.');
  }
  const outputText = textBlocks.map((block) => block.text).join('');
  if (outputText.trim().length === 0) {
    throw providerFailure('Google Gemini text-model response included empty model output.');
  }

  return requestId === undefined
    ? { provider, model: actualModel ?? configuredModel, outputText }
    : { provider, model: actualModel ?? configuredModel, requestId, outputText };
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

function optionalNonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function providerFailure(publicMessage: string, cause?: unknown): VidGenError {
  return new VidGenError('text_model', publicMessage, cause === undefined ? {} : { cause });
}
