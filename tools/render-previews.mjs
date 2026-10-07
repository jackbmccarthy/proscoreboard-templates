import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSafeRelativePath, contentHash, DEFAULT_ROOT, validatePublishedDocument } from './build-catalog.mjs';
import { applySportFixture, FIXTURE_VERSION, getSportFixture } from './preview-fixtures.mjs';
import { validateSafeScoreboardTemplateDocument } from '../contract/index.mjs';

export const RENDERER_VERSION = '1';
export const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
export const MAX_CAPTURE = Object.freeze({ width: 4096, height: 4096 });
const ORIGIN = 'https://scoreboard-preview.invalid';
const HASH = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const ENTRY_KEYS = ['contentHash', 'fixtureVersion', 'height', 'imageHash', 'path', 'rendererVersion', 'sport', 'width'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export async function recipeHash() {
  const sources = await Promise.all(['render-previews.mjs', 'preview-fixtures.mjs'].map(name => readFile(new URL(name, import.meta.url))));
  return sha256(Buffer.concat(sources.map(source => Buffer.concat([Buffer.from(`${source.length}:`), source]))));
}

async function regularPath(root, relative, { missing = false } = {}) {
  assertSafeRelativePath(relative);
  let target = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    target = path.join(target, parts[index]);
    let stat;
    try { stat = await lstat(target); }
    catch (error) { if (missing && error.code === 'ENOENT' && index === parts.length - 1) return target; throw error; }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Expected regular non-symlink path: ${relative}`);
  }
  return target;
}

async function readBounded(root, relative, max = 8_000_000) {
  const target = await regularPath(root, relative);
  if ((await lstat(target)).size > max) throw new Error(`File exceeds size bound: ${relative}`);
  const bytes = await readFile(target);
  if (bytes.length > max) throw new Error(`File exceeds size bound: ${relative}`);
  return bytes;
}

async function atomicJSON(root, relative, value) {
  const target = await regularPath(root, relative, { missing: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(canonical(value), null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function writeImage(root, relative, bytes) {
  const target = await regularPath(root, relative, { missing: true });
  try { if ((await readFile(target)).equals(bytes)) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export function selectTemplates(catalog, { only = [], limit } = {}) {
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.templates)) throw new Error('Invalid catalog schema.');
  const entries = catalog.templates.filter(entry => !entry.retired).sort((a, b) => a.fileName.localeCompare(b.fileName, 'en'));
  const seen = new Set();
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-]{1,190}\.html$/.test(entry.fileName) || seen.has(entry.fileName) || !HASH.test(entry.contentHash)) throw new Error('Invalid/duplicate catalog entry.');
    seen.add(entry.fileName);
    getSportFixture(entry.sport);
  }
  for (const name of only) if (!seen.has(name)) throw new Error(`Unknown active template: ${name}`);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit must be a positive integer.');
  return entries.filter(entry => !only.length || only.includes(entry.fileName)).slice(0, limit);
}

async function loadDesign(root, entry) {
  if (entry.documentPath !== `published/${entry.contentHash}.json`) throw new Error('Catalog document path does not bind its content hash.');
  const document = JSON.parse(await readBounded(root, entry.documentPath));
  validatePublishedDocument(document, entry.contentHash);
  assertSafeRelativePath(entry.output);
  const source = (await readBounded(root, `templates/${entry.output}`, 500_000)).toString('utf8');
  if (document.html !== source || document.css !== '' || contentHash({ html: source, css: '' }) !== entry.contentHash) throw new Error('Authored source/catalog content hash mismatch.');
  return document;
}

// Chromium emits non-interlaced 8-bit RGB/RGBA PNGs. Decode filters using zlib,
// keeping pixel verification dependency-free and independent of browser state.
export function inspectPNG(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid PNG signature.');
  let offset = 8, width, height, channels, ended = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) throw new Error('Truncated PNG chunk.');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (length !== 13 || width !== undefined) throw new Error('Invalid PNG header.');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!width || !height || width > MAX_CAPTURE.width || height > MAX_CAPTURE.height || data[8] !== 8 || !channels || data[10] || data[11] || data[12]) throw new Error('Unsupported or oversized PNG.');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') { ended = true; break; }
    offset += length + 12;
  }
  if (!ended || !channels || !compressed.length) throw new Error('Incomplete PNG.');
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid PNG pixel length.');
  let previous = Buffer.alloc(stride), visiblePixels = 0;
  const colors = new Set();
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = raw[start], row = Buffer.alloc(stride);
    if (filter > 4) throw new Error('Invalid PNG filter.');
    for (let index = 0; index < stride; index++) {
      const a = index >= channels ? row[index - channels] : 0, b = previous[index], c = index >= channels ? previous[index - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      row[index] = (raw[start + 1 + index] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const index = x * channels, alpha = channels === 4 ? row[index + 3] : 255;
      if (alpha <= 8) continue;
      visiblePixels++;
      left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      if (colors.size < 256) colors.add(`${row[index]},${row[index + 1]},${row[index + 2]},${alpha}`);
    }
    previous = row;
  }
  if (visiblePixels < 64 || colors.size < 8) throw new Error('Empty or visually blank screenshot.');
  return { width, height, visiblePixels, coverage: visiblePixels / (width * height), distinctColors: colors.size, pixelBounds: { left, top, right, bottom } };
}

async function verifyPreview(root, entry, metadata, manifest, recipe) {
  if (!metadata) throw new Error('Missing preview metadata.');
  if (manifest.schemaVersion !== 1 || manifest.fixtureVersion !== FIXTURE_VERSION || manifest.rendererVersion !== RENDERER_VERSION || manifest.recipeHash !== recipe) throw new Error('Stale manifest recipe/fixture/renderer.');
  if (Object.keys(metadata).sort().join(',') !== ENTRY_KEYS.join(',')) throw new Error('Preview metadata keys do not match allowlist.');
  if (metadata.contentHash !== entry.contentHash || metadata.fixtureVersion !== FIXTURE_VERSION || metadata.rendererVersion !== RENDERER_VERSION || metadata.sport !== entry.sport) throw new Error('Stale preview content/fixture/renderer/sport.');
  if (!HASH.test(metadata.imageHash) || metadata.path !== `previews/${metadata.imageHash}.png`) throw new Error('Invalid content-addressed preview path.');
  const bytes = await readBounded(root, metadata.path, 64_000_000);
  if (sha256(bytes) !== metadata.imageHash) throw new Error('Preview image hash mismatch.');
  const pixels = inspectPNG(bytes);
  if (pixels.width !== metadata.width || pixels.height !== metadata.height) throw new Error('Preview dimensions mismatch.');
  return pixels;
}

function measureDesign() {
  const rectangles = [], overflow = [], clipped = [];
  const transparent = color => color === 'transparent' || /rgba\([^)]*,\s*0\s*\)/.test(color);
  const visible = element => {
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  for (const element of document.querySelectorAll('body, body *')) {
    if (['STYLE', 'SCRIPT', 'LINK', 'META', 'BASE'].includes(element.tagName) || !visible(element)) continue;
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const text = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const pseudo = ['::before', '::after'].some(name => { const p = getComputedStyle(element, name); return p.content !== 'none' && p.content !== 'normal' && p.display !== 'none'; });
    const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && !transparent(style[`border${side}Color`]) && !['none', 'hidden'].includes(style[`border${side}Style`]));
    const painted = text || pseudo || ['IMG', 'SVG', 'CANVAS'].includes(element.tagName) || !transparent(style.backgroundColor) || style.backgroundImage !== 'none' || border || style.boxShadow !== 'none' || style.filter !== 'none';
    if (!painted || !rect.width || !rect.height) continue;
    const stripColor = value => value.replace(/(?:rgba?|hsla?|color)\([^)]*\)/g, '');
    const shadows = [...stripColor(style.boxShadow).split(',').filter(value => !value.includes('inset')), ...stripColor(style.textShadow).split(','), ...stripColor(style.filter).matchAll(/drop-shadow\(([^)]*)\)/g)].map(value => typeof value === 'string' ? value : value[1]);
    const extent = { left: 0, top: 0, right: 0, bottom: 0 };
    for (const shadow of shadows) {
      const values = [...shadow.matchAll(/(-?[\d.]+)px/g)].map(match => Number(match[1]));
      if (values.length < 2) continue;
      const [x, y, blur = 0, spread = 0] = values, radius = Math.max(0, blur * 1.5 + spread);
      extent.left = Math.max(extent.left, radius - x); extent.right = Math.max(extent.right, radius + x);
      extent.top = Math.max(extent.top, radius - y); extent.bottom = Math.max(extent.bottom, radius + y);
    }
    rectangles.push({ left: rect.left - extent.left, top: rect.top - extent.top, right: rect.right + extent.right, bottom: rect.bottom + extent.bottom });
    const name = element.getAttribute('data-osb-field') || element.className || element.tagName;
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) overflow.push(String(name));
    if (['number', 'timer'].includes(element.dataset.previewType) && element.scrollWidth > element.clientWidth + 1) clipped.push(String(name));
  }
  if (!rectangles.length) throw new Error('No visible authored design.');
  const bounds = { left: Math.floor(Math.min(...rectangles.map(rect => rect.left))), top: Math.floor(Math.min(...rectangles.map(rect => rect.top))), right: Math.ceil(Math.max(...rectangles.map(rect => rect.right))), bottom: Math.ceil(Math.max(...rectangles.map(rect => rect.bottom))) };
  return { bounds, paintedElements: rectangles.length, overflow, clipped, viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
}

export async function renderDesign(browser, root, document, sport) {
  validateSafeScoreboardTemplateDocument(document);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const diagnostics = { blockedRequests: [], missingAssets: [], pageErrors: [] };
  const fixture = getSportFixture(sport);
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN || route.request().method() !== 'GET') {
      diagnostics.blockedRequests.push(url.href); await route.abort('blockedbyclient'); return;
    }
    if (url.pathname === '/design.html') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: document.html, headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'" } });
      return;
    }
    try {
      const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (!/\.(?:png|jpe?g|webp|gif|svg|woff2?|ttf|otf|css)$/i.test(relative)) throw new Error('Unsupported asset type.');
      const body = await readBounded(root, `studio/public/${relative}`);
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css' };
      await route.fulfill({ body, contentType: types[path.extname(relative).toLowerCase()] });
    } catch (error) { diagnostics.missingAssets.push({ url: url.href, error: error.message }); await route.abort('blockedbyclient'); }
  });
  try {
    await page.goto(`${ORIGIN}/design.html`, { waitUntil: 'load', timeout: 15_000 });
    if (document.css) await page.evaluate(css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }, document.css);
    const bindings = await page.evaluate(applySportFixture, fixture);
    await page.evaluate(types => {
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
      document.head.append(style);
      for (const [field, type] of Object.entries(types)) for (const element of document.querySelectorAll(`[data-osb-field="${field}"],.${field}`)) element.dataset.previewType = type;
    }, fixture.fieldTypes);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    });
    // CSP may stop remote URLs before routing: inspect authored resource declarations too.
    const resources = await page.evaluate(() => ({
      failedImages: [...document.images].filter(image => image.getAttribute('src') && (!image.complete || !image.naturalWidth)).map(image => image.src),
      remote: [...document.querySelectorAll('[src],[href]')].flatMap(element => ['src', 'href'].map(name => element.getAttribute(name)).filter(value => value && /^(https?:)?\/\//i.test(value))).concat([...document.querySelectorAll('style')].flatMap(style => [...style.textContent.matchAll(/(?:url\(\s*["']?|@import\s+["'])(https?:\/\/[^\s"')]+)/gi)].map(match => match[1]))),
    }));
    diagnostics.blockedRequests.push(...resources.remote);
    for (const url of resources.failedImages) diagnostics.missingAssets.push({ url, error: 'Image failed to decode.' });
    const geometry = await page.evaluate(measureDesign);
    diagnostics.geometry = geometry;
    diagnostics.bindings = bindings.changes;
    if (geometry.clipped.length) throw new Error(`Numeric fields clipped: ${geometry.clipped.join(', ')}`);
    if (diagnostics.blockedRequests.length || diagnostics.missingAssets.length || diagnostics.pageErrors.length) throw new Error('Blocked remote or missing local assets/page errors.');
    const padding = 8, bounds = geometry.bounds;
    const shift = { x: Math.max(0, padding - bounds.left), y: Math.max(0, padding - bounds.top) };
    const clip = { x: Math.max(0, bounds.left - padding), y: Math.max(0, bounds.top - padding), width: bounds.right - bounds.left + padding * 2, height: bounds.bottom - bounds.top + padding * 2 };
    if (clip.width > MAX_CAPTURE.width || clip.height > MAX_CAPTURE.height || clip.width < 1 || clip.height < 1) throw new Error('Authored design exceeds safe capture dimensions.');
    if (shift.x || shift.y) await page.evaluate(shift => { document.body.style.translate = `${shift.x}px ${shift.y}px`; }, shift);
    // Playwright's screenshot helper clamps clips to the document scroll size.
    // CDP preserves the whole bounded painted union at the native layout viewport.
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const capture = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...clip, scale: 1 } });
    const bytes = Buffer.from(capture.data, 'base64');
    await session.detach();
    const pixels = inspectPNG(bytes);
    if (pixels.width !== clip.width || pixels.height !== clip.height) throw new Error('Screenshot was clipped to less than the whole design.');
    return { bytes, diagnostics: { ...diagnostics, clip, shift, pixels } };
  } catch (error) {
    error.diagnostics = diagnostics;
    throw error;
  } finally { await context.close(); }
}

async function writeReport(root, reportPath, report) {
  if (!reportPath) return;
  const target = path.resolve(reportPath), parent = await realpath(path.dirname(target));
  const tmp = await realpath('/tmp');
  if (!(parent === tmp || parent.startsWith(`${tmp}/`)) || parent === root || parent.startsWith(`${root}/`)) throw new Error('--report must be outside the export under /tmp (existing parent directory).');
  await atomicJSON(parent, path.basename(target), report);
}

export async function renderPreviews({ root = DEFAULT_ROOT, only = [], limit, check = false, report: reportPath, onProgress = () => {} } = {}) {
  root = await realpath(root);
  const recipe = await recipeHash();
  const catalog = JSON.parse(await readBounded(root, 'catalog.json'));
  const selected = selectTemplates(catalog, { only, limit });
  let previous;
  try { previous = JSON.parse(await readBounded(root, 'previews/manifest.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; previous = {}; }
  const compatible = previous.schemaVersion === 1 && previous.fixtureVersion === FIXTURE_VERSION && previous.rendererVersion === RENDERER_VERSION && previous.recipeHash === recipe;
  const active = new Set(catalog.templates.filter(entry => !entry.retired).map(entry => entry.fileName));
  const manifest = { schemaVersion: 1, fixtureVersion: FIXTURE_VERSION, rendererVersion: RENDERER_VERSION, recipeHash: recipe, entries: compatible ? Object.fromEntries(Object.entries(previous.entries || {}).filter(([name]) => active.has(name))) : {} };
  const report = { schemaVersion: 1, recipeHash: recipe, viewport: VIEWPORT, selected: selected.length, rendered: 0, reused: 0, checked: 0, failed: 0, entries: {} };
  let browser;
  if (!check) {
    const directory = path.join(root, 'previews');
    await mkdir(directory, { recursive: true });
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('previews must be a regular non-symlink directory.');
  }
  try {
    for (const entry of selected) {
      try {
        const document = await loadDesign(root, entry);
        let pixels;
        try { pixels = await verifyPreview(root, entry, previous.entries?.[entry.fileName], previous, recipe); }
        catch (error) { if (check) throw error; }
        if (pixels) {
          report[check ? 'checked' : 'reused']++;
          report.entries[entry.fileName] = { status: check ? 'checked' : 'reused', pixels };
        } else {
          delete manifest.entries[entry.fileName];
          // Invalidate old success metadata before a potentially interrupted render.
          await atomicJSON(root, 'previews/manifest.json', manifest);
          if (!browser) {
            const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
            const { chromium } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : 'playwright');
            browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
          }
          const result = await renderDesign(browser, root, document, entry.sport);
          const imageHash = sha256(result.bytes), relative = `previews/${imageHash}.png`;
          await writeImage(root, relative, result.bytes);
          manifest.entries[entry.fileName] = { path: relative, imageHash, contentHash: entry.contentHash, width: result.diagnostics.pixels.width, height: result.diagnostics.pixels.height, fixtureVersion: FIXTURE_VERSION, rendererVersion: RENDERER_VERSION, sport: entry.sport };
          report.rendered++;
          report.entries[entry.fileName] = { status: 'rendered', ...result.diagnostics };
          await atomicJSON(root, 'previews/manifest.json', manifest);
        }
      } catch (error) {
        report.failed++;
        report.entries[entry.fileName] = { status: 'failed', error: error.message, ...error.diagnostics };
        if (!check) { delete manifest.entries[entry.fileName]; await atomicJSON(root, 'previews/manifest.json', manifest); }
      }
      onProgress(entry.fileName, report.entries[entry.fileName]);
    }
    if (!check) await atomicJSON(root, 'previews/manifest.json', manifest);
  } finally { if (browser) await browser.close(); await writeReport(root, reportPath, report); }
  return report;
}

export function parseArgs(args) {
  const options = { only: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--check') options.check = true;
    else if (['--only', '--limit', '--report'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      if (argument === '--only') options.only.push(...value.split(','));
      else if (argument === '--limit') { if (!/^[1-9]\d*$/.test(value)) throw new Error('--limit must be a positive integer.'); options.limit = Number(value); }
      else options.report = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await renderPreviews({ ...parseArgs(process.argv.slice(2)), onProgress: (name, result) => console.log(`${result.status}: ${name}${result.error ? `: ${result.error}` : ''}`) });
    console.log(`Previews: ${report.rendered} rendered, ${report.reused} reused, ${report.checked} checked, ${report.failed} failed (${report.selected} selected).`);
    if (report.failed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
