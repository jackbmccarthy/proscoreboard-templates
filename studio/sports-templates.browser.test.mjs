import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from '../templates/html-replications/manifest.json' with { type: 'json' };

const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
const entries = manifest.filter(entry => entry.output.startsWith('html-replications/sport-'));
test('sport overlays keep score tracks stable, truncate long names and fit desktop/mobile', { timeout: 120_000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const entry of entries) {
      const html = await readFile(new URL(`../templates/${entry.output}`, import.meta.url), 'utf8');
      for (const width of [1920, 1280, 390]) {
        const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : Math.round(width * 9 / 16) } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.abort());
        await page.setContent(html);
        if (process.env.SPORT_TEMPLATE_ARTIFACTS) {
          await mkdir(process.env.SPORT_TEMPLATE_ARTIFACTS, { recursive: true });
          await page.evaluate(() => { document.body.style.background = '#000'; });
          await page.screenshot({ path: path.join(process.env.SPORT_TEMPLATE_ARTIFACTS, `${entry.sport}-${width}.png`) });
          await page.evaluate(() => { document.body.style.background = 'transparent'; });
        }
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
        const scores = ['currentAGameScore', 'currentBGameScore'];
        const scoreTracks = () => Promise.all(scores.map(field => page.locator(`[data-osb-field="${field}"]`).evaluate(element => {
          const track = element.parentElement.matches('.goal-cell,.cell') ? element.parentElement : element;
          const rect = track.getBoundingClientRect();
          return { x: rect.x, width: rect.width };
        })));
        const before = await scoreTracks();
        await page.evaluate(score => {
          for (const side of ['A', 'B']) {
            document.querySelector(`[data-osb-field="combined${side}Name"]`).textContent = `Team ${side} With A Very Long Competitor Name That Must Truncate`;
            document.querySelector(`[data-osb-field="current${side}GameScore"]`).textContent = score;
            document.querySelector(`[data-osb-field="current${side}MatchScore"]`).textContent = '3';
          }
        }, entry.sport === 'basketball' ? '128' : '12');
        const after = await scoreTracks();
        for (let index = 0; index < before.length; index++) {
          assert.ok(Math.abs(before[index].x - after[index].x) < 1, `${entry.sport} ${width}: score track moved ${JSON.stringify({before:before[index],after:after[index]})}`);
          assert.ok(Math.abs(before[index].width - after[index].width) < 1, `${entry.sport} ${width}: score track resized`);
        }
        const layout = await page.evaluate(() => {
          const fields = [...document.querySelectorAll('[data-osb-field]')].filter(element => element.getBoundingClientRect().width && getComputedStyle(element).display !== 'none');
          return { overflow: document.documentElement.scrollWidth > innerWidth, outside: fields.filter(element => { const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1; }).map(element => element.dataset.osbField) };
        });
        assert.equal(layout.overflow, false, `${entry.sport} ${width}: document overflow`);
        assert.deepEqual(layout.outside, [], `${entry.sport} ${width}: live fields outside viewport`);
        for (const field of scores) {
          const fits = await page.locator(`[data-osb-field="${field}"]`).evaluate(element => element.scrollWidth <= element.clientWidth + 1);
          assert.ok(fits, `${entry.sport} ${width}: live score clipped`);
        }
        assert.deepEqual(errors, []);
        if (process.env.SPORT_TEMPLATE_ARTIFACTS) {
          await mkdir(process.env.SPORT_TEMPLATE_ARTIFACTS, { recursive: true });
          await page.evaluate(() => {
            document.body.style.background = '#000';
            for (const side of ['A', 'B']) {
              document.querySelector(`[data-osb-field="combined${side}Name"]`).textContent = `Team ${side}`;
              document.querySelector(`[data-osb-field="current${side}GameScore"]`).textContent = '0';
              document.querySelector(`[data-osb-field="current${side}MatchScore"]`).textContent = '0';
            }
          });
          await page.screenshot({ path: path.join(process.env.SPORT_TEMPLATE_ARTIFACTS, `${entry.sport}-${width}.png`) });
        }
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
