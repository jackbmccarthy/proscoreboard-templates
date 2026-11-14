import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };

// Live-board "must be on template" fields for baseball/softball (OpenScoreboard template-requirements v2),
// plus the summary totals; a field counts when an element carries it as a class or data-osb-field.
const REQUIRED = ['currentAGameScore', 'currentBGameScore', 'jerseyColorA', 'jerseyColorB', 'eventName', 'matchRound',
  'isInBetweenGames', 'isMatchStarted', 'combinedAName', 'combinedBName', 'balls', 'bases', 'battingSide', 'hitsA', 'hitsB',
  'errorsA', 'errorsB', 'inning', 'inningHalf', 'outs', 'strikes', 'isGame1Started',
  // 2026-11-13 display booleans: lit bases, count and out dots, at-bat and home marks, final state
  'isRunnerOnFirst', 'isRunnerOnSecond', 'isRunnerOnThird', 'isBall1', 'isBall2', 'isBall3', 'isStrike1', 'isStrike2', 'isOut1', 'isOut2',
  'isABatting', 'isBBatting', 'isAHome', 'isBHome', 'isComplete'];
const entries = manifest.filter(entry => /^html-replications\/starter-(?:baseball|softball)-/.test(entry.output));
const classes = tag => (tag.attributes.class || '').split(/\s+/).filter(Boolean);

test('sport-native diamond starters keep three corners, three lower thirds and two full screens per sport active', () => {
  // 2026-11-14 round 2: the box bug and the ribbon (blind review <= 6.5) are retired, not deleted.
  for (const sport of ['baseball', 'softball']) {
    const placements = entries.filter(entry => entry.sport === sport && !entry.retired).map(entry => entry.placement).sort();
    assert.deepEqual(placements, [...Array(3).fill('corner'), 'full-screen', 'full-screen', ...Array(3).fill('lower-third')], sport);
  }
});

test('diamond starters bind the sport fields, group the count and keep stored values neutral', async () => {
  for (const entry of entries) {
    const html = await readFile(new URL(`../templates/${entry.output}`, import.meta.url), 'utf8');
    const label = entry.output;
    assert.ok(entry.output.split('/')[1].startsWith(`starter-${entry.sport}-`), label);
    const inspection = inspectTemplate(html);
    assert.deepEqual(inspection.errors, [], label);
    // Deliberate repeats (a winner line that restates the winner's name and score, a team-coloured runs box) are allowed.
    assert.deepEqual(inspection.warnings.filter(w => !/ is repeated \d+ times; all instances receive runtime updates\.$/.test(w)), ['This template has no service indicators.'], label);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, label);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    const present = new Set(tags.flatMap(tag => [...classes(tag), tag.attributes['data-osb-field']].filter(Boolean)));
    for (const field of entry.placement === 'full-screen' && /final/.test(label) ? REQUIRED.filter(f => !['balls', 'strikes', 'outs', 'bases', 'inning', 'inningHalf', 'isInBetweenGames', 'battingSide'].includes(f)) : REQUIRED) {
      assert.ok(present.has(field), `${label}: ${field}`);
    }
    if (!/final/.test(label)) {
      // A real diamond: the three base markers sit directly in one .diamond container, each holding its runner light.
      const runner = base => `<span class="base ${base.toLowerCase()}"><span class="runner isRunnerOn${base}" data-osb-component="field" data-osb-field="isRunnerOn${base}" style="opacity: 0"></span></span>`;
      assert.ok(html.includes(`<span class="diamond" aria-label="Bases">${runner('Second')}${runner('Third')}${runner('First')}</span>`), `${label}: diamond with three lit bases`);
      // Balls and strikes share one count element.
      assert.match(html, /class="count">[^]*?class="cb balls"[^]*?class="dash"[^]*?class="cs strikes"/, `${label}: grouped B-S count`);
      assert.match(html, /<span class="inningHalf" data-osb-component="field"><\/span>/, `${label}: empty live inning half`);
    }
    for (const tag of tags.filter(tag => tag.attributes['data-sport-stat'])) {
      assert.ok(classes(tag).includes(tag.attributes['data-sport-stat']), `${label}: live class for ${tag.attributes['data-sport-stat']}`);
      assert.equal(tag.attributes['data-osb-static'], 'true', label);
      const close = html.indexOf(`</${tag.name}>`, tag.end);
      assert.equal(html.slice(tag.end, close), '0', `${label}: stored counter must be 0`);
    }
    const innings = entry.sport === 'softball' ? 7 : 9;
    const ticks = tags.filter(tag => classes(tag).includes('tick')).length;
    if (ticks) assert.equal(ticks, innings, `${label}: one inning pip per regulation inning`);
    const headers = [...html.matchAll(/<span class="ls-col(?: ls-extra)?"><span class="ls-h">(\d+)<\/span>/g)];
    if (headers.length) assert.equal(headers.filter(match => !match[0].includes('ls-extra')).length, innings, `${label}: regulation line score`);
    // Never hide a show/hide element by CSS: the runtime's opacity decides (display:none only on its non-gated containers).
    for (const tag of tags.filter(tag => /^is[A-Z]/.test(classes(tag).find(name => /^is[A-Z]/.test(name)) || ''))) {
      assert.equal(tag.attributes.style, 'opacity: 0', `${label}: ${classes(tag).join(' ')} starts hidden by opacity`);
    }
    // A FINAL state exists and the LIVE mark is withdrawn once the game is complete.
    assert.match(html, /isComplete\[style\*="opacity: 1"\]\) \.st-live-in\{visibility:hidden\}/, `${label}: LIVE yields to FINAL`);
    assert.match(html, /prefers-reduced-motion:reduce/, label);
    assert.doesNotMatch(html, new RegExp(entry.sport === 'softball' ? 'BASEBALL' : 'SOFTBALL'), `${label}: wrong sport label`);
  }
});
