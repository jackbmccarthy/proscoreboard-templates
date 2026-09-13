const $ = (id) => document.getElementById(id);
const state = { token: '', catalog: [], template: null, raw: '', baseline: '', notes: [], savedNotes: '[]', selected: null, editing: null, archived: false, zoom: null, loading: false, saving: false, conflicted: false };
const icons = {
  close: ['M6 6l12 12', 'M18 6L6 18'], plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  monitor: ['M4 5h16v11H4z', 'M8 21h8', 'M12 16v5'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M7 7l1 14h8l1-14', 'M10 11v6', 'M14 11v6'],
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of icons[name] || []) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
document.querySelectorAll('[data-icon]').forEach((el) => el.append(icon(el.dataset.icon)));
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const sourceDirty = () => Boolean(state.template) && $('source').value !== state.baseline;
const notesDirty = () => JSON.stringify(state.notes) !== state.savedNotes;
const draftDirty = () => Boolean($('note-text').value.trim());
const dirty = () => sourceDirty() || notesDirty() || draftDirty();
function notice(message, reload = false, success = false) {
  $('notice-text').textContent = message; $('notice').hidden = false;
  $('notice').classList.toggle('success', success); $('reload').hidden = !reload;
}
function updateDirty() {
  $('unsaved').hidden = !dirty();
  $('dirty-detail').textContent = [sourceDirty() && 'Source', notesDirty() && 'Review notes', draftDirty() && 'Note draft'].filter(Boolean).join(' / ');
  $('save-source').disabled = !sourceDirty() || state.loading || state.saving || state.conflicted;
  $('save-notes').disabled = !notesDirty() || state.loading || state.saving || state.conflicted;
  $('add-note').disabled = !state.template || state.loading || state.saving;
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'PUT', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Studio-Token': state.token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) { const error = new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || payload.message || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return payload.data ?? payload;
}
function fail(error) {
  if (error.status === 409) { state.conflicted = true; notice('This file or review changed on disk. Your changes are still here. Reload latest before saving; nothing was overwritten.', true); }
  else notice(error.message || 'Request failed. Your changes are still here.');
  updateDirty();
}
function renderCatalog() {
  const query = $('search').value.trim().toLowerCase();
  const visible = state.catalog.filter((t) => Boolean(t.retired) === state.archived && `${t.title} ${t.fileName} ${t.placement} ${t.id}`.toLowerCase().includes(query));
  $('template-count').textContent = `${visible.length} / ${state.catalog.length}`;
  $('template-list').replaceChildren();
  for (const template of visible) {
    const button = node('button', 'template-item'); button.type = 'button'; button.dataset.id = template.id;
    button.setAttribute('aria-current', String(state.template?.id === template.id));
    const body = node('span', 'item-body'); body.append(node('span', 'item-title', template.title || template.fileName));
    body.append(node('span', 'item-meta', [template.placement, template.published ? 'Published' : 'Unpublished'].filter(Boolean).join(' · ')));
    const swatches = node('span', 'swatches');
    const palette = Array.isArray(template.palette) ? template.palette : Object.values(template.palette || {});
    for (const color of palette.slice(0, 6)) { if (typeof color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(color)) continue; const swatch = node('span', 'swatch'); swatch.style.backgroundColor = color; swatches.append(swatch); }
    body.append(swatches); button.append(body); button.addEventListener('click', () => loadTemplate(template.id)); $('template-list').append(button);
  }
  if (!visible.length) $('template-list').append(node('div', 'empty', 'No matching templates'));
}
function safeResourceURL(value) {
  if (!value) return null;
  try { const url = new URL(value, location.href); return url.origin === location.origin || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
async function loadTemplate(id, force = false) {
  if (state.loading || state.saving || (!force && id === state.template?.id)) return;
  if (dirty() && !confirm('Discard unsaved source changes, review notes, and note draft?')) return;
  state.loading = true; updateDirty();
  try {
    const result = await api(`/api/template?id=${encodeURIComponent(id)}`);
    const template = result.template ?? result;
    if (typeof template.html !== 'string' || !template.hash) throw new Error('The template response is missing source or hash.');
    state.template = template; state.raw = template.html; $('source').value = template.html; state.baseline = $('source').value;
    state.notes = structuredClone(template.review?.notes || []); state.savedNotes = JSON.stringify(state.notes); state.conflicted = false;
    $('template-title').textContent = template.title || state.catalog.find((t) => t.id === id)?.title || template.fileName;
    $('template-meta').textContent = template.fileName;
    $('source-hash').textContent = `SHA ${template.hash.slice(0, 12)}`;
    const meta = state.catalog.find((t) => t.id === id) || template;
    $('publication').hidden = false; $('publication').textContent = meta.retired ? 'Archived' : meta.published ? 'Published' : 'Unpublished'; $('publication').classList.toggle('archived', Boolean(meta.retired));
    $('export').href = `/api/brief?id=${encodeURIComponent(id)}`;
    const reference = safeResourceURL(template.referenceURL || meta.referenceURL);
    $('reference-toggle').disabled = !reference; $('reference-toggle').checked = false; $('reference').hidden = true; $('preview').style.visibility = 'visible';
    if (reference) $('reference').src = reference; else $('reference').removeAttribute('src');
    $('notice').hidden = true; resetNoteForm(); clearSelection(); renderCatalog(); renderNotes(); renderPreview();
  } catch (error) { fail(error); } finally { state.loading = false; updateDirty(); }
}

// This serialization is exclusively a disposable preview. Source saves use the raw textarea.
function previewDocument(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,frame,frameset,object,embed,base,meta[http-equiv],link[rel="import"],link[rel="modulepreload"],link[rel="preload"]').forEach((el) => el.remove());
  for (const el of doc.querySelectorAll('*')) {
    for (const attribute of [...el.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['srcdoc', 'autofocus', 'formaction', 'action', 'target', 'ping'].includes(name)) el.removeAttribute(attribute.name);
      if (['href', 'src', 'xlink:href'].includes(name) && /^\s*(javascript|vbscript):/i.test(attribute.value)) el.removeAttribute(attribute.name);
    }
  }
  const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' 'self' https:; img-src 'self' https: data:; font-src 'self' https: data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
  doc.head.prepend(csp);
  const base = doc.createElement('base');
  const assetBase = safeResourceURL(state.template.resourceBaseURL || state.template.baseURL || '/');
  base.href = assetBase && new URL(assetBase).origin === location.origin ? assetBase : `${location.origin}/`;
  doc.head.insertBefore(base, csp.nextSibling);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
function renderPreview() {
  clearSelection(); $('preview-status').textContent = 'Scripts disabled';
  $('preview').srcdoc = previewDocument(state.raw);
}
$('preview').addEventListener('load', () => {
  if (!state.template) return;
  const doc = $('preview').contentDocument;
  if (!doc) return;
  const originals = new WeakMap();
  for (const el of doc.querySelectorAll('*')) originals.set(el, el.outerHTML);
  state.originals = originals;
  const defaults = state.template.previewDefaults || { combinedAName: 'Player A', combinedBName: 'Player B', currentAGameScore: 0, currentBGameScore: 0, currentAMatchScore: 0, currentBMatchScore: 0 };
  for (const el of doc.querySelectorAll('[data-osb-field]')) {
    const field = el.getAttribute('data-osb-field');
    if (!Object.hasOwn(defaults, field) || el.children.length || ['IMG', 'INPUT', 'SELECT', 'TEXTAREA', 'STYLE', 'LINK', 'META'].includes(el.tagName)) continue;
    const value = defaults[field];
    if (typeof value === 'number' || value === 'Player A' || value === 'Player B') el.textContent = String(value);
  }
  doc.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); if (event.target instanceof doc.defaultView.Element) selectElement(event.target); }, true);
  doc.addEventListener('auxclick', (event) => event.preventDefault(), true);
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  doc.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') event.preventDefault(); }, true);
  doc.addEventListener('scroll', positionOutline, true);
  fitPreview();
});
function fitPreview() {
  const viewport = $('preview-viewport');
  const padding = parseFloat(getComputedStyle(viewport).padding) * 2 + 2;
  const fit = Math.max(.05, Math.min((viewport.clientWidth - padding) / 1280, (viewport.clientHeight - padding) / 720));
  const scale = state.zoom || fit;
  $('preview-stage').style.transform = `scale(${scale})`;
  $('preview-size').style.width = `${1280 * scale}px`; $('preview-size').style.height = `${720 * scale}px`;
  $('zoom-value').value = `${Math.round(scale * 100)}%`; $('zoom-value').textContent = `${Math.round(scale * 100)}%`;
}
new ResizeObserver(fitPreview).observe($('preview-viewport'));
function selectorFor(el) {
  const doc = el.ownerDocument;
  if (el.id && doc.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
  const parts = [];
  for (let current = el; current && current.nodeType === 1; current = current.parentElement) {
    let part = current.tagName.toLowerCase();
    if (current.id) part += `#${CSS.escape(current.id)}`;
    else if (current.classList.length) part += [...current.classList].slice(0, 3).map((c) => `.${CSS.escape(c)}`).join('');
    if (current.parentElement) { const siblings = [...current.parentElement.children].filter((s) => s.tagName === current.tagName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`; }
    parts.unshift(part); const selector = parts.join(' > ');
    try { if (doc.querySelectorAll(selector).length === 1) return selector; } catch { /* Continue with the parent path. */ }
  }
  return parts.join(' > ');
}
function authoredCSS(el) {
  const matched = []; let inaccessible = 0;
  function visit(rules) {
    for (const rule of rules) {
      if (rule.selectorText) { try { if (el.matches(rule.selectorText)) matched.push(rule.cssText); } catch { /* Pseudo-elements cannot be directly selected. */ } }
      else if (rule.cssRules) { visit(rule.cssRules); }
      else if (rule.styleSheet) { try { visit(rule.styleSheet.cssRules); } catch { inaccessible++; } }
    }
  }
  for (const sheet of el.ownerDocument.styleSheets) { try { visit(sheet.cssRules); } catch { inaccessible++; } }
  if (el.hasAttribute('style')) matched.push(`/* Inline */\n${el.getAttribute('style')}`);
  if (inaccessible) matched.push(`/* ${inaccessible} cross-origin stylesheet(s) unavailable to inspection. */`);
  return matched.join('\n\n');
}
function selectElement(el) {
  const computed = el.ownerDocument.defaultView.getComputedStyle(el);
  const css = authoredCSS(el);
  state.selected = { element: el, selector: selectorFor(el), elementHTML: (state.originals.get(el) || el.outerHTML).slice(0, 12000), classes: [...el.classList], field: el.getAttribute('data-osb-field') || '', css, sourceHash: state.template.hash };
  $('selection-empty').hidden = true; $('selection-details').hidden = false; $('clear-selection').disabled = false;
  $('element-selector').textContent = state.selected.selector; $('element-tag').textContent = el.tagName.toLowerCase();
  $('element-classes').textContent = state.selected.classes.join(' ') || '(none)'; $('element-field').textContent = state.selected.field || '(none)';
  $('authored-css').textContent = css || '(No matching authored rules)';
  $('computed-css').textContent = [...computed].map((property) => `${property}: ${computed.getPropertyValue(property)};`).join('\n');
  $('element-html').textContent = state.selected.elementHTML;
  if (!state.editing) $('note-context').textContent = state.selected.selector;
  positionOutline();
}
function positionOutline() {
  if (!state.selected || $('reference-toggle').checked) { $('selection-outline').hidden = true; return; }
  const rect = state.selected.element.getBoundingClientRect(); const outline = $('selection-outline');
  Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); outline.hidden = false;
}
function clearSelection() {
  state.selected = null; $('selection-outline').hidden = true; $('selection-empty').hidden = false; $('selection-details').hidden = true; $('clear-selection').disabled = true;
  if (!state.editing) $('note-context').textContent = 'Template-level note';
}
function resetNoteForm() {
  state.editing = null; $('note-form').reset(); $('cancel-note').hidden = true; $('add-note').textContent = 'Add note';
  $('note-context').textContent = state.selected?.selector || 'Template-level note'; updateDirty();
}
function renderNotes() {
  $('note-count').textContent = state.notes.length; $('review-summary').textContent = `${state.notes.filter((n) => n.status !== 'resolved').length} open`;
  $('note-list').replaceChildren();
  for (const note of state.notes) {
    const article = node('article', 'note'); article.dataset.noteId = note.id;
    const heading = node('div', 'note-heading'); heading.append(node('span', 'note-kind', note.kind.charAt(0).toUpperCase() + note.kind.slice(1)), node('span', `note-status ${note.status === 'resolved' ? 'resolved' : ''}`, note.status === 'resolved' ? 'Resolved' : 'Open'));
    article.append(heading, node('p', '', note.text), node('div', 'note-selector', note.selector || 'Template-level'));
    const bottom = node('div', 'note-bottom');
    bottom.append(node('span', note.sourceHash !== state.template.hash ? 'stale' : 'muted', note.sourceHash !== state.template.hash ? 'Source changed · stale' : `SHA ${note.sourceHash.slice(0, 8)}`));
    const actions = node('div', 'actions');
    const edit = node('button', '', 'Edit'); edit.addEventListener('click', () => {
      if (state.saving) return;
      if (draftDirty() && !confirm('Discard the current note draft?')) return;
      state.editing = note.id; $('note-kind').value = note.kind; $('note-status').value = note.status; $('note-text').value = note.text;
      $('note-context').textContent = note.selector || 'Template-level note'; $('cancel-note').hidden = false; $('add-note').textContent = 'Update note'; $('note-text').focus(); updateDirty();
    });
    const resolve = node('button', '', note.status === 'resolved' ? 'Reopen' : 'Resolve'); resolve.addEventListener('click', () => { if (state.saving) return; note.status = note.status === 'resolved' ? 'open' : 'resolved'; renderNotes(); updateDirty(); });
    const remove = node('button', 'icon-button'); remove.title = 'Delete note'; remove.setAttribute('aria-label', 'Delete note'); remove.append(icon('trash'));
    remove.addEventListener('click', () => { if (state.saving || !confirm('Delete this review note? Save notes to apply the deletion.')) return; state.notes = state.notes.filter((n) => n.id !== note.id); if (state.editing === note.id) resetNoteForm(); renderNotes(); updateDirty(); });
    actions.append(edit, resolve, remove); bottom.append(actions); article.append(bottom); $('note-list').append(article);
  }
  if (!state.notes.length) $('note-list').append(node('div', 'empty', 'No review notes'));
}
$('note-form').addEventListener('submit', (event) => {
  event.preventDefault(); if (!state.template || state.saving || !$('note-text').value.trim()) return;
  const existing = state.notes.find((n) => n.id === state.editing);
  const selected = state.selected;
  const context = existing || { id: crypto.randomUUID(), selector: selected?.selector || '', elementHTML: selected?.elementHTML || '', classes: selected?.classes || [], field: selected?.field || '', css: selected?.css || '', sourceHash: state.template.hash };
  const note = { ...context, kind: $('note-kind').value, text: $('note-text').value.trim(), status: $('note-status').value };
  if (existing) state.notes = state.notes.map((n) => n.id === existing.id ? note : n); else state.notes.push(note);
  resetNoteForm(); renderNotes(); updateDirty();
});
$('save-notes').addEventListener('click', async () => {
  if (!state.template || state.saving || state.conflicted) return;
  state.saving = true; $('notice').hidden = true; updateDirty();
  const notes = structuredClone(state.notes);
  try { const result = await api('/api/review', { id: state.template.id, expectedRevision: state.template.review?.revision ?? 0, notes });
    const review = result.review || result;
    if (review.revision === undefined) throw new Error('Review saved, but no revision was returned. Reload latest before further edits.');
    state.template.review = { ...review, notes }; state.savedNotes = JSON.stringify(notes); notice('Review notes saved.', false, true);
  } catch (error) { fail(error); } finally { state.saving = false; updateDirty(); }
});
$('save-source').addEventListener('click', async () => {
  if (!state.template || state.saving || state.conflicted || !sourceDirty()) return;
  state.saving = true; $('notice').hidden = true; updateDirty();
  const text = $('source').value;
  const html = state.raw.includes('\r\n') ? text.replace(/\r\n?|\n/g, '\r\n') : text;
  try {
    const result = await api('/api/template', { id: state.template.id, expectedHash: state.template.hash, html });
    const saved = result.template || result;
    if (!saved.hash) throw new Error('Source saved, but no hash was returned. Reload latest before further edits.');
    state.raw = html; state.baseline = text; state.template = { ...state.template, ...saved, html };
    const entry = state.catalog.find((t) => t.id === state.template.id); if (entry) entry.hash = saved.hash;
    $('source-hash').textContent = `SHA ${saved.hash.slice(0, 12)}`; renderNotes(); renderPreview(); notice('Source saved. Review contexts retain their original source hash.', false, true);
  } catch (error) { fail(error); } finally { state.saving = false; updateDirty(); }
});
$('source').addEventListener('input', updateDirty); $('note-text').addEventListener('input', updateDirty);
$('note-kind').addEventListener('change', updateDirty); $('note-status').addEventListener('change', updateDirty);
$('cancel-note').addEventListener('click', () => { if (!draftDirty() || confirm('Discard this note draft?')) resetNoteForm(); });
$('clear-selection').addEventListener('click', clearSelection);
$('search').addEventListener('input', renderCatalog);
for (const [id, archived] of [['active-filter', false], ['archived-filter', true]]) $(id).addEventListener('click', () => { state.archived = archived; $('active-filter').setAttribute('aria-pressed', String(!archived)); $('archived-filter').setAttribute('aria-pressed', String(archived)); renderCatalog(); });
for (const name of ['preview', 'source']) $(`${name}-tab`).addEventListener('click', () => { for (const tab of ['preview', 'source']) { $(`${tab}-tab`).setAttribute('aria-selected', String(tab === name)); $(`${tab}-panel`).hidden = tab !== name; } if (name === 'preview') fitPreview(); });
$('reference-toggle').addEventListener('change', () => { $('reference').hidden = !$('reference-toggle').checked; $('preview').style.visibility = $('reference-toggle').checked ? 'hidden' : 'visible'; positionOutline(); });
$('reference').addEventListener('error', () => { $('reference-toggle').checked = false; $('reference').hidden = true; $('preview').style.visibility = 'visible'; notice('The original reference image could not be loaded.'); });
$('zoom-fit').addEventListener('click', () => { state.zoom = null; fitPreview(); });
for (const [id, delta] of [['zoom-in', .1], ['zoom-out', -.1]]) $(id).addEventListener('click', () => { state.zoom = Math.max(.1, Math.min(2, (state.zoom || parseFloat($('zoom-value').textContent) / 100) + delta)); fitPreview(); });
$('dismiss').addEventListener('click', () => { $('notice').hidden = true; });
$('reload').addEventListener('click', () => { if (state.template) loadTemplate(state.template.id, true); else start(); });
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
let events;
async function changed(event) {
  if (state.saving || state.loading) return;
  try { const catalog = await api('/api/catalog'); state.catalog = catalog.templates || []; renderCatalog();
    if (!state.template || state.saving || state.loading) return;
    let change = {}; try { change = JSON.parse(event?.data || '{}'); } catch { /* A generic change still refreshes the catalog. */ }
    if (change.id && change.id !== state.template.id) return;
    const id = state.template.id;
    const latest = await api(`/api/template?id=${encodeURIComponent(id)}`);
    if (state.template.id !== id || state.saving || state.loading) return;
    if (latest.hash === state.template.hash && latest.review?.revision === state.template.review?.revision) return;
    notice(dirty() ? 'Files changed on disk. Your unsaved changes are preserved. Reload latest when ready.' : 'Files changed on disk. Reload to view the latest source and review.', true);
  } catch (error) { fail(error); }
}
async function start() {
  try {
    const session = await api('/api/session'); state.token = session.token;
    const catalog = await api('/api/catalog'); state.catalog = catalog.templates || []; renderCatalog();
    const first = state.catalog.find((t) => !t.retired) || state.catalog[0];
    if (first) await loadTemplate(first.id); else { $('template-title').textContent = 'No templates'; $('connection').textContent = 'Local studio'; }
    events?.close(); events = new EventSource('/api/events');
    events.onopen = () => { $('connection').textContent = 'Local · connected'; $('connection').classList.add('live'); };
    events.onerror = () => { $('connection').textContent = 'Reconnecting'; $('connection').classList.remove('live'); };
    events.onmessage = changed; events.addEventListener('change', changed);
  } catch (error) { $('template-title').textContent = 'Studio unavailable'; $('connection').textContent = 'Disconnected'; notice(error.message, true); }
}
start();
