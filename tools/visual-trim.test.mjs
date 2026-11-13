import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readTemplateHTMLTags, runtimeFields, inspectTemplate, neutralizeScoreboardTemplateHTML } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };
import baseline from './fixtures/visual-trim-baseline.json' with { type: 'json' };

const fields = new Set(runtimeFields.map(f => f.field));
const inBaseline = e => Object.hasOwn(baseline, e.output.split('/').pop());
// Templates authored after the 2026-10-06 trim have no baseline; they still get the error/neutrality checks below.
const active = manifest.filter(e => !e.retired && e.published !== false && inBaseline(e));
const added = manifest.filter(e => !inBaseline(e));
// Designs active at the 2026-10-06 trim. Later curation may retire them from the gallery, but their sources
// remain readable documents, so their bindings, image slots and neutral values are still checked.
const tracked = manifest.filter(e => inBaseline(e) && !baseline[e.output.split('/').pop()].retired);
const sourceFor = e => readFile(new URL(`../templates/${e.output}`, import.meta.url), 'utf8');
const bound = t => t.attributes['data-osb-field'] || t.attributes['data-field'] || (t.attributes.class || '').split(/\s+/).some(c => fields.has(c));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('visual cleanup preserves every existing runtime binding, optional image slot and neutral value', async () => {
  // The 1046 designs in the cleanup baseline stay in the manifest (active or deliberately retired, never
  // silently dropped); later additions are checked without a baseline.
  assert.equal(tracked.length, 1046);
  for (const entry of tracked) assert.ok(!entry.retired || entry.published === false, `${entry.output}: retired but still published`);
  for (const entry of [...tracked, ...active.filter(e => !tracked.includes(e))]) {
    const html = await sourceFor(entry);
    const tags = readTemplateHTMLTags(html).filter(t => !t.closing);
    const before = baseline[entry.output.split('/').pop()];
    if (!before) {
      assert.deepEqual(inspectTemplate(html).errors, [], entry.output);
      assert.equal(neutralizeScoreboardTemplateHTML(html), html, `${entry.output}: saved sample data`);
      continue;
    }
    assert.equal(hash(tags.filter(bound).map(t => ({ tag: t.name, attributes: t.attributes }))), before.bindingsHash, `${entry.output}: changed a functional binding`);
    assert.equal(hash(tags.filter(t => t.name === 'img').map(t => t.attributes)), before.imageSlotsHash, `${entry.output}: lost an image slot`);
    assert.deepEqual(inspectTemplate(html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, `${entry.output}: saved sample data`);
  }
});

test('templates added after the visual-trim baseline are new starter documents with clean neutral sources', async () => {
  for (const entry of added) {
    assert.match(entry.output, /^html-replications\/(?:starter|native)-[a-z0-9-]+\.html$/, entry.output);
    const html = await sourceFor(entry);
    assert.deepEqual(inspectTemplate(html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, `${entry.output}: saved sample data`);
  }
});

test('reserved status rails have no redundant visible A/B side captions or their dead label styles', async () => {
  const failures = [];
  for (const entry of active) {
    const html = await sourceFor(entry);
    if (/osb-condition-side-label/.test(html)) failures.push(entry.output);
  }
  assert.deepEqual(failures, [], `Remove only the unbound status-rail captions: ${failures.slice(0, 8).join(', ')}`);
});

test('retired designs and all historical published documents remain unchanged and readable', async () => {
  for (const entry of manifest.filter(inBaseline)) {
    const name = entry.output.split('/').pop(), before = baseline[name];
    if (!before) continue; // added after the cleanup baseline
    if (before.retired) assert.equal(createHash('sha256').update(await sourceFor(entry)).digest('hex'), before.sourceHash, `${name}: retired source changed`);
    const old = JSON.parse(await readFile(new URL(`../${before.documentPath}`, import.meta.url), 'utf8'));
    assert.equal(createHash('sha256').update(old.html).digest('hex'), before.sourceHash, `${name}: old source blob changed`);
  }
});
