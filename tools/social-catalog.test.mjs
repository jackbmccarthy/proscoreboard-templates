import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SOCIAL_FIELDS, SOCIAL_FONTS, SOCIAL_PRESETS, SOCIAL_TEMPLATE_SCHEMA_VERSION, inspectSocialTemplate, validateSocialTemplate } from '../social/contract.mjs';
import { assertSafeRelativePath, buildSocialCatalog, contentHash, validatePublishedDocument } from './build-social-catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP = await realpath(tmpdir());
const manifest = JSON.parse(await readFile(path.join(ROOT, 'social/manifest.json'), 'utf8'));
const originals = await Promise.all(manifest.map(async (entry) => JSON.parse(await readFile(path.join(ROOT, `social/templates/${entry.id}.json`), 'utf8'))));
const fresh = () => structuredClone(originals[0]);
const layer = () => structuredClone(originals[0].layers[0]);
const jsonWrite = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

async function fixture(t, entries = manifest.slice(0, 1)) {
  const root = await mkdtemp(path.join(TEMP, 'social-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'social/templates'), { recursive: true });
  await jsonWrite(path.join(root, 'social/manifest.json'), entries);
  for (const entry of entries) await jsonWrite(path.join(root, `social/templates/${entry.id}.json`), originals.find((value) => value.id === entry.id));
  return root;
}

async function snapshot(root, relative = '') {
  const result = [];
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const next = path.join(relative, name), info = await stat(path.join(root, next));
    if (info.isDirectory()) result.push(...await snapshot(root, next));
    else result.push([next, info.mtimeMs, await readFile(path.join(root, next), 'utf8')]);
  }
  return result;
}

test('public constants preserve all fourteen exact presets, eleven fields, and five fonts', () => {
  assert.equal(SOCIAL_TEMPLATE_SCHEMA_VERSION, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(SOCIAL_PRESETS).map(([key, value]) => [key, [value.width, value.height]])), {
    instagramSquare: [1080, 1080], instagramPortrait: [1080, 1350], instagramStory: [1080, 1920], tiktokVertical: [1080, 1920],
    facebookLandscape: [1200, 630], facebookCover: [1640, 630], xLandscape: [1600, 900], linkedinLandscape: [1200, 627],
    youtubeThumbnail: [1280, 720], pinterestPin: [1000, 1500], square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], landscape: [1200, 628]
  });
  assert.deepEqual(SOCIAL_FIELDS.map((field) => field.value).sort(), ['championName', 'competitorA', 'competitorB', 'dateLabel', 'eventName', 'loserName', 'roundLabel', 'scoreA', 'scoreB', 'statusLabel', 'winnerName']);
  assert.deepEqual(SOCIAL_FONTS, ['Arial, sans-serif', 'Georgia, serif', 'Impact, sans-serif', 'Trebuchet MS, sans-serif', 'Verdana, sans-serif']);
  assert.ok(Object.isFrozen(SOCIAL_PRESETS.square));
  assert.ok(Object.isFrozen(SOCIAL_FIELDS[0]));
});

test('all twelve authored designs are valid original documents with live fields and no photos', () => {
  assert.equal(manifest.length, 12);
  assert.equal(new Set(manifest.map((entry) => entry.id)).size, 12);
  assert.deepEqual(new Set(manifest.map((entry) => entry.category)), new Set(['winners', 'results', 'matchday', 'event', 'recap']));
  assert.ok(new Set(originals.map((value) => value.preset)).size >= 8);
  assert.equal(new Set(originals.map((value) => JSON.stringify(value.layers))).size, 12);
  assert.deepEqual(originals.slice(0, 3).map((value) => [value.id, value.layers.length]), [['starter-champion', 6], ['starter-final-score', 9], ['starter-match-day', 7]]);
  for (const document of originals) {
    const before = JSON.stringify(document);
    assert.strictEqual(validateSocialTemplate(document), document);
    assert.equal(JSON.stringify(document), before);
    const inspection = inspectSocialTemplate(document);
    assert.deepEqual(inspection.errors, []);
    assert.deepEqual(inspection.warnings, []);
    assert.ok(inspection.fields.length >= 3);
    assert.equal(document.createdOn, '2026-01-01T00:00:00.000Z');
    assert.equal(document.updatedOn, document.createdOn);
    assert.ok(document.id.startsWith('starter-'));
    assert.ok(!document.backgroundImage);
    for (const item of document.layers) {
      assert.notEqual(item.type, 'image');
      if (item.type === 'boundText') { assert.ok(item.field); assert.ok(!Object.hasOwn(item, 'text')); }
    }
  }
});

test('contract is import-free browser code and validation never evaluates accessors', async () => {
  const source = await readFile(path.join(ROOT, 'social/contract.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|process|Buffer)\b/);
  const input = fresh();
  Object.defineProperty(input, 'name', { get() { throw new Error('Do not execute'); }, enumerable: true });
  assert.match(inspectSocialTemplate(input).errors.join(' '), /property/);
});

test('strict schema rejects unknown/missing keys, types, IDs, timestamps and duplicates', () => {
  const mutations = [
    (d) => { d.extra = true; }, (d) => { delete d.name; }, (d) => { d.name = ' padded '; },
    (d) => { d.name = 'x'.repeat(101); }, (d) => { d.id = '../escape'; }, (d) => { d.id = '__proto__'; },
    (d) => { d.id = 'bad\\id'; }, (d) => { d.createdOn = '2026-02-30T00:00:00.000Z'; },
    (d) => { d.updatedOn = 'today'; }, (d) => { d.preset = 'constructor'; },
    (d) => { d.backgroundColor = '#FFF'; }, (d) => { d.backgroundColor = '#FFFFFF'; },
    (d) => { d.layers[0].id = d.layers[1].id; }, (d) => { d.layers[0].type = 'html'; },
    (d) => { d.layers[0].fontFamily = 'remote font'; }, (d) => { d.layers[0].fontWeight = 700; },
    (d) => { d.layers[0].align = 'justify'; }, (d) => { d.layers[0].onclick = 'alert(1)'; },
    (d) => { d.layers[1].field = 'ownerID'; }, (d) => { delete d.layers[1].field; },
    (d) => { d.layers[1].text = 'Fake Person'; }, (d) => { d.layers[0].field = 'eventName'; },
    (d) => { d.layers[0].src = 'https://example.com/a.png'; },
    (d) => { d.layers = Array(2); }, (d) => { d.layers.extra = 'no'; },
    (d) => { d.layers = Array.from({ length: 41 }, (_, i) => ({ ...layer(), id: `layer-${i}` })); }
  ];
  for (const mutate of mutations) {
    const document = fresh(); mutate(document);
    assert.throws(() => validateSocialTemplate(document), /Invalid social template/);
  }
  for (const invalid of [null, [], 123, 'template', new Date()]) assert.throws(() => validateSocialTemplate(invalid));
  const proto = JSON.parse(JSON.stringify(fresh()).replace('"name":', '"__proto__":{},"name":'));
  assert.throws(() => validateSocialTemplate(proto), /unsupported key/);
});

test('every numeric sanitizer bound is enforced without coercion, rounding or clamping', () => {
  for (const [key, values] of Object.entries({
    width: [15, 1081, 100.5, '100'], height: [15, 1081], x: [-1, 321, 0.5], y: [-1, 1053],
    fontSize: [11, 241, 24.5], letterSpacing: [-1, 25, 0.5], opacity: [0, 0.049, 1.01], rotation: [-181, 181, 0.5]
  })) {
    for (const value of [...values, NaN, Infinity, null, undefined]) {
      const document = fresh(); document.layers[0][key] = value;
      assert.throws(() => validateSocialTemplate(document), undefined, `${key}=${value}`);
    }
  }
  for (const [preset, size] of Object.entries(SOCIAL_PRESETS)) {
    const document = fresh(); Object.assign(document, { preset, width: size.width, height: size.height, layers: [] });
    assert.strictEqual(validateSocialTemplate(document), document);
    document.width++;
    assert.throws(() => validateSocialTemplate(document), /dimensions/);
  }
  const document = fresh();
  document.layers = [{ ...layer(), width: 1080, height: 1080, x: 0, y: 0, fontSize: 240, letterSpacing: 24, opacity: 0.05, rotation: -180 }];
  assert.strictEqual(validateSocialTemplate(document), document);
});

test('exact four layer types, all fonts/fields and optional empty image placeholders are accepted', () => {
  for (const fontFamily of SOCIAL_FONTS) {
    const document = fresh(); document.layers[0].fontFamily = fontFamily; validateSocialTemplate(document);
  }
  for (const { value: field } of SOCIAL_FIELDS) {
    const document = fresh(); document.layers = [{ ...layer(), type: 'boundText', field }];
    assert.deepEqual(inspectSocialTemplate(validateSocialTemplate(document)).fields, [field]);
  }
  const document = fresh();
  document.layers = [{ ...layer(), type: 'image', src: '' }];
  document.backgroundImage = '';
  assert.strictEqual(validateSocialTemplate(document), document);
  assert.match(inspectSocialTemplate(document).warnings.join(' '), /empty image/);
  document.layers = [{ ...layer(), type: 'text', text: 'FINAL' }];
  validateSocialTemplate(document);
  for (const text of ['', ' padded ', 'x'.repeat(501)]) {
    document.layers[0].text = text; assert.throws(() => validateSocialTemplate(document));
  }
});

test('image sources reject remote, SVG, executable, malformed, spoofed and oversized data', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=';
  for (const src of ['', png, 'data:image/jpeg;base64,/9j/2Q==', 'data:image/webp;base64,UklGRgQAAABXRUJQ']) {
    const document = fresh(); document.layers = [{ ...layer(), type: 'image', src }];
    assert.strictEqual(validateSocialTemplate(document), document);
  }
  const rejected = ['https://example.com/photo.jpg', '/original/photo.png', 'file:///secret', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,AAAA',
    'data:image/png;base64,a===', 'data:image/png;base64,', `${png}\n`, ' data:image/png;base64,AAAA',
    png.replace('png', 'jpeg'), 'data:image/png;base64,' + 'A'.repeat(2_000_064)];
  for (const source of rejected) {
    const document = fresh(); document.backgroundImage = source;
    assert.throws(() => validateSocialTemplate(document));
    delete document.backgroundImage; document.layers = [{ ...layer(), type: 'image', src: source }];
    assert.throws(() => validateSocialTemplate(document));
  }
});

test('catalog has all twelve exact dimensions, prescribed hashes, paths and deterministic revision', async () => {
  const { catalog, warningCount } = await buildSocialCatalog({ check: true });
  assert.equal(catalog.templates.length, 12);
  assert.equal(warningCount, 0);
  assert.equal(catalog.revision, createHash('sha256').update(JSON.stringify(catalog.templates)).digest('hex'));
  for (const entry of catalog.templates) {
    assert.deepEqual(Object.keys(entry), ['id', 'name', 'description', 'category', 'preset', 'width', 'height', 'colors', 'published', 'contentHash', 'documentPath']);
    const source = originals.find((document) => document.id === entry.id);
    const hash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    assert.equal(entry.contentHash, hash);
    assert.equal(entry.documentPath, `social/published/${hash}.json`);
    assert.deepEqual(JSON.parse(await readFile(path.join(ROOT, entry.documentPath), 'utf8')), source);
    assert.strictEqual(validatePublishedDocument(source, hash), source);
    assert.throws(() => validatePublishedDocument(source, '0'.repeat(64)), /hash mismatch/);
  }
});

test('build/check are deterministic across manifest order and JSON whitespace; check never writes', async (t) => {
  const root = await fixture(t, manifest);
  const first = await buildSocialCatalog({ root });
  const before = await snapshot(root);
  assert.deepEqual((await buildSocialCatalog({ root, check: true })).catalog, first.catalog);
  assert.deepEqual(await snapshot(root), before);
  await jsonWrite(path.join(root, 'social/manifest.json'), [...manifest].reverse());
  await writeFile(path.join(root, `social/templates/${originals[0].id}.json`), JSON.stringify(originals[0]));
  assert.deepEqual((await buildSocialCatalog({ root, check: true })).catalog, first.catalog);
  const blobBefore = await snapshot(path.join(root, 'social/published'));
  await buildSocialCatalog({ root });
  assert.deepEqual(await snapshot(path.join(root, 'social/published')), blobBefore);
});

test('historical blobs remain byte-identical after edits and retired metadata remains listed', async (t) => {
  const root = await fixture(t);
  const first = await buildSocialCatalog({ root });
  const oldBlob = first.catalog.templates[0].documentPath;
  const before = await readFile(path.join(root, oldBlob), 'utf8');
  const changed = fresh(); changed.layers[0].fill = '#ff0000';
  await jsonWrite(path.join(root, `social/templates/${changed.id}.json`), changed);
  await jsonWrite(path.join(root, 'social/manifest.json'), [{ ...manifest[0], published: false, colors: ['#f2f4f7', '#141820'] }]);
  const second = await buildSocialCatalog({ root });
  assert.equal(second.catalog.templates.length, 1);
  assert.equal(second.catalog.templates[0].published, false);
  assert.notEqual(first.catalog.revision, second.catalog.revision);
  assert.equal(await readFile(path.join(root, oldBlob), 'utf8'), before);
  assert.equal((await readdir(path.join(root, 'social/published'))).length, 2);
  await buildSocialCatalog({ root, check: true });
});

test('missing/stale check failures leave source and output entirely unchanged', async (t) => {
  const root = await fixture(t);
  const original = await snapshot(root);
  await assert.rejects(buildSocialCatalog({ root, check: true }));
  assert.deepEqual(await snapshot(root), original);
  await buildSocialCatalog({ root });
  const catalogPath = path.join(root, 'social/catalog.json');
  await writeFile(catalogPath, '{}\n');
  const stale = await snapshot(root);
  await assert.rejects(buildSocialCatalog({ root, check: true }), /stale/);
  assert.deepEqual(await snapshot(root), stale);
});

test('document-only rename updates catalog name and hash without a manifest transaction', async (t) => {
  const root = await fixture(t);
  const first = await buildSocialCatalog({ root });
  const manifestPath = path.join(root, 'social/manifest.json');
  const manifestBefore = await readFile(manifestPath, 'utf8');
  const document = fresh();
  document.name = 'Renamed champion announcement';
  await jsonWrite(path.join(root, `social/templates/${document.id}.json`), document);
  await assert.rejects(buildSocialCatalog({ root, check: true }));
  const second = await buildSocialCatalog({ root });
  const entry = second.catalog.templates[0];
  assert.equal(entry.name, document.name);
  assert.equal(entry.id, document.id);
  assert.equal(entry.contentHash, contentHash(document));
  assert.notEqual(entry.contentHash, first.catalog.templates[0].contentHash);
  assert.notEqual(second.catalog.revision, first.catalog.revision);
  assert.equal(await readFile(manifestPath, 'utf8'), manifestBefore);
  assert.equal(JSON.parse(await readFile(path.join(root, entry.documentPath), 'utf8')).name, entry.name);
  await buildSocialCatalog({ root, check: true });
});

test('manifest rejects duplicate IDs, unsafe IDs, authored generated keys and bad metadata', async (t) => {
  const root = await fixture(t);
  const manifestPath = path.join(root, 'social/manifest.json');
  const invalid = [
    [manifest[0], manifest[0]], [{ ...manifest[0], id: '../outside' }], [{ ...manifest[0], documentPath: '/secret' }],
    [{ ...manifest[0], source: '../secret' }], [{ ...manifest[0], published: 'yes' }], [{ ...manifest[0], category: 'unknown' }],
    [{ ...manifest[0], colors: ['#ffffff', '#ffffff'] }], [{ ...manifest[0], colors: ['red', 'blue'] }],
    [{ ...manifest[0], colors: ['#000000', '#123456'] }], [{ ...manifest[0], name: ' padded ' }],
    [{ ...manifest[0], description: '' }], [], {}
  ];
  for (const value of invalid) {
    await jsonWrite(manifestPath, value);
    await assert.rejects(buildSocialCatalog({ root }));
    await assert.rejects(stat(path.join(root, 'social/published')), { code: 'ENOENT' });
  }
  await writeFile(manifestPath, JSON.stringify([manifest[0]]).replace('"published":true', '"published":true,"published":false'));
  await assert.rejects(buildSocialCatalog({ root }), /Duplicate JSON key/);
});

test('source identity, unknown keys and duplicate raw keys fail before publishing', async (t) => {
  const root = await fixture(t), sourcePath = path.join(root, `social/templates/${originals[0].id}.json`);
  for (const [key, value] of [['id', 'starter-other'], ['payload', {}], ['width', 100]]) {
    await jsonWrite(sourcePath, { ...fresh(), [key]: value });
    await assert.rejects(buildSocialCatalog({ root }));
  }
  await writeFile(sourcePath, JSON.stringify(fresh()).replace('"width":760', '"width":760,"width":760'));
  await assert.rejects(buildSocialCatalog({ root }), /Duplicate JSON key/);
});

test('path validation rejects traversal, absolute, encoded, platform and hidden paths', () => {
  for (const value of ['../secret', '/secret', 'social//x', 'social/./x', 'social/../x', 'social/.hidden', 'C:\\secret', 'social/%2e%2e', 'social/a?x', 'social/a#x', 'social/\0x', 'social/a:b', 'social/a\\b']) {
    assert.throws(() => assertSafeRelativePath(value), /Unsafe relative path/);
  }
  assert.equal(assertSafeRelativePath('social/templates/starter-champion.json'), 'social/templates/starter-champion.json');
});

test('source, output, catalog, root and intermediate symlinks are rejected', async (t) => {
  for (const target of ['social/templates', `social/templates/${originals[0].id}.json`, 'social/published', 'social/catalog.json', 'social']) {
    const root = await fixture(t);
    await buildSocialCatalog({ root });
    const location = path.join(root, target), outside = await mkdtemp(path.join(TEMP, 'social-symlink-target-'));
    t.after(() => rm(outside, { recursive: true, force: true }));
    await rm(location, { recursive: true, force: true });
    await symlink(outside, location);
    await assert.rejects(buildSocialCatalog({ root }), /Symlinks/);
    await assert.rejects(buildSocialCatalog({ root, check: true }), /Symlinks/);
    assert.deepEqual(await readdir(outside), []);
  }
  const root = await fixture(t), alias = `${root}-alias`;
  t.after(() => rm(alias, { force: true }));
  await symlink(root, alias);
  await assert.rejects(buildSocialCatalog({ root: alias }), /symlinks/);
});

test('tampered and unsafe historical blobs cannot be overwritten or ignored', async (t) => {
  const root = await fixture(t);
  const first = await buildSocialCatalog({ root });
  const file = path.join(root, first.catalog.templates[0].documentPath);
  await writeFile(file, '{}\n');
  await assert.rejects(buildSocialCatalog({ root }));
  assert.equal(await readFile(file, 'utf8'), '{}\n');
  await writeFile(file, `${JSON.stringify(fresh())}\n`);
  const bad = { ...fresh(), backgroundImage: 'https://example.com/private.jpg' };
  await jsonWrite(path.join(root, `social/published/${contentHash(bad)}.json`), bad);
  await assert.rejects(buildSocialCatalog({ root }), /backgroundImage/);
});

test('unexpected photos, archives and non-hash published files are excluded', async (t) => {
  for (const relative of ['social/templates/original.jpg', 'social/templates/reference.png', 'social/templates/source.zip', 'social/published/photo.jpg', 'social/published/.DS_Store']) {
    const root = await fixture(t);
    await buildSocialCatalog({ root });
    await writeFile(path.join(root, relative), 'not export content');
    await assert.rejects(buildSocialCatalog({ root }), /Unexpected/);
  }
});
