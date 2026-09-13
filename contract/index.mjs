import registry from './runtime-fields.json' with { type: 'json' };
import { scoreboardTextDefault } from './live-field-defaults.mjs';
import { inspectScoreboardTemplate } from './inspection.mjs';

export { inspectScoreboardTemplate };
export { readTemplateHTMLTags, validateSafeScoreboardTemplateDocument, assertSafeTemplateCSS, assertTemplateAssetURL } from './static-html.mjs';
export { scoreboardTextDefault } from './live-field-defaults.mjs';
export { neutralizeScoreboardTemplateHTML } from './neutralize.mjs';
export const runtimeFields = registry.fields;
export const CORE_FIELDS = Object.freeze([
  'combinedAName', 'combinedBName', 'jerseyColorA', 'jerseyColorB',
  'currentAMatchScore', 'currentBMatchScore', 'currentAGameScore', 'currentBGameScore',
]);

export function inspectTemplate(html, css = '') {
  return inspectScoreboardTemplate(html, css);
}

/** Optional schema is an array of field names/records or an object with a fields array. */
export function getPreviewDefaults(schema = registry) {
  const fields = Array.isArray(schema) ? schema : schema?.fields;
  if (!Array.isArray(fields)) throw new TypeError('Preview schema must contain a fields array.');
  return Object.fromEntries(fields.map((entry) => {
    const field = typeof entry === 'string' ? entry : entry.field;
    if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)) throw new TypeError('Invalid preview field name.');
    const metadata = registry.fields.find((candidate) => candidate.field === field) || entry;
    const text = scoreboardTextDefault(field, 'preview');
    const value = metadata.valueType === 'boolean' ? false
      : metadata.valueType === 'number' || metadata.valueType === 'timer' ? 0
        : text ?? (metadata.valueType === 'color' ? (field.endsWith('B') ? '#bc4760' : '#218c86') : '');
    return [field, value];
  }));
}
