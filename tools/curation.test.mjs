import assert from 'node:assert/strict';
import test from 'node:test';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };
import catalog from '../catalog.json' with { type: 'json' };

// Jack (2026-11-13): a small set of very good scoreboards, at most 10 per sport per placement.
// Retire the weaker design before adding another one past the cap.
const CAP = 10;
const active = manifest.filter(entry => !entry.retired && entry.published !== false);

test('each sport lists at most ten active scoreboards per placement', () => {
  const counts = new Map();
  for (const entry of active) {
    assert.ok(entry.sport, `${entry.output}: active scoreboards declare their sport`);
    const key = `${entry.sport}/${entry.placement}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) assert.ok(count <= CAP, `${key} has ${count} active scoreboards (cap ${CAP})`);
});

test('every active scoreboard has a rendered preview to judge it by', () => {
  const byName = new Map(catalog.templates.map(entry => [entry.fileName, entry]));
  for (const entry of active) assert.ok(byName.get(entry.output.split('/').pop())?.preview, `${entry.output}: missing preview`);
});

test('at most one active default template per sport', () => {
  const seen = new Set();
  for (const entry of active) for (const sport of entry.defaultForSports || []) {
    assert.ok(!seen.has(sport), `more than one default for ${sport}`);
    seen.add(sport);
  }
});

// Jack (2026-11-18): every new court gets a scoreboard made from its sport's default lower third, and
// "Change scoreboard" lists one default per placement first. defaultForSports stays the single
// sport-wide default (a lower third, which older servers already read); placementDefaultForSports
// marks the corner, full-screen and courtside defaults.
// A placement may have no default while its designs are being redesigned (2026-11-18: baseball, softball and table tennis
// full-screen and table tennis courtside); the server then reports "no default yet" for it. Every sport keeps its lower third.
test('every sport has one default lower third and at most one default per placement', () => {
  const defaults = new Map();
  for (const entry of active) for (const sport of [...(entry.defaultForSports || []), ...(entry.placementDefaultForSports || [])]) {
    assert.equal(sport, entry.sport, `${entry.output}: defaults name the template's own sport`);
    const key = `${sport}/${entry.placement}`;
    assert.ok(!defaults.has(key), `more than one default for ${key}`);
    defaults.set(key, entry.output);
  }
  for (const entry of active) for (const sport of entry.defaultForSports || []) assert.equal(entry.placement, 'lower-third', `${entry.output}: the sport default is a lower third`);
  for (const sport of new Set(active.map(entry => entry.sport))) assert.ok(defaults.has(`${sport}/lower-third`), `${sport} has no default lower third`);
  for (const entry of manifest.filter(item => item.retired || item.published === false)) {
    assert.ok(!entry.defaultForSports && !entry.placementDefaultForSports, `${entry.output}: retired or unpublished templates cannot be defaults`);
  }
});
