import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Templates may use Google Fonts (`@import url("https://fonts.googleapis.com/css2?...")`; owner rule,
// 2026-11-20). Previews must still be deterministic and must not depend on the network after the first
// run, so each Google Fonts response (stylesheet or font file) is fetched once with a fixed Chrome user
// agent (Google varies the stylesheet by agent) and served from an on-disk cache thereafter. The cache is
// local state (`.template-cache/`, gitignored, never exported). Offline with no cached copy is an error
// naming the request. Mirrors the server repo's scripts/qa/template-transparency.mjs cache.
export const GOOGLE_FONT_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_BYTES = 8_000_000;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export const googleFontCacheDirectory = root => process.env.OSB_GOOGLE_FONT_CACHE || path.join(root, '.template-cache/google-fonts');
export const googleFontOffline = () => process.env.OSB_GOOGLE_FONT_OFFLINE === '1';

/** Whether a URL is a Google Fonts stylesheet (fonts.googleapis.com/css or /css2) or font file (fonts.gstatic.com). */
export function isGoogleFontURL(value) {
  const url = value instanceof URL ? value : new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && ((url.hostname === 'fonts.googleapis.com' && /^\/css2?$/.test(url.pathname)) || url.hostname === 'fonts.gstatic.com');
}

export const googleFontCacheKey = href => sha256(href).slice(0, 40);

/** A Google Fonts response from the cache, fetching and caching it once when absent. Throws when it cannot be had. */
export async function googleFontResponse(href, { cache, fetcher = fetch, offline = googleFontOffline() } = {}) {
  if (!cache) throw new Error('Google Fonts cache directory is required.');
  if (!isGoogleFontURL(href)) throw new Error(`Not a Google Fonts URL: ${href}`);
  const key = googleFontCacheKey(href), bodyPath = path.join(cache, `${key}.body`), metaPath = path.join(cache, `${key}.json`);
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8')), body = await readFile(bodyPath);
    if (meta.url !== href || meta.sha256 !== sha256(body)) throw new Error(`Google Fonts cache entry ${key} in ${cache} is corrupt; delete it and run once online`);
    return { status: 200, contentType: meta.contentType, body, cached: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let response;
  try {
    if (offline) throw new Error('OSB_GOOGLE_FONT_OFFLINE=1');
    response = await fetcher(href, { headers: { 'user-agent': GOOGLE_FONT_AGENT }, redirect: 'error' });
  } catch (error) {
    throw new Error(`Google Fonts request ${href} is not cached in ${cache} and could not be fetched (${error.cause?.code || error.message}); run once online to fill the cache`);
  }
  if (!response.ok) throw new Error(`Google Fonts returned ${response.status} for ${href}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_BYTES) throw new Error(`Google Fonts response exceeds size bound: ${href}`);
  const contentType = response.headers.get('content-type') || (new URL(href).hostname === 'fonts.gstatic.com' ? 'font/woff2' : 'text/css; charset=utf-8');
  await mkdir(cache, { recursive: true });
  for (const [target, bytes] of [[bodyPath, body], [metaPath, `${JSON.stringify({ url: href, contentType, bytes: body.length, sha256: sha256(body) }, null, 2)}\n`]]) {
    const temporary = `${target}.${process.pid}.tmp`;
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { status: 200, contentType, body, cached: false };
}
