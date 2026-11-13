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
