import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_FIELDS, inspectTemplate, getPreviewDefaults, runtimeFields, validateSafeScoreboardTemplateDocument, neutralizeScoreboardTemplateHTML } from '../contract/index.mjs';

const core = CORE_FIELDS.map((field) => `<span class="${field}" data-osb-field="${field}"></span>`).join('');

test('inspector accepts static native bindings and reports mismatches', () => {
  assert.deepEqual(inspectTemplate(core).errors, []);
  assert.ok(inspectTemplate(core + '<b class="other" data-osb-field="currentAGameScore"></b>').errors.some((value) => /metadata must match/.test(value)));
  assert.ok(inspectTemplate(core + '<i class="isGamePoint isMatchPoint"></i>').errors.some((value) => /separate sibling/.test(value)));
  assert.ok(inspectTemplate(core + '<i class="isACurrentlyServing" isA="true"></i>').errors.some((value) => /matching A and B/.test(value)));
  assert.ok(inspectTemplate(core + '<div class="countryA"></div>').errors.some((value) => /img/.test(value)));
  assert.deepEqual(inspectTemplate(core + '<i class="isACurrentlyServing" isA="true"></i><i class="isBCurrentlyServing"></i>').errors, []);
});

test('static safety rejects executable tags, events, URL tricks and CSS escapes without network', () => {
  for (const html of [
    '<script>alert(1)</script>', '<iframe src="https://example.invalid"></iframe>',
    '<img src="x" onerror="alert(1)">', '<a href="java&#x73;cript:alert(1)">x</a>',
    '<meta http-equiv="refresh" content="0;url=https://example.invalid">',
    '<div data-gjs-script="alert(1)"></div>', '<div data-gjs-type="script"></div>',
    '<img srcset="https://example.invalid/a.png 2x">',
    '<style>a{background:url(javascript:alert(1))}</style>',
    '<style>a{b:expre\\73 sion(alert(1))}</style>',
    '<style>@import "https://example.invalid/style.css";</style>',
    '<div class="a" class="b"></div>', '<svg><script></script></svg>',
  ]) assert.throws(() => validateSafeScoreboardTemplateDocument({ html, css: '' }), undefined, html);
  assert.doesNotThrow(() => validateSafeScoreboardTemplateDocument({ html: '<style>body{background:transparent}</style><img src="data:image/png;base64,AAAA">', css: '' }));
});

test('public registry and optional preview schema preserve neutral names, scores and separate states', () => {
  assert.equal(new Set(runtimeFields.map((entry) => entry.field)).size, runtimeFields.length);
  const defaults = getPreviewDefaults();
  assert.equal(defaults.combinedAName, 'Player A');
  assert.equal(defaults.combinedBName, 'Player B');
  for (const entry of runtimeFields) {
    assert.ok(['boolean', 'color', 'image', 'number', 'text', 'timer'].includes(entry.valueType));
    assert.equal(typeof entry.description, 'string');
    if (['number', 'timer'].includes(entry.valueType)) assert.equal(defaults[entry.field], 0);
    if (entry.valueType === 'boolean') assert.equal(defaults[entry.field], false);
    if (entry.valueType === 'image') assert.equal(defaults[entry.field], '');
  }
  assert.deepEqual(getPreviewDefaults(['combinedAName', 'currentAGameScore', 'isGamePoint']), { combinedAName: 'Player A', currentAGameScore: 0, isGamePoint: false });
  assert.deepEqual(getPreviewDefaults({ fields: [{ field: 'isBCurrentlyServing', valueType: 'boolean' }] }), { isBCurrentlyServing: false });
});

test('neutralizer is byte-preserving outside live text and idempotent', () => {
  const source = '<style>.name{color:red}</style><main><span class="combinedAName"><b>Example</b></span><b class="currentAGameScore"><em>11</em></b><i class="isGamePoint">GAME POINT</i><span data-osb-static>Final</span></main>';
  const expected = source.replace('>Example<', '><').replace('>11<', '>0<');
  assert.equal(neutralizeScoreboardTemplateHTML(source), expected);
  assert.equal(neutralizeScoreboardTemplateHTML(expected), expected);
  assert.throws(() => neutralizeScoreboardTemplateHTML('<p class="currentAGameScore">9<p>Static'), /explicit closing tags/);
});
