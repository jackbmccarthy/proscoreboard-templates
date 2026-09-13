// Public, browser-safe subset of the application's social graphics model.
export const SOCIAL_TEMPLATE_SCHEMA_VERSION = 1;
export const SOCIAL_PRESETS = Object.freeze(Object.fromEntries([
  ['instagramSquare', 1080, 1080, '1:1', 'Square post', 'Instagram'],
  ['instagramPortrait', 1080, 1350, '4:5', 'Portrait post', 'Instagram'],
  ['instagramStory', 1080, 1920, '9:16', 'Story / Reel', 'Instagram'],
  ['tiktokVertical', 1080, 1920, '9:16', 'Vertical post', 'TikTok'],
  ['facebookLandscape', 1200, 630, '1.91:1', 'Feed post', 'Facebook'],
  ['facebookCover', 1640, 630, '2.63:1', 'Page cover', 'Facebook'],
  ['xLandscape', 1600, 900, '16:9', 'Landscape post', 'X'],
  ['linkedinLandscape', 1200, 627, '1.91:1', 'Landscape post', 'LinkedIn'],
  ['youtubeThumbnail', 1280, 720, '16:9', 'Thumbnail', 'YouTube'],
  ['pinterestPin', 1000, 1500, '2:3', 'Standard Pin', 'Pinterest'],
  ['square', 1080, 1080, '1:1', 'Square', 'Universal'],
  ['portrait', 1080, 1350, '4:5', 'Portrait', 'Universal'],
  ['story', 1080, 1920, '9:16', 'Vertical', 'Universal'],
  ['landscape', 1200, 628, '1.91:1', 'Landscape', 'Universal']
].map(([key, width, height, aspectRatio, label, platform]) => [key, Object.freeze({ aspectRatio, height, label, platform, width })])));

export const SOCIAL_FIELDS = Object.freeze([
  ['Champion', 'championName'], ['Winner', 'winnerName'], ['Loser', 'loserName'],
  ['Competitor A', 'competitorA'], ['Competitor B', 'competitorB'],
  ['Score A', 'scoreA'], ['Score B', 'scoreB'], ['Event', 'eventName'],
  ['Round', 'roundLabel'], ['Date', 'dateLabel'], ['Status', 'statusLabel']
].map(([label, value]) => Object.freeze({ label, value })));

export const SOCIAL_FONTS = Object.freeze([
  'Arial, sans-serif', 'Georgia, serif', 'Impact, sans-serif',
  'Trebuchet MS, sans-serif', 'Verdana, sans-serif'
]);
export const MAX_IMAGE_DATA_URL_LENGTH = 2_000_064;
const fields = new Set(SOCIAL_FIELDS.map(({ value }) => value));
const templateKeys = ['backgroundColor', 'backgroundImage', 'createdOn', 'height', 'id', 'layers', 'name', 'preset', 'updatedOn', 'width'];
const layerKeys = ['align', 'color', 'field', 'fill', 'fontFamily', 'fontSize', 'fontWeight', 'height', 'id', 'letterSpacing', 'opacity', 'rotation', 'src', 'text', 'type', 'width', 'x', 'y'];
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const safeID = (value) => isText(value, 160) && !/[.#$[\]/\\]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
const isTimestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function record(value, keys, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    errors.push(`${label} must be a plain object.`);
    return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      errors.push(`${label} has an unsupported key or property: ${String(key)}.`);
      return false;
    }
  }
  return true;
}

function imageSource(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URL_LENGTH) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value);
  if (!match || !match[2]) return false;
  try {
    const bytes = atob(match[2]);
    if (btoa(bytes) !== match[2]) return false;
    if (match[1] === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    if (match[1] === 'jpeg') return bytes.startsWith('\xff\xd8\xff');
    return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}

export function inspectSocialTemplate(value) {
  const errors = [], warnings = [], usedFields = new Set();
  const result = () => ({ errors, warnings, fields: [...usedFields] });
  if (!record(value, templateKeys, 'Template', errors)) return result();
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(safeID(value.id), 'Template id must be a safe ID of at most 160 characters.');
  check(isText(value.name, 100), 'Template name must be trimmed text of 1-100 characters.');
  check(isColor(value.backgroundColor), 'backgroundColor must be a lowercase six-digit hex color.');
  check(isTimestamp(value.createdOn), 'createdOn must be an ISO UTC timestamp.');
  check(isTimestamp(value.updatedOn), 'updatedOn must be an ISO UTC timestamp.');
  if (Object.hasOwn(value, 'backgroundImage')) check(imageSource(value.backgroundImage), 'backgroundImage must be empty or a bounded PNG/JPEG/WebP base64 image.');
  const preset = typeof value.preset === 'string' && Object.hasOwn(SOCIAL_PRESETS, value.preset) ? SOCIAL_PRESETS[value.preset] : null;
  check(Boolean(preset), 'Unknown preset.');
  check(Boolean(preset) && value.width === preset.width && value.height === preset.height, 'Canvas dimensions must exactly match the preset.');
  if (!Array.isArray(value.layers) || value.layers.length > 40) {
    errors.push('layers must be an array with at most 40 layers.');
    return result();
  }
  if (Object.keys(value.layers).length !== value.layers.length || Reflect.ownKeys(value.layers).length !== value.layers.length + 1
    || Array.from({ length: value.layers.length }, (_, index) => Object.getOwnPropertyDescriptor(value.layers, String(index)))
      .some((descriptor) => !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)) {
    errors.push('layers must be a dense array of ordinary JSON values.');
    return result();
  }
  if (!value.layers.length) warnings.push('Template has no layers.');
  const ids = new Set();
  value.layers.forEach((layer, index) => {
    const label = `Layer ${index + 1}`;
    if (!record(layer, layerKeys, label, errors)) return;
    const test = (condition, message) => check(condition, `${label}: ${message}`);
    const number = (key, min, max, integer = true) => test(typeof layer[key] === 'number' && Number.isFinite(layer[key]) && (!integer || Number.isInteger(layer[key])) && layer[key] >= min && layer[key] <= max, `${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
    test(safeID(layer.id), 'invalid id.');
    test(!ids.has(layer.id), 'duplicate id.');
    ids.add(layer.id);
    test(['boundText', 'image', 'shape', 'text'].includes(layer.type), 'invalid type.');
    test(['left', 'center', 'right'].includes(layer.align), 'invalid alignment.');
    test(['400', '600', '700', '800', '900'].includes(layer.fontWeight), 'invalid fontWeight.');
    test(SOCIAL_FONTS.includes(layer.fontFamily), 'unsupported fontFamily.');
    test(isColor(layer.color) && isColor(layer.fill), 'color and fill must be lowercase six-digit hex colors.');
    number('width', 16, preset?.width ?? 0);
    number('height', 16, preset?.height ?? 0);
    number('x', 0, (preset?.width ?? 0) - layer.width);
    number('y', 0, (preset?.height ?? 0) - layer.height);
    number('fontSize', 12, 240);
    number('letterSpacing', 0, 24);
    number('rotation', -180, 180);
    number('opacity', 0.05, 1, false);
    if (layer.type === 'boundText') {
      test(fields.has(layer.field), 'boundText requires a supported field.');
      if (fields.has(layer.field)) usedFields.add(layer.field);
    } else test(!Object.hasOwn(layer, 'field'), 'field is only allowed on boundText.');
    if (layer.type === 'text') test(isText(layer.text, 500), 'text must be trimmed text of 1-500 characters.');
    else test(!Object.hasOwn(layer, 'text'), 'text is only allowed on text layers; use a field for live values.');
    if (layer.type === 'image') {
      test(imageSource(layer.src), 'src must be empty or a bounded PNG/JPEG/WebP base64 image.');
      if (layer.src === '') warnings.push(`${label}: empty image placeholder.`);
    } else test(!Object.hasOwn(layer, 'src'), 'src is only allowed on image layers.');
  });
  if (!usedFields.size) warnings.push('Template has no live field bindings.');
  if (!errors.length && JSON.stringify(value).length > 4_000_000) errors.push('Template exceeds the 4,000,000-character save limit.');
  return result();
}

export function validateSocialTemplate(value) {
  const { errors } = inspectSocialTemplate(value);
  if (errors.length) throw new Error(`Invalid social template: ${errors.join(' ')}`);
  return value;
}
