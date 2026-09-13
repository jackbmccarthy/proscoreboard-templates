import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { startStudioServer } from './server.mjs';

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.SOCIAL_TEST_ARTIFACTS || path.join(tmpdir(), 'proscoreboard-social-browser');
const hash = (text) => createHash('sha256').update(text).digest('hex');
async function until(check) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.fail('Expected browser state was not reached');
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'social-browser-'));
  await cp(path.join(rootDir, 'studio/public'), path.join(root, 'studio/public'), { recursive: true });
  await cp(path.join(rootDir, 'social'), path.join(root, 'social'), { recursive: true });
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), '[]');
  return root;
}
async function ready(page) { await until(() => page.locator('#export-png').isEnabled()); }
async function saved(page, message = 'JSON saved.') { await page.locator('#notice-text').filter({ hasText: message }).waitFor(); }
async function setProperty(page, id, value) { await page.fill(`#prop-${id}`, String(value)); await page.locator(`#prop-${id}`).press('Tab'); await ready(page); }

test('Social Studio: real JSON/layer saves, review lifecycle, draft guards, CAS conflicts, images and responsive canvas', { timeout: 120_000 }, async () => {
  const root = await fixture(); let studio, browser, page;
  const manifest = JSON.parse(await readFile(path.join(root, 'social/manifest.json'), 'utf8'));
  await mkdir(artifacts, { recursive: true });
  try {
    studio = await startStudioServer({ root, port: 0 }); browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${studio.url}/social.html`); await ready(page);
    assert.equal(await page.locator('.template-item').count(), manifest.length);
    const sourcePath = path.join(root, 'social/templates/starter-champion.json');
    const initial = await readFile(sourcePath, 'utf8');
    assert.equal(await page.locator('#source').inputValue(), initial);
    await page.locator('.layer-item[data-layer-id="champion-name"]').click();
    assert.equal(await page.locator('#selected-id').textContent(), 'layers.champion-name');
    const preview = await page.locator('#preview').boundingBox();
    await page.mouse.click(preview.x + preview.width * .5, preview.y + preview.height * .45);
    assert.equal(await page.locator('#selected-id').textContent(), 'layers.champion-name');
    await setProperty(page, 'fontSize', 100);
    await page.click('#duplicate-layer'); await ready(page);
    const duplicateID = (await page.locator('#selected-id').textContent()).slice(7);
    await page.click('#lower-layer'); await ready(page);
    await page.click('#save-source'); await saved(page);
    const written = JSON.parse(await readFile(sourcePath, 'utf8'));
    assert.equal(written.layers.find((l) => l.id === 'champion-name').fontSize, 100);
    assert.equal(written.layers[2].id, duplicateID); assert.equal(written.layers[3].id, 'champion-name');
    assert.equal(written.layers.find((l) => l.id === duplicateID).field, 'championName');
    await page.click('#source-tab');
    const rawEdit = ` \n${await page.locator('#source').inputValue()}\t\n`;
    await page.fill('#source', rawEdit); await page.click('#save-source'); await saved(page);
    assert.equal(await readFile(sourcePath, 'utf8'), rawEdit);
    await page.click('#design-tab'); await ready(page);
    await page.locator('.samples summary').click();
    await page.fill('#sample-championName', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(8)); await ready(page);
    assert.equal(await page.locator('#unsaved').isVisible(), false);
    assert.equal(await readFile(sourcePath, 'utf8'), await page.locator('#source').inputValue());
    await page.screenshot({ path: path.join(artifacts, 'desktop-long-name.png'), fullPage: true });

    await page.click('#review-tab'); await page.selectOption('#note-kind', 'binding');
    await page.selectOption('#note-target', duplicateID); await page.fill('#note-text', 'Keep the champion binding and adjust the name size.'); await page.click('#add-note');
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    const reviewPath = path.join(root, 'reviews/social/starter-champion.json');
    let review = JSON.parse(await readFile(reviewPath, 'utf8'));
    assert.equal(review.notes[0].selector, `layers.${duplicateID}`); assert.equal(review.notes[0].field, 'championName');
    assert.equal(JSON.parse(review.notes[0].elementHTML).fontSize, 100); assert.equal(JSON.parse(review.notes[0].css).fontSize, 100);
    assert.equal(review.notes[0].sourceHash, hash(await readFile(sourcePath, 'utf8')));
    await page.reload(); await ready(page); await page.click('#review-tab');
    await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.fill('#note-text', 'Preserve binding; use the selected font size.'); await page.click('#add-note');
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    const briefDownload = page.waitForEvent('download'); await page.click('#export-brief');
    const brief = await briefDownload; await brief.saveAs(path.join(artifacts, 'review-brief.md'));
    assert.match(await readFile(path.join(artifacts, 'review-brief.md'), 'utf8'), new RegExp(`layers\\.${duplicateID}`));
    await page.getByRole('button', { name: 'Resolve', exact: true }).click(); await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    review = JSON.parse(await readFile(reviewPath, 'utf8')); assert.equal(review.notes[0].status, 'resolved');

    await page.fill('#note-text', 'Unsaved review draft');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.locator('[data-id="starter-final-score"]').click();
    assert.equal(await page.locator('#note-text').inputValue(), 'Unsaved review draft');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('link', { name: 'Scoreboards', exact: true }).click();
    assert.match(page.url(), /social.html$/);
    await page.fill('#note-text', ''); await page.click('#source-tab');
    const savedSource = await page.locator('#source').inputValue();
    await page.fill('#source', savedSource.replace('Champion announcement', 'Local unsaved name'));
    const external = savedSource.replace('Champion announcement', 'External name'); await writeFile(sourcePath, external);
    await page.locator('#notice-text').filter({ hasText: 'Files changed on disk' }).waitFor();
    assert.match(await page.locator('#source').inputValue(), /Local unsaved/);
    await page.click('#save-source'); await saved(page, 'nothing was overwritten');
    assert.equal(await readFile(sourcePath, 'utf8'), external); assert.equal(await page.locator('#save-source').isDisabled(), true);
    page.once('dialog', (dialog) => dialog.accept()); await page.click('#reload');
    await until(async () => (await page.locator('#source').inputValue()).includes('External name'));
    await page.fill('#source', '{ broken JSON'); await page.click('#design-tab');
    assert.equal(await page.locator('#source-panel').isVisible(), true); assert.equal(await page.locator('#export-png').isDisabled(), true);
    await page.fill('#source', external); assert.equal(await page.locator('#apply-source').isDisabled(), true); await ready(page);
    await page.click('#review-tab'); await page.fill('#note-text', 'Local unsaved note'); await page.click('#add-note');
    review.revision += 1; await writeFile(reviewPath, JSON.stringify(review));
    await page.click('#save-notes'); await saved(page, 'nothing was overwritten');
    assert.equal(JSON.parse(await readFile(reviewPath, 'utf8')).notes.length, 1);
    page.once('dialog', (dialog) => dialog.accept()); await page.click('#reload');
    await until(async () => await page.locator('.note').count() === 1 && await page.locator('#save-notes').isDisabled());
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    assert.equal(JSON.parse(await readFile(reviewPath, 'utf8')).notes.length, 0);

    await page.click('#design-tab'); await page.selectOption('#add-type', 'image'); await page.click('#add-layer'); await ready(page);
    const beforeImage = await page.locator('#preview').evaluate((canvas) => canvas.toDataURL());
    await page.locator('#image-import').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await saved(page, 'Choose a PNG');
    assert.equal(await page.locator('#preview').evaluate((canvas) => canvas.toDataURL()), beforeImage);
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20; const c = canvas.getContext('2d'); c.fillStyle = '#fa2050'; c.fillRect(0, 0, 20, 20); return canvas.toDataURL().split(',')[1]; });
    await page.locator('#image-import').setInputFiles({ name: 'safe.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await until(async () => (await page.locator('#source').inputValue()).includes('data:image/png'));
    await ready(page); assert.notEqual(await page.locator('#preview').evaluate((canvas) => canvas.toDataURL()), beforeImage);
    await page.click('#review-tab'); await page.fill('#note-text', 'Restyle the imported image frame.'); await page.click('#add-note');
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    const imageNote = JSON.parse(await readFile(reviewPath, 'utf8')).notes[0];
    assert.equal(JSON.parse(imageNote.elementHTML).src, '[embedded image omitted]');
    assert(Buffer.byteLength(imageNote.elementHTML) < 20_000); assert.match(imageNote.selector, /^layers\.layer-/);
    await page.click('#design-tab');
    await page.getByRole('button', { name: 'Clear image', exact: true }).click(); await ready(page);
    assert.equal(await page.locator('#preview').evaluate((canvas) => canvas.toDataURL()), beforeImage);
    page.once('dialog', (dialog) => dialog.accept()); await page.click('#remove-layer'); await ready(page); await page.click('#save-source'); await saved(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await until(async () => (await page.locator('#preview').boundingBox()).width <= 350);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobile = await page.locator('#preview').boundingBox(); assert(mobile.width >= 250); assert(Math.abs(mobile.width / mobile.height - 1) < .01);
    await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
    await page.selectOption('#category', 'recap'); assert.equal(await page.locator('.template-item').count(), manifest.filter((entry) => entry.category === 'recap').length);
    await page.selectOption('#category', ''); await page.fill('#search', 'final score'); assert.equal(await page.locator('.template-item').count(), 1);
    await page.fill('#search', ''); assert((await page.locator('#preset-filter option').count()) > 2);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); console.error(await page.locator('#notice-text').textContent().catch(() => 'No notice')); }
    throw error;
  } finally { await browser?.close(); await studio?.close(); await rm(root, { recursive: true, force: true }); }
});

test('Broken JSON and schema-invalid templates retain raw repair, notes and brief without reusing another canvas', { timeout: 60_000 }, async () => {
  const root = await fixture(); let studio, browser, page;
  const manifest = JSON.parse(await readFile(path.join(root, 'social/manifest.json'), 'utf8'));
  const syntaxID = 'starter-champion'; const schemaID = 'starter-final-score';
  const syntaxPath = path.join(root, 'social/templates', `${syntaxID}.json`);
  const schemaPath = path.join(root, 'social/templates', `${schemaID}.json`);
  const goodSyntax = await readFile(syntaxPath, 'utf8'); const goodSchema = await readFile(schemaPath, 'utf8');
  const brokenSyntax = '{ "id": "starter-champion",\r\n "layers": [';
  const brokenSchema = JSON.stringify({ ...JSON.parse(goodSchema), layers: null });
  await writeFile(syntaxPath, brokenSyntax); await writeFile(schemaPath, brokenSchema);
  await mkdir(artifacts, { recursive: true });
  try {
    studio = await startStudioServer({ root, port: 0 }); browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${studio.url}/social.html`);
    await until(async () => await page.locator('#source').isEnabled() && await page.locator('#template-meta').textContent() === `${syntaxID}.json`);
    assert.equal(await page.locator('.template-item').count(), manifest.length);
    assert.equal(await page.locator('#source-panel').isVisible(), true);
    assert.equal(await page.locator('#source').inputValue(), brokenSyntax.replaceAll('\r\n', '\n'));
    assert((await page.locator('#validation').textContent()).length > 0);
    assert.equal(await page.locator('#export-png').isDisabled(), true);
    assert.equal(await page.locator('#design-tab').isDisabled(), true);
    assert.equal(await page.locator('#add-layer').isDisabled(), true);
    assert.equal(await page.locator('.layer-item').count(), 0);
    assert.equal(await page.locator('#properties input,#properties select').count(), 0);
    await page.screenshot({ path: path.join(artifacts, 'repair-syntax.png'), fullPage: true });
    await page.click('#review-tab'); await page.selectOption('#note-kind', 'general');
    await page.fill('#note-text', 'Repair the incomplete layers JSON before adjusting typography.'); await page.click('#add-note');
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    const notes = JSON.parse(await readFile(path.join(root, 'reviews/social', `${syntaxID}.json`), 'utf8')).notes;
    assert.equal(notes[0].selector, ''); assert.equal(notes[0].elementHTML, ''); assert.equal(notes[0].css, ''); assert.equal(notes[0].sourceHash, hash(brokenSyntax));
    const pending = page.waitForEvent('download'); await page.click('#export-brief');
    await (await pending).saveAs(path.join(artifacts, 'broken-template-brief.md'));
    const brief = await readFile(path.join(artifacts, 'broken-template-brief.md'), 'utf8');
    assert.match(brief, /Repair the incomplete layers JSON/); assert.match(brief, /starter-champion/);
    await page.click('#source-tab'); await page.fill('#source', goodSyntax.replaceAll('starter-champion', 'different-id'));
    assert.equal(await page.locator('#save-source').isEnabled(), true);
    await page.click('#save-source'); await saved(page, 'template ID cannot change');
    assert.equal(await readFile(syntaxPath, 'utf8'), brokenSyntax);
    await page.fill('#source', goodSyntax); await page.click('#save-source'); await saved(page); await ready(page);
    assert.equal(await readFile(syntaxPath, 'utf8'), goodSyntax.replaceAll('\n', '\r\n'));
    await page.click('#design-tab'); assert.equal(await page.locator('#preview').isVisible(), true);
    assert((await page.locator('.layer-item').count()) > 0);
    await page.locator('.layer-item[data-layer-id="champion-name"]').click();

    await page.locator(`[data-id="${schemaID}"]`).click();
    await until(async () => await page.locator('#source').inputValue() === brokenSchema);
    assert.equal(await page.locator('#source-panel').isVisible(), true);
    assert.match(await page.locator('#validation').textContent(), /layers/);
    assert.equal(await page.locator('.layer-item').count(), 0);
    assert.equal(await page.locator('#layer-json').textContent(), '');
    assert.equal(await page.locator('#selection-outline').isVisible(), false);
    assert.equal(await page.locator('#canvas-stage').isVisible(), false);
    assert.equal(await page.locator('#preview').getAttribute('data-rendered'), null);
    assert.equal(await page.locator('#preview').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.every((channel) => channel === 0)), true);
    assert.equal(await page.locator('#export-png').isDisabled(), true);
    await page.click('#review-tab'); assert.equal(await page.locator('#note-target option').count(), 1);
    await page.fill('#note-text', 'Restore a valid layers array.'); await page.click('#add-note');
    await page.click('#save-notes'); await saved(page, 'Review notes saved.');
    assert.equal(JSON.parse(await readFile(path.join(root, 'reviews/social', `${schemaID}.json`), 'utf8')).notes[0].selector, '');
    await page.click('#source-tab'); await page.fill('#source', goodSchema); await page.click('#apply-source'); await ready(page);
    assert.equal(await readFile(schemaPath, 'utf8'), brokenSchema);
    await page.click('#save-source'); await saved(page); assert.equal(await readFile(schemaPath, 'utf8'), goodSchema);
    await page.click('#design-tab'); assert.equal(await page.locator('#preview').isVisible(), true);
    await page.screenshot({ path: path.join(artifacts, 'repair-restored.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'repair-failure.png'), fullPage: true }).catch(() => {}); console.error(await page.locator('#notice-text').textContent().catch(() => 'No notice')); }
    throw error;
  } finally { await browser?.close(); await studio?.close(); await rm(root, { recursive: true, force: true }); }
});

test('Every authored template exports nonblank native PNGs on desktop/mobile; renderer rejects active and cross-MIME image data', { timeout: 120_000 }, async () => {
  const root = await fixture(); let studio, browser;
  const manifest = JSON.parse(await readFile(path.join(root, 'social/manifest.json'), 'utf8'));
  await mkdir(artifacts, { recursive: true });
  try {
    studio = await startStudioServer({ root, port: 0 }); browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${studio.url}/social`); await ready(page);
    const catalog = await fetch(`${studio.url}/api/social/catalog`).then((r) => r.json());
    assert(manifest.length > 0); assert.equal(catalog.templates.length, manifest.length);
    assert.deepEqual(catalog.templates.map((entry) => entry.id).sort(), manifest.map((entry) => entry.id).sort());
    const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const entry of catalog.templates) {
        await page.locator(`[data-id="${entry.id}"]`).click();
        await until(async () => (await page.locator('#template-meta').textContent()) === entry.fileName); await ready(page);
        const template = JSON.parse(await readFile(path.join(root, 'social/templates', entry.fileName), 'utf8'));
        const pixels = await page.locator('#preview').evaluate((canvas) => {
          const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; const colors = new Set();
          for (let i = 0; i < bytes.length; i += 400) colors.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
          return { width: canvas.width, height: canvas.height, colors: colors.size };
        });
        assert.equal(pixels.width, template.width); assert.equal(pixels.height, template.height); assert(pixels.colors > 2, entry.id);
        const box = await page.locator('#preview').boundingBox(); assert(Math.abs(box.width / box.height - template.width / template.height) < .01);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const pending = page.waitForEvent('download'); await page.click('#export-png'); const download = await pending;
        const pngPath = path.join(artifacts, `${entry.id}-${viewport.width}.png`); await download.saveAs(pngPath);
        const bytes = await readFile(pngPath); assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.equal(bytes.readUInt32BE(16), template.width); assert.equal(bytes.readUInt32BE(20), template.height);
        assert.equal(await page.locator('#unsaved').isVisible(), false);
      }
      await page.screenshot({ path: path.join(artifacts, `catalog-${viewport.width}.png`), fullPage: true });
    }
    const safety = await page.evaluate(async () => {
      const { renderSocialGraphic, safeImageSource } = await import('/social-renderer.mjs');
      const t = JSON.parse(document.getElementById('source').value);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const png = canvas.toDataURL();
      const cases = [png.replace('image/png', 'image/jpeg'), `data:image/png;base64,${btoa('<svg onload="alert(1)"/>')}`, 'https://example.invalid/image.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,!!!'];
      const rejected = [];
      for (const source of cases) { try { await renderSocialGraphic({ ...t, backgroundImage: source }); rejected.push(false); } catch { rejected.push(true); } }
      const blank = { ...t, backgroundImage: '', layers: [] }; const a = await renderSocialGraphic(blank);
      const b = await renderSocialGraphic({ ...blank, layers: [{ ...t.layers[0], type: 'image', src: '', text: undefined, field: undefined }] });
      return { rejected, acceptsPNG: safeImageSource(png), emptyImageHidden: a.toDataURL() === b.toDataURL() };
    });
    assert(safety.rejected.every(Boolean)); assert(safety.acceptsPNG); assert(safety.emptyImageHidden); assert.deepEqual(errors, []);
    const thumbs = [];
    for (const entry of catalog.templates) thumbs.push({ name: entry.name || entry.id, src: `data:image/png;base64,${(await readFile(path.join(artifacts, `${entry.id}-1440.png`))).toString('base64')}` });
    const sheet = await page.evaluate(async (items) => {
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = Math.ceil(items.length / 4) * 440;
      const c = canvas.getContext('2d'); c.fillStyle = '#e9ecee'; c.fillRect(0, 0, canvas.width, canvas.height);
      for (const [index, item] of items.entries()) {
        const img = new Image(); img.src = item.src; await img.decode();
        const x = index % 4 * 360; const y = Math.floor(index / 4) * 440; const scale = Math.min(328 / img.width, 384 / img.height);
        c.drawImage(img, x + (360 - img.width * scale) / 2, y + 16, img.width * scale, img.height * scale);
        c.fillStyle = '#24282b'; c.font = 'bold 15px Arial'; c.fillText(item.name, x + 16, y + 423, 328);
      }
      return canvas.toDataURL().split(',')[1];
    }, thumbs);
    await writeFile(path.join(artifacts, 'contact-sheet.png'), Buffer.from(sheet, 'base64'));
    await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ status: 'passed', templates: catalog.templates.length, exports: catalog.templates.length * viewports.length, viewports: viewports.map((viewport) => viewport.width), safety, pageErrors: errors }, null, 2));
  } finally { await browser?.close(); await studio?.close(); await rm(root, { recursive: true, force: true }); }
});
