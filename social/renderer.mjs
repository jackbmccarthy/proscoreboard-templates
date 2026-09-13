// Browser-only counterpart of features/socialGraphics/socialGraphicExport.ts.
// Cover cropping, center-origin rotation, line height and alignment mirror the app.
export const SAMPLE_VALUES = Object.freeze({ championName: 'Champion Name', winnerName: 'Winner Name', loserName: 'Runner-up', competitorA: 'Competitor A', competitorB: 'Competitor B', scoreA: '0', scoreB: '0', eventName: 'Event name', roundLabel: 'Final', dateLabel: 'Event date', statusLabel: 'Final' });

export function safeImageSource(source) {
  if (typeof source !== 'string' || source.length > 2_000_064) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(source);
  if (!match || !match[2]) return false;
  try {
    const bytes = atob(match[2]);
    if (btoa(bytes) !== match[2]) return false;
    if (match[1] === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    if (match[1] === 'jpeg') return bytes.startsWith('\xff\xd8\xff');
    return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}
async function loadImage(source) {
  if (!safeImageSource(source)) throw new Error('Only embedded PNG, JPEG or WebP images can be rendered.');
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = () => reject(new Error('An imported image could not be rendered.')); image.src = source;
  });
  if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('Imported image exceeds 32 megapixels.');
  return image;
}
function drawCoverImage(context, image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sw = width / scale; const sh = height / scale;
  context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, width, height);
}
export function getWrappedLines(context, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (context.measureText(candidate).width <= maxWidth) current = candidate;
      else { lines.push(current); current = word; }
    }
    lines.push(current);
  }
  return lines;
}
function drawTextLayer(context, layer, value) {
  context.beginPath(); context.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height); context.clip();
  context.fillStyle = layer.color;
  context.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
  context.textAlign = layer.align; context.textBaseline = 'top';
  const x = layer.align === 'center' ? 0 : layer.align === 'right' ? layer.width / 2 : -layer.width / 2;
  const lineHeight = layer.fontSize * 1.08;
  getWrappedLines(context, value, layer.width).slice(0, Math.max(1, Math.floor(layer.height / lineHeight))).forEach((line, index) => {
    const y = -layer.height / 2 + index * lineHeight;
    if (layer.letterSpacing <= 0) { context.fillText(line, x, y, layer.width); return; }
    const characters = [...line]; const widths = characters.map((c) => context.measureText(c).width);
    const lineWidth = widths.reduce((sum, width) => sum + width, 0) + layer.letterSpacing * Math.max(0, characters.length - 1);
    // Retain tracking while fitting unbreakable names inside the authored rectangle.
    const scale = Math.min(1, layer.width / Math.max(1, lineWidth));
    context.save(); context.scale(scale, 1); context.textAlign = 'left';
    let cx = layer.align === 'center' ? -lineWidth / 2 : layer.align === 'right' ? layer.width / (2 * scale) - lineWidth : -layer.width / (2 * scale);
    characters.forEach((c, i) => { context.fillText(c, cx, y); cx += widths[i] + layer.letterSpacing; });
    context.restore();
  });
}
export function hitTestLayer(layer, x, y) {
  const radians = -layer.rotation * Math.PI / 180;
  const dx = x - layer.x - layer.width / 2; const dy = y - layer.y - layer.height / 2;
  return Math.abs(dx * Math.cos(radians) - dy * Math.sin(radians)) <= layer.width / 2 && Math.abs(dx * Math.sin(radians) + dy * Math.cos(radians)) <= layer.height / 2;
}
export async function renderSocialGraphic(template, values = {}) {
  if (!Number.isFinite(template.width) || !Number.isFinite(template.height) || template.width <= 0 || template.height <= 0 || template.width * template.height > 32_000_000) throw new Error('Invalid canvas dimensions.');
  const canvas = document.createElement('canvas'); canvas.width = template.width; canvas.height = template.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering is unavailable.');
  context.fillStyle = template.backgroundColor; context.fillRect(0, 0, canvas.width, canvas.height);
  if (template.backgroundImage) drawCoverImage(context, await loadImage(template.backgroundImage), 0, 0, canvas.width, canvas.height);
  for (const layer of template.layers) {
    if (layer.type === 'image' && !layer.src) continue;
    context.save(); context.globalAlpha = layer.opacity;
    context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2); context.rotate(layer.rotation * Math.PI / 180);
    try {
      if (layer.type === 'shape') { context.fillStyle = layer.fill; context.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height); }
      else if (layer.type === 'image') drawCoverImage(context, await loadImage(layer.src), -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      else drawTextLayer(context, layer, layer.type === 'boundText' ? String(values[layer.field] ?? '') : layer.text || '');
    } finally { context.restore(); }
  }
  return canvas;
}
