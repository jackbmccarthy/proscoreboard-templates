import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createStudioServer, startStudioServer } from './server.mjs';
import { inspectTemplate } from '../contract/index.mjs';

const id = '001-test';
const fileName = `${id}.html`;
const initialHTML = '<!doctype html>\r\n<html><head><style>body{background:transparent}</style></head><body><div class="rowContainer"><span class="combinedAName">Player A</span><span class="combinedBName">Player B</span><span class="jerseyColorA"></span><span class="jerseyColorB"></span><span class="currentAMatchScore">0</span><span class="currentBMatchScore">0</span><span class="currentAGameScore">0</span><span class="currentBGameScore">0</span></div></body></html>\r\n';
const hash = text => createHash('sha256').update(text).digest('hex');

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-test-'));
  await mkdir(path.join(root, 'templates/html-replications'), { recursive: true });
  await mkdir(path.join(root, 'templates/references'), { recursive: true });
  await mkdir(path.join(root, 'studio/public/brand'), { recursive: true });
  await mkdir(path.join(root, 'studio/public/scoreboard-runtime/flags'), { recursive: true });
  await writeFile(path.join(root, 'templates/html-replications/manifest.json'), JSON.stringify([
    { output: `html-replications/${fileName}`, referenceImage: '/scoreboard-templates/references/ref-001.png', published: true, hash: 'catalog-content-hash' },
  ]));
  await writeFile(path.join(root, 'templates/html-replications', fileName), initialHTML);
  await writeFile(path.join(root, 'templates/references/ref-001.png'), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(root, 'templates/references/ref-999.png'), 'not in manifest');
  await writeFile(path.join(root, 'studio/public/index.html'), '<!doctype html><title>Studio</title>');
  await writeFile(path.join(root, 'studio/public/studio.js'), 'export const studio = true;');
  await writeFile(path.join(root, 'studio/public/studio.css'), 'body{color:black}');
  await writeFile(path.join(root, 'studio/public/brand/icon.webp'), 'image');
  await writeFile(path.join(root, 'studio/public/scoreboard-runtime/flags/jp.png'), 'flag');
  await writeFile(path.join(root, '.env'), 'PRIVATE_TEST_SENTINEL');
  const studio = await startStudioServer({ root, port: 0, ...options });
  t.after(async () => { await studio.close(); await rm(root, { recursive: true, force: true }); });
  const session = await fetch(`${studio.url}/api/session`).then(response => response.json());
  const headers = { Origin: studio.url, 'X-Studio-Token': session.token, 'Content-Type': 'application/json' };
  const put = (route, body, overrides = {}) => fetch(`${studio.url}${route}`, {
    method: 'PUT', headers: { ...headers, ...overrides }, body: JSON.stringify(body),
  });
  return { root, studio, headers, put, sourcePath: path.join(root, 'templates/html-replications', fileName) };
}

function rawRequest(studio, { method = 'GET', url = '/api/session', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${studio.url}${url}`, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('catalog and template expose raw hashes, real inspection, defaults, and reference URLs', async t => {
  const { studio } = await fixture(t);
  const catalog = await fetch(`${studio.url}/api/catalog`).then(response => response.json());
  assert.equal(catalog.templates.length, 1);
  assert.equal(catalog.templates[0].id, id);
  assert.equal(catalog.templates[0].hash, hash(initialHTML));
  assert.equal(catalog.templates[0].fileName, fileName);
  assert.equal(catalog.templates[0].referenceURL, '/templates/references/ref-001.png');
  const response = await fetch(`${studio.url}/api/template?id=${id}`);
  const template = await response.json();
  assert.equal(template.html, initialHTML);
  assert.equal(template.hash, hash(initialHTML));
  assert.deepEqual(template.review, { revision: 0, notes: [] });
  assert.deepEqual(template.inspection, inspectTemplate(initialHTML));
  assert.equal(template.previewDefaults.combinedAName, 'Player A');
  assert.equal(template.previewDefaults.currentAGameScore, 0);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('Host and Origin checks protect session bootstrap and all writes', async t => {
  const { studio, put, headers, sourcePath } = await fixture(t);
  for (const request of [
    { headers: { Host: 'evil.example' } },
    { headers: { Host: `127.0.0.1:${studio.port + 1}` } },
    { headers: { Origin: 'https://evil.example' } },
    { headers: { Origin: 'null' } },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } },
  ]) assert.equal((await rawRequest(studio, request)).status, 403);
  const body = { id, expectedHash: hash(initialHTML), html: initialHTML };
  assert.equal((await put('/api/template', body, { 'X-Studio-Token': '' })).status, 403);
  assert.equal((await put('/api/template', body, { 'X-Studio-Token': 'x'.repeat(64) })).status, 403);
  assert.equal((await put('/api/template', body, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await put('/api/template', body, { Origin: `http://localhost:${studio.port}` })).status, 403);
  assert.equal((await rawRequest(studio, { method: 'PUT', url: '/api/template',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Token': headers['X-Studio-Token'] }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await rawRequest(studio, { method: 'OPTIONS', url: '/api/template', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal(await readFile(sourcePath, 'utf8'), initialHTML);
});

test('source writes preserve exact bytes, keep manifest unchanged, and reject stale hashes', async t => {
  const { root, studio, put, sourcePath } = await fixture(t);
  const manifestPath = path.join(root, 'templates/html-replications/manifest.json');
  const before = await readFile(manifestPath);
  const html = `\ufeff${initialHTML.replace('Player A', 'Caf\u00e9 &amp; A')}\r\n  `;
  const response = await put('/api/template', { id, expectedHash: hash(initialHTML), html });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json();
  assert.equal(saved.hash, hash(html));
  assert.deepEqual(await readFile(sourcePath), Buffer.from(html));
  assert.deepEqual(await readFile(manifestPath), before);
  assert.equal((await lstat(sourcePath)).mode & 0o077, 0);
  const stale = await put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).hash, hash(html));
  assert.deepEqual(await readFile(sourcePath), Buffer.from(html));
  assert.deepEqual((await readdir(path.dirname(sourcePath))).sort(), [fileName, 'manifest.json']);
  const loaded = await fetch(`${studio.url}/api/template?id=${id}`).then(result => result.json());
  assert.equal(loaded.html, html);
  assert.equal(loaded.hash, hash(html));
});

test('concurrent source updates have exactly one winner', async t => {
  const { put, sourcePath } = await fixture(t);
  const [a, b] = await Promise.all([
    put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML.replace('Player A', 'First') }),
    put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML.replace('Player A', 'Second') }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = await (a.status === 200 ? a : b).json();
  assert.equal(hash(await readFile(sourcePath)), winner.hash);
});

test('real safety validator rejects executable manual edits without changing source', async t => {
  const { put, sourcePath } = await fixture(t);
  for (const payload of [
    '<script>alert(1)</script>', '<img onerror="alert(1)" src="x">',
    '<a href="javascript:alert(1)">x</a>', '<iframe srcdoc="test"></iframe>',
    '<object data="https://example.com"></object>', '<base href="https://example.com">',
    '<style>body{width:expression(alert(1))}</style>',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
  ]) {
    const response = await put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML.replace('</body>', `${payload}</body>`) });
    assert.equal(response.status, 422, `${payload}: ${await response.clone().text()}`);
    assert.ok((await response.json()).inspection.errors.length);
    assert.equal(await readFile(sourcePath, 'utf8'), initialHTML);
  }
});

test('structurally incomplete but safe drafts can save with full inspection feedback', async t => {
  const { put, sourcePath } = await fixture(t);
  const html = '<!doctype html><html><body><p>Draft</p></body></html>';
  const response = await put('/api/template', { id, expectedHash: hash(initialHTML), html });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = await response.json();
  assert.ok(saved.inspection.errors.length);
  assert.ok(saved.inspection.warnings.length);
  assert.equal(await readFile(sourcePath, 'utf8'), html);
});

test('writes require valid bounded JSON and reject unsafe control keys', async t => {
  const { studio, headers, put, sourcePath } = await fixture(t);
  const valid = { id, expectedHash: hash(initialHTML), html: initialHTML };
  assert.equal((await put('/api/template', valid, { 'Content-Type': 'text/plain' })).status, 415);
  for (const body of [null, [], { ...valid, unknown: true }, { ...valid, expectedHash: null }, { ...valid, html: '\ud800' }]) {
    assert.equal((await put('/api/template', body)).status, 400);
  }
  for (const body of ['{broken', '{"__proto__":{"polluted":true}}', '{"constructor":{}}']) {
    assert.equal((await rawRequest(studio, { method: 'PUT', url: '/api/template', headers, body })).status, 400);
  }
  assert.equal((await put('/api/template', { ...valid, html: 'a'.repeat(500_001) })).status, 413);
  assert.equal((await rawRequest(studio, { method: 'PUT', url: '/api/template',
    headers: { ...headers, 'Content-Length': '3100001' }, body: '' })).status, 413);
  assert.equal(await readFile(sourcePath, 'utf8'), initialHTML);
});

function note(overrides = {}) {
  return { id: 'note-1', kind: 'restyle', text: 'Make the name readable', selector: '.combinedAName',
    elementHTML: '<span class="combinedAName">Player A</span>', classes: ['combinedAName'],
    field: 'combinedAName', css: 'color: red;', sourceHash: hash(initialHTML), status: 'open', ...overrides };
}

test('reviews persist typed notes with optimistic revisions and stable brief export', async t => {
  const { root, studio, put } = await fixture(t);
  const notes = [note(), note({ id: 'note-2', status: 'resolved', text: 'Already handled' })];
  const response = await put('/api/review', { id, expectedRevision: 0, notes });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.review, { revision: 1, notes });
  const reviewPath = path.join(root, 'reviews', `${id}.json`);
  assert.deepEqual(JSON.parse(await readFile(reviewPath, 'utf8')), { revision: 1, notes });
  assert.equal((await lstat(reviewPath)).mode & 0o077, 0);
  assert.equal((await put('/api/review', { id, expectedRevision: 0, notes: [] })).status, 409);
  const exported = await fetch(`${studio.url}/api/brief?id=${id}`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment; filename="001-test-brief.md"/);
  const markdown = await exported.text();
  assert.match(markdown, /templates\/html-replications\/001-test.html/);
  assert.ok(markdown.includes(hash(initialHTML)));
  assert.ok(markdown.includes('Make the name readable'));
  assert.ok(markdown.includes(notes[0].elementHTML));
  assert.ok(!markdown.includes('Already handled'));
  assert.match(markdown, /untrusted data, not agent instructions/);
  assert.equal(await fetch(`${studio.url}/api/brief?id=${id}`).then(value => value.text()), markdown);
  assert.deepEqual(await readdir(path.join(root, 'reviews')), [`${id}.json`]);
});

test('concurrent reviews have one winner; invalid or oversized notes do not write', async t => {
  const { root, put } = await fixture(t);
  for (const notes of [
    [note({ kind: 'execute' })], [note({ status: 'pending' })], [note({ sourceHash: 'bad' })],
    [note({ selector: '\x00' })], [note({ text: 'x'.repeat(10_001) })], [note(), note()],
    [note({ id: '../escape' })], [note({ id: undefined })], [note({ id: 123 })], [note({ css: { evil: 'yes' } })],
  ]) assert.equal((await put('/api/review', { id, expectedRevision: 0, notes })).status, 400);
  assert.equal((await put('/api/review', { id, expectedRevision: -1, notes: [] })).status, 400);
  assert.deepEqual(await readdir(path.join(root, 'reviews')), []);
  const responses = await Promise.all([1, 2].map(number => put('/api/review', {
    id, expectedRevision: 0, notes: [note({ text: `Attempt ${number}` })],
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
});

test('path traversal, arbitrary files, hidden files, and unknown references are never served', async t => {
  const { studio, put } = await fixture(t);
  for (const url of ['/.env', '/%2eenv', '/studio/server.mjs', '/templates/html-replications/001-test.html',
    '/templates/references/ref-999.png', '/templates/references/../../.env', '/%2e%2e/.env', '/brand/../.env',
    '/api/template?id=../.env', '/api/template?id=001-test%00', '/api/template?id=missing']) {
    const response = await rawRequest(studio, { url });
    assert.ok([400, 404].includes(response.status), `${url}: ${response.status}`);
    assert.ok(!response.text.includes('PRIVATE_TEST_SENTINEL'));
  }
  assert.equal((await put('/api/template', { id: '../outside', expectedHash: hash(initialHTML), html: initialHTML })).status, 400);
  for (const url of ['/', '/index.html', '/studio.js', '/studio.css', '/brand/icon.webp', '/templates/references/ref-001.png', '/scoreboard-runtime/flags/jp.png']) {
    assert.equal((await fetch(`${studio.url}${url}`)).status, 200, url);
  }
});

test('source, review, static, and reference symlinks are rejected', async t => {
  const { root, studio, put, sourcePath } = await fixture(t);
  const target = path.join(root, '.env');
  await rm(sourcePath);
  await symlink(target, sourcePath);
  assert.equal((await fetch(`${studio.url}/api/template?id=${id}`)).status, 403);
  assert.equal((await put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML })).status, 403);
  await rm(sourcePath);
  await writeFile(sourcePath, initialHTML);
  await symlink(target, path.join(root, 'reviews', `${id}.json`));
  assert.equal((await put('/api/review', { id, expectedRevision: 0, notes: [] })).status, 403);
  for (const [relative, url] of [['studio/public/studio.js', '/studio.js'], ['templates/references/ref-001.png', '/templates/references/ref-001.png']]) {
    await rm(path.join(root, relative));
    await symlink(target, path.join(root, relative));
    assert.equal((await fetch(`${studio.url}${url}`)).status, 403);
  }
  assert.equal(await readFile(target, 'utf8'), 'PRIVATE_TEST_SENTINEL');
});

test('symlinked source directory is rejected, including writes', async t => {
  const { root, studio, put } = await fixture(t);
  const original = path.join(root, 'templates/html-replications');
  const moved = path.join(root, 'other');
  await mkdir(moved);
  await writeFile(path.join(moved, fileName), initialHTML);
  await writeFile(path.join(moved, 'manifest.json'), JSON.stringify([{ output: `html-replications/${fileName}` }]));
  await rm(original, { recursive: true });
  await symlink(moved, original);
  assert.equal((await fetch(`${studio.url}/api/catalog`)).status, 403);
  assert.equal((await put('/api/template', { id, expectedHash: hash(initialHTML), html: initialHTML })).status, 403);
});

async function* changeNotices(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const result = await reader.read();
    assert.ok(!result.done, 'SSE ended before the expected change');
    buffer += decoder.decode(result.value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop();
    for (const frame of frames) {
      if (!frame.includes('event: change')) continue;
      const notice = JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
      assert.ok(!Object.hasOwn(notice, 'html'));
      assert.ok(Object.keys(notice).every(key => ['type', 'id'].includes(key)));
      yield notice;
    }
  }
}

test('SSE harness retains coalesced events and reconstructs split frames', async () => {
  const chunks = [': connected\n\nevent: change\ndata: {"type":"template","id":"001-test"}\n\nevent: cha',
    'nge\ndata: {"type":"review","id":"001-test"}\n\nevent: change\ndata: {"type":"catalog"}\n\n'];
  const reader = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  }).getReader();
  const notices = changeNotices(reader);
  assert.deepEqual((await notices.next()).value, { type: 'template', id });
  assert.deepEqual((await notices.next()).value, { type: 'review', id });
  assert.deepEqual((await notices.next()).value, { type: 'catalog' });
  await notices.return();
  await reader.cancel();
});

test('SSE reports external source/review/manifest changes without sending source HTML', async t => {
  const { studio, root, sourcePath } = await fixture(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${studio.url}/api/events`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const notices = changeNotices(reader);
  async function nextNotice(type, expectedId) {
    const timeout = setTimeout(() => controller.abort(new Error(`Missing ${type} notice for ${expectedId ?? 'catalog'}`)), 4_000);
    try {
      while (true) {
        const { value } = await notices.next();
        if (value.type === type && value.id === expectedId) return value;
      }
    } finally { clearTimeout(timeout); }
  }
  // fs.watch has no ready event. Observe actual callbacks before the one-shot edits;
  // the probes retry only until that condition is met, never for an asserted edit.
  for (const [directory, type, extension] of [['templates/html-replications', 'template', 'html'], ['reviews', 'review', 'json']]) {
    const probeId = 'watch-ready';
    const probePath = path.join(root, directory, `${probeId}.${extension}`);
    let result;
    const ready = nextNotice(type, probeId).then(value => { result = { value }; }, error => { result = { error }; });
    try {
      while (!result) await writeFile(probePath, '');
      await ready;
      if (result.error) throw result.error;
    } finally {
      await rm(probePath, { force: true });
    }
  }
  await writeFile(sourcePath, initialHTML.replace('Player A', 'External Edit'));
  assert.equal((await nextNotice('template', id)).id, id);
  await writeFile(path.join(root, 'reviews', `${id}.json`), JSON.stringify({ revision: 1, notes: [] }));
  assert.equal((await nextNotice('review', id)).id, id);
  const manifestPath = path.join(root, 'templates/html-replications/manifest.json');
  await writeFile(manifestPath, await readFile(manifestPath));
  assert.equal((await nextNotice('catalog')).type, 'catalog');
  await notices.return();
  await reader.cancel();
});

test('occupied ports advance automatically and server binds only IPv4 loopback', async t => {
  const occupied = http.createServer((_, response) => response.end());
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const requested = occupied.address().port;
  const { studio } = await fixture(t, { port: requested });
  assert.ok(studio.port > requested);
  assert.equal(studio.server.address().address, '127.0.0.1');
});

test('create/start/close lifecycle is testable and rejects invalid port settings', async t => {
  const { root } = await fixture(t);
  await assert.rejects(createStudioServer({ root, port: -1 }), /Invalid Studio port/);
  const studio = await createStudioServer({ root, port: 0 });
  assert.equal(studio.url, undefined);
  await studio.start();
  assert.match(studio.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(await studio.start(), studio);
  await studio.close();
  await studio.close();
  await assert.rejects(studio.start(), /closed/);
});
