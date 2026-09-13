import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCatalog, contentHash, sha256, assertSafeRelativePath, validatePublishedDocument, MAX_DOCUMENT_BYTES } from './build-catalog.mjs';
import { CORE_FIELDS } from '../contract/index.mjs';

const html = `\uFEFF<!doctype html>\r\n<html lang="en"><head><style>body{background:transparent} .score{color:red}</style></head><body><main>${CORE_FIELDS.map((field) => `<span class="${field}" data-osb-field="${field}"></span>`).join('')}</main><footer>Static &amp; preserved</footer></body></html>\r\n`;

async function fixture(t, entries = [{ output: 'html-replications/test-template.html', published: true }]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'template-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify(entries));
  await writeFile(path.join(root, 'templates/html-replications/test-template.html'), html);
  return root;
}

test('catalog preserves exact UTF-8/BOM/CRLF HTML and embedded CSS; check is read-only', async (t) => {
  const root = await fixture(t);
  const { catalog } = await buildCatalog({ root });
  const entry = catalog.templates[0];
  const blobPath = path.join(root, entry.documentPath);
  const blob = JSON.parse(await readFile(blobPath, 'utf8'));
  assert.deepEqual(blob, { html, css: '' });
  assert.ok(Buffer.from(blob.html).equals(await readFile(path.join(root, 'templates/html-replications/test-template.html'))));
  assert.equal(entry.contentHash, sha256(JSON.stringify([html, ''])));
  assert.equal(entry.documentPath, `published/${entry.contentHash}.json`);
  assert.equal(catalog.revision, sha256(JSON.stringify(catalog.templates)));
  const before = (await stat(blobPath)).mtimeMs;
  assert.deepEqual((await buildCatalog({ root, check: true })).catalog, catalog);
  assert.equal((await stat(blobPath)).mtimeMs, before);
  await rm(blobPath);
  await assert.rejects(buildCatalog({ root, check: true }), /Missing published blob/);
  assert.deepEqual(await readdir(path.join(root, 'published')), []);
});

test('old immutable blobs survive updates and retirement', async (t) => {
  const root = await fixture(t);
  const first = (await buildCatalog({ root })).catalog;
  await writeFile(path.join(root, 'templates/html-replications/test-template.html'), html.replace('Static', 'Revised'));
  const second = (await buildCatalog({ root })).catalog;
  assert.notEqual(first.revision, second.revision);
  assert.equal((await readdir(path.join(root, 'published'))).length, 2);
  assert.equal(JSON.parse(await readFile(path.join(root, first.templates[0].documentPath))).html, html);
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify([{ output: 'html-replications/test-template.html', retired: true, published: false }]));
  assert.equal((await buildCatalog({ root })).retired, 1);
  assert.equal((await readdir(path.join(root, 'published'))).length, 2);
});

test('entry ordering and object key order do not alter catalog revision', async (t) => {
  const root = await fixture(t, [
    { output: 'html-replications/test-template.html', title: 'A', published: true },
    { output: 'html-replications/other-template.html', title: 'B', retired: true },
  ]);
  await writeFile(path.join(root, 'templates/html-replications/other-template.html'), '<main>Retired</main>');
  const first = (await buildCatalog({ root })).catalog;
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify([
    { retired: true, title: 'B', output: 'html-replications/other-template.html' },
    { title: 'A', published: true, output: 'html-replications/test-template.html' },
  ]));
  assert.deepEqual((await buildCatalog({ root, check: true })).catalog, first);
});

test('invalid paths and duplicate file names are rejected', async (t) => {
  for (const value of ['../file.html', '/file.html', 'a//b', 'a/../b', 'a\\b', 'a/%2e%2e/b', './a', '.hidden/a', 'a?b', 'a\u0000b']) assert.throws(() => assertSafeRelativePath(value), /Unsafe/);
  const root = await fixture(t, [{ output: 'html-replications/test-template.html' }, { output: 'html-replications/test-template.html' }]);
  await assert.rejects(buildCatalog({ root }), /Duplicate/);
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), '[{"output":"../escape.html"}]');
  await assert.rejects(buildCatalog({ root }), /Unsafe/);
});

test('source and output symlinks are rejected', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'templates/html-replications/test-template.html');
  await rm(file);
  await writeFile(path.join(root, 'real.html'), html);
  await symlink(path.join(root, 'real.html'), file);
  await assert.rejects(buildCatalog({ root }), /Symlinks/);
  await rm(file);
  await writeFile(file, html);
  await mkdir(path.join(root, 'elsewhere'));
  await symlink(path.join(root, 'elsewhere'), path.join(root, 'published'));
  await assert.rejects(buildCatalog({ root }), /regular directory/);
});

test('stale catalog, corrupt blobs, and extra blob fields cannot be accepted or overwritten', async (t) => {
  const root = await fixture(t);
  const { catalog } = await buildCatalog({ root });
  await writeFile(path.join(root, 'catalog.json'), '{}');
  await assert.rejects(buildCatalog({ root, check: true }), /stale/);
  const blobPath = path.join(root, catalog.templates[0].documentPath);
  await writeFile(blobPath, JSON.stringify({ html: 'corruption', css: '' }));
  await assert.rejects(buildCatalog({ root }), /hash mismatch/);
  assert.equal(JSON.parse(await readFile(blobPath)).html, 'corruption');
  assert.throws(() => validatePublishedDocument({ html, css: '', extra: true }, contentHash({ html, css: '' })), /only string/);
});

test('active documents require core fields, safe static HTML, size limits and lossless UTF-8', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'templates/html-replications/test-template.html');
  await writeFile(file, '<main>No fields</main>');
  await assert.rejects(buildCatalog({ root }), /requires at least one/);
  await writeFile(file, '<script>alert(1)</script>');
  await assert.rejects(buildCatalog({ root }), /unsupported executable/);
  await writeFile(file, 'x'.repeat(MAX_DOCUMENT_BYTES + 1));
  await assert.rejects(buildCatalog({ root }), /exceeds/);
  await writeFile(file, Buffer.from([0xff, 0xfe]));
  await assert.rejects(buildCatalog({ root }), /encoded data/);
});
