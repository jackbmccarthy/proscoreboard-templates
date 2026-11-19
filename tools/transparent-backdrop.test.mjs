import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCatalog, findBackdropViolations, loadExemptions, subjectOf } from './check-transparent-backdrop.mjs';

// Owner rule (2026-11-18): everything behind the scoreboard is transparent; the scoreboard itself keeps its colours.
const page = (css, body = '<main class="board"><div class="panel"></div></main>', attributes = '') =>
  `<!doctype html><html${attributes}><head><style>${css}</style></head><body>${body}</body></html>`;

test('html, :root and body backgrounds, shadows and backdrop filters are page backdrops', () => {
  for (const css of ['body{background:#000}', 'html{background-color:#101010}', ':root{background:linear-gradient(#000,#111)}',
    'body.dark{box-shadow:inset 0 0 200px #000}', 'body{backdrop-filter:blur(4px)}', 'html,body{margin:0;background:#0b1220}',
    'body::before{content:"";position:fixed;inset:0;background:radial-gradient(#0000,#000)}']) {
    assert.ok(findBackdropViolations(page(css)).length, css);
  }
});

test('a viewport-sized wrapper, stage or canvas may not paint', () => {
  for (const css of ['.board{position:fixed;inset:0;background:#0a1222}', '.stage{position:fixed;top:0;right:0;bottom:0;left:0;background-image:linear-gradient(#000,#111)}',
    '.stage{width:100vw;height:100vh;background:#000}', '.stage{width:100vw;min-height:100dvh}.stage{background:#000}']) {
    assert.ok(findBackdropViolations(page(css)).length, css);
  }
});

test('inline styles on html, body and main are checked', () => {
  assert.ok(findBackdropViolations(page('', '<main></main>', ' style="background:#000"')).length);
  assert.ok(findBackdropViolations(page('', '<main style="background-color: #111"></main>')).length);
});

test('transparent page roots and the scoreboard\'s own panels pass', () => {
  for (const css of ['html,body{margin:0;background:transparent}', 'body{background:none!important}', 'body{background:rgba(0,0,0,0)}',
    '.panel{background:#0a1222;box-shadow:0 8px 24px #0008}', '.board{position:fixed;inset:0;background:transparent}.panel{background:#000}',
    '.chip{position:absolute;inset:0;background:#ffd23f}', 'body:has(.isComplete[style*="opacity: 1"]) .isMatchStarted{opacity:0!important}',
    'body .panel{background:#123}', '@media (max-width:600px){.panel{background:#000}}']) {
    assert.deepEqual(findBackdropViolations(page(css)), [], css);
  }
});

test('the subject of a selector is its last compound', () => {
  assert.equal(subjectOf('body:has(.a .b) .panel'), '.panel');
  assert.equal(subjectOf('html > body.dark'), 'body.dark');
  assert.equal(subjectOf(':root'), ':root');
});

test('every active published scoreboard has a transparent page backdrop (or an owner-reviewed exemption for its exact content)', async () => {
  const results = await checkCatalog();
  assert.ok(results.length >= 30);
  const failures = results.filter((result) => (result.violations.length && !result.exempt) || result.staleExemption)
    .map((result) => `${result.fileName}${result.staleExemption ? ' (stale exemption)' : ''}: ${result.violations.map((v) => `${v.selector} ${v.paints.join('; ')}`).join(' | ')}`);
  assert.deepEqual(failures, []);
});

test('exemptions name active templates and record a decision and reason', async () => {
  const results = new Map((await checkCatalog()).map((result) => [result.fileName, result]));
  for (const [fileName, exemption] of await loadExemptions()) {
    assert.ok(results.has(fileName), `${fileName}: exemption for a template that is not active`);
    assert.match(exemption.contentHash, /^[a-f0-9]{64}$/);
    assert.ok(['pending', 'approved'].includes(exemption.decision), fileName);
    assert.ok(exemption.reason?.length > 40, fileName);
    assert.ok(results.get(fileName).violations.length, `${fileName}: exemption no longer needed; remove it`);
  }
});
