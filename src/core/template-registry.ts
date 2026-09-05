import defaultNews40sDefinition from '../../templates/default-news-40s.json' with { type: 'json' };

import { type AssemblyTemplate, validateAssemblyTemplate } from './assembly-template.ts';
import { VidGenError } from './error.ts';

const builtInTemplates = new Map<string, AssemblyTemplate>([
  ['default-news-40s', validateAssemblyTemplate(defaultNews40sDefinition)],
]);

/** Returns a validated built-in template; this boundary deliberately has no discovery behavior. */
export function getAssemblyTemplate(templateId: string): AssemblyTemplate {
  const template = builtInTemplates.get(templateId);
  if (template === undefined) {
    throw new VidGenError('assembly_template', `Unknown assembly template ID: ${templateId}.`);
  }
  return template;
}
