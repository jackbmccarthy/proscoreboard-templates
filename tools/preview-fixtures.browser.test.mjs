import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { applySportFixture, getSportFixture } from './preview-fixtures.mjs';
import { renderDesign } from './render-previews.mjs';

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
test('blank nested fixture text preserves formatting, escaping, markup and descendant bindings', { skip: !modulePath }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="br" data-osb-field="combinedAName"><br></div><div id="format" data-osb-field="combinedBName"><strong class="formatted"><em title="leaf"></em></strong></div><div id="classOnly" class="combinedBName"><span><br></span></div><div id="authored" data-osb-field="combinedAName"><strong>Manual</strong></div><div id="nested" data-osb-field="combinedAName"><span data-osb-field="rankingA"></span></div><div id="nestedClass" class="combinedAName"><span class="rankingB"></span></div><div id="unknown" data-osb-field="combinedAName"><span data-field="custom"></span></div>');
  const before = await page.evaluate(() => {
    window.preservedNodes = [...document.querySelectorAll('br, strong, em, span')];
    return [...document.querySelectorAll('*')].map(e => [e.tagName, e.getAttributeNames().map(n => [n, e.getAttribute(n)])]);
  });
  const fixture = getSportFixture('tableTennis');
  fixture.fields.combinedBName = '<Lane & "Co">';
  await page.evaluate(applySportFixture, fixture);
  assert.equal(await page.locator('#br').textContent(), 'Avery Lane');
  assert.equal(await page.locator('#format em').textContent(), '<Lane & "Co">');
  assert.equal(await page.locator('#classOnly span').textContent(), '<Lane & "Co">');
  assert.equal(await page.locator('#authored strong').textContent(), 'Manual');
  assert.equal(await page.locator('#nested').textContent(), '3');
  assert.equal(await page.locator('#nestedClass').textContent(), '4');
  assert.equal(await page.locator('#unknown').textContent(), '');
  const after = await page.evaluate(() => {
    for (const node of window.preservedNodes) {
      if (!node.isConnected) throw new Error('Authored descendant was replaced');
    }
    return [...document.querySelectorAll('*')].map(e => [e.tagName, e.getAttributeNames().map(n => [n, e.getAttribute(n)])]);
  });
  assert.deepEqual(after, before);
  assert.equal(await page.locator('#format').innerHTML(), '<strong class="formatted"><em title="leaf">&lt;Lane &amp; "Co"&gt;</em></strong>');
  const first = await page.locator('body').innerHTML();
  await page.evaluate(applySportFixture, fixture);
  assert.equal(await page.locator('body').innerHTML(), first, 'fixture is idempotent without losing formatting');
});

test('all seven previously blank name previews populate both names while keeping BR placeholders and binding tags', { skip: !modulePath }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(() => browser.close());
  const directory = new URL('../templates/html-replications/', import.meta.url);
  const names = await readdir(directory);
  for (const ref of [120, 122, 128, 131, 138, 140, 141]) {
    const name = names.find(n => n.startsWith(`ref-${ref}-`));
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(await readFile(new URL(name, directory), 'utf8'));
    const selector = '[data-osb-field="combinedAName"], [data-osb-field="combinedBName"]';
    const before = await page.locator(selector).evaluateAll(elements => elements.map(e => ({ tag: e.tagName, attrs: e.getAttributeNames().map(n => [n, e.getAttribute(n)]), breaks: e.querySelectorAll('br').length })));
    assert.equal(before.length, 2, name);
    assert.ok(before.every(e => e.breaks === 1), name);
    const result = await page.evaluate(applySportFixture, getSportFixture('tableTennis'));
    for (const [side, expected] of [['A', 'Avery Lane'], ['B', 'Jordan Reed']]) {
      const field = `combined${side}Name`;
      assert.ok(result.changes.includes(field), name);
      assert.equal(await page.locator(`[data-osb-field="${field}"]`).textContent(), expected, name);
      assert.ok(await page.locator(`[data-osb-field="${field}"]`).evaluate(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'), name);
    }
    assert.deepEqual(await page.locator(selector).evaluateAll(elements => elements.map(e => ({ tag: e.tagName, attrs: e.getAttributeNames().map(n => [n, e.getAttribute(n)]), breaks: e.querySelectorAll('br').length }))), before, name);
    await page.close();
  }
});

test('scoped diagnostic previews retain nonblank geometry and restored names without updating manifests', { skip: !modulePath || !process.env.PREVIEW_QA_DIR }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(() => browser.close());
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const directory = new URL('../templates/html-replications/', import.meta.url);
  const names = await readdir(directory);
  const output = path.resolve(process.env.PREVIEW_QA_DIR);
  await mkdir(output, { recursive: true });
  const refs = [84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 98, 99, 100, 101, 103, 104, 106, 108, 111, 112, 116, 117, 120, 122, 128, 131, 138, 140, 141, 145];
  for (const ref of refs) {
    const name = names.find(n => n.startsWith(`ref-${String(ref).padStart(3, '0')}-`));
    const html = await readFile(new URL(name, directory), 'utf8');
    const { bytes, diagnostics } = await renderDesign(browser, root, { html, css: '' }, 'tableTennis');
    assert.ok(diagnostics.pixels.width > 0 && diagnostics.pixels.height > 0, name);
    assert.ok(diagnostics.bindings.includes('combinedAName') && diagnostics.bindings.includes('combinedBName'), name);
    assert.deepEqual(diagnostics.missingAssets, [], name);
    assert.deepEqual(diagnostics.blockedRequests, [], name);
    await writeFile(path.join(output, `${name}.png`), bytes);
  }
});
