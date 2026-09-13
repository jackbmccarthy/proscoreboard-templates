import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_ROOT, buildCatalog } from './build-catalog.mjs';
import { CORE_FIELDS, inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags, validateSafeScoreboardTemplateDocument } from '../contract/index.mjs';
import baseline from './fixtures/extraction-baseline.json' with { type: 'json' };

const templateDirectory = path.join(DEFAULT_ROOT, 'templates/html-replications');
const manifest = JSON.parse(await readFile(path.join(templateDirectory, 'manifest.json'), 'utf8'));
const sourceFor = (entry) => readFile(path.join(DEFAULT_ROOT, 'templates', entry.output), 'utf8');
const hasClass = (tag, name) => (tag.attributes.class || '').split(/\s+/).includes(name);
const activeEntries = (entries) => entries.filter((entry) => !entry.retired && entry.published !== false);
const active = activeEntries(manifest);
const archivedSeeds = (entries, extraction = baseline) => entries.filter((entry) => entry.retired && extraction.legacySeeds.includes(path.basename(entry.output)));

function assertManifestPreservation(entries, files, extraction = baseline) {
  const names = entries.map((entry) => path.basename(entry.output));
  assert.equal(new Set(names).size, names.length, 'duplicate manifest filenames');
  for (const name of extraction.fileNames) assert.ok(names.includes(name), `extraction baseline must be retained: ${name}`);
  assert.deepEqual([...files].sort(), [...names].sort(), 'every present HTML file must match the manifest');
  const references = entries.filter((entry) => entry.referenceID !== undefined).map((entry) => entry.referenceID);
  assert.equal(new Set(references).size, references.length, 'reference IDs must be unique');
  assert.ok(entries.filter((entry) => entry.retired).every((entry) => entry.published !== true), 'retired entries cannot remain published');
}

test('catalog retains extraction baseline IDs while allowing additions and publication-state changes', async () => {
  const { catalog } = await buildCatalog({ check: true });
  const files = (await readdir(templateDirectory)).filter((name) => name.endsWith('.html')).sort();
  assertManifestPreservation(manifest, files);
  assert.deepEqual(catalog.templates.map((entry) => entry.fileName).sort(), files);
  assert.deepEqual(activeEntries(catalog.templates).map((entry) => entry.fileName).sort(), active.map((entry) => path.basename(entry.output)).sort());
});

test('all corpus HTML is neutral, idempotent, inspectable and byte-preserved in published documents', async () => {
  const catalog = JSON.parse(await readFile(path.join(DEFAULT_ROOT, 'catalog.json'), 'utf8'));
  for (const entry of catalog.templates) {
    const source = await sourceFor(entry);
    const document = JSON.parse(await readFile(path.join(DEFAULT_ROOT, entry.documentPath), 'utf8'));
    assert.equal(document.html, source, entry.fileName);
    assert.ok(Buffer.from(document.html).equals(await readFile(path.join(DEFAULT_ROOT, 'templates', entry.output))), entry.fileName);
    assert.equal(document.css, '', entry.fileName);
    validateSafeScoreboardTemplateDocument(document);
    if (!entry.retired && entry.published !== false) assert.deepEqual(inspectTemplate(source).errors, [], entry.fileName);
    const neutral = neutralizeScoreboardTemplateHTML(source);
    assert.equal(neutral, source, `${entry.fileName}: baked-in live value`);
    assert.equal(neutralizeScoreboardTemplateHTML(neutral), neutral, `${entry.fileName}: not idempotent`);
  }
});

function assertPointSemantics(source, label) {
  const tags = readTemplateHTMLTags(source);
  const elements = tags.filter((tag) => !tag.closing);
  const parents = new Map();
  const stack = [];
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  for (const tag of tags) {
    if (tag.closing) {
      const index = stack.findLastIndex((open) => open.name === tag.name);
      if (index >= 0) stack.length = index;
    } else {
      parents.set(tag, stack.at(-1));
      if (!voidTags.has(tag.name)) stack.push(tag);
    }
  }
  const nodes = ['isGamePoint', 'isMatchPoint'].map((field) => {
    const matches = elements.filter((tag) => hasClass(tag, field));
    assert.equal(matches.length, 1, `${label}: exactly one ${field}`);
    const node = matches[0];
    assert.equal(node.attributes['data-osb-field'], field, label);
    assert.match(node.attributes.style || '', /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(?:;|$)/i, `${label}: point label starts hidden`);
    assert.ok(!Object.hasOwn(node.attributes, 'isa') && !hasClass(node, 'isACurrentlyServing') && !hasClass(node, 'isBCurrentlyServing'), `${label}: point state must be neutral`);
    return node;
  });
  const slot = parents.get(nodes[0]);
  assert.ok(slot && slot === parents.get(nodes[1]), `${label}: point labels must be siblings in a shared slot`);
  const css = tags.filter((tag) => !tag.closing && tag.name === 'style' && !/\bprint\b/i.test(tag.attributes.media || '')).map((tag) => {
    const close = tags.find((candidate) => candidate.closing && candidate.name === 'style' && candidate.start >= tag.end);
    return source.slice(tag.end, close.start);
  }).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, declarations]) => ({ selector, declarations }));
  const slotClasses = (slot.attributes.class || '').split(/\s+/).filter(Boolean);
  const targetsLabels = (selector) => /\.is(?:Game|Match)Point\b/.test(selector)
    || slotClasses.some((name) => selector.includes(`.${name}`)) && nodes.some((node) => new RegExp(`(?:>|\\s)${node.name}\\b`).test(selector));
  const activeMatch = /:has\([^{}]*\.isMatchPoint\b[^{}]*opacity\s*:\s*1[^{}]*\)[^{}]*\.isGamePoint\b/;
  assert.ok(rules.some(({ selector, declarations }) => activeMatch.test(selector)
    && /(?:^|;)\s*(?:opacity\s*:\s*0\s*!important|visibility\s*:\s*hidden|display\s*:\s*none)\s*(?:!important\s*)?(?:;|$)/i.test(declarations)), `${label}: active match point must take precedence over game point`);
  const motion = rules.filter(({ selector }) => targetsLabels(selector));
  const animated = motion.some(({ declarations }) => /(?:^|;)\s*(?:transition|animation)(?:-\w+)?\s*:/i.test(declarations)
    && /(?:\d*\.)?\d+(?:ms|s)\b/.test(declarations));
  if (animated) {
    const reducedBlocks = [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{([\s\S]*?)\}\s*\}/gi)].map((match) => match[1] + '}');
    assert.ok(reducedBlocks.some((block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selector, declarations]) => targetsLabels(selector)
      && /(?:^|;)\s*(?:transition|animation)\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i.test(declarations))), `${label}: animated point labels must honor reduced motion`);
  }
}

test('active templates retain shared neutral point states, match-point precedence and reduced-motion behavior', async () => {
  for (const entry of active) assertPointSemantics(await sourceFor(entry), entry.output);
});

test('active templates use unique combined competitor names with unambiguous live bindings', async () => {
  for (const entry of active) {
    const elements = readTemplateHTMLTags(await sourceFor(entry)).filter((tag) => !tag.closing);
    for (const field of ['combinedAName', 'combinedBName']) {
      const labels = elements.filter((tag) => hasClass(tag, field));
      assert.equal(labels.length, 1, `${entry.output}: ${field}`);
      assert.equal(labels[0].attributes['data-osb-field'], field);
      assert.ok(!(labels[0].attributes.class || '').split(/\s+/).some((name) => /^player[AB]2?$/.test(name)), entry.output);
    }
  }
});

test('archived extraction seeds preserve native hierarchy, bindings, service sides and transparent surfaces', async () => {
  const legacy = archivedSeeds(manifest);
  for (const entry of legacy) {
    const source = await sourceFor(entry);
    for (const expression of [/osb-render-stage/, /<style/, /osb-paired-surface[^"']*rowContainer/,
      /osb-field-stack osb-name-stack columnContainer/, /osb-field-stack osb-current-score-stack columnContainer/,
      /osb-field-stack osb-service-stack columnContainer/, /isACurrentlyServing[^>]*isA="true"/, /isBCurrentlyServing/,
      /body\s*\{[\s\S]*?background:\s*transparent;/]) assert.match(source, expression, entry.output);
    assert.doesNotMatch(source, /isA="false"/);
    assert.doesNotMatch(source, /repeating-(?:linear|conic|radial)-gradient|checker(?:ed|board)?/i);
    const elements = readTemplateHTMLTags(source).filter((tag) => !tag.closing);
    for (const element of elements.filter((tag) => tag.attributes['data-osb-field'])) assert.ok(hasClass(element, element.attributes['data-osb-field']), entry.output);
    const fields = ['combinedAName', 'combinedBName', 'currentAGameScore', 'currentBGameScore', 'currentAMatchScore', 'currentBMatchScore', 'jerseyColorA', 'jerseyColorB', 'isACurrentlyServing', 'isBCurrentlyServing'];
    if (entry.placement !== 'corner') for (let game = 1; game <= 9; game++) fields.push(`isGame${game}Started`, `game${game}AScore`, `game${game}BScore`);
    for (const field of fields) assert.equal(elements.filter((tag) => tag.attributes['data-osb-field'] === field).length, 1, `${entry.output}: ${field}`);
  }
});

test('public corpus excludes original images, reference images and archive metadata', async () => {
  const rootFiles = await readdir(DEFAULT_ROOT);
  assert.ok(!rootFiles.includes('sources'));
  assert.ok(!(await readdir(path.join(DEFAULT_ROOT, 'templates'))).includes('references'));
  for (const entry of manifest) {
    for (const key of ['source', 'sourceHash', 'referenceImage', 'referenceHash']) {
      assert.equal(entry[key], undefined, `${entry.output}: excluded original-image metadata`);
    }
    assert.doesNotMatch(await sourceFor(entry), /(?:scoreboard-templates\/references\/|scoreboardtemplates\/)/);
  }
});

const restyledPointCSS = `
.review-slot > b { color: #237867; transition: opacity 240ms ease; }
.review-slot:has(> .isMatchPoint[style*="opacity: 1"]) > .isGamePoint { opacity: 0 !important; }
@media (prefers-reduced-motion: reduce) {
  .review-slot > b { transition: none !important; }
}`;
const futureHTML = `<!doctype html><html><head><style>body { background: transparent; }${restyledPointCSS}</style></head><body>
${CORE_FIELDS.map((field) => `<span class="${field}" data-osb-field="${field}">${field.includes('Score') ? '0' : ''}</span>`).join('')}
<i class="isACurrentlyServing" isA="true"></i><i class="isBCurrentlyServing"></i>
<aside class="review-slot"><b class="isGamePoint" data-osb-field="isGamePoint" style="opacity: 0;">GAME POINT</b><b class="isMatchPoint" data-osb-field="isMatchPoint" style="opacity: 0;">MATCH POINT</b></aside>
</body></html>`;

test('future additions, publication, reference retirement and restyling satisfy preservation checks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'corpus-evolution-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'templates/html-replications');
  await mkdir(directory, { recursive: true });
  const extraction = { fileNames: ['original-template.html'], legacySeeds: [] };
  const entries = [{ output: 'html-replications/original-template.html', referenceID: 1, published: true }];
  const verify = async () => {
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(entries));
    await buildCatalog({ root });
    const { catalog } = await buildCatalog({ root, check: true });
    const files = (await readdir(directory)).filter((name) => name.endsWith('.html'));
    assertManifestPreservation(catalog.templates, files, extraction);
    for (const entry of activeEntries(catalog.templates)) {
      const source = await readFile(path.join(directory, entry.fileName), 'utf8');
      assert.deepEqual(inspectTemplate(source).errors, []);
      assert.equal(neutralizeScoreboardTemplateHTML(source), source);
      assertPointSemantics(source, entry.fileName);
    }
    return catalog;
  };
  await writeFile(path.join(directory, 'original-template.html'), futureHTML);
  await verify();
  entries.push({ output: 'html-replications/new-template.html', published: false });
  await writeFile(path.join(directory, 'new-template.html'), futureHTML.replace('#237867', '#a84064'));
  assert.equal(activeEntries((await verify()).templates).length, 1);
  entries[1].published = true;
  assert.equal(activeEntries((await verify()).templates).length, 2);
  entries[0].published = false;
  entries[0].retired = true;
  const retired = await verify();
  assert.deepEqual(activeEntries(retired.templates).map((entry) => entry.fileName), ['new-template.html']);
  entries[1].retired = true;
  entries[1].published = false;
  assert.equal(activeEntries((await verify()).templates).length, 0);
  assert.deepEqual(archivedSeeds(entries, extraction), [], 'new non-reference templates are not legacy extraction seeds');
  assert.throws(() => assertManifestPreservation(entries.slice(1), ['new-template.html'], extraction), /baseline must be retained/);
  assert.throws(() => assertManifestPreservation(entries, ['original-template.html'], extraction), /every present HTML/);
});

test('point semantics detect regressions without requiring historical CSS bytes or animation timing', () => {
  assertPointSemantics(futureHTML, 'restyled fixture');
  assertPointSemantics(futureHTML.replace('opacity 240ms ease', 'opacity 350ms linear'), 'different motion timing');
  assertPointSemantics(futureHTML.replace('transition: opacity 240ms ease;', 'transition: none;').replace(/@media[^]*?\n\}/, ''), 'no motion needs no override');
  assert.throws(() => assertPointSemantics(futureHTML.replace('opacity: 0 !important;', 'opacity: 1;'), 'broken precedence'), /precedence/);
  assert.throws(() => assertPointSemantics(futureHTML.replace('prefers-reduced-motion: reduce', 'prefers-reduced-motion: no-preference'), 'broken reduced motion'), /reduced motion/);
  assert.throws(() => assertPointSemantics(futureHTML.replace('style="opacity: 0;"', 'style="opacity: 1;"'), 'visible idle'), /starts hidden/);
  assert.throws(() => assertPointSemantics(futureHTML.replace('<b class="isMatchPoint"', '</aside><aside><b class="isMatchPoint"'), 'split slots'), /shared slot/);
});
