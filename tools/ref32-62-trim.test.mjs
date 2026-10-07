import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTemplateHTMLTags, runtimeFields, inspectTemplate, neutralizeScoreboardTemplateHTML } from '../contract/index.mjs';
import { renderDesign } from './render-previews.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };
import baseline from './fixtures/visual-trim-baseline.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
const fields = new Set(runtimeFields.map(field => field.field));
const themes = new Set(['TABLE TENNIS', 'RISE ABOVE']);
const classes = tag => (tag.attributes.class || '').split(/\s+/);
const bound = tag => tag.attributes['data-osb-field'] || tag.attributes['data-field'] || classes(tag).some(name => fields.has(name));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entries = manifest.filter(entry => {
  const number = Number(/\/ref-(\d{3})-/.exec(entry.output)?.[1]);
  return number >= 32 && number <= 62;
});

async function baselineSource(entry) {
  const record = baseline[path.basename(entry.output)];
  const document = JSON.parse(await readFile(path.join(root, record.documentPath), 'utf8'));
  assert.equal(createHash('sha256').update(document.html).digest('hex'), record.sourceHash);
  return document.html;
}

// Token offsets restrict the edit to approved unbound leaves, without reserializing HTML.
function claimEdits(source) {
  const tags = readTemplateHTMLTags(source);
  const edits = [];
  const stack = [];
  const voidTags = new Set(['meta', 'img', 'source', 'br', 'hr', 'col', 'wbr']);
  for (let index = 0; index < tags.length; index++) {
    const tag = tags[index];
    if (tag.closing) { stack.pop(); continue; }
    const close = tags[index + 1];
    const leaf = close?.closing && close.name === tag.name;
    const text = leaf ? source.slice(tag.end, close.start).trim() : '';
    const inFooter = stack.some(parent => classes(parent).includes('footer'));
    let reason;
    if (classes(tag).includes('subtitle') && !themes.has(text)) reason = 'unsupportedSubtitle';
    if (classes(tag).includes('footer-note') && inFooter) reason = 'repeatedFooterNote';
    if (tag.name === 'span' && text === 'LIVE' && inFooter) reason = 'unboundLive';
    if (reason) {
      assert(leaf && !bound(tag), 'Approved claims must remain nonbinding leaf elements');
      assert(!source.slice(tag.end, close.start).includes('<'), 'Do not remove image or binding descendants');
      edits.push({ start: tag.start, end: close.end, reason, text });
    }
    if (!voidTags.has(tag.name)) stack.push(tag);
  }
  return edits;
}

function withoutClaims(source) {
  let result = source;
  for (const edit of claimEdits(source).reverse()) result = result.slice(0, edit.start) + result.slice(edit.end);
  return result;
}

test('Ref032-062 baseline permits exactly 89 approved leaf deletions and retains four theme subtitles', async () => {
  assert.equal(entries.length, 31);
  const counts = { unboundLive: 0, repeatedFooterNote: 0, unsupportedSubtitle: 0 };
  let retained = 0;
  for (const entry of entries) {
    const source = await baselineSource(entry);
    const edits = claimEdits(source);
    assert.equal(edits.filter(edit => edit.reason === 'unboundLive').length, 1, entry.output);
    assert.equal(edits.filter(edit => edit.reason === 'repeatedFooterNote').length, 1, entry.output);
    for (const edit of edits) counts[edit.reason]++;
    const expected = withoutClaims(source);
    assert.equal(claimEdits(expected).length, 0);
    retained += readTemplateHTMLTags(expected).filter(tag => !tag.closing && classes(tag).includes('subtitle')).length;
  }
  assert.deepEqual(counts, { unboundLive: 31, repeatedFooterNote: 31, unsupportedSubtitle: 27 });
  assert.equal(retained, 4);
});

test('Ref032-062 runtime tag attributes, optional images, theme CSS and neutral values match the baseline fixture', async () => {
  for (const entry of entries) {
    const source = await readFile(path.join(root, 'templates', entry.output), 'utf8');
    const before = await baselineSource(entry);
    const record = baseline[path.basename(entry.output)];
    const tags = readTemplateHTMLTags(source).filter(tag => !tag.closing);
    const bindings = tags.filter(bound).map(tag => ({ tag: tag.name, attributes: tag.attributes }));
    const imageSlots = tags.filter(tag => tag.name === 'img').map(tag => tag.attributes);
    assert.equal(hash(bindings), record.bindingsHash, entry.output);
    assert.equal(bindings.length, record.bindingCount, entry.output);
    assert.equal(hash(imageSlots), record.imageSlotsHash, entry.output);
    assert.equal(imageSlots.length, record.imageSlotCount, entry.output);
    assert.equal(source.slice(0, source.indexOf('<body')), before.slice(0, before.indexOf('<body')), `${entry.output}: CSS/head bytes changed`);
    assert.deepEqual(inspectTemplate(source).errors, [], entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(source), source, entry.output);
  }
});

test('Ref032-062 sources differ from the immutable baseline only by approved claim leaves', async () => {
  const failures = [];
  for (const entry of entries) {
    const source = await readFile(path.join(root, 'templates', entry.output), 'utf8');
    if (source !== withoutClaims(await baselineSource(entry))) failures.push(entry.output);
  }
  assert.deepEqual(failures, [], 'Each scoped source must contain only the approved deletions');
});

test('claim selection rejects bound/nested claims and leaves other live text or image slots intact', () => {
  for (const leaf of [
    '<div class="subtitle eventName" data-osb-field="eventName">2026</div>',
    '<div class="subtitle"><img data-osb-asset-role="event-logo"></div>',
    '<span class="footer-note"><span data-osb-field="courtName"></span></span>',
  ]) assert.throws(() => claimEdits(`<div class="footer">${leaf}</div>`), /nonbinding leaf/);
  const source = '<div>LIVE</div><span>LIVE</span><div class="subtitle">TABLE TENNIS</div><div class="subtitle">RISE ABOVE</div><img data-osb-asset-role="sponsor-logo">';
  assert.equal(withoutClaims(source), source);
});

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
test('representative full renders preserve bindings and art at 1280 and 640', { skip: !modulePath, timeout: 180_000 }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(() => browser.close());
  const captureDirectory = process.env.REF_TRIM_CAPTURE_DIR;
  const phase = process.env.REF_TRIM_PHASE || 'current';
  assert(['before', 'after', 'current'].includes(phase));
  if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
  const selected = entries.filter(entry => /\/ref-(032|034|040|043|057|059)-/.test(entry.output));
  assert.equal(selected.length, 6);
  const results = [];
  for (const entry of selected) {
    const before = await baselineSource(entry);
    const current = await readFile(path.join(root, 'templates', entry.output), 'utf8');
    for (const width of [1280, 640]) {
      const sizedBrowser = { newContext: options => browser.newContext({ ...options, viewport: { width, height: width * 9 / 16 } }) };
      const reference = await renderDesign(sizedBrowser, root, { html: before, css: '' }, 'tableTennis');
      const rendered = await renderDesign(sizedBrowser, root, { html: current, css: '' }, 'tableTennis');
      assert.deepEqual(rendered.diagnostics.bindings, reference.diagnostics.bindings, entry.output);
      assert.deepEqual(rendered.diagnostics.missingAssets, []);
      assert.deepEqual(rendered.diagnostics.pageErrors, []);
      assert.deepEqual(rendered.diagnostics.geometry.viewport, reference.diagnostics.geometry.viewport);
      assert.equal(rendered.diagnostics.pixels.width, reference.diagnostics.pixels.width);
      // Removing a subtitle can shrink the negative painted extent at 640px.
      // The existing renderer independently proves the entire painted union was captured.
      assert.equal(rendered.diagnostics.pixels.height, rendered.diagnostics.clip.height);
      assert.equal(rendered.diagnostics.pixels.width, rendered.diagnostics.clip.width);
      assert(rendered.diagnostics.pixels.distinctColors >= 8);
      const prefix = `${path.basename(entry.output, '.html')}-${width}`;
      if (captureDirectory) {
        await writeFile(path.join(captureDirectory, `baseline-${prefix}.png`), reference.bytes);
        await writeFile(path.join(captureDirectory, `${phase}-${prefix}.png`), rendered.bytes);
      }
      results.push({ fileName: path.basename(entry.output), width, phase, baseline: reference.diagnostics, current: rendered.diagnostics });
    }
  }
  if (captureDirectory) await writeFile(path.join(captureDirectory, `${phase}-diagnostics.json`), `${JSON.stringify(results, null, 2)}\n`);
});
