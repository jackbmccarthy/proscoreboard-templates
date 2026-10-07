import { getPreviewDefaults, runtimeFields } from '../contract/index.mjs';

export const FIXTURE_VERSION = 'sport-samples-v1';
export const SPORTS = Object.freeze(['baseball', 'basketball', 'pickleball', 'soccer', 'softball', 'tableTennis', 'volleyball']);

// Fictional samples only. Completed history precedes the current game/period.
const samples = {
  baseball: { names: ['Owls', 'Pines'], score: [4, 2], wins: [0, 0], history: [[0, 0], [1, 0], [0, 1], [2, 0], [0, 1]], stats: { inning: 6, balls: 2, strikes: 1, outs: 1, hitsA: 7, hitsB: 5, errorsA: 0, errorsB: 1 } },
  basketball: { names: ['Waves', 'Sparks'], score: [78, 74], wins: [0, 0], history: [[24, 21], [19, 23], [22, 18]], stats: { period: 4, gameClock: '06:42', clockMinutes: '06', clockSeconds: '42', shotClock: 18, foulsA: 3, foulsB: 4 } },
  pickleball: { names: ['Morgan Vale', 'Riley Brook'], score: [8, 6], wins: [1, 1], history: [[11, 7], [8, 11]], stats: { set: 3 }, serving: 'A' },
  soccer: { names: ['United', 'Rovers'], score: [2, 1], wins: [0, 0], history: [[1, 0]], stats: { half: 2, period: 2, gameClock: '67:24', clockMinutes: '67', clockSeconds: '24', foulsA: 5, foulsB: 7 } },
  softball: { names: ['Comets', 'Oaks'], score: [5, 3], wins: [0, 0], history: [[1, 0], [0, 2], [2, 0], [0, 1]], stats: { inning: 5, balls: 1, strikes: 2, outs: 2, hitsA: 8, hitsB: 6, errorsA: 1, errorsB: 0 } },
  tableTennis: { names: ['Avery Lane', 'Jordan Reed'], score: [9, 7], wins: [2, 1], history: [[11, 8], [9, 11], [11, 6]], stats: { set: 4 }, serving: 'B' },
  volleyball: { names: ['Spikes', 'Aces'], score: [18, 16], wins: [1, 1], history: [[25, 21], [22, 25]], stats: { set: 3 }, serving: 'A' },
};
const formatLabels = { baseball: '9 innings', basketball: '4 quarters', pickleball: 'Best of 3', soccer: '2 halves', softball: '7 innings', tableTennis: 'Best of 5', volleyball: 'Best of 5' };

export function getSportFixture(sport) {
  const sample = samples[sport];
  if (!sample) throw new Error(`Unsupported preview sport: ${sport}`);
  const fields = getPreviewDefaults();
  for (const side of ['A', 'B']) {
    const index = side === 'A' ? 0 : 1;
    for (const field of runtimeFields) {
      if (field.valueType === 'text' && /^(combined|courtSideCombined|player|team)/.test(field.field) && field.field.includes(side)) fields[field.field] = sample.names[index];
    }
    Object.assign(fields, {
      [`combined${side}Name`]: sample.names[index], [`team${side}Name`]: sample.names[index],
      [`current${side}GameScore`]: sample.score[index], [`team${side}Score`]: sample.score[index],
      [`current${side}MatchScore`]: sample.wins[index],
      [`courtSide${side}GameScore`]: sample.score[index], [`courtSide${side}MatchScore`]: sample.wins[index],
      [`jerseyColor${side}`]: index === 0 ? '#2678a9' : '#c85e66',
      [`is${side}CurrentlyServing`]: sample.serving === side,
      [`ranking${side}`]: String(index + 3), [`rating${side}`]: sport === 'pickleball' ? '4.5' : '',
      [`country${side}`]: `/scoreboard-runtime/flags/${index === 0 ? 'jp' : 'se'}.png`,
      [`timeOutTimer${side}`]: '00:30',
    });
  }
  Object.assign(fields, { matchRound: 'Semifinal', matchFormatLabel: formatLabels[sport], courtName: 'Court 2', eventName: 'Sample Open', timeOutTimer: '00:30' });
  const setSport = ['pickleball', 'tableTennis', 'volleyball'].includes(sport);
  const currentSegment = setSport ? sample.score : sample.score.map((total, side) => total - sample.history.reduce((sum, score) => sum + score[side], 0));
  for (let game = 1; game <= 9; game++) {
    const score = sample.history[game - 1] ?? (game === sample.history.length + 1 ? currentSegment : null);
    fields[`isGame${game}Started`] = score !== null;
    fields[`game${game}AScore`] = score?.[0] ?? 0;
    fields[`game${game}BScore`] = score?.[1] ?? 0;
  }
  const stats = { ...sample.stats };
  if (sport === 'basketball') stats.quarter = stats.period;
  const aliases = { 'fouls-a': 'foulsA', 'fouls-b': 'foulsB', 'hits-a': 'hitsA', 'hits-b': 'hitsB', 'game-clock': 'gameClock', clock: 'gameClock', 'shot-clock': 'shotClock', shot: 'shotClock', 'current-set': 'set' };
  for (const [alias, field] of Object.entries(aliases)) if (Object.hasOwn(stats, field)) stats[alias] = stats[field];
  return { sport, fixtureVersion: FIXTURE_VERSION, fields, fieldTypes: Object.fromEntries(runtimeFields.map(({ field, valueType }) => [field, valueType])), stats, bases: { first: sport === 'baseball' || sport === 'softball', second: false, third: sport === 'softball' } };
}

// This function is serializable for page.evaluate; it deliberately has no imports.
export function applySportFixture(fixture) {
  const changes = [];
  for (const [field, value] of Object.entries(fixture.fields)) {
    const type = fixture.fieldTypes[field];
    const selector = `[data-osb-field="${field}"], [data-field="${field}"], .${field}`;
    for (const element of document.querySelectorAll(selector)) {
      const declared = element.getAttribute('data-osb-field') || element.getAttribute('data-field');
      if (declared && declared !== field) continue;
      if (['STYLE', 'LINK', 'META', 'SCRIPT', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) continue;
      if (type === 'boolean') {
        element.style.opacity = value ? '1' : '0';
        if (value && element.style.display === 'none') element.style.removeProperty('display');
      } else if (type === 'color') {
        element.style.backgroundColor = value;
      } else if (type === 'image') {
        if (value && element.tagName === 'IMG') element.setAttribute('src', value);
      } else if (!element.children.length && element.tagName !== 'IMG') {
        element.textContent = String(value);
      } else continue;
      changes.push(field);
    }
  }
  for (const element of document.querySelectorAll('[data-osb-static][data-sport-stat]')) {
    const field = element.getAttribute('data-sport-stat');
    if (Object.hasOwn(fixture.stats, field) && !element.children.length) {
      element.textContent = String(fixture.stats[field]);
      changes.push(`static:${field}`);
    }
  }
  // Existing authored diamonds have no public binding on their individual bases.
  // Only color their exact known markers; never replace labels or add markup.
  if (fixture.sport === 'baseball' || fixture.sport === 'softball') {
    for (const [base, occupied] of Object.entries(fixture.bases)) {
      for (const element of document.querySelectorAll(`.diamond > .base.${base}`)) {
        if (occupied) element.style.backgroundColor = '#f5cf52';
        changes.push(`base:${base}`);
      }
    }
  }
  return { changes, visibleText: document.body.innerText };
}
