import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT } from './build-catalog.mjs';
import { readTemplateHTMLTags, runtimeFields, inspectTemplate, neutralizeScoreboardTemplateHTML } from '../contract/index.mjs';

const fields = new Set(runtimeFields.map(f => f.field));
const binding = t => t.attributes['data-osb-field'] || t.attributes['data-field'] || (t.attributes.class || '').split(/\s+/).some(c => fields.has(c));
const signature = html => readTemplateHTMLTags(html).filter(t => !t.closing && binding(t)).map(t => ({ tag: t.name, attributes: t.attributes }));

/** A narrow mechanical edit: remove only confirmed nonbinding status-rail captions. */
export function trimStatusCaptions(source) {
  const before = signature(source);
  const tags = readTemplateHTMLTags(source);
  const edits = [];
  for (let i = 0; i < tags.length - 1; i++) {
    const tag = tags[i], close = tags[i + 1];
    if (tag.closing || !(tag.attributes.class || '').split(/\s+/).includes('osb-condition-side-label')) continue;
    if (tag.name !== 'span' || binding(tag) || !close.closing || close.name !== tag.name || !/^[AB]$/.test(source.slice(tag.end, close.start).trim())) throw Error('Unexpected status caption structure; inspect manually.');
    edits.push({ start: tag.start, end: close.end });
  }
  let html = source;
  for (const edit of edits.reverse()) html = html.slice(0, edit.start) + html.slice(edit.end);
  if (edits.length) {
    html = html.replace(/\.osb-conditional-rail\s+\.osb-condition-side-label\s*\{[^{}]*\}\r?\n?/g, '');
    if (/osb-condition-side-label/.test(html)) throw Error('Unexpected residual caption selector; inspect manually.');
    if (JSON.stringify(signature(html)) !== JSON.stringify(before)) throw Error('A functional binding changed.');
    if (neutralizeScoreboardTemplateHTML(html) !== html || inspectTemplate(html).errors.length) throw Error('Edited template is not neutral or structurally valid.');
  }
  return { html, removed: edits.length };
}

export async function trimCorpus({ root = DEFAULT_ROOT, apply = false } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'templates/html-replications/manifest.json'), 'utf8'));
  const result = [];
  for (const entry of manifest.filter(e => !e.retired && e.published !== false)) {
    const file = path.join(root, 'templates', entry.output);
    const source = await readFile(file, 'utf8');
    const edited = trimStatusCaptions(source);
    if (!edited.removed) continue;
    if (apply) await writeFile(file, edited.html);
    result.push({ fileName: entry.output.split('/').pop(), removed: edited.removed });
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => a !== '--apply')) throw Error('Usage: node tools/trim-status-captions.mjs [--apply]');
    const result = await trimCorpus({ apply: args.includes('--apply') });
    console.log(JSON.stringify({ applied: args.includes('--apply'), templates: result.length, removed: result.reduce((n,e) => n + e.removed, 0), files: result }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
