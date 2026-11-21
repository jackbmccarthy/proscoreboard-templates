import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GOOGLE_FONT_AGENT, googleFontCacheKey, googleFontResponse, isGoogleFontURL } from './google-font-cache.mjs';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@700&display=swap';

test('only Google Fonts stylesheets and font files are recognised', () => {
  for (const url of [CSS_URL, 'https://fonts.googleapis.com/css?family=Roboto', 'https://fonts.gstatic.com/s/robotoslab/v1/a.woff2']) assert.ok(isGoogleFontURL(url), url);
  for (const url of ['http://fonts.googleapis.com/css2?family=Roboto', 'https://fonts.googleapis.com/icon?family=Material+Icons', 'https://fonts.googleapis.com.evil.example/css2', 'https://user@fonts.gstatic.com/a.woff2', 'https://fonts.gstatic.com:8443/a.woff2', 'https://example.invalid/css2']) assert.ok(!isGoogleFontURL(url), url);
});

test('a Google Fonts response is fetched once with the fixed agent, then served byte-identically from the cache', async t => {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'google-font-cache-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const calls = [];
  const fetcher = async (href, options) => { calls.push({ href, agent: options.headers['user-agent'] }); return new Response('@font-face{font-family:"Roboto Slab"}', { headers: { 'content-type': 'text/css; charset=utf-8' } }); };
  const first = await googleFontResponse(CSS_URL, { cache, fetcher, offline: false });
  assert.equal(first.cached, false);
  const second = await googleFontResponse(CSS_URL, { cache, fetcher, offline: true });
  assert.equal(second.cached, true);
  assert.ok(first.body.equals(second.body));
  assert.equal(second.contentType, 'text/css; charset=utf-8');
  assert.deepEqual(calls, [{ href: CSS_URL, agent: GOOGLE_FONT_AGENT }]);
  assert.deepEqual((await readdir(cache)).sort(), [`${googleFontCacheKey(CSS_URL)}.body`, `${googleFontCacheKey(CSS_URL)}.json`]);
  await writeFile(path.join(cache, `${googleFontCacheKey(CSS_URL)}.body`), 'tampered');
  await assert.rejects(() => googleFontResponse(CSS_URL, { cache, fetcher, offline: true }), /corrupt/);
});

test('offline or failing with no cached copy fails clearly and caches nothing', async t => {
  const cache = await mkdtemp(path.join(os.tmpdir(), 'google-font-cache-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const never = async () => { throw new Error('network must not be used offline'); };
  await assert.rejects(() => googleFontResponse(CSS_URL, { cache, fetcher: never, offline: true }), /is not cached in .* \(OSB_GOOGLE_FONT_OFFLINE=1\); run once online to fill the cache/);
  await assert.rejects(() => googleFontResponse(CSS_URL, { cache, fetcher: async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, offline: false }), /could not be fetched \(ENOTFOUND\)/);
  await assert.rejects(() => googleFontResponse(CSS_URL, { cache, fetcher: async () => new Response('', { status: 400 }), offline: false }), /returned 400/);
  await assert.rejects(() => googleFontResponse('https://example.invalid/font.woff2', { cache, fetcher: never }), /Not a Google Fonts URL/);
  assert.deepEqual(await readdir(cache), []);
});
