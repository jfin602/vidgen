import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { VeoPromptAssetIdentity } from '../../core/generated-media.ts';
import { VidGenError } from '../../core/error.ts';

export const VIDGEN_VEO_PROMPT_FILE_ENV = 'VIDGEN_VEO_PROMPT_FILE';
export const MAX_VEO_PROMPT_SPEC_BYTES = 65_536;

type TemplateName = keyof VeoPromptTemplates;
type Placeholder = 'dialogue' | 'context' | 'retainedExtensionSeconds';

export interface VeoPromptTemplates {
  readonly simplePresenterInitial: string;
  readonly simplePresenterInitialWithExtension: string;
  readonly simplePresenterExtension: string;
  readonly cinematicPresenterInitial: string;
  readonly cinematicPresenterExtension: string;
  readonly cinematicContentInitial: string;
  readonly cinematicContentExtension: string;
}

export interface LoadedVeoPromptSpec {
  readonly templates: VeoPromptTemplates;
  readonly identity: VeoPromptAssetIdentity;
}

const required: Readonly<Record<TemplateName, readonly Placeholder[]>> = {
  simplePresenterInitial: ['dialogue'],
  simplePresenterInitialWithExtension: ['dialogue'],
  simplePresenterExtension: ['dialogue', 'retainedExtensionSeconds'],
  cinematicPresenterInitial: ['context', 'dialogue'],
  cinematicPresenterExtension: ['context', 'dialogue'],
  cinematicContentInitial: ['context'],
  cinematicContentExtension: ['context'],
};
const names = Object.keys(required) as TemplateName[];

/** Reads and validates one immutable prompt-byte snapshot for a configured client. */
export function loadVeoPromptSpec(environment: Readonly<Record<string, string | undefined>> = process.env): LoadedVeoPromptSpec {
  try {
    const path = environment[VIDGEN_VEO_PROMPT_FILE_ENV];
    if (typeof path !== 'string' || path.trim().length === 0) throw new Error('missing');
    const info = lstatSync(path);
    if (!info.isFile() || info.size < 1 || info.size > MAX_VEO_PROMPT_SPEC_BYTES) throw new Error('file');
    const bytes = readFileSync(path);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_VEO_PROMPT_SPEC_BYTES) throw new Error('size');
    const name = basename(path);
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name)) throw new Error('basename');
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    const source = parsed as Record<string, unknown>;
    if (Object.keys(source).length !== names.length || Object.keys(source).some((key) => !names.includes(key as TemplateName))) throw new Error('fields');
    const templates = Object.fromEntries(names.map((name) => [name, template(source[name], required[name])])) as VeoPromptTemplates;
    return { templates, identity: { basename: name, sha256: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.byteLength } };
  } catch {
    throw new VidGenError('configuration', 'Agent Platform Veo prompt configuration is invalid.');
  }
}

/** Fixed, one-pass substitution; values never become template syntax. */
export function renderVeoPrompt(templateName: TemplateName, template: string, values: Readonly<Record<Placeholder, string>>): string {
  return template.replace(/\{\{(dialogue|context|retainedExtensionSeconds)\}\}/g, (_match, name: Placeholder) => values[name]);
}

function template(value: unknown, expected: readonly Placeholder[]): string {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > MAX_VEO_PROMPT_SPEC_BYTES) throw new Error('template');
  const found = [...value.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1]);
  if (value.replace(/\{\{[^{}]*\}\}/g, '').includes('{{') || value.replace(/\{\{[^{}]*\}\}/g, '').includes('}}') || found.length !== expected.length || new Set(found).size !== found.length || found.some((name) => !expected.includes(name as Placeholder)) || expected.some((name) => !found.includes(name))) throw new Error('placeholder');
  return value;
}
