import test from 'node:test';
import assert from 'node:assert/strict';
import { trimStatusCaptions } from './trim-status-captions.mjs';
import { CORE_FIELDS } from '../contract/index.mjs';

const fields = CORE_FIELDS.map(f => `<span class="${f}" data-osb-field="${f}">${f.endsWith('Score') ? '0' : ''}</span>`).join('');
const html = `<style>.osb-conditional-rail .osb-condition-side-label{font-size:10px}</style><main>${fields}<div class="osb-conditional-rail"><span class="osb-condition-side-label">A</span><span class="isATimeOutActive" data-osb-field="isATimeOutActive" style="opacity:0"></span><span class="osb-condition-side-label">B</span></div><span class="static-art">A</span><b>GAMES</b></main>`;
test('remove only exact unbound rail captions and dead caption CSS, preserving useful content', () => {
  const result = trimStatusCaptions(html);
  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.html, /osb-condition-side-label/);
  assert.match(result.html, /data-osb-field="isATimeOutActive"/);
  assert.match(result.html, /<span class="static-art">A<\/span>/);
  assert.match(result.html, /<b>GAMES<\/b>/);
  assert.deepEqual(trimStatusCaptions(result.html), { html: result.html, removed: 0 });
});
test('unexpected labels, nested markup and bound captions fail instead of guessing', () => {
  for (const replacement of ['<span class="osb-condition-side-label">HOME</span>', '<span class="osb-condition-side-label"><b>A</b></span>', '<span class="osb-condition-side-label combinedAName" data-osb-field="combinedAName">A</span>']) {
    assert.throws(() => trimStatusCaptions(html.replace('<span class="osb-condition-side-label">A</span>', replacement)), /Unexpected/);
  }
});
