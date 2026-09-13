import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOCIAL_TEMPLATE_SCHEMA_VERSION, inspectSocialTemplate, validateSocialTemplate } from '../social/contract.mjs';

export const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const contentHash = (document) => sha256(JSON.stringify(document));
const MAX_JSON_BYTES = 8_000_000;
const ID = /^starter-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const META_KEYS = ['id', 'name', 'description', 'category', 'colors', 'published'];

export function assertSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\u0000-\u001f\u007f%?#:]/.test(value)
    || value.split('/').some((part) => !part || part.startsWith('.') || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

async function assertRoot(root) {
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split('/').filter(Boolean)) {
    current = path.join(current, part);
    const status = await lstat(current);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`Root must use regular directories, without symlinks: ${current}`);
  }
}

async function checkedPath(root, relative, { missing = false, directory = false } = {}) {
  assertSafeRelativePath(relative);
  let target = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    target = path.join(target, parts[index]);
    const last = index === parts.length - 1;
    let status;
    try { status = await lstat(target); }
    catch (error) { if (error.code === 'ENOENT' && missing && last) return target; throw error; }
    if (status.isSymbolicLink()) throw new Error(`Symlinks are not permitted: ${relative}`);
    if ((!last || directory) ? !status.isDirectory() : !status.isFile()) throw new Error(`Expected regular ${directory ? 'directory' : 'file'}: ${relative}`);
  }
  return target;
}

function parseJSON(text, label) {
  const value = JSON.parse(text);
  // JSON.parse alone silently accepts repeated keys; catch those before trusting a document.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g) || [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const key = JSON.parse(token), keys = stack.at(-1);
      if (keys.has(key)) throw new Error(`Duplicate JSON key ${key}: ${label}`);
      keys.add(key);
    }
  }
  return value;
}

async function readBounded(root, relative) {
  const target = await checkedPath(root, relative);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const status = await handle.stat();
    if (!status.isFile() || status.size > MAX_JSON_BYTES) throw new Error(`Oversized or irregular JSON file: ${relative}`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_JSON_BYTES) throw new Error(`Oversized JSON file: ${relative}`);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { await handle.close(); }
}

function validateMetadata(entry, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || Object.keys(entry).sort().join(',') !== [...META_KEYS].sort().join(',')) throw new Error('Manifest entries must contain exactly id, name, description, category, colors, published.');
  if (typeof entry.id !== 'string' || entry.id.length > 160 || !ID.test(entry.id)) throw new Error('Invalid starter template id.');
  if (seen.has(entry.id)) throw new Error(`Duplicate template id: ${entry.id}`);
  seen.add(entry.id);
  for (const [key, limit] of [['name', 100], ['description', 500]]) {
    const text = entry[key];
    if (typeof text !== 'string' || !text || text.trim() !== text || text.length > limit || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`Invalid manifest ${key}: ${entry.id}`);
  }
  if (!['winners', 'results', 'matchday', 'event', 'recap'].includes(entry.category)) throw new Error(`Invalid category: ${entry.id}`);
  if (typeof entry.published !== 'boolean') throw new Error(`published must be boolean: ${entry.id}`);
  if (!Array.isArray(entry.colors) || entry.colors.length < 2 || entry.colors.length > 8
    || entry.colors.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color))
    || new Set(entry.colors).size !== entry.colors.length) throw new Error(`Invalid colors: ${entry.id}`);
}

export function validatePublishedDocument(document, expectedHash) {
  validateSocialTemplate(document);
  if (!ID.test(document.id)) throw new Error('Published documents must have starter IDs.');
  if (typeof expectedHash !== 'string' || !HASH.test(expectedHash) || contentHash(document) !== expectedHash) throw new Error('Published document hash mismatch.');
  return document;
}

export async function buildSocialCatalog({ root = DEFAULT_ROOT, check = false } = {}) {
  root = path.resolve(root);
  await assertRoot(root);
  const manifest = parseJSON(await readBounded(root, 'social/manifest.json'), 'social/manifest.json');
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 1000) throw new Error('Manifest must contain 1-1000 entries.');
  const seen = new Set(), templates = [], blobs = new Map();
  let warningCount = 0;
  for (const entry of manifest) {
    validateMetadata(entry, seen);
    const relative = `social/templates/${entry.id}.json`;
    const document = validateSocialTemplate(parseJSON(await readBounded(root, relative), relative));
    if (document.id !== entry.id) throw new Error(`Manifest/document identity mismatch: ${entry.id}`);
    const palette = new Set([document.backgroundColor, ...document.layers.flatMap((layer) => [layer.color, layer.fill])]);
    if (entry.colors.some((color) => !palette.has(color))) throw new Error(`Manifest palette is not present in document: ${entry.id}`);
    warningCount += inspectSocialTemplate(document).warnings.length;
    const hash = contentHash(document), documentPath = `social/published/${hash}.json`;
    blobs.set(documentPath, `${JSON.stringify(document)}\n`);
    templates.push({ id: entry.id, name: document.name, description: entry.description, category: entry.category,
      preset: document.preset, width: document.width, height: document.height, colors: entry.colors,
      published: entry.published, contentHash: hash, documentPath });
  }
  const sourceDirectory = await checkedPath(root, 'social/templates', { directory: true });
  for (const name of await readdir(sourceDirectory)) {
    if (!name.endsWith('.json') || !seen.has(name.slice(0, -5))) throw new Error(`Unexpected social source file: ${name}`);
  }
  templates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const catalog = { schemaVersion: SOCIAL_TEMPLATE_SCHEMA_VERSION, revision: sha256(JSON.stringify(templates)), templates };
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  const published = await checkedPath(root, 'social/published', { directory: true, missing: !check });
  let names;
  try { names = await readdir(published); }
  catch (error) { if (error.code !== 'ENOENT' || check) throw error; names = []; }
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error(`Unexpected published file: ${name}`);
    const relative = `social/published/${name}`;
    validatePublishedDocument(parseJSON(await readBounded(root, relative), relative), name.slice(0, -5));
  }
  const missing = [];
  for (const [relative, expected] of blobs) {
    if (!names.includes(path.basename(relative))) {
      if (check) throw new Error(`Missing published blob: ${relative}`);
      missing.push([relative, expected]);
    } else if (await readBounded(root, relative) !== expected) throw new Error(`Immutable blob differs: ${relative}`);
  }
  const catalogPath = await checkedPath(root, 'social/catalog.json', { missing: true });
  if (check) {
    if (await readBounded(root, 'social/catalog.json') !== serialized) throw new Error('social/catalog.json is stale; run node tools/build-social-catalog.mjs.');
  } else {
    if (!names.length) {
      try { await mkdir(published); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await checkedPath(root, 'social/published', { directory: true });
    }
    for (const [relative, expected] of missing) {
      const target = await checkedPath(root, relative, { missing: true });
      await writeFile(target, expected, { flag: 'wx' });
    }
    const temporary = path.join(root, 'social', `catalog-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, serialized, { flag: 'wx' });
      await rename(temporary, catalogPath);
    } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { catalog, total: templates.length, published: templates.filter((entry) => entry.published).length, blobs: blobs.size, warningCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== '--check')) throw new Error('Usage: node tools/build-social-catalog.mjs [--check]');
    const result = await buildSocialCatalog({ check: process.argv.includes('--check') });
    console.log(`Social catalog ${process.argv.includes('--check') ? 'verified' : 'built'}: ${result.total} entries, ${result.published} published, ${result.blobs} blobs; ${result.warningCount} inspection warnings.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
