import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CORE_FIELDS, inspectTemplate, readTemplateHTMLTags, neutralizeScoreboardTemplateHTML } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };

const entries = manifest.filter(entry => entry.output.startsWith('html-replications/sport-'));
test('five sport concepts preserve supported live bindings and disclose manual counters', async () => {
  assert.deepEqual(entries.map(entry => entry.sport).sort(), ['baseball', 'basketball', 'soccer', 'softball', 'volleyball']);
  for (const entry of entries) {
    const html = await readFile(new URL(`../templates/${entry.output}`, import.meta.url), 'utf8');
    const inspection = inspectTemplate(html);
    assert.deepEqual(inspection.errors, [], entry.output);
    assert.deepEqual(inspection.warnings, ['This template has no service indicators.'], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, entry.output);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    for (const field of CORE_FIELDS) {
      const matches = tags.filter(tag => tag.attributes['data-osb-field'] === field);
      assert.equal(matches.length, 1, `${entry.output}: ${field}`);
      assert.equal(matches[0].attributes['data-osb-component'], 'field');
    }
    assert.equal(entry.scoringMode, 'generic');
    assert.equal(entry.runtimeSupport.sportRules, false);
    assert.equal(entry.runtimeSupport.sportCounters, 'editable-static');
    assert.match(entry.description, /editable static placeholder/);
    assert.ok(!entry.defaultForSports, 'do not imply native sport support');
    const statTags = tags.filter(tag => tag.attributes['data-sport-stat']);
    assert.ok(statTags.length > 0);
    for (const tag of statTags) {
      assert.equal(tag.attributes['data-osb-static'], 'true');
      assert.equal(tag.attributes['data-osb-field'], undefined);
      const close = html.indexOf(`</${tag.name}>`, tag.end);
      assert.match(html.slice(tag.end, close).trim(), /^(?:0|00|00:00)$/);
    }
  }
});
