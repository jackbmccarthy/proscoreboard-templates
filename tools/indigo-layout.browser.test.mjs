import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags, runtimeFields } from '../contract/index.mjs';
import { applySportFixture, getSportFixture } from './preview-fixtures.mjs';
import { renderDesign } from './render-previews.mjs';
import baseline from './fixtures/visual-trim-baseline.json' with { type: 'json' };

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
  'indigo-open-data-lane-pickleball-1.html',
  'indigo-open-data-lane-pickleball-2.html',
  'indigo-open-data-lane-table-tennis-1.html',
  'indigo-open-data-lane-table-tennis-2.html',
  'limestone-inset-subscore-table-tennis-2.html',
  'sage-slate-data-console-pickleball-2.html',
];
const sourceFor = file => readFile(path.join(root, 'templates/html-replications', file), 'utf8');
const fields = new Set(runtimeFields.map(field => field.field));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('bounded layout edits preserve exact binding tags/attributes, image slots and neutral values', async () => {
  for (const file of files) {
    const html = await sourceFor(file);
    const tags = readTemplateHTMLTags(html).filter(tag => !tag.closing);
    const bindings = tags.filter(tag => tag.attributes['data-osb-field'] || tag.attributes['data-field'] || (tag.attributes.class || '').split(/\s+/).some(name => fields.has(name)));
    const imageSlots = tags.filter(tag => tag.name === 'img').map(tag => tag.attributes);
    assert.equal(bindings.length, baseline[file].bindingCount, file);
    assert.equal(hash(bindings.map(tag => ({ tag: tag.name, attributes: tag.attributes }))), baseline[file].bindingsHash, file);
    assert.equal(imageSlots.length, baseline[file].imageSlotCount, file);
    assert.equal(hash(imageSlots), baseline[file].imageSlotsHash, file);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, file);
    assert.deepEqual(inspectTemplate(html).errors, [], file);
    assert.ok(!html.includes('osb-condition-side-label'), `${file}: preserve leader's footer trim`);
  }
});

test('indigo drops only the redundant header caption, retaining local match-score labels', async () => {
  for (const file of files.slice(0, 4)) {
    const tags = readTemplateHTMLTags(await sourceFor(file)).filter(tag => !tag.closing);
    const hasClass = (tag, name) => (tag.attributes.class || '').split(/\s+/).includes(name);
    assert.equal(tags.filter(tag => hasClass(tag, 'headline-data')).length, 0, file);
    assert.equal(tags.filter(tag => hasClass(tag, 'game-label')).length, 2, file);
  }
});

test('Sage retains the sport caption and local game/point labels', async () => {
  const html = await sourceFor('sage-slate-data-console-pickleball-2.html');
  assert.ok(html.includes('<span class="sport-tag">PICKLEBALL</span>'));
  assert.ok(html.includes('<span class="games-label">GAMES</span>'));
  assert.equal(html.split('<span class="points-label">POINTS</span>').length - 1, 2);
});

function measureScoreAllocation() {
  const box = element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, width: rect.width };
  };
  const board = document.querySelector('.board');
  const rail = document.querySelector('.osb-conditional-rail');
  const content = document.querySelector('.competitors');
  const numbers = [...document.querySelectorAll('.primary-score,.match-score,.score[data-osb-field]')].map(element => ({
    field: element.dataset.osbField,
    text: element.textContent,
    box: box(element),
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    parent: box(element.parentElement),
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  const labels = [...document.querySelectorAll('.game-label,.games-label,.point-label,.points-label')].map(element => ({
    text: element.textContent, box: box(element), parent: box(element.parentElement),
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }));
  const names = [...document.querySelectorAll('.name')].map(element => ({
    field: element.dataset.osbField, text: element.textContent, box: box(element), parent: box(element.parentElement),
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }));
  const sportTags = [...document.querySelectorAll('.console .sport-tag')].map(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const metrics = context.measureText(element.textContent);
    const baseline = rect.top + metrics.fontBoundingBoxAscent;
    return { text: element.textContent, box: box(element), parent: box(element.parentElement),
      lineHeight: parseFloat(style.lineHeight),
      glyph: { top: baseline - metrics.actualBoundingBoxAscent, bottom: baseline + metrics.actualBoundingBoxDescent,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent },
    };
  });
  const states = [...rail.querySelectorAll('[data-osb-field]')].map(element => ({
    field: element.dataset.osbField, box: box(element),
    visible: getComputedStyle(element).display !== 'none' && Number(getComputedStyle(element).opacity) > 0,
  }));
  return { board: box(board), rail: box(rail), content: box(content), numbers, labels, names, sportTags, states };
}

test('score rows reserve the status rail without vertical clipping at mobile/desktop idle and active states', {
  skip: !process.env.PLAYWRIGHT_MODULE_PATH,
  timeout: 120_000,
}, async t => {
  const { chromium } = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE_PATH)).href);
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  t.after(() => browser.close());
  const captures = process.env.TRIM_LAYOUT_CAPTURE_DIR;
  if (captures) await mkdir(captures, { recursive: true });
  const report = [], failures = [];
  for (const file of files) for (const width of [390, 1280, 1920]) for (const active of [false, true]) {
    const html = await sourceFor(file), sport = file.includes('pickleball') ? 'pickleball' : 'tableTennis';
    const id = `${file.slice(0, -5)}-${width}-${active ? 'active' : 'idle'}`;
    let geometry;
    // Keep the production renderer's fixture, safety and pixel checks; vary only viewport/state.
    const rendererBrowser = { newContext: async options => {
      const context = await browser.newContext({ ...options, viewport: { width, height: width === 390 ? 844 : width === 1280 ? 720 : 1080 } });
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage(), evaluate = page.evaluate.bind(page);
        page.evaluate = async (callback, argument) => {
          const result = await evaluate(callback, argument);
          if (callback === applySportFixture) await evaluate(active => {
            for (const element of document.querySelectorAll('[data-osb-field]')) {
              const field = element.dataset.osbField;
              if (/TimeOut|Carded|^is(?:Game|Match)Point$/.test(field)) {
                element.style.opacity = active ? '1' : '0';
                if (/TimeOut/.test(field)) element.style.display = active ? '' : 'none';
              }
              if (active && /^current[AB]GameScore$/.test(field)) element.textContent = field.includes('A') ? '18' : '16';
            }
          }, active);
          if (callback.name === 'measureDesign') geometry = await evaluate(measureScoreAllocation);
          return result;
        };
        return page;
      };
      return context;
    } };
    try {
      const result = await renderDesign(rendererBrowser, root, { html, css: '' }, sport);
      if (captures) await writeFile(path.join(captures, `${id}.png`), result.bytes);
      report.push({ file, width, active, image: captures ? path.join(captures, `${id}.png`) : null, geometry, pixels: result.diagnostics.pixels });
      const check = (condition, message) => { if (!condition) failures.push(`${id}: ${message}`); };
      const fixture = getSportFixture(sport);
      for (const element of [...geometry.numbers, ...geometry.names]) {
        const expected = active && /^current[AB]GameScore$/.test(element.field) ? (element.field.includes('A') ? 18 : 16) : fixture.fields[element.field];
        check(element.text === String(expected), `${element.field}: ordinary fixture value changed`);
      }
      check(Math.abs(geometry.rail.height - 28) < .5, 'rail must remain 28px');
      check(geometry.content.bottom <= geometry.rail.top + .5, 'score row overlaps rail');
      check(geometry.rail.bottom <= geometry.board.bottom + .5, 'rail overflows board');
      for (const element of [...geometry.numbers, ...geometry.labels, ...geometry.names, ...geometry.sportTags]) {
        check(element.box.height + .5 >= element.lineHeight, `${element.field || element.text}: line box clipped (${element.box.height}/${element.lineHeight})`);
        check(element.box.top >= element.parent.top - .5 && element.box.bottom <= element.parent.bottom + .5, `${element.field || element.text}: overflows parent vertically`);
      }
      for (const sport of geometry.sportTags) {
        check(sport.text === 'PICKLEBALL', 'Sage sport caption changed');
        check(sport.glyph.top >= sport.box.top - .5 && sport.glyph.bottom <= sport.box.bottom + .5, 'Sage sport glyph clipped');
      }
      if (active) {
        check(geometry.states.find(state => state.field === 'isMatchPoint').visible, 'match point missing');
        check(!geometry.states.find(state => state.field === 'isGamePoint').visible, 'match point must take precedence');
        for (const state of geometry.states.filter(state => /TimeOut|Carded/.test(state.field))) {
          check(state.visible, `${state.field}: active state missing`);
          check(state.box.top >= geometry.rail.top && state.box.bottom <= geometry.rail.bottom, `${state.field}: outside rail`);
        }
      }
    } catch (error) {
      failures.push(`${id}: ${error.message}`);
      report.push({ file, width, active, geometry, error: error.message });
    }
  }
  for (const idle of report.filter(record => !record.active && record.geometry)) {
    const active = report.find(record => record.file === idle.file && record.width === idle.width && record.active);
    if (active?.geometry) assert.deepEqual(active.geometry.content, idle.geometry.content, `${idle.file}/${idle.width}: active states moved the scores`);
  }
  if (captures) await writeFile(path.join(captures, 'geometry.json'), `${JSON.stringify({ report, failures }, null, 2)}\n`);
  assert.deepEqual(failures, [], failures.join('\n'));
});
