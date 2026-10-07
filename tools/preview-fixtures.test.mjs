import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeFields } from '../contract/index.mjs';
import { FIXTURE_VERSION, getSportFixture, SPORTS } from './preview-fixtures.mjs';

test('seven sport fixtures are deterministic, isolated, and use only public runtime fields', () => {
  assert.equal(SPORTS.length, 7);
  const allowed = runtimeFields.map(({ field }) => field).sort();
  for (const sport of SPORTS) {
    const fixture = getSportFixture(sport);
    assert.equal(fixture.fixtureVersion, FIXTURE_VERSION);
    assert.deepEqual(Object.keys(fixture.fields).sort(), allowed);
    assert.deepEqual(fixture, getSportFixture(sport));
    assert.ok(fixture.fields.combinedAName && fixture.fields.combinedBName);
    assert.notEqual(fixture.fields.combinedAName, fixture.fields.combinedBName);
    assert.ok(fixture.fields.currentAGameScore > 0 && fixture.fields.currentBGameScore > 0);
    assert.match(fixture.fields.countryA, /^\/scoreboard-runtime\/flags\/[a-z]{2}\.png$/);
    assert.equal(fixture.fields.isMatchPoint, false);
    assert.equal(fixture.fields.isGamePoint, false);
    fixture.fields.combinedAName = 'Mutated';
    assert.notEqual(getSportFixture(sport).fields.combinedAName, 'Mutated');
  }
  assert.throws(() => getSportFixture('tennis'), /Unsupported preview sport/);
});

test('racket/set sports include completed history, current game, and no future games', () => {
  for (const sport of ['pickleball', 'tableTennis', 'volleyball']) {
    const { fields } = getSportFixture(sport);
    const completed = fields.currentAMatchScore + fields.currentBMatchScore;
    let winsA = 0, winsB = 0;
    for (let game = 1; game <= completed; game++) {
      const a = fields[`game${game}AScore`], b = fields[`game${game}BScore`];
      assert.notEqual(a, b);
      assert.ok(Math.max(a, b) >= (sport === 'volleyball' ? 25 : 11));
      assert.equal(fields[`isGame${game}Started`], true);
      if (a > b) winsA++; else winsB++;
    }
    assert.equal(winsA, fields.currentAMatchScore);
    assert.equal(winsB, fields.currentBMatchScore);
    assert.equal(fields[`game${completed + 1}AScore`], fields.currentAGameScore);
    assert.equal(fields[`game${completed + 1}BScore`], fields.currentBGameScore);
    assert.equal(fields[`isGame${completed + 2}Started`], false);
    assert.notEqual(fields.isACurrentlyServing, fields.isBCurrentlyServing);
  }
});

test('manual sport clocks and counters have explicit static aliases and plausible counts', () => {
  const basketball = getSportFixture('basketball');
  assert.equal(basketball.stats.clock, '06:42');
  assert.equal(basketball.stats['game-clock'], '06:42');
  assert.equal(basketball.stats['shot-clock'], 18);
  assert.equal(basketball.stats.quarter, basketball.stats.period);
  assert.equal(basketball.stats['fouls-a'], basketball.stats.foulsA);
  const soccer = getSportFixture('soccer');
  assert.equal(soccer.stats.clock, '67:24');
  assert.equal(soccer.stats.half, 2);
  for (const sport of ['baseball', 'softball']) {
    const { stats, bases } = getSportFixture(sport);
    assert.ok(stats.balls < 4 && stats.strikes < 3 && stats.outs < 3);
    assert.equal(bases.first, true);
    assert.ok(stats.hitsA >= getSportFixture(sport).fields.currentAGameScore);
  }
});

test('manual sport formats describe their actual segments and period history sums to live totals', () => {
  const formats = { baseball: '9 innings', softball: '7 innings', basketball: '4 quarters', soccer: '2 halves', pickleball: 'Best of 3', tableTennis: 'Best of 5', volleyball: 'Best of 5' };
  for (const [sport, label] of Object.entries(formats)) assert.equal(getSportFixture(sport).fields.matchFormatLabel, label);
  for (const sport of ['baseball', 'softball', 'basketball', 'soccer']) {
    const { fields } = getSportFixture(sport);
    for (const side of ['A', 'B']) {
      let total = 0;
      for (let game = 1; game <= 9; game++) {
        if (fields[`isGame${game}Started`]) total += fields[`game${game}${side}Score`];
        assert.ok(fields[`game${game}${side}Score`] >= 0);
      }
      assert.equal(total, fields[`current${side}GameScore`]);
    }
  }
});

test('current history segments preserve exact residuals while live headers keep aggregate scores', () => {
  const expected = {
    basketball: { segment: 4, score: [13, 12], header: [78, 74] },
    soccer: { segment: 2, score: [1, 1], header: [2, 1] },
    baseball: { segment: 6, score: [1, 0], header: [4, 2] },
    softball: { segment: 5, score: [2, 0], header: [5, 3] },
    tableTennis: { segment: 4, score: [9, 7], header: [9, 7] },
    pickleball: { segment: 3, score: [8, 6], header: [8, 6] },
    volleyball: { segment: 3, score: [18, 16], header: [18, 16] },
  };
  for (const [sport, { segment, score, header }] of Object.entries(expected)) {
    const { fields } = getSportFixture(sport);
    assert.deepEqual([fields[`game${segment}AScore`], fields[`game${segment}BScore`]], score, sport);
    assert.deepEqual([fields.currentAGameScore, fields.currentBGameScore], header, sport);
    assert.equal(fields[`isGame${segment}Started`], true, sport);
    assert.equal(fields[`isGame${segment + 1}Started`], false, sport);
    assert.ok(score.every(value => Number.isInteger(value) && value >= 0), sport);
  }
});
