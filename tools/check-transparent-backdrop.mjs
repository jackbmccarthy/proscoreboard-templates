// Transparent page backdrop (owner rule, 2026-11-18): a scoreboard is composited over live video, so everything BEHIND the
// scoreboard must be transparent: the html, :root and body backgrounds, and any wrapper/stage/canvas element that covers the
// page. "If you load the template in a browser and the entire page in the browser is black, that means we have a background
// color." The scoreboard's own panels, bars, chips, cards and conditional components keep their colours.
//
// This is the static, dependency-free half of the gate (the rendered, pixel half is the server repository's
// scripts/qa/template-transparency.mjs, which renders every published template through the real output page). It reads the
// embedded CSS and flags:
//   - a rule whose subject is html, :root or body (or their ::before/::after) that paints a background, box-shadow or
//     backdrop-filter;
//   - a rule that paints those on an element the CSS makes viewport-sized (position:fixed with inset 0, or 100vw by 100vh);
//   - an inline style attribute on <html>, <body> or <main> that paints.
// A design whose whole frame is the graphic (an intentional full-bleed board) needs an owner decision recorded in
// tools/transparent-backdrop-exemptions.json, bound to its content hash so any edit ends the exemption.
//
//   node tools/check-transparent-backdrop.mjs            check every active published template (exit 1 on a violation)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAINT = ['background', 'background-color', 'background-image', 'box-shadow', 'backdrop-filter', '-webkit-backdrop-filter'];
const CLEAR = /^(?:transparent|none|initial|unset|inherit|revert|revert-layer|rgba\([^)]*,\s*0(?:\.0+)?\s*\)|#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)|(?:transparent|none)\s*!important)$/i;

/** Flat `{selectors, declarations}` rules from CSS text, descending into @media/@supports/@layer/@container blocks. */
export function parseRules(css) {
  const rules = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (source) => {
    let index = 0;
    while (index < source.length) {
      const open = source.indexOf('{', index);
      if (open < 0) break;
      const prelude = source.slice(index, open).trim();
      let depth = 1, cursor = open + 1, quote = '';
      for (; cursor < source.length && depth; cursor++) {
        const char = source[cursor];
        if (quote) { if (char === quote && source[cursor - 1] !== '\\') quote = ''; continue; }
        if (char === '"' || char === "'") quote = char;
        else if (char === '{') depth++;
        else if (char === '}') depth--;
      }
      const body = source.slice(open + 1, cursor - 1);
      if (/^@(?:media|supports|layer|container|document)\b/i.test(prelude)) walk(body);
      else if (!prelude.startsWith('@')) {
        const declarations = {};
        for (const part of body.split(/;(?![^(]*\))/)) {
          const colon = part.indexOf(':');
          if (colon < 0) continue;
          declarations[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
        }
        rules.push({ selectors: splitSelectors(prelude), declarations });
      }
      index = cursor;
    }
  };
  walk(text);
  return rules;
}

function splitSelectors(prelude) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < prelude.length; i++) {
    if (prelude[i] === '(' || prelude[i] === '[') depth++;
    else if (prelude[i] === ')' || prelude[i] === ']') depth--;
    else if (prelude[i] === ',' && !depth) { out.push(prelude.slice(start, i).trim()); start = i + 1; }
  }
  out.push(prelude.slice(start).trim());
  return out.filter(Boolean);
}

/** The last compound selector (the element the rule styles), without its functional pseudo-class arguments. */
export function subjectOf(selector) {
  let depth = 0, start = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (!depth && (char === ' ' || char === '>' || char === '+' || char === '~')) start = i + 1;
  }
  return selector.slice(start).replace(/\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '()').trim();
}

const isPageRoot = (subject) => /^(?:html|body)(?![\w-])|^:root(?![\w-])/i.test(subject);

function painting(declarations) {
  return PAINT.filter((property) => property in declarations && !CLEAR.test(declarations[property].replace(/\s*!important$/i, '').trim())
    && !(property === 'background' && /^(?:transparent|none)(?:\s+!important)?$/i.test(declarations[property])))
    .map((property) => `${property}: ${declarations[property]}`);
}

// Only the viewport is known statically: position:fixed with inset 0, or 100vw by 100vh. (position:absolute/inset 0 or 100%
// sizes fill an unknown containing block, usually a scoreboard panel; the rendered gate measures those.)
function pageSized(declarations) {
  const zero = (value) => /^0(?:px|%|vh|vw|rem|em)?$/.test(String(value || '').trim());
  const fixed = /^fixed\b/.test(declarations.position || '');
  const inset = declarations.inset ? declarations.inset.split(/\s+/).every(zero) : ['top', 'right', 'bottom', 'left'].every((side) => zero(declarations[side]));
  const viewport = /^100vw\b/.test(declarations.width || '') && (/^100(?:d|s|l)?vh\b/.test(declarations.height || '') || /^100(?:d|s|l)?vh\b/.test(declarations['min-height'] || ''));
  return (fixed && inset) || viewport;
}

/** Backdrop violations of one HTML document (CSS embedded in <style> elements and style attributes). */
export function findBackdropViolations(html) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
  const rules = parseRules(css);
  const violations = [];
  // aggregate declarations per selector so a page-sized `.stage` split over several rules is still recognised
  const merged = new Map();
  for (const rule of rules) for (const selector of rule.selectors) merged.set(selector, { ...merged.get(selector), ...rule.declarations });
  const pageSelectors = new Set([...merged].filter(([, declarations]) => pageSized(declarations)).map(([selector]) => selector.replace(/::?(?:before|after)$/, '')));
  for (const rule of rules) {
    const paints = painting(rule.declarations);
    if (!paints.length) continue;
    for (const selector of rule.selectors) {
      const subject = subjectOf(selector);
      const base = selector.replace(/::?(?:before|after)$/, '');
      if (isPageRoot(subject)) violations.push({ selector, reason: 'page root paints', paints });
      else if (pageSelectors.has(base) || pageSelectors.has(selector)) violations.push({ selector, reason: 'page-sized element paints', paints });
    }
  }
  for (const match of html.matchAll(/<(html|body|main)\b[^>]*\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const declarations = parseRules(`x{${match[3] ?? match[4]}}`)[0]?.declarations || {};
    const paints = painting(declarations);
    if (paints.length) violations.push({ selector: `<${match[1].toLowerCase()} style>`, reason: 'page root inline style paints', paints });
  }
  return violations;
}

export async function loadExemptions(root = ROOT) {
  const data = JSON.parse(await readFile(path.join(root, 'tools/transparent-backdrop-exemptions.json'), 'utf8'));
  return new Map(data.exemptions.map((entry) => [entry.fileName, entry]));
}

/** Every active published catalog entry checked against its authored source; exemptions must match the current content hash. */
export async function checkCatalog(root = ROOT) {
  const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
  const exemptions = await loadExemptions(root);
  const results = [];
  for (const entry of catalog.templates.filter((template) => template.published !== false && !template.retired)) {
    const html = await readFile(path.join(root, 'templates', entry.output), 'utf8');
    const violations = findBackdropViolations(html);
    const exemption = exemptions.get(entry.fileName);
    const exempt = Boolean(exemption && exemption.contentHash === entry.contentHash);
    results.push({ fileName: entry.fileName, contentHash: entry.contentHash, violations, exempt, staleExemption: Boolean(exemption && !exempt) });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await checkCatalog();
  let failed = 0;
  for (const result of results) {
    if (!result.violations.length && !result.staleExemption) continue;
    if (result.exempt) { console.log(`exempt (owner decision recorded): ${result.fileName}`); continue; }
    failed++;
    console.log(`FAIL ${result.fileName}${result.staleExemption ? ' (exemption is for other content: re-review)' : ''}`);
    for (const violation of result.violations) console.log(`  ${violation.selector}: ${violation.reason} (${violation.paints.join('; ')})`);
  }
  console.log(`${results.length} active templates, ${failed} with a painted page backdrop.`);
  process.exitCode = failed ? 1 : 0;
}
