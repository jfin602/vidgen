import defaultNews40sDefinition from '../../templates/default-news-40s.json' with { type: 'json' };

import { type AssemblyTemplate, validateAssemblyTemplate } from './assembly-template.ts';
import { VidGenError } from './error.ts';

const defaultNews40sTemplate = validateAssemblyTemplate(defaultNews40sDefinition);

/** Returns a validated built-in template; this boundary deliberately has no discovery behavior. */
export function getAssemblyTemplate(templateId: string): AssemblyTemplate {
  if (templateId !== defaultNews40sTemplate.id) {
    throw new VidGenError('assembly_template', `Unknown assembly template ID: ${templateId}.`);
  }
  return defaultNews40sTemplate;
}
