import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };

// Conventions: reviews/sport-conventions/volleyball.md and pickleball.md.
const starters = sport => manifest.filter(e => e.sport === sport && e.output.startsWith(`html-replications/starter-${sport}-`));
const load = async entry => {
  const html = await readFile(new URL(`../templates/${entry.output}`, import.meta.url), 'utf8');
  const tags = readTemplateHTMLTags(html).filter(t => !t.closing);
  const classes = t => (t.attributes.class || '').split(/\s+/);
  return { html, tags, has: f => tags.some(t => classes(t).includes(f)), count: f => tags.filter(t => classes(t).includes(f)).length,
    serveA: tags.some(t => classes(t).includes('isACurrentlyServing') && Object.hasOwn(t.attributes, 'isa')),
    serveB: tags.some(t => classes(t).includes('isBCurrentlyServing')) };
};
const placements = list => list.reduce((acc, e) => (acc[e.placement] = (acc[e.placement] || 0) + 1, acc), {});

for (const sport of ['volleyball', 'pickleball']) {
  test(`${sport} starters cover corner, lower-third and full-screen placements`, () => {
    const list = starters(sport);
    assert.deepEqual(placements(list), { corner: 4, 'lower-third': 4, 'full-screen': 2 });
    for (const entry of list) {
      assert.equal(entry.published, true, entry.output);
      assert.equal(entry.scoringMode, 'native', entry.output);
      assert.ok(entry.tags.includes('sport-native'), entry.output);
    }
  });
}

test('volleyball starters bind serve, sets won, set number, set history, timeouts, deciding set and final', async () => {
  // Redesign 2026-11-13: timeouts left are lit pips (isATimeoutLeftN), the set number is currentGame, FINAL is isComplete.
  for (const entry of starters('volleyball').filter(e => !e.retired)) {
    const t = await load(entry);
    const full = entry.placement === 'full-screen';
    assert.deepEqual(inspectTemplate(t.html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(t.html), t.html, entry.output);
    const fields = ['setsWonA', 'setsWonB', 'currentGame', 'isComplete', 'isInBetweenGames', 'isDecidingSet', 'eventName', 'matchRound'];
    if (!full) {
      assert.ok(t.serveA && t.serveB, `${entry.output}: serve indicator`);
      fields.push('isATimeOutActive', 'isBTimeOutActive', 'timeoutsRemainingA', 'timeoutsRemainingB', 'isATimeoutLeft1', 'isATimeoutLeft2', 'isBTimeoutLeft1', 'isBTimeoutLeft2');
    }
    for (const field of fields) assert.ok(t.has(field), `${entry.output}: ${field}`);
    for (let game = 1; game <= 5; game++) for (const field of [`game${game}AScore`, `game${game}BScore`, `isGame${game}Started`]) assert.ok(t.has(field), `${entry.output}: ${field}`);
    assert.doesNotMatch(t.html.replace(/<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, ''), /\b(?:VOLLEYBALL|GAMES)\b/, `${entry.output}: generic sport header`);
  }
});

test('pickleball starters bind server number, score call, game history, cards, timeouts and the team tie', async () => {
  for (const entry of starters('pickleball').filter(e => !e.retired)) {
    const t = await load(entry);
    const full = entry.placement === 'full-screen';
    assert.deepEqual(inspectTemplate(t.html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(t.html), t.html, entry.output);
    assert.ok(t.has('playerA2'), `${entry.output}: doubles probe`);
    const fields = ['eventName', 'matchRound', 'isMatchStarted', 'isInBetweenGames', 'currentGame', 'teamAName', 'teamBName', 'teamAScore', 'teamBScore', 'teamLogoURLA', 'teamLogoURLB', 'teamJerseyColorA', 'teamJerseyColorB'];
    if (full) for (let game = 1; game <= 9; game++) fields.push(`game${game}AScore`, `game${game}BScore`, `isGame${game}Started`);
    else {
      assert.ok(t.serveA && t.serveB, `${entry.output}: serve indicator`);
      const second = t.tags.filter(tag => (tag.attributes.class || '').split(/\s+/).includes('isSecondServer'));
      assert.ok(second.some(tag => Object.hasOwn(tag.attributes, 'isa')) && second.some(tag => !Object.hasOwn(tag.attributes, 'isa')), `${entry.output}: A and B server number`);
      assert.ok(second.every(tag => /opacity:\s*0/.test(tag.attributes.style || '')), `${entry.output}: server 2 starts hidden`);
      assert.ok(t.count('currentAGameScore') >= 2 && t.count('currentBGameScore') >= 2, `${entry.output}: score call`);
      fields.push('isDoubles', 'isAYellowCarded', 'isARedCarded', 'isBYellowCarded', 'isBRedCarded', 'isATimeOutUsed', 'isBTimeOutUsed', 'isATimeOutActive', 'isBTimeOutActive', 'isWarmUpStarted');
      for (let game = 1; game <= 5; game++) fields.push(`isGame${game}Started`);
    }
    for (const field of fields) assert.ok(t.has(field), `${entry.output}: ${field}`);
    assert.doesNotMatch(t.html.replace(/<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, ''), /\bPICKLEBALL\b/, `${entry.output}: generic sport header`);
  }
});
