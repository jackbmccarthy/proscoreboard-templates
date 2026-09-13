import { validateSocialTemplate, inspectSocialTemplate, SOCIAL_PRESETS, SOCIAL_FIELDS, SOCIAL_FONTS, MAX_IMAGE_DATA_URL_LENGTH } from '/social-contract.mjs';
import { renderSocialGraphic, hitTestLayer, SAMPLE_VALUES } from '/social-renderer.mjs';

const $ = (id) => document.getElementById(id);
const state = { token: '', catalog: [], record: null, model: null, baseline: '', applied: '', notes: [], savedNotes: '[]', selected: null, editing: null, samples: { ...SAMPLE_VALUES }, busy: false, conflict: false, render: 0, rendered: null, view: 'design' };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const sourceDirty = () => Boolean(state.record) && $('source').value !== state.baseline;
const notesDirty = () => JSON.stringify(state.notes) !== state.savedNotes;
const noteDraft = () => Boolean(state.editing || $('note-text').value.trim());
const dirty = () => sourceDirty() || notesDirty() || noteDraft();
const selectedLayer = () => state.model?.layers.find((layer) => layer.id === state.selected);
const sourceBytes = (value) => state.record?.source.includes('\r\n') ? value.replace(/\r\n?|\n/g, '\r\n') : value;
function notice(message, reload = false) { $('notice-text').textContent = message; $('notice').hidden = false; $('reload').hidden = !reload; }
function fail(error) {
  if (error.status === 409) { state.conflict = true; notice('Source or review changed on disk. Your draft is preserved; nothing was overwritten. Reload latest before saving.', true); }
  else notice(error.message || 'Request failed. Your draft is preserved.');
  update();
}
async function api(url, body) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'PUT', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Studio-Token': state.token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok) { const error = new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || `Request failed (${response.status})`); error.status = response.status; throw error; }
  return payload.data ?? payload;
}
function update() {
  const unavailable = state.busy || !state.record; const canvasUnavailable = unavailable || !state.model; const rawPending = $('source').value !== state.applied;
  $('unsaved').hidden = !dirty(); $('dirty-detail').textContent = [sourceDirty() && 'JSON', notesDirty() && 'Review notes', noteDraft() && 'Note draft'].filter(Boolean).join(', ');
  $('save-source').disabled = unavailable || state.conflict || !sourceDirty();
  $('save-notes').disabled = unavailable || state.conflict || !notesDirty();
  $('export-png').disabled = canvasUnavailable || rawPending || !state.rendered;
  $('export-brief').disabled = unavailable;
  $('apply-source').disabled = unavailable || (Boolean(state.model) && !rawPending);
  $('source').disabled = unavailable;
  $('design-tab').disabled = canvasUnavailable;
  for (const el of document.querySelectorAll('#sample-fields input,#samples-enabled')) el.disabled = canvasUnavailable;
  for (const el of document.querySelectorAll('#properties input,#properties select,#properties button,.layer-tools button,.layer-tools select')) el.disabled = canvasUnavailable || rawPending;
  for (const id of ['duplicate-layer', 'remove-layer', 'raise-layer', 'lower-layer', 'clear-selection']) $(id).disabled = canvasUnavailable || rawPending || !selectedLayer();
  if (selectedLayer()) { const i = state.model.layers.indexOf(selectedLayer()); $('raise-layer').disabled ||= i === state.model.layers.length - 1; $('lower-layer').disabled ||= i === 0; }
  $('add-layer').disabled ||= state.model?.layers.length >= 40;
  $('duplicate-layer').disabled ||= state.model?.layers.length >= 40;
  for (const el of document.querySelectorAll('#note-form input,#note-form select,#note-form textarea,#note-form button,#note-list button')) el.disabled = unavailable;
  $('note-target').disabled ||= Boolean(state.editing);
  $('source-hash').textContent = state.record ? `SHA ${state.record.hash.slice(0, 12)}` : '';
}
function option(select, value, label) { const el = node('option', label); el.value = value; select.append(el); }
function renderCatalog() {
  const query = $('search').value.trim().toLowerCase();
  const visible = state.catalog.filter((t) => `${t.title || t.name || ''} ${t.id} ${t.category || ''} ${t.preset || ''}`.toLowerCase().includes(query) && (!$('category').value || t.category === $('category').value) && (!$('preset-filter').value || t.preset === $('preset-filter').value));
  $('template-count').textContent = `${visible.length} / ${state.catalog.length}`; $('template-list').replaceChildren();
  for (const t of visible) {
    const button = node('button', undefined, 'template-item'); button.dataset.id = t.id; button.setAttribute('aria-current', String(t.id === state.record?.id));
    button.append(node('strong', t.title || t.name || t.id), node('small', [t.category, SOCIAL_PRESETS[t.preset]?.label || t.preset].filter(Boolean).join(' / ')));
    button.addEventListener('click', () => loadTemplate(t.id)); $('template-list').append(button);
  }
  if (!visible.length) $('template-list').append(node('p', 'No matching templates', 'empty'));
}
async function loadTemplate(id, force = false) {
  if (state.busy || (!force && state.record?.id === id)) return;
  if (dirty() && !confirm('Discard unsaved JSON, review notes and note draft?')) return;
  state.busy = true; update();
  try {
    const record = await api(`/api/social/template?id=${encodeURIComponent(id)}`);
    if (typeof record.source !== 'string' || !record.hash || !record.review) throw new Error('Incomplete template response.');
    let model = null; let diagnostics = '';
    try {
      validateSocialTemplate(record.template);
      if (record.template.id !== record.id) throw new Error('The template ID must match its file ID.');
      model = structuredClone(record.template);
    } catch (error) { diagnostics = record.inspection?.errors?.length ? record.inspection.errors.join(' ') : error.message; }
    state.record = record; state.model = model; $('source').value = record.source;
    state.baseline = $('source').value; state.applied = $('source').value; state.selected = null; state.conflict = false;
    state.notes = structuredClone(record.review.notes); state.savedNotes = JSON.stringify(state.notes); resetNote();
    $('template-title').textContent = model?.name || state.catalog.find((entry) => entry.id === id)?.name || record.fileName; $('template-meta').textContent = record.fileName; $('notice').hidden = true;
    $('validation').textContent = diagnostics;
    if (!model) showView('source');
    renderCatalog(); renderLayers(); renderProperties(); renderNotes(); await renderPreview();
  } catch (error) { fail(error); } finally { state.busy = false; update(); }
}
function renderLayers() {
  const layers = state.model?.layers || [];
  $('layer-count').textContent = layers.length; $('layer-list').replaceChildren();
  for (const layer of [...layers].reverse()) {
    const button = node('button', undefined, 'layer-item'); button.dataset.layerId = layer.id; button.setAttribute('aria-pressed', String(layer.id === state.selected));
    button.append(node('span', layer.id), node('small', layer.type === 'boundText' ? layer.field : layer.type === 'image' && !layer.src ? 'Image / empty' : layer.type));
    button.addEventListener('click', () => selectLayer(layer.id)); $('layer-list').append(button);
  }
  const target = $('note-target').value; $('note-target').replaceChildren(); option($('note-target'), '', 'Template-level');
  for (const layer of layers) option($('note-target'), layer.id, `layers.${layer.id}`);
  if (target && !layers.some((l) => l.id === target)) option($('note-target'), target, `layers.${target} (removed)`);
  $('note-target').value = target;
}
function selectLayer(id) {
  if (state.busy) return;
  state.selected = id; renderLayers(); renderProperties(); positionOutline();
  if (!noteDraft()) $('note-target').value = id || '';
  update();
}
function positionOutline() {
  const layer = selectedLayer(); const outline = $('selection-outline'); outline.hidden = !layer || !state.rendered;
  if (!layer) return;
  Object.assign(outline.style, { left: `${layer.x / state.model.width * 100}%`, top: `${layer.y / state.model.height * 100}%`, width: `${layer.width / state.model.width * 100}%`, height: `${layer.height / state.model.height * 100}%`, transform: `rotate(${layer.rotation}deg)` });
}
function fitPreview() {
  if (!state.model) return;
  const viewport = $('preview-viewport'); const padding = parseFloat(getComputedStyle(viewport).padding) * 2;
  const scale = Math.max(.02, Math.min((viewport.clientWidth - padding) / state.model.width, (viewport.clientHeight - padding) / state.model.height));
  Object.assign($('canvas-stage').style, { width: `${state.model.width * scale}px`, height: `${state.model.height * scale}px` }); positionOutline();
}
async function renderPreview() {
  const revision = ++state.render; state.rendered = null;
  const preview = $('preview'); delete preview.dataset.rendered; preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);
  $('canvas-stage').hidden = !state.model; $('selection-outline').hidden = true;
  $('canvas-size').textContent = ''; $('render-status').textContent = state.model ? 'Rendering' : 'Invalid template'; update();
  if (!state.model) return;
  try {
    const canvas = await renderSocialGraphic(state.model, $('samples-enabled').checked ? state.samples : {});
    if (revision !== state.render) return;
    const preview = $('preview'); preview.width = canvas.width; preview.height = canvas.height; preview.getContext('2d').drawImage(canvas, 0, 0);
    state.rendered = canvas; preview.dataset.rendered = String(revision); $('render-status').textContent = '';
    $('canvas-size').textContent = `${canvas.width} x ${canvas.height}`; fitPreview();
  } catch (error) { if (revision === state.render) { $('render-status').textContent = error.message; $('preview').getContext('2d').clearRect(0, 0, $('preview').width, $('preview').height); } }
  update();
}
function commitModel(model, rebuild = false) {
  validateSocialTemplate(model); state.model = model;
  $('source').value = JSON.stringify(model, null, 2) + '\n'; state.applied = $('source').value;
  $('template-title').textContent = model.name; $('validation').textContent = inspectSocialTemplate(model).warnings.join(' ');
  renderLayers(); if (!noteDraft()) $('note-target').value = state.selected || '';
  if (rebuild) renderProperties(); else $('layer-json').textContent = JSON.stringify(selectedLayer() || model, null, 2);
  renderPreview(); update();
}
function mutate(change, rebuild = false) {
  if (state.busy || !state.model || $('source').value !== state.applied) return;
  try { const model = structuredClone(state.model); change(model, model.layers.find((l) => l.id === state.selected)); commitModel(model, rebuild); } catch (error) { fail(error); }
}
function control(label, key, value, config = {}) {
  const wrapper = node('label', label); if (config.wide) wrapper.className = 'wide';
  const input = node(config.options ? 'select' : 'input'); input.id = `prop-${key}`;
  if (config.options) for (const item of config.options) option(input, typeof item === 'string' ? item : item.value, typeof item === 'string' ? item : item.label);
  else { input.type = config.type || 'text'; for (const attr of ['min', 'max', 'step', 'maxLength']) if (config[attr] !== undefined) input[attr] = config[attr]; }
  input.value = value; input.addEventListener('change', () => {
    if (!input.reportValidity()) return;
    const nextValue = config.type === 'number' || config.type === 'range' ? Number(input.value) : input.value;
    mutate((model, layer) => { const target = layer || model; target[key] = nextValue;
      if (key === 'type') { delete target.field; delete target.text; delete target.src; if (nextValue === 'boundText') target.field = SOCIAL_FIELDS[0].value; if (nextValue === 'text') target.text = 'Text'; if (nextValue === 'image') target.src = ''; }
      if (key === 'preset') {
        const size = SOCIAL_PRESETS[nextValue]; const sx = size.width / model.width; const sy = size.height / model.height;
        model.layers = model.layers.map((l) => { const width = Math.max(16, Math.min(size.width, Math.round(l.width * sx))); const height = Math.max(16, Math.min(size.height, Math.round(l.height * sy))); return { ...l, width, height, x: Math.min(size.width - width, Math.round(l.x * sx)), y: Math.min(size.height - height, Math.round(l.y * sy)), fontSize: Math.min(240, Math.max(12, Math.round(l.fontSize * Math.min(sx, sy)))) }; });
        model.width = size.width; model.height = size.height;
      }
    }, true);
  }); wrapper.append(input); $('properties').append(wrapper);
}
function renderProperties() {
  $('properties').replaceChildren(); const layer = selectedLayer(); const model = state.model;
  $('selected-id').textContent = layer ? `layers.${layer.id}` : 'Template';
  $('layer-json').textContent = model ? JSON.stringify(layer || model, (key, value) => key === 'src' || key === 'backgroundImage' ? value ? '[embedded image]' : '' : value, 2) : '';
  if (!model) return;
  if (!layer) {
    control('Name', 'name', model.name, { wide: true, maxLength: 100 }); control('Background', 'backgroundColor', model.backgroundColor, { type: 'color' });
    control('Preset', 'preset', model.preset, { wide: true, options: Object.entries(SOCIAL_PRESETS).map(([value, p]) => ({ value, label: `${p.platform} / ${p.label} (${p.width} x ${p.height})` })) }); return;
  }
  control('Type', 'type', layer.type, { wide: true, options: ['text', 'boundText', 'shape', 'image'] });
  if (layer.type === 'boundText') control('Bound field', 'field', layer.field, { wide: true, options: SOCIAL_FIELDS });
  if (layer.type === 'text') control('Text', 'text', layer.text, { wide: true, maxLength: 500 });
  if (['text', 'boundText'].includes(layer.type)) {
    control('Font', 'fontFamily', layer.fontFamily, { wide: true, options: SOCIAL_FONTS });
    control('Font size', 'fontSize', layer.fontSize, { type: 'number', min: 12, max: 240, step: 1 }); control('Weight', 'fontWeight', layer.fontWeight, { options: ['400', '600', '700', '800', '900'] });
    control('Color', 'color', layer.color, { type: 'color' }); control('Alignment', 'align', layer.align, { options: ['left', 'center', 'right'] });
    control('Tracking', 'letterSpacing', layer.letterSpacing, { type: 'number', min: 0, max: 24, step: 1 });
  }
  if (layer.type === 'shape') control('Fill', 'fill', layer.fill, { type: 'color', wide: true });
  if (layer.type === 'image') {
    const label = node('label', 'Import PNG / JPEG / WebP'); label.className = 'wide'; const file = node('input'); file.id = 'image-import'; file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; label.append(file); $('properties').append(label);
    file.addEventListener('change', () => importImage(file.files[0], layer.id));
    const remove = node('button', 'Clear image'); remove.type = 'button'; remove.addEventListener('click', () => mutate((_, l) => { l.src = ''; }, true)); $('properties').append(remove);
  }
  for (const [label, key, max] of [['X', 'x', model.width - layer.width], ['Y', 'y', model.height - layer.height], ['Width', 'width', model.width - layer.x], ['Height', 'height', model.height - layer.y]]) control(label, key, layer[key], { type: 'number', min: key === 'x' || key === 'y' ? 0 : 16, max, step: 1 });
  control('Opacity', 'opacity', layer.opacity, { type: 'number', min: .05, max: 1, step: .05 }); control('Rotation', 'rotation', layer.rotation, { type: 'number', min: -180, max: 180, step: 1 });
}
$('properties').addEventListener('submit', (event) => event.preventDefault());
async function importImage(file, id) {
  if (!file || state.busy) return;
  const recordID = state.record.id;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_500_000) throw new Error('Choose a PNG, JPEG or WebP image up to 1.5 MB.');
    const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    if (source.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error('Image is too large.');
    const bitmap = await createImageBitmap(file); const pixels = bitmap.width * bitmap.height; bitmap.close();
    if (pixels > 32_000_000) throw new Error('Image exceeds 32 megapixels.');
    if (state.record.id !== recordID || state.selected !== id) return;
    mutate((_, layer) => { layer.src = source; }, true);
  } catch (error) { fail(error); }
}
function resetNote() { state.editing = null; $('note-form').reset(); $('note-target').value = state.selected || ''; $('cancel-note').hidden = true; $('add-note').textContent = 'Add note'; update(); }
function renderNotes() {
  $('note-count').textContent = state.notes.length; $('review-summary').textContent = `${state.notes.filter((n) => n.status === 'open').length} open`; $('note-list').replaceChildren();
  for (const note of state.notes) {
    const article = node('article', undefined, 'note'); article.dataset.noteId = note.id;
    article.append(node('strong', `${note.kind} / ${note.status}`), node('p', note.text), node('div', note.selector || 'Template-level', 'note-selector'));
    article.append(node('span', note.sourceHash === state.record.hash ? `SHA ${note.sourceHash.slice(0, 12)}` : 'Source changed / stale', note.sourceHash === state.record.hash ? 'note-selector' : 'stale'));
    const actions = node('div', undefined, 'actions');
    const edit = node('button', 'Edit'); edit.addEventListener('click', () => {
      if (noteDraft() && !confirm('Discard the current note draft?')) return;
      state.editing = note.id; $('note-kind').value = note.kind; $('note-status').value = note.status; $('note-text').value = note.text;
      const target = note.selector.startsWith('layers.') ? note.selector.slice(7) : '';
      if (target && ![...$('note-target').options].some((o) => o.value === target)) option($('note-target'), target, `${note.selector} (removed)`);
      $('note-target').value = target; $('note-target').disabled = true; $('cancel-note').hidden = false; $('add-note').textContent = 'Update note'; update(); $('note-target').disabled = true;
    });
    const resolve = node('button', note.status === 'open' ? 'Resolve' : 'Reopen'); resolve.addEventListener('click', () => { note.status = note.status === 'open' ? 'resolved' : 'open'; renderNotes(); update(); });
    const remove = node('button', '\u00d7'); remove.title = 'Delete note'; remove.setAttribute('aria-label', 'Delete note'); remove.addEventListener('click', () => { if (!confirm('Delete this review note? Save notes to apply deletion.')) return; state.notes = state.notes.filter((n) => n.id !== note.id); if (state.editing === note.id) resetNote(); renderNotes(); update(); });
    actions.append(edit, resolve, remove); article.append(actions); $('note-list').append(article);
  }
  if (!state.notes.length) $('note-list').append(node('p', 'No review notes', 'empty'));
}
async function digest(source) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map((n) => n.toString(16).padStart(2, '0')).join(''); }
$('note-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (state.busy || !state.record || !$('note-text').value.trim()) return;
  state.busy = true; update();
  try {
    const existing = state.notes.find((n) => n.id === state.editing); const layer = state.model?.layers.find((l) => l.id === $('note-target').value);
    const snapshot = layer ? { ...layer, ...(layer.src ? { src: '[embedded image omitted]' } : {}) } : null;
    const style = layer ? Object.fromEntries(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'color', 'fill', 'align'].map((key) => [key, layer[key]])) : null;
    const context = existing || { id: crypto.randomUUID(), selector: layer ? `layers.${layer.id}` : '', elementHTML: snapshot ? JSON.stringify(snapshot, null, 2) : '', css: style ? JSON.stringify(style, null, 2) : '', classes: [], field: layer?.field || '', sourceHash: await digest(sourceBytes(state.applied)) };
    const note = { ...context, kind: $('note-kind').value, status: $('note-status').value, text: $('note-text').value.trim() };
    if (existing) state.notes = state.notes.map((n) => n.id === existing.id ? note : n); else state.notes.push(note);
    resetNote(); renderNotes();
  } catch (error) { fail(error); } finally { state.busy = false; update(); }
});
function applySource() {
  const model = validateSocialTemplate(JSON.parse($('source').value));
  if (model.id !== state.record.id) throw new Error('The template ID cannot change.');
  state.model = model; state.applied = $('source').value; if (!selectedLayer()) state.selected = null;
  $('template-title').textContent = model.name; $('validation').textContent = inspectSocialTemplate(model).warnings.join(' ');
  renderLayers(); renderProperties(); renderPreview(); update();
}
$('save-source').addEventListener('click', async () => {
  if (state.busy || state.conflict || !sourceDirty()) return;
  try { applySource(); } catch (error) { $('validation').textContent = error.message; fail(error); return; }
  const baseline = $('source').value; const source = sourceBytes(baseline); state.busy = true; $('notice').hidden = true; update();
  try {
    const result = await api('/api/social/template', { id: state.record.id, expectedHash: state.record.hash, source });
    if (!result.hash) throw new Error('Save response has no hash. Reload latest before saving again.');
    state.record = { ...state.record, ...result, source, template: structuredClone(state.model) }; state.baseline = baseline;
    const entry = state.catalog.find((t) => t.id === state.record.id); if (entry) { entry.name = state.model.name; entry.preset = state.model.preset; entry.hash = result.hash; renderCatalog(); }
    notice('JSON saved.'); renderNotes();
  } catch (error) { fail(error); } finally { state.busy = false; update(); }
});
$('save-notes').addEventListener('click', async () => {
  if (state.busy || state.conflict || !notesDirty()) return;
  state.busy = true; $('notice').hidden = true; update(); const notes = structuredClone(state.notes);
  try {
    const result = await api('/api/social/review', { id: state.record.id, expectedRevision: state.record.review.revision, notes });
    const review = result.review || result; if (!Number.isSafeInteger(review.revision)) throw new Error('Save response has no review revision. Reload latest before saving again.');
    state.record.review = { ...review, notes }; state.savedNotes = JSON.stringify(notes); notice('Review notes saved.');
  } catch (error) { fail(error); } finally { state.busy = false; update(); }
});
function download(blob, filename) { const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('export-png').addEventListener('click', async () => {
  const canvas = state.rendered; if (!canvas || state.busy || $('source').value !== state.applied) return;
  const filename = `${state.record.id}.png`;
  try { const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNG export failed.'); download(blob, filename); } catch (error) { fail(error); }
});
$('export-brief').addEventListener('click', async () => {
  if (dirty() && !confirm('Export the saved version only? Unsaved JSON and notes are not included.')) return;
  try { const response = await fetch(`/api/social/brief?id=${encodeURIComponent(state.record.id)}`); if (!response.ok) throw new Error('Could not export the brief.'); download(await response.blob(), `${state.record.id}-brief.md`); } catch (error) { fail(error); }
});
function showView(view) {
  state.view = view;
  for (const name of ['design', 'source', 'review']) { $(`${name}-panel`).hidden = name !== view; $(`${name}-tab`).setAttribute('aria-selected', String(name === view)); }
  fitPreview();
}
for (const view of ['design', 'source', 'review']) $(`${view}-tab`).addEventListener('click', () => {
  if (view === 'design' && state.model && $('source').value !== state.applied) {
    try { applySource(); } catch (error) { $('validation').textContent = error.message; fail(error); return; }
  }
  showView(view);
});
$('apply-source').addEventListener('click', () => { try { applySource(); notice('JSON applied to preview; save to persist.'); } catch (error) { $('validation').textContent = error.message; fail(error); } });
$('source').addEventListener('input', update); $('note-text').addEventListener('input', update);
$('cancel-note').addEventListener('click', () => { if (!noteDraft() || confirm('Discard this note draft?')) resetNote(); });
$('clear-selection').addEventListener('click', () => selectLayer(null));
$('preview').addEventListener('click', (event) => {
  if (!state.model) return;
  const rect = $('preview').getBoundingClientRect(); const x = (event.clientX - rect.left) * state.model.width / rect.width; const y = (event.clientY - rect.top) * state.model.height / rect.height;
  selectLayer([...state.model.layers].reverse().find((layer) => !(layer.type === 'image' && !layer.src) && hitTestLayer(layer, x, y))?.id || null);
});
$('add-layer').addEventListener('click', () => mutate((model) => {
  const type = $('add-type').value; const layer = { id: `layer-${crypto.randomUUID()}`, type, align: 'left', color: '#ffffff', fill: '#166543', fontFamily: 'Arial, sans-serif', fontSize: 48, fontWeight: '700', height: 100, letterSpacing: 0, opacity: 1, rotation: 0, width: Math.min(500, model.width), x: 0, y: 0, ...(type === 'text' ? { text: 'Text' } : type === 'boundText' ? { field: SOCIAL_FIELDS[0].value } : type === 'image' ? { src: '' } : {}) };
  model.layers.push(layer); state.selected = layer.id;
}, true));
$('duplicate-layer').addEventListener('click', () => mutate((model, layer) => { const clone = { ...layer, id: `layer-${crypto.randomUUID()}` }; model.layers.splice(model.layers.indexOf(layer) + 1, 0, clone); state.selected = clone.id; }, true));
$('remove-layer').addEventListener('click', () => { if (confirm('Remove this layer? Save JSON to persist.')) mutate((model, layer) => { model.layers = model.layers.filter((l) => l.id !== layer.id); state.selected = null; }, true); });
for (const [id, delta] of [['raise-layer', 1], ['lower-layer', -1]]) $(id).addEventListener('click', () => mutate((model, layer) => { const index = model.layers.indexOf(layer); if (index + delta < 0 || index + delta >= model.layers.length) return; model.layers.splice(index, 1); model.layers.splice(index + delta, 0, layer); }));
for (const { label, value } of SOCIAL_FIELDS) { const wrapper = node('label', label); const input = node('input'); input.id = `sample-${value}`; input.value = state.samples[value]; input.maxLength = 500; input.addEventListener('input', () => { state.samples[value] = input.value; renderPreview(); }); wrapper.append(input); $('sample-fields').append(wrapper); }
$('samples-enabled').addEventListener('change', () => renderPreview());
for (const id of ['search', 'category', 'preset-filter']) $(id).addEventListener(id === 'search' ? 'input' : 'change', renderCatalog);
$('reload').addEventListener('click', () => state.record ? loadTemplate(state.record.id, true) : location.reload()); $('dismiss').addEventListener('click', () => { $('notice').hidden = true; });
document.querySelectorAll('[data-leave]').forEach((link) => link.addEventListener('click', (event) => { if (dirty() && !confirm('Leave with unsaved JSON, review notes or note draft?')) event.preventDefault(); }));
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(fitPreview).observe($('preview-viewport'));
let changeTimer;
function checkDiskChange() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(async () => {
    if (state.busy) { checkDiskChange(); return; }
    if (!state.record) return;
    const id = state.record.id;
    try {
      const latest = await api(`/api/social/template?id=${encodeURIComponent(id)}`);
      if (state.busy) { checkDiskChange(); return; }
      if (state.record.id !== id || state.conflict) return;
      // A write produces both the explicit save event and a filesystem watcher event.
      if (latest.hash === state.record.hash && latest.review.revision === state.record.review.revision) return;
      notice('Files changed on disk. Your current draft is unchanged. Reload latest to compare.', true);
    } catch (error) { notice(`Files changed on disk. ${error.message}`, true); }
  }, 150);
}
async function initialize() {
  try {
    state.token = (await api('/api/session')).token; state.catalog = (await api('/api/social/catalog')).templates;
    for (const category of [...new Set(state.catalog.map((t) => t.category).filter(Boolean))].sort()) option($('category'), category, category);
    for (const preset of [...new Set(state.catalog.map((t) => t.preset).filter(Boolean))]) option($('preset-filter'), preset, `${SOCIAL_PRESETS[preset]?.platform || ''} / ${SOCIAL_PRESETS[preset]?.label || preset}`);
    renderCatalog(); if (state.catalog.length) await loadTemplate(state.catalog[0].id); else notice('No social templates available.');
    const events = new EventSource('/api/events'); events.onopen = () => { $('connection').textContent = 'Connected'; }; events.onerror = () => { $('connection').textContent = 'Reconnecting'; };
    events.addEventListener('change', (event) => {
      let change; try { change = JSON.parse(event.data); } catch { return; }
      if (!String(change.type).startsWith('social-') || (change.id && change.id !== state.record?.id)) return;
      if (change.type === 'social-catalog') notice('Social catalog changed on disk. Your current draft is unchanged.', true);
      else checkDiskChange();
    });
  } catch (error) { fail(error); }
  update();
}
update();
initialize();
