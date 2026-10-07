import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags, runtimeFields } from '../contract/index.mjs';
import baseline from './fixtures/visual-trim-baseline.json' with { type: 'json' };

const names = [
  'cobalt-fog-leadchip-pickleball-1.html',
  'cobalt-fog-leadchip-pickleball-2.html',
  'cobalt-fog-leadchip-table-tennis-1.html',
  'cobalt-fog-leadchip-table-tennis-2.html',
];
const fields = new Set(runtimeFields.map(entry => entry.field));
const bound = tag => tag.attributes['data-osb-field'] || tag.attributes['data-field']
  || (tag.attributes.class || '').split(/\s+/).some(name => fields.has(name));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceFor = name => readFile(new URL(`../templates/html-replications/${name}`, import.meta.url), 'utf8');

for (const name of names) {
  test(`${name}: runtime states, image slots and score units survive header cleanup`, async () => {
    const html = await sourceFor(name);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    const bindings = tags.filter(bound).map(tag => ({ tag: tag.name, attributes: tag.attributes }));
    const images = tags.filter(tag => tag.name === 'img').map(tag => tag.attributes);
    const before = baseline[name];
    assert.equal(hash(bindings), before.bindingsHash, 'binding attributes changed');
    assert.equal(bindings.length, before.bindingCount);
    assert.equal(hash(images), before.imageSlotsHash, 'image slot attributes changed');
    assert.equal(images.length, before.imageSlotCount);
    for (const side of ['A', 'B']) {
      assert.match(html, new RegExp(`<span class="support-number current${side}MatchScore" data-osb-component="field" data-osb-field="current${side}MatchScore">0</span><span class="support-caption">GAMES</span>`));
      assert.match(html, new RegExp(`<span class="primary-number current${side}GameScore" data-osb-component="field" data-osb-field="current${side}GameScore">0</span><span class="primary-caption">POINTS</span>`));
    }
    assert.match(html, /data-osb-field="isGamePoint"[^>]*>GAME POINT</);
    assert.match(html, /data-osb-field="isMatchPoint"[^>]*>MATCH POINT</);
    assert.doesNotMatch(html, /osb-condition-side-label/, 'do not restore removed A/B rail captions');
    assert.deepEqual(inspectTemplate(html).errors, []);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html);
  });

  test(`${name}: no unbound GAME/MATCH counters or unused status CSS remain`, async () => {
    const html = await sourceFor(name);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    assert.equal(tags.filter(tag => (tag.attributes.class || '').split(/\s+/).includes('status')).length, 0);
    assert.doesNotMatch(html, /(?:GAME|MATCH)\s*<b>0<\/b>/);
    const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
    assert.doesNotMatch(css, /\.status\b/);
    assert.match(html, /<header class="header"><div class="sport-tag">(?:PICKLEBALL|TABLE TENNIS)<\/div><\/header>/);
  });
}
