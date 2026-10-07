import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags, runtimeFields } from '../contract/index.mjs';

const directory = new URL('../templates/html-replications/', import.meta.url);
const footerRefs = [94, 95, 98, 99, 103, 104, 106, 111, 112, 116, 117];
const historyRefs = [87, 88, 89, 90];
const jerseyRefs = [84, 85, 86];
const refs = [...jerseyRefs, ...historyRefs, 91, ...footerRefs, 100, 101, 108, 145];
const names = await readdir(directory);
const fields = new Set(runtimeFields.map(f => f.field));
const binding = tag => tag.attributes['data-osb-field'] || tag.attributes['data-field']
  || (tag.attributes.class || '').split(/\s+/).some(c => fields.has(c));
const functionalTags = html => readTemplateHTMLTags(html).filter(t => !t.closing && (binding(t) || t.name === 'img')).map(t => html.slice(t.start, t.end));
const entries = await Promise.all(refs.map(async ref => {
  const name = names.find(name => name.startsWith(`ref-${String(ref).padStart(3, '0')}-`));
  assert.ok(name, `missing Ref${ref}`);
  const before = execFileSync('git', ['show', `HEAD:templates/html-replications/${name}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  return { ref, name, before, html: await readFile(new URL(name, directory), 'utf8') };
}));

const shirts = html => {
  const tags = readTemplateHTMLTags(html);
  return tags.flatMap((tag, index) => {
    if (tag.closing || !['jerseyColorA', 'jerseyColorB'].includes(tag.attributes['data-osb-field'])
      || !(tag.attributes.class || '').split(/\s+/).includes('shirt')) return [];
    const close = tags[index + 1];
    assert.ok(close?.closing && close.name === tag.name, 'shirt remains a leaf');
    return [{ tag: tag.name, attributes: tag.attributes, opening: html.slice(tag.start, tag.end), text: html.slice(tag.end, close.start) }];
  });
};

test('six unsupported jersey-number literals become empty without changing shirt tags, attributes or colors', () => {
  for (const { ref, before, html, name } of entries.filter(e => jerseyRefs.includes(e.ref))) {
    const original = shirts(before), current = shirts(html);
    assert.equal(current.length, 2, name);
    assert.deepEqual(original.map(s => s.text), ref === 84 ? ['7', '15'] : ['7', '12'], name);
    assert.deepEqual(current, original.map(s => ({ ...s, text: '' })), name);
  }
});

test('Ref084-145 trim preserves exact bound opening tags, image slots and neutral stored values', () => {
  for (const { name, before, html } of entries) {
    assert.deepEqual(functionalTags(html), functionalTags(before), name);
    assert.deepEqual(inspectTemplate(html).errors, [], name);
    assert.equal(neutralizeScoreboardTemplateHTML(html), html, name);
  }
});

test('Ref084-145 source changes are exactly the authorized static leaf removals', () => {
  for (const { ref, name, before, html } of entries) {
    const tokens = [];
    if (footerRefs.includes(ref)) tokens.push('<span class="side-label">A</span>', '<span class="side-label">B</span>');
    if (historyRefs.includes(ref)) tokens.push('<small>A</small>', '<small>B</small>');
    if (ref === 91) tokens.push('<span class="live">LIVE</span>');
    if ([100, 101, 108].includes(ref)) tokens.push(`<span class="elapsed">${ref === 108 ? '01:02:35' : '01:12:36'}</span>`);
    if (ref === 103) tokens.push('<span class="caption">FAST ATTACK</span>', '<span class="caption">POWER LOOP</span>');
    if (ref === 145) tokens.push('<span>WORLD SERIES</span>');
    let expected = before;
    if (jerseyRefs.includes(ref)) {
      for (const shirt of shirts(before)) {
        const token = `${shirt.opening}${shirt.text}</${shirt.tag}>`;
        assert.equal(expected.split(token).length - 1, 1, name);
        expected = expected.replace(token, `${shirt.opening}</${shirt.tag}>`);
      }
    }
    for (const token of tokens) {
      assert.equal(expected.split(token).length - 1, 1, `${name}: unique unbound leaf ${token}`);
      expected = expected.replace(token, '');
    }
    // apply_patch terminates text files; Ref145 was the sole unterminated source.
    if (!before.endsWith('\n')) expected += '\n';
    assert.equal(html, expected, `${name}: changed bytes outside authorized leaves or failed to trim`);
  }
});
