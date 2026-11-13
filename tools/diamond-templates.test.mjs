import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };

// Live-board "must be on template" fields for baseball/softball (OpenScoreboard template-requirements v2),
// plus the summary totals; a field counts when an element carries it as a class or data-osb-field.
const REQUIRED = ['currentAGameScore', 'currentBGameScore', 'jerseyColorA', 'jerseyColorB', 'eventName', 'matchRound',
  'isInBetweenGames', 'isMatchStarted', 'combinedAName', 'combinedBName', 'balls', 'bases', 'battingSide', 'hitsA', 'hitsB',
  'errorsA', 'errorsB', 'inning', 'inningHalf', 'outs', 'strikes', 'isGame1Started'];
const entries = manifest.filter(entry => /^html-replications\/starter-(?:baseball|softball)-/.test(entry.output));
const classes = tag => (tag.attributes.class || '').split(/\s+/).filter(Boolean);

test('sport-native diamond starters cover four corners, four lower thirds and two full screens per sport', () => {
  for (const sport of ['baseball', 'softball']) {
    const placements = entries.filter(entry => entry.sport === sport).map(entry => entry.placement).sort();
    assert.deepEqual(placements, [...Array(4).fill('corner'), 'full-screen', 'full-screen', ...Array(4).fill('lower-third')], sport);
  }
});

test('diamond starters bind the sport fields, group the count and keep stored values neutral', async () => {
  for (const entry of entries) {
    const html = await readFile(new URL(`../templates/${entry.output}`, import.meta.url), 'utf8');
    const label = entry.output;
    assert.ok(entry.output.split('/')[1].startsWith(`starter-${entry.sport}-`), label);
    const inspection = inspectTemplate(html);
    assert.deepEqual(inspection.errors, [], label);
    assert.deepEqual(inspection.warnings, ['This template has no service indicators.'], label);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, label);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    const present = new Set(tags.flatMap(tag => [...classes(tag), tag.attributes['data-osb-field']].filter(Boolean)));
    for (const field of entry.placement === 'full-screen' && /final/.test(label) ? REQUIRED.filter(f => !['balls', 'strikes', 'outs', 'bases', 'inning', 'inningHalf', 'isInBetweenGames', 'battingSide'].includes(f)) : REQUIRED) {
      assert.ok(present.has(field), `${label}: ${field}`);
    }
    if (!/final/.test(label)) {
      // A real diamond: the three base markers sit directly in one .diamond container.
      const diamond = html.match(/<span class="diamond[^"]*"[^>]*><span class="base second"><\/span><span class="base third"><\/span><span class="base first"><\/span>/);
      assert.ok(diamond, `${label}: diamond with three bases`);
      // Balls and strikes share one count element; outs follow in the same situation block.
      assert.match(html, /class="bb-count">[^]*?class="bb-b[^"]*\bballs"[^]*?class="bb-dash"[^]*?class="bb-s[^"]*\bstrikes"/, `${label}: grouped B-S count`);
      assert.match(html, /<span class="inningHalf" data-osb-component="field"><\/span>/, `${label}: empty live inning half`);
    }
    for (const tag of tags.filter(tag => tag.attributes['data-sport-stat'])) {
      assert.ok(classes(tag).includes(tag.attributes['data-sport-stat']), `${label}: live class for ${tag.attributes['data-sport-stat']}`);
      assert.equal(tag.attributes['data-osb-static'], 'true', label);
      const close = html.indexOf(`</${tag.name}>`, tag.end);
      assert.equal(html.slice(tag.end, close), '0', `${label}: stored counter must be 0`);
    }
    const innings = entry.sport === 'softball' ? 7 : 9;
    const ticks = tags.filter(tag => classes(tag).includes('bb-tick')).length;
    if (ticks) assert.equal(ticks, innings, `${label}: one inning pip per regulation inning`);
    const headers = [...html.matchAll(/<span class="bb-ls-col(?: bb-ls-extra)?"><span class="bb-ls-h">(\d+)<\/span>/g)];
    if (headers.length) assert.equal(headers.filter(match => !match[0].includes('bb-ls-extra')).length, innings, `${label}: regulation line score`);
    assert.match(html, /prefers-reduced-motion:reduce/, label);
    assert.doesNotMatch(html, new RegExp(entry.sport === 'softball' ? 'BASEBALL' : 'SOFTBALL'), `${label}: wrong sport label`);
  }
});
