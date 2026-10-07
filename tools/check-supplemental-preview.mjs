import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROOT, readPreviewManifest } from './build-catalog.mjs';
import { recipeHash, inspectPNG } from './render-previews.mjs';

export async function checkSupplementalPreview(root = DEFAULT_ROOT) {
  const directory = path.join(root, 'previews');
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Supplemental preview directory must be regular.');
  const file = path.join(directory, 'supplemental.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 100_000) throw new Error('Invalid supplemental preview file.');
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.schemaVersion !== 1 || data.recipeHash !== await recipeHash()
    || Object.keys(data.entries || {}).join(',') !== 'proscoreboard-default.html') throw new Error('Invalid or stale supplemental preview recipe.');
  const asset = data.entries['proscoreboard-default.html'];
  if (!asset.preview || asset.contentHash !== asset.preview.contentHash
    || asset.previewURL !== `https://raw.githubusercontent.com/jackbmccarthy/proscoreboard-templates/main/${asset.preview.path}`) throw new Error('Invalid supplemental preview identity.');
  const entries = await readPreviewManifest(root, { schemaVersion: 1, fixtureVersion: 'sport-samples-v1', rendererVersion: '1', entries: { 'proscoreboard-default.html': asset.preview } });
  const pixels = inspectPNG(await readFile(path.join(root, entries['proscoreboard-default.html'].path)));
  return { checked: 1, contentHash: asset.contentHash, imageHash: asset.preview.imageHash, width: pixels.width, height: pixels.height };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkSupplementalPreview())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
