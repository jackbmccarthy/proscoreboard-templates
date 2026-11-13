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

test('volleyball starters bind serve, sets won, set number, set history, timeouts and the deciding set', async () => {
  for (const entry of starters('volleyball')) {
    const t = await load(entry);
    assert.deepEqual(inspectTemplate(t.html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(t.html), t.html, entry.output);
    assert.ok(t.serveA && t.serveB, `${entry.output}: serve indicator`);
    for (const field of ['setsWonA', 'setsWonB', 'isATimeOutUsed', 'isBTimeOutUsed', 'isATimeOutActive', 'isBTimeOutActive', 'timeoutsRemainingA', 'timeoutsRemainingB', 'isGame5Started']) assert.ok(t.has(field), `${entry.output}: ${field}`);
    for (let game = 1; game <= 5; game++) for (const field of [`game${game}AScore`, `game${game}BScore`, `isGame${game}Started`]) assert.ok(t.has(field), `${entry.output}: ${field}`);
    assert.ok(t.tags.some(tag => tag.attributes['data-sport-stat'] === 'set' && tag.attributes['data-osb-static'] === 'true'), `${entry.output}: live set number`);
    assert.doesNotMatch(t.html.replace(/<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, ''), /\b(?:VOLLEYBALL|GAMES)\b/, `${entry.output}: generic sport header`);
  }
});

test('pickleball starters bind server number, score call, game history, cards and timeouts', async () => {
  for (const entry of starters('pickleball')) {
    const t = await load(entry);
    assert.deepEqual(inspectTemplate(t.html).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(t.html), t.html, entry.output);
    assert.ok(t.serveA && t.serveB, `${entry.output}: serve indicator`);
    const second = t.tags.filter(tag => (tag.attributes.class || '').split(/\s+/).includes('isSecondServer'));
    assert.ok(second.some(tag => Object.hasOwn(tag.attributes, 'isa')) && second.some(tag => !Object.hasOwn(tag.attributes, 'isa')), `${entry.output}: A and B server number`);
    assert.ok(second.every(tag => /opacity:\s*0/.test(tag.attributes.style || '')), `${entry.output}: server 2 starts hidden`);
    assert.ok(t.count('currentAGameScore') >= 2 && t.count('currentBGameScore') >= 2, `${entry.output}: score call`);
    assert.ok(t.has('playerA2'), `${entry.output}: doubles probe`);
    for (const field of ['isAYellowCarded', 'isARedCarded', 'isBYellowCarded', 'isBRedCarded', 'isATimeOutUsed', 'isBTimeOutUsed', 'isATimeOutActive', 'isBTimeOutActive',
      'eventName', 'matchRound', 'isMatchStarted', 'teamAName', 'teamBName', 'teamAScore', 'teamBScore', 'teamLogoURLA', 'teamLogoURLB', 'teamJerseyColorA', 'teamJerseyColorB']) assert.ok(t.has(field), `${entry.output}: ${field}`);
    for (let game = 1; game <= 5; game++) assert.ok(t.has(`isGame${game}Started`), `${entry.output}: isGame${game}Started`);
    assert.doesNotMatch(t.html.replace(/<style[\s\S]*?<\/style>|<title>[\s\S]*?<\/title>/g, ''), /\bPICKLEBALL\b/, `${entry.output}: generic sport header`);
  }
});
