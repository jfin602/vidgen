import type { JsonObject } from '../shared/json.ts';

/** A stateless request for provider-enforced JSON-shaped text output. */
export interface StructuredTextModelRequest {
  readonly systemInstruction: string;
  readonly input: string;
  readonly responseSchema: JsonObject;
}

/** Minimal provenance plus unparsed structured output for VidGen-owned validation. */
export interface StructuredTextModelResult {
  readonly provider: string;
  readonly model: string;
  readonly requestId?: string;
  readonly outputText: string;
}

/**
 * Provider-neutral structured text boundary. Callers receive only JSON text
 * and minimal provenance; provider transport envelopes stay in adapters.
 */
export interface StructuredTextModelClient {
  readonly provider: string;
  readonly model: string;
  generateStructuredJson(request: StructuredTextModelRequest): Promise<StructuredTextModelResult>;
}
