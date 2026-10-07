import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCatalog, contentHash, sha256, readPreviewManifest } from './build-catalog.mjs';
import { CORE_FIELDS } from '../contract/index.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'preview-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await mkdir(path.join(root, 'previews'));
  const html = `<main>${CORE_FIELDS.map(field => `<span class="${field}" data-osb-field="${field}"></span>`).join('')}</main>`;
  await writeFile(path.join(root, 'templates/html-replications/example-board.html'), html);
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify([{ output: 'html-replications/example-board.html', sport: 'basketball', published: true }]));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZV0AAAAASUVORK5CYII=', 'base64');
  const imageHash = sha256(image);
  const preview = { path: `previews/${imageHash}.png`, imageHash, contentHash: contentHash({ html, css: '' }),
    width: 1, height: 1, fixtureVersion: 'sport-samples-v1', rendererVersion: '1', sport: 'basketball' };
  await writeFile(path.join(root, preview.path), image);
  const manifest = { schemaVersion: 1, fixtureVersion: 'sport-samples-v1', rendererVersion: '1', entries: { 'example-board.html': preview } };
  const save = () => writeFile(path.join(root, 'previews/manifest.json'), JSON.stringify(manifest));
  await save();
  return { root, html, preview, manifest, save };
}

test('catalog attaches validated screenshots without altering source bytes or design identities', async t => {
  const f = await fixture(t);
  const { catalog } = await buildCatalog({ root: f.root });
  assert.deepEqual(catalog.templates[0].preview, f.preview);
  assert.equal(catalog.templates[0].contentHash, f.preview.contentHash);
  assert.equal(JSON.parse(await readFile(path.join(f.root, catalog.templates[0].documentPath))).html, f.html);
  await buildCatalog({ root: f.root, check: true });
});

test('catalog rejects stale design previews, changed image bytes and incorrect dimensions', async t => {
  const f = await fixture(t);
  f.preview.contentHash = 'a'.repeat(64); await f.save();
  await assert.rejects(buildCatalog({ root: f.root }), /Stale preview/);
  f.preview.contentHash = contentHash({ html: f.html, css: '' }); f.preview.width = 2; await f.save();
  await assert.rejects(readPreviewManifest(f.root), /dimensions differ/);
  f.preview.width = 1; await f.save();
  await writeFile(path.join(f.root, f.preview.path), Buffer.from('not a PNG'));
  await assert.rejects(readPreviewManifest(f.root), /identity or dimensions/);
});

test('preview metadata rejects path escapes, external URLs, unknown sport and future fixture versions', async t => {
  const f = await fixture(t);
  for (const [key, value] of [['path', '../outside.png'], ['path', 'https://untrusted.invalid/image.png'], ['sport', 'unknown'], ['fixtureVersion', 'future-v99'], ['height', 9000]]) {
    const original = f.preview[key]; f.preview[key] = value; await f.save();
    await assert.rejects(readPreviewManifest(f.root), /Invalid preview metadata/);
    f.preview[key] = original;
  }
});

test('inactive designs retain source and history but never acquire active gallery preview metadata', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'templates/html-replications/manifest.json'), JSON.stringify([{ output: 'html-replications/example-board.html', sport: 'basketball', retired: true, published: false }]));
  assert.equal((await buildCatalog({ root: f.root })).catalog.templates[0].preview, undefined);
});
