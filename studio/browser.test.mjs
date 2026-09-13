import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startStudioServer } from './server.mjs';

// Optional local test tooling only. The application has no browser-tool dependency.
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = process.env.STUDIO_TEST_ARTIFACTS || '/tmp/proscoreboard-studio-browser';
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.fail('Expected browser state was not reached');
}
const fixture = '<!DOCTYPE html>\r\n<html><head><title>Review fixture</title><style>html,body{margin:0;width:1280px;height:720px;background:#fff;font-family:Arial}.board{position:absolute;left:80px;top:180px;width:1120px;height:320px;display:flex;background:#1762c4;color:white}.player{flex:1;padding:50px;font-size:54px}.score{font-size:74px}#probe{position:absolute;left:80px;top:540px;color:#1762c4;font-size:28px}</style></head><body>\r\n<section class="board"><div class="player"><div id="player-a" class="name combinedAName" data-osb-field="combinedAName">Original A</div><div class="score" data-osb-field="currentAGameScore">11</div></div><div class="player"><div class="name" data-osb-field="combinedBName">Original B</div><div class="score" data-osb-field="currentBGameScore">7</div></div></section><a id="probe" href="https://example.invalid/escape" target="_top">Select this link</a>\r\n<!-- exact spacing and CRLF must survive --></body></html>\r\n';

test('Studio browser: source fidelity, review persistence, conflicts, responsive preview and isolation', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-browser-fixture-'));
  let studio; let browser; let page;
  const checks = [];
  try {
    await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
    await mkdir(path.join(root, 'templates/references'), { recursive: true });
    await cp(path.join(here, 'public'), path.join(root, 'studio/public'), { recursive: true });
    const sourceFile = path.join(root, 'templates/html-replications/review-fixture.html');
    const unsafeFile = path.join(root, 'templates/html-replications/unsafe-fixture.html');
    await writeFile(sourceFile, fixture);
    await writeFile(unsafeFile, fixture.replace('</body>', '<script>parent.document.body.dataset.escaped="yes";top.location="https://example.invalid/script"</script><img src="/bad.png" onerror="parent.document.body.dataset.escaped=\'yes\'"><iframe srcdoc="<script>top.location=\'https://example.invalid/frame\'</script>"></iframe><meta http-equiv="refresh" content="0;url=https://example.invalid/refresh"></body>'));
    await writeFile(path.join(root, 'templates/html-replications/archive-fixture.html'), fixture);
    const manifest = [
      { output: 'html-replications/review-fixture.html', title: 'Review fixture', placement: 'Full screen', palette: ['#1762c4', '#e47991'], retired: false, published: false, referenceImage: '/templates/references/ref-035.png' },
      { output: 'html-replications/unsafe-fixture.html', title: 'Unsafe fixture', retired: false, published: false },
      { output: 'html-replications/archive-fixture.html', title: 'Archive fixture', retired: true, published: false },
    ];
    await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify(manifest));
    await cp(path.join(here, 'public/scoreboard-runtime/flags/jp.png'), path.join(root, 'templates/references/ref-035.png'));
    await mkdir(artifacts, { recursive: true });
    studio = await startStudioServer({ root, port: 0 });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
    page.on('response', async (response) => { if (response.url().includes('/api/') && response.status() >= 400) console.error(response.status(), await response.text()); });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(studio.url);
    await page.locator('#template-title').filter({ hasText: 'Review fixture' }).waitFor();
    const frame = page.frameLocator('#preview');
    await frame.locator('#player-a').filter({ hasText: 'Player A' }).waitFor();
    assert.equal(await page.locator('#preview').getAttribute('sandbox'), 'allow-same-origin');
    await frame.locator('#player-a').click();
    assert.equal(await page.locator('#element-selector').textContent(), '#player-a');
    assert.equal(await page.locator('#element-field').textContent(), 'combinedAName');
    assert.match(await page.locator('#element-html').textContent(), /Original A/);
    assert.match(await page.locator('#computed-css').textContent(), /font-size:/);
    assert.equal(await page.locator('#selection-outline').isVisible(), true);
    await frame.locator('#probe').click();
    assert.equal(page.url(), `${studio.url}/`);
    assert.match(await page.locator('#authored-css').textContent(), /#probe/);
    await frame.locator('#player-a').click();
    await page.selectOption('#note-kind', 'restyle');
    await page.fill('#note-text', 'Increase player name contrast against the blue panel; keep the combinedAName binding intact.');
    await page.click('#add-note');
    await page.click('#save-notes');
    await page.locator('#notice-text').filter({ hasText: 'Review notes saved' }).waitFor();
    const reviewFile = path.join(root, 'reviews/review-fixture.json');
    let review = JSON.parse(await readFile(reviewFile, 'utf8'));
    assert.equal(review.notes[0].selector, '#player-a'); assert.equal(review.notes[0].kind, 'restyle');
    assert.match(review.notes[0].elementHTML, /Original A/); assert.equal(review.notes[0].sourceHash.length, 64);
    assert.equal(await readFile(sourceFile, 'utf8'), fixture);
    await page.reload();
    await page.locator('.note p').filter({ hasText: 'Increase player name contrast' }).waitFor();
    await page.locator('.note button').filter({ hasText: /^Edit$/ }).click();
    await page.fill('#note-text', 'Use white text with a minimum 4.5:1 contrast ratio. Preserve the player binding.');
    await page.click('#add-note'); await page.click('#save-notes');
    await page.locator('#notice-text').filter({ hasText: 'Review notes saved' }).waitFor();
    await page.locator('.note button').filter({ hasText: /^Resolve$/ }).click(); await page.click('#save-notes');
    await page.locator('#notice-text').filter({ hasText: 'Review notes saved' }).waitFor();
    review = JSON.parse(await readFile(reviewFile, 'utf8')); assert.equal(review.notes[0].status, 'resolved');
    checks.push('Selection + authored/computed inspector; navigation prevented; notes add/edit/resolve saved to file and reloaded; raw CRLF source unchanged.');

    await page.click('#source-tab');
    assert.equal(await page.locator('#source').inputValue(), fixture.replace(/\r\n/g, '\n'));
    const edited = fixture.replace('exact spacing', 'edited spacing');
    await page.fill('#source', edited);
    await page.locator('#unsaved').waitFor();
    page.once('dialog', (dialog) => dialog.dismiss()); await page.locator('[data-id="unsafe-fixture"]').click();
    assert.equal(await page.locator('#template-title').textContent(), 'Review fixture');
    await page.click('#save-source');
    await page.locator('#notice-text').filter({ hasText: 'Source saved.' }).waitFor();
    assert.equal(await readFile(sourceFile, 'utf8'), edited);
    assert.equal(await page.locator('.stale').textContent(), 'Source changed · stale');
    checks.push('Explicit raw source save preserves CRLF and untouched bytes; no placeholder/highlight serialization; stale note hash flagged.');

    await page.fill('#source', edited.replace('edited spacing', 'local unsaved'));
    const external = edited.replace('edited spacing', 'external edit'); await writeFile(sourceFile, external);
    await page.locator('#notice-text').filter({ hasText: 'Files changed on disk' }).waitFor();
    assert.match(await page.locator('#source').inputValue(), /local unsaved/);
    await page.click('#save-source');
    await page.locator('#notice-text').filter({ hasText: 'nothing was overwritten' }).waitFor();
    assert.equal(await readFile(sourceFile, 'utf8'), external);
    assert.equal(await page.locator('#save-source').isDisabled(), true);
    page.once('dialog', (dialog) => dialog.accept()); await page.click('#reload');
    await until(async () => (await page.locator('#source').inputValue()).includes('external edit'));
    checks.push('Dirty SSE notice does not overwrite; source 409 locks save and explicit reload confirms discard.');

    await page.click('#preview-tab'); await frame.locator('#player-a').click();
    await page.fill('#note-text', 'Adjust spacing without changing binding.'); await page.click('#add-note');
    review = JSON.parse(await readFile(reviewFile, 'utf8')); review.revision += 1;
    await writeFile(reviewFile, JSON.stringify(review));
    await page.click('#save-notes'); await page.locator('#notice-text').filter({ hasText: 'nothing was overwritten' }).waitFor();
    assert.equal(JSON.parse(await readFile(reviewFile, 'utf8')).notes.length, 1);
    page.once('dialog', (dialog) => dialog.accept()); await page.click('#reload');
    await until(async () => await page.locator('#save-notes').isDisabled() && await page.locator('.note').count() === 1);
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    await page.click('#save-notes'); await page.locator('#notice-text').filter({ hasText: 'Review notes saved' }).waitFor();
    assert.equal(JSON.parse(await readFile(reviewFile, 'utf8')).notes.length, 0);
    checks.push('Review revision 409 preserves external notes; confirmed delete persists.');

    await page.check('#reference-toggle'); await page.locator('#reference').waitFor();
    await until(() => page.locator('#reference').evaluate((img) => img.naturalWidth > 0));
    await page.uncheck('#reference-toggle');
    await page.click('#zoom-in'); await page.click('#zoom-fit');
    await page.screenshot({ path: path.join(artifacts, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await frame.locator('#player-a').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const previewBox = await page.locator('#preview').boundingBox(); assert(previewBox.width > 200 && previewBox.height > 100);
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
    checks.push('Desktop/mobile nonblank 1280x720 scaled preview, reference comparison and fit controls; no horizontal page overflow.');

    await page.locator('[data-id="unsafe-fixture"]').click();
    await page.locator('#template-title').filter({ hasText: 'Unsafe fixture' }).waitFor();
    await frame.locator('#player-a').waitFor();
    await frame.locator('#probe').click();
    assert.equal(page.url(), `${studio.url}/`);
    assert.equal(await page.evaluate(() => document.body.dataset.escaped), undefined);
    assert.equal(await frame.locator('script,iframe,meta[http-equiv="refresh"],[onerror]').count(), 0);
    await page.click('#archived-filter'); assert.equal(await page.locator('.template-item').count(), 1);
    await page.fill('#search', 'not a match'); assert.equal(await page.locator('.template-item').count(), 0);
    assert.deepEqual(errors, []);
    checks.push('Hostile scripts, event attributes, nested iframe and refresh stripped; top navigation prevented; archived/search filters verified; zero page errors.');
    await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ status: 'passed', checks, artifacts }, null, 2));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); console.error('Studio notice:', await page.locator('#notice-text').textContent().catch(() => 'unavailable')); }
    throw error;
  } finally {
    await browser?.close(); await studio?.close(); await rm(root, { recursive: true, force: true });
  }
});

test('Studio real catalog renders on desktop and mobile without editing source', { timeout: 60_000 }, async () => {
  const studio = await startStudioServer({ root: path.resolve(here, '..'), port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(studio.url);
    const frame = page.frameLocator('#preview');
    await frame.locator('[data-osb-field="combinedAName"]').filter({ hasText: 'Player A' }).first().waitFor();
    assert(await page.locator('.template-item').count() > 100);
    await page.locator('#preview').screenshot({ path: path.join(artifacts, 'real-preview.png') });
    await page.screenshot({ path: path.join(artifacts, 'real-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, 'real-mobile.png'), fullPage: true });
    const imageStates = await frame.locator('img[src]').evaluateAll((images) => images.map((img) => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 })));
    assert(imageStates.filter((img) => img.src.startsWith('/scoreboard-runtime/flags/')).every((img) => img.loaded));
    await writeFile(path.join(artifacts, 'real-catalog-report.json'), JSON.stringify({ status: 'passed', imageStates }, null, 2));
  } finally { await browser?.close(); await studio.close(); }
});
