import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTemplate, validateSafeScoreboardTemplateDocument } from '../contract/index.mjs';

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_DOCUMENT_BYTES = 500_000;
const MAX_JSON_BYTES = 8_000_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FILE_PATTERN = /^[a-z0-9][a-z0-9-]{1,190}\.html$/;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const contentHash = ({ html, css }) => sha256(JSON.stringify([html, css]));

export async function readPreviewManifest(root, manifest) {
  if (manifest === undefined) {
    try { manifest = JSON.parse(await readBounded(root, 'previews/manifest.json', MAX_JSON_BYTES)); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  if (manifest.schemaVersion !== 1 || manifest.fixtureVersion !== 'sport-samples-v1' || manifest.rendererVersion !== '1'
    || !manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) throw new Error('Invalid preview manifest.');
  const entries = {};
  for (const [fileName, preview] of Object.entries(manifest.entries)) {
    if (!FILE_PATTERN.test(fileName) || !preview || typeof preview !== 'object' || Array.isArray(preview)
      || !HASH_PATTERN.test(preview.imageHash) || !HASH_PATTERN.test(preview.contentHash)
      || preview.path !== `previews/${preview.imageHash}.png`
      || preview.fixtureVersion !== manifest.fixtureVersion || preview.rendererVersion !== manifest.rendererVersion
      || !['tableTennis', 'pickleball', 'volleyball', 'basketball', 'soccer', 'baseball', 'softball'].includes(preview.sport)
      || !Number.isSafeInteger(preview.width) || !Number.isSafeInteger(preview.height)
      || preview.width < 1 || preview.height < 1 || preview.width > 4096 || preview.height > 4096) throw new Error(`Invalid preview metadata: ${fileName}`);
    const target = await checkedPath(root, preview.path);
    if ((await lstat(target)).size > 10_000_000) throw new Error(`Preview image is too large: ${fileName}`);
    const bytes = await readFile(target);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== preview.width
      || bytes.readUInt32BE(20) !== preview.height || sha256(bytes) !== preview.imageHash) throw new Error(`Preview image identity or dimensions differ: ${fileName}`);
    entries[fileName] = { path: preview.path, imageHash: preview.imageHash, contentHash: preview.contentHash,
      width: preview.width, height: preview.height, fixtureVersion: preview.fixtureVersion, rendererVersion: preview.rendererVersion, sport: preview.sport };
  }
  return entries;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\u0000-\u001f\u007f%?#:]/.test(value)
    || value.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

async function checkedPath(root, relative, { missingLeaf = false } = {}) {
  assertSafeRelativePath(relative);
  const parts = relative.split('/');
  let target = root;
  for (let index = 0; index < parts.length; index++) {
    target = path.join(target, parts[index]);
    let status;
    try { status = await lstat(target); }
    catch (error) {
      if (error.code === 'ENOENT' && missingLeaf && index === parts.length - 1) return target;
      throw error;
    }
    if (status.isSymbolicLink()) throw new Error(`Symlinks are not permitted: ${relative}`);
    if (index < parts.length - 1 ? !status.isDirectory() : !status.isFile()) throw new Error(`Expected regular path: ${relative}`);
  }
  return target;
}

async function readBounded(root, relative, limit) {
  const target = await checkedPath(root, relative);
  if ((await lstat(target)).size > limit) throw new Error(`File exceeds ${limit} bytes: ${relative}`);
  const bytes = await readFile(target);
  if (bytes.length > limit) throw new Error(`File exceeds ${limit} bytes: ${relative}`);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!Buffer.from(text).equals(bytes)) throw new Error(`Not lossless UTF-8: ${relative}`);
  return text;
}

function validateEntry(entry, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Manifest entries must be objects.');
  assertSafeRelativePath(entry.output);
  const [directory, fileName, extra] = entry.output.split('/');
  if (directory !== 'html-replications' || extra !== undefined || !FILE_PATTERN.test(fileName)) throw new Error(`Invalid template output: ${entry.output}`);
  if (seen.has(fileName)) throw new Error(`Duplicate template fileName: ${fileName}`);
  seen.add(fileName);
  for (const flag of ['retired', 'published']) if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') throw new Error(`${fileName}: ${flag} must be boolean.`);
  if (entry.retired && entry.published) throw new Error(`${fileName}: retired templates cannot be published.`);
  if (entry.source !== undefined) assertSafeRelativePath(entry.source);
  if (entry.referenceImage !== undefined) {
    if (typeof entry.referenceImage !== 'string' || !entry.referenceImage.startsWith('/scoreboard-templates/references/')) throw new Error(`${fileName}: invalid referenceImage.`);
    assertSafeRelativePath(entry.referenceImage.slice('/scoreboard-templates/'.length));
  }
  if (entry.aliases !== undefined && (!Array.isArray(entry.aliases) || entry.aliases.some((value) => typeof value !== 'string'))) throw new Error(`${fileName}: aliases must be strings.`);
  for (const alias of entry.aliases || []) assertSafeRelativePath(alias);
  for (const field of ['title', 'description', 'placement', 'motif']) if (entry[field] !== undefined && typeof entry[field] !== 'string') throw new Error(`${fileName}: ${field} must be text.`);
  for (const field of ['fileName', 'contentHash', 'documentPath', 'preview', 'previewURL']) if (Object.hasOwn(entry, field)) throw new Error(`${fileName}: ${field} is generated, not authored.`);
  return fileName;
}

export function validatePublishedDocument(document, expectedHash) {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || Object.keys(document).sort().join(',') !== 'css,html'
    || typeof document.html !== 'string' || typeof document.css !== 'string') throw new Error('Published documents must contain only string html and css fields.');
  if (Buffer.byteLength(document.html) > MAX_DOCUMENT_BYTES || Buffer.byteLength(document.css) > MAX_DOCUMENT_BYTES) throw new Error('Published document exceeds size limit.');
  if (!HASH_PATTERN.test(expectedHash) || contentHash(document) !== expectedHash) throw new Error('Published document hash mismatch.');
  validateSafeScoreboardTemplateDocument(document);
  return document;
}

async function ensurePublishedDirectory(root, check) {
  const directory = path.join(root, 'published');
  if (!check) await mkdir(directory, { recursive: true });
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('published must be a regular directory.');
  return directory;
}

export async function buildCatalog({ root = DEFAULT_ROOT, check = false } = {}) {
  root = path.resolve(root);
  const manifest = JSON.parse(await readBounded(root, 'templates/html-replications/manifest.json', MAX_JSON_BYTES));
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 10_000) throw new Error('Manifest must be a nonempty array with at most 10000 entries.');
  const templates = [];
  const blobs = new Map();
  const seen = new Set();
  let warningCount = 0;
  const previews = await readPreviewManifest(root);
  for (const entry of manifest) {
    const fileName = validateEntry(entry, seen);
    const html = await readBounded(root, `templates/${entry.output}`, MAX_DOCUMENT_BYTES);
    const document = { html, css: '' };
    validateSafeScoreboardTemplateDocument(document);
    if (!entry.retired) {
      const inspection = inspectTemplate(html);
      if (inspection.errors.length) throw new Error(`${fileName}: ${inspection.errors.join('; ')}`);
      warningCount += inspection.warnings.length;
    }
    const hash = contentHash(document);
    const documentPath = `published/${hash}.json`;
    blobs.set(documentPath, `${JSON.stringify(document)}\n`);
    const preview = previews[fileName];
    if (preview && (preview.contentHash !== hash || (entry.sport && entry.sport !== preview.sport))) throw new Error(`Stale preview: ${fileName}. Regenerate screenshots before publishing.`);
    templates.push({ ...canonical(entry), fileName, contentHash: hash, documentPath,
      ...(preview && !entry.retired && entry.published !== false ? { preview } : {}) });
  }
  for (const fileName of Object.keys(previews)) if (!seen.has(fileName)) throw new Error(`Preview has no source template: ${fileName}`);
  templates.sort((a, b) => a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0);
  const catalog = { schemaVersion: 1, revision: sha256(JSON.stringify(templates)), templates };
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  const published = await ensurePublishedDirectory(root, check);
  // Historical blobs remain addressable. Validate them, but never remove or rewrite them.
  for (const name of await readdir(published)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`Unexpected published file: ${name}`);
    validatePublishedDocument(JSON.parse(await readBounded(root, `published/${name}`, MAX_JSON_BYTES)), name.slice(0, -5));
  }
  const missing = [];
  for (const [relative, expected] of blobs) {
    const target = await checkedPath(root, relative, { missingLeaf: true });
    try {
      const existing = await readBounded(root, relative, MAX_JSON_BYTES);
      if (existing !== expected) throw new Error(`Immutable blob differs: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (check) throw new Error(`Missing published blob: ${relative}`);
      missing.push([target, expected]);
    }
  }
  const catalogPath = await checkedPath(root, 'catalog.json', { missingLeaf: true });
  if (check) {
    if (await readBounded(root, 'catalog.json', MAX_JSON_BYTES) !== serialized) throw new Error('catalog.json is stale; run node tools/build-catalog.mjs.');
  } else {
    for (const [target, expected] of missing) await writeFile(target, expected, { flag: 'wx' });
    const temporary = path.join(root, `catalog-${process.pid}-${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 12)}.tmp`);
    try {
      await writeFile(temporary, serialized, { flag: 'wx' });
      await rename(temporary, catalogPath);
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return { catalog, total: templates.length, active: templates.filter((entry) => !entry.retired).length, retired: templates.filter((entry) => entry.retired).length, blobs: blobs.size, warningCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== '--check')) throw new Error('Usage: node tools/build-catalog.mjs [--check]');
    const { total, active, retired, blobs, warningCount } = await buildCatalog({ check: process.argv.includes('--check') });
    console.log(`Catalog ${process.argv.includes('--check') ? 'verified' : 'built'}: ${total} entries, ${active} active, ${retired} retired, ${blobs} current blobs; ${warningCount} inspection warnings.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
