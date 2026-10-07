import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { contentHash } from './build-catalog.mjs';
import { FIXTURE_VERSION } from './preview-fixtures.mjs';
import { canonical, inspectPNG, parseArgs, recipeHash, renderPreviews, RENDERER_VERSION, selectTemplates } from './render-previews.mjs';

// Small RGBA fixture with real PNG CRCs, including deliberately blank variants.
function png({ width = 16, height = 16, blank = false, solid = false, filter = 0 } = {}) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(name, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let previous = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) { const i = x * 4; row[i] = solid ? 255 : x * 15; row[i + 1] = solid ? 255 : y * 15; row[i + 2] = 120; row[i + 3] = blank ? 0 : 255; }
    raw[y * (width * 4 + 1)] = filter;
    for (let i = 0; i < row.length; i++) {
      const a = i >= 4 ? row[i - 4] : 0, b = previous[i], c = i >= 4 ? previous[i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[y * (width * 4 + 1) + 1 + i] = (row[i] - predictor) & 255;
    }
    previous = row;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('pixel verification rejects empty, flat, malformed and oversized images', () => {
  const stats = inspectPNG(png());
  assert.equal(stats.width, 16); assert.equal(stats.height, 16);
  assert.equal(stats.visiblePixels, 256); assert.equal(stats.coverage, 1);
  assert.equal(stats.distinctColors, 256);
  for (const filter of [1, 2, 3, 4]) assert.deepEqual(inspectPNG(png({ filter })), stats);
  assert.throws(() => inspectPNG(png({ blank: true })), /blank/);
  assert.throws(() => inspectPNG(png({ solid: true })), /blank/);
  assert.throws(() => inspectPNG(png({ width: 2, height: 2 })), /blank/);
  assert.throws(() => inspectPNG(png({ width: 4097, height: 1 })), /oversized/);
  assert.throws(() => inspectPNG(png({ filter: 5 })), /filter/);
  assert.throws(() => inspectPNG(Buffer.from('invalid')), /signature/);
  assert.throws(() => inspectPNG(png().subarray(0, 55)), /Truncated|Incomplete/);
});

test('selection is active-only, sorted, bounded, and rejects unknown/unsafe names', () => {
  const entry = (fileName, retired = false) => ({ fileName, retired, contentHash: 'a'.repeat(64), sport: 'basketball' });
  const catalog = { schemaVersion: 1, templates: [entry('zz-test.html'), entry('aa-test.html'), entry('retired-test.html', true)] };
  assert.deepEqual(selectTemplates(catalog).map(entry => entry.fileName), ['aa-test.html', 'zz-test.html']);
  assert.equal(selectTemplates(catalog, { limit: 1 })[0].fileName, 'aa-test.html');
  assert.equal(selectTemplates(catalog, { only: ['zz-test.html'] })[0].fileName, 'zz-test.html');
  assert.throws(() => selectTemplates(catalog, { only: ['retired-test.html'] }), /Unknown active/);
  assert.throws(() => selectTemplates(catalog, { limit: 0 }), /positive/);
  assert.throws(() => selectTemplates({ schemaVersion: 1, templates: [entry('../bad.html')] }), /Invalid/);
});

test('CLI options and canonical JSON are deterministic', async () => {
  assert.deepEqual(parseArgs(['--only', 'one.html,two.html', '--only', 'three.html', '--limit', '7', '--check', '--report', '/tmp/report.json']), { only: ['one.html', 'two.html', 'three.html'], limit: 7, check: true, report: '/tmp/report.json' });
  for (const args of [['--limit', '0'], ['--limit', '2foo'], ['--limit'], ['--only', '--check'], ['--bad']]) assert.throws(() => parseArgs(args));
  assert.equal(JSON.stringify(canonical({ z: 2, a: { z: 1, a: 2 } })), '{"a":{"a":2,"z":1},"z":2}');
  const hash = await recipeHash(); assert.match(hash, /^[a-f0-9]{64}$/); assert.equal(hash, await recipeHash());
});

test('--check binds exact source, recipe, fixture, image hash, dimensions, and metadata allowlist without browser', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await mkdir(path.join(root, 'published')); await mkdir(path.join(root, 'previews'));
  const html = '<!doctype html><html><body><span class="combinedAName"></span><span class="currentAGameScore">0</span></body></html>';
  const document = { html, css: '' }, hash = contentHash(document);
  const entry = { fileName: 'sample-test.html', contentHash: hash, documentPath: `published/${hash}.json`, output: 'html-replications/sample-test.html', sport: 'basketball' };
  const image = png(), imageHash = createHash('sha256').update(image).digest('hex');
  await writeFile(path.join(root, 'catalog.json'), JSON.stringify({ schemaVersion: 1, templates: [entry] }));
  await writeFile(path.join(root, entry.documentPath), JSON.stringify(document));
  const sourcePath = path.join(root, 'templates', entry.output);
  await writeFile(sourcePath, html);
  const imagePath = path.join(root, `previews/${imageHash}.png`);
  await writeFile(imagePath, image);
  const metadata = { path: `previews/${imageHash}.png`, imageHash, contentHash: hash, width: 16, height: 16, fixtureVersion: FIXTURE_VERSION, rendererVersion: RENDERER_VERSION, sport: 'basketball' };
  const manifest = { schemaVersion: 1, recipeHash: await recipeHash(), fixtureVersion: FIXTURE_VERSION, rendererVersion: RENDERER_VERSION, entries: { [entry.fileName]: metadata } };
  const manifestPath = path.join(root, 'previews/manifest.json');
  const save = () => writeFile(manifestPath, JSON.stringify(manifest));
  await save();
  const valid = await renderPreviews({ root, check: true }); assert.equal(valid.checked, 1); assert.equal(valid.failed, 0);
  for (const [object, key, value] of [[manifest, 'recipeHash', 'b'.repeat(64)], [manifest, 'fixtureVersion', 'old'], [metadata, 'contentHash', 'b'.repeat(64)], [metadata, 'fixtureVersion', 'old'], [metadata, 'rendererVersion', '0'], [metadata, 'sport', 'soccer'], [metadata, 'width', 12], [metadata, 'path', '../escape.png'], [metadata, 'extra', true]]) {
    const original = object[key]; object[key] = value; await save();
    const failed = await renderPreviews({ root, check: true }); assert.equal(failed.failed, 1, key);
    assert.equal(await readFile(manifestPath, 'utf8'), JSON.stringify(manifest), 'check must not modify metadata');
    if (original === undefined) delete object[key]; else object[key] = original;
  }
  await save();
  await writeFile(imagePath, png({ solid: true })); assert.equal((await renderPreviews({ root, check: true })).failed, 1);
  await writeFile(imagePath, image);
  await writeFile(sourcePath, `${html}\n`); assert.equal((await renderPreviews({ root, check: true })).failed, 1);
  await writeFile(sourcePath, html);
  await rm(imagePath); assert.equal((await renderPreviews({ root, check: true })).failed, 1);
  await symlink(sourcePath, imagePath); assert.equal((await renderPreviews({ root, check: true })).failed, 1);
});
