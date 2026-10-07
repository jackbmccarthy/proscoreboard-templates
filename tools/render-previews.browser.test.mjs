import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { contentHash } from './build-catalog.mjs';
import { applySportFixture, getSportFixture } from './preview-fixtures.mjs';
import { renderDesign, renderPreviews } from './render-previews.mjs';

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const browserOptions = { headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) };
const browserTest = (name, callback) => test(name, { skip: !modulePath, timeout: 90_000 }, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch(browserOptions);
  t.after(() => browser.close());
  await callback(t, browser);
});

browserTest('fixture binding supports class-only/static fields and preserves unrecognized authored content', async (_t, browser) => {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<div class="combinedAName"></div><div data-field="currentAGameScore">0</div><div class="isGame1Started" style="display:none"><b class="game1AScore">0</b></div><div class="isGame7Started" style="opacity:0"><b class="game7AScore">0</b></div><span class="isACurrentlyServing" style="opacity:0">SERVE</span><span data-osb-static="true" data-sport-stat="gameClock">00:00</span><span data-sport-stat="gameClock">AUTHORED</span><span data-osb-static="true" data-sport-stat="unknown">CUSTOM</span><div class="custom">Keep this title</div>');
  const result = await page.evaluate(applySportFixture, getSportFixture('basketball'));
  assert.ok(result.changes.includes('combinedAName'));
  assert.equal(await page.locator('.combinedAName').textContent(), 'Waves');
  assert.equal(await page.locator('[data-field]').textContent(), '78');
  assert.equal(await page.locator('.game1AScore').textContent(), '24');
  assert.equal(await page.locator('.isGame1Started').evaluate(element => element.style.display), '');
  assert.equal(await page.locator('.isGame7Started').evaluate(element => element.style.opacity), '0');
  assert.equal(await page.locator('[data-osb-static][data-sport-stat="gameClock"]').textContent(), '06:42');
  assert.equal(await page.locator('[data-sport-stat="gameClock"]:not([data-osb-static])').textContent(), 'AUTHORED');
  assert.equal(await page.locator('[data-sport-stat="unknown"]').textContent(), 'CUSTOM');
  assert.equal(await page.locator('.custom').textContent(), 'Keep this title');
  assert.equal(await page.locator('.isACurrentlyServing').textContent(), 'SERVE');
  await page.close();
});

browserTest('native viewport captures the full wide/negative-position design, is deterministic, and refuses blank/oversized/remote assets', async (t, browser) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-browser-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'studio/public'), { recursive: true });
  const html = '<!doctype html><html><style>html,body{margin:0;background:transparent}.board{position:absolute;left:-20px;top:30px;width:1500px;height:130px;background:#24343b;color:white;font:32px Arial}.combinedAName{padding:10px}</style><body><div class="board"><span class="combinedAName"></span><span class="currentAGameScore">0</span><b style="position:absolute;right:0">RIGHT EDGE</b></div></body></html>';
  const first = await renderDesign(browser, root, { html, css: '' }, 'basketball');
  assert.equal(first.diagnostics.geometry.viewport.width, 1280);
  assert.equal(first.diagnostics.pixels.width, 1516);
  assert.equal(first.diagnostics.pixels.height, first.diagnostics.clip.height);
  assert.ok(first.diagnostics.pixels.pixelBounds.right > 1490, 'right edge captured');
  assert.ok(first.diagnostics.pixels.pixelBounds.left <= 8, 'left edge captured');
  assert.deepEqual(first.diagnostics.blockedRequests, []);
  assert.deepEqual(first.diagnostics.missingAssets, []);
  const second = await renderDesign(browser, root, { html, css: '' }, 'basketball');
  assert.ok(first.bytes.equals(second.bytes), 'repeat screenshots must match byte for byte');
  for (const [replacement, pattern] of [
    ['<html><body></body></html>', /No visible/],
    [html.replace('1500px', '6000px'), /safe capture/],
    [html.replace('</body>', '<img src="https://example.invalid/remote.png"></body>'), /Blocked remote/],
    [html.replace('</body>', '<img src="/missing.png"></body>'), /missing local/],
    [html.replace('</style>', '@import "https://example.invalid/style.css";</style>'), /stylesheet dependency/],
  ]) await assert.rejects(() => renderDesign(browser, root, { html: replacement, css: '' }, 'basketball'), pattern);
});

browserTest('separate safe CSS and only local public flags are rendered without modifying source', async (t, browser) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-css-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'studio/public/scoreboard-runtime/flags'), { recursive: true });
  for (const country of ['jp', 'se']) await writeFile(path.join(root, `studio/public/scoreboard-runtime/flags/${country}.png`), await readFile(new URL(`../studio/public/scoreboard-runtime/flags/${country}.png`, import.meta.url)));
  const document = { html: '<!doctype html><html><body><div class="board"><span class="combinedAName"></span><span class="currentAGameScore">0</span><img class="countryA" src=""><img class="countryB" src=""></div></body></html>', css: 'html,body{margin:0;background:transparent}.board{width:300px;height:120px;background:#164a3a;color:white;font:30px Arial}img{width:32px;height:20px}' };
  const before = JSON.stringify(document);
  const result = await renderDesign(browser, root, document, 'tableTennis');
  assert.equal(JSON.stringify(document), before);
  assert.deepEqual(result.diagnostics.missingAssets, []);
  assert.deepEqual(result.diagnostics.blockedRequests, []);
  assert.equal(result.diagnostics.pixels.width, 316);
  assert.equal(result.diagnostics.pixels.height, 136);
  assert.ok(result.diagnostics.bindings.includes('countryA'));
  await assert.rejects(() => renderDesign(browser, root, { ...document, css: `${document.css}.board{background-image:url(https://example.invalid/no.png)}` }, 'tableTennis'), /Blocked remote/);
  await assert.rejects(() => renderDesign(browser, root, { ...document, html: document.html.replace('</body>', '<script>throw new Error("never run")</script></body>') }, 'tableTennis'), /executable|unsupported|script/i);
});

browserTest('generation checkpoints metadata, reuses exact images, and removes success for failed rendering', async (t, _browser) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-resume-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await mkdir(path.join(root, 'published')); await mkdir(path.join(root, 'studio/public'), { recursive: true });
  let html = '<!doctype html><html><style>body{margin:0;background:transparent}.board{width:320px;height:130px;background:#24343b;color:white;font:32px Arial}</style><body><div class="board"><span class="combinedAName"></span><span class="currentAGameScore">0</span></div></body></html>';
  const entry = { fileName: 'sample-resume.html', output: 'html-replications/sample-resume.html', sport: 'basketball' };
  const saveDesign = async () => { const document = { html, css: '' }; entry.contentHash = contentHash(document); entry.documentPath = `published/${entry.contentHash}.json`; await writeFile(path.join(root, entry.documentPath), JSON.stringify(document)); await writeFile(path.join(root, 'templates', entry.output), html); await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ schemaVersion: 1, templates: [entry] })); };
  await saveDesign();
  const source = await readFile(path.join(root, 'templates', entry.output));
  const first = await renderPreviews({ root }); assert.equal(first.rendered, 1); assert.equal(first.failed, 0);
  assert.ok((await readFile(path.join(root, 'templates', entry.output))).equals(source));
  const before = await readFile(path.join(root, 'previews/manifest.json'));
  const second = await renderPreviews({ root }); assert.equal(second.reused, 1); assert.equal(second.rendered, 0);
  assert.ok((await readFile(path.join(root, 'previews/manifest.json'))).equals(before));
  assert.equal((await renderPreviews({ root, check: true })).checked, 1);
  const firstManifest = JSON.parse(before);
  await writeFile(path.join(root, firstManifest.entries[entry.fileName].path), 'interrupted image');
  const repaired = await renderPreviews({ root }); assert.equal(repaired.rendered, 1); assert.equal(repaired.failed, 0);
  assert.equal((await renderPreviews({ root, check: true })).checked, 1);
  html = html.replace('</body>', '<img src="/missing.png"></body>'); await saveDesign();
  const failed = await renderPreviews({ root }); assert.equal(failed.failed, 1);
  const manifest = JSON.parse(await readFile(path.join(root, 'previews/manifest.json')));
  assert.deepEqual(manifest.entries, {});
});
