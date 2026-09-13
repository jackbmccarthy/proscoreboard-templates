// Mechanically extracted from the public static scoreboard contract. No server runtime imports.


function decodeAttribute(value        ) {
  return value.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_match, code        ) => {
    const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\ufffd";
  }).replace(/&(amp|quot|apos|lt|gt|colon|tab|newline);/gi, (_match, name        ) =>
    ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", tab: "\t", newline: "\n" })[name.toLowerCase()] || "");
}

// A deliberately restricted HTML tokenizer: reject ambiguous syntax instead of repairing it.
export function readTemplateHTMLTags(html        )                    {
  const tags                    = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) break;
    // Quoted values can contain angle brackets, so locate the end before parsing attributes.
    let end = start + 1;
    let quote = "";
    if (html.startsWith("<!--", start)) {
      end = html.indexOf("-->", start + 4);
      if (end < 0) throw new Error("Close the HTML comment before saving.");
      cursor = end + 3;
      continue;
    }
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === html.length) throw new Error("Close the HTML tag before saving.");
    const raw = html.slice(start, end + 1);
    if (/^<!doctype\s+html\s*>$/i.test(raw)) { cursor = end + 1; continue; }
    const prefix = /^<(\/?)([a-z][\w-]*)\b/i.exec(raw);
    if (!prefix) throw new Error("Unsupported HTML syntax; encode literal < characters as &lt;.");
    const attributes                         = {};
    let offset = prefix[0].length;
    const attribute = /\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
    while (!/^\s*\/?\s*>$/.test(raw.slice(offset))) {
      attribute.lastIndex = offset;
      const match = attribute.exec(raw);
      if (!match) throw new Error("Unsupported HTML attribute syntax; quote attribute values.");
      const name = match[1].toLowerCase();
      if (Object.hasOwn(attributes, name)) throw new Error(`Remove duplicate ${name} attributes.`);
      attributes[name] = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "");
      offset = attribute.lastIndex;
    }
    const tag = { name: prefix[2].toLowerCase(), attributes, start, end: end + 1, closing: Boolean(prefix[1]) };
    tags.push(tag);
    cursor = end + 1;
    if (!tag.closing && ["style", "title", "textarea", "script"].includes(tag.name)) {
      const closing = new RegExp(`</${tag.name}\\s*>`, "gi");
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) throw new Error(`Close the ${tag.name} element before saving.`);
      cursor = match.index;
    }
  }
  return tags;
}

export function assertTemplateAssetURL(value        , context        , allowSVG = false) {
  const url = value.trim();
  if (!url || url.startsWith("#")) return;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) return;
  if (allowSVG && /^data:image\/svg\+xml[;,]/i.test(url)) return; // Only used in inert image contexts.
  if (/^\/(?!\/)/.test(url) && !/[\\\u0000-\u001f]/.test(url)) return;
  try {
    const parsed = new URL(url);
    if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !/[\\\u0000-\u0020]/.test(url)) return;
  }
  catch { /* Relative dependencies require a known hosting location. */ }
  throw new Error(`${context}: use an absolute HTTP(S) URL, a site-root /asset path, or an embedded image; relative or executable dependencies are unsupported.`);
}

export function assertSafeTemplateCSS(css        ) {
  const decoded = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
    (_match, hex                    , character                    ) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character || "");
  const withoutFonts = decoded.replace(/@import\s+url\(\s*(["'])https:\/\/fonts\.googleapis\.com\/css2?\?[^"']+\1\s*\)\s*;/gi, "");
  if (/@import|expression\s*\(|(?:javascript|vbscript)\s*:|behavior\s*:|-moz-binding|<\s*\/\s*style/i.test(withoutFonts)) {
    throw new Error("Scoreboard template contains unsupported executable content or a stylesheet dependency; inline external CSS before importing.");
  }
  for (const match of decoded.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    assertTemplateAssetURL(match[1] ?? match[2] ?? match[3], "CSS asset", true);
  }
  if (/image-set\s*\(/i.test(decoded)) throw new Error("Replace image-set() with explicit url() assets before importing.");
}

export function validateSafeScoreboardTemplateDocument(input                                 ) {
  if ((input.html !== undefined && typeof input.html !== "string") || (input.css !== undefined && typeof input.css !== "string")) {
    throw new Error("Template HTML and CSS must be strings; use an empty string for an unfinished draft.");
  }
  const html = typeof input.html === "string" ? input.html : "";
  const css = typeof input.css === "string" ? input.css : "";
  if (html.length > 500_000 || css.length > 500_000) throw new Error("The scoreboard document is too large to save.");
  assertSafeTemplateCSS(css);
  const allowedTags = new Set("html head body title meta style main section article aside header footer nav div span p b i u s em strong small label h1 h2 h3 h4 h5 h6 img picture source br hr table thead tbody tfoot tr td th col colgroup ul ol li dl dt dd figure figcaption a time abbr sup sub wbr".split(" "));
  const tags = readTemplateHTMLTags(html);
  for (const tag of tags) {
    if (!allowedTags.has(tag.name)) throw new Error(`Scoreboard template contains unsupported executable content or element <${tag.name}>; use static HTML and image assets.`);
    if (tag.closing) continue;
    const attrs = tag.attributes;
    if (tag.name === "meta" && !(Object.keys(attrs).every((key) => ["charset", "name", "content"].includes(key)) && (attrs.charset || attrs.name === "viewport"))) {
      throw new Error("Only charset and viewport metadata are supported; remove refresh and external dependencies.");
    }
    for (const [name, value] of Object.entries(attrs)) {
      if (/^on/i.test(name) || /^data-gjs-(?:script|components|attributes|content)/i.test(name)
        || (name === "data-gjs-type" && /^(?:script|iframe|object|embed|link|form|svg)$/i.test(value.trim()))
        || ["srcdoc", "srcset", "ping", "is", "xmlns", "xlink:href", "action", "formaction", "background", "codebase"].includes(name)) {
        throw new Error(`Scoreboard template contains unsupported executable content or ${name}; use explicit static assets.`);
      }
      if (name === "style") assertSafeTemplateCSS(value);
      if (name === "data-gjs-style") {
        let style         ;
        try { style = JSON.parse(value); }
        catch { throw new Error("data-gjs-style must contain valid JSON CSS declarations."); }
        if (!style || typeof style !== "object" || Array.isArray(style)) throw new Error("data-gjs-style must be an object of CSS declarations.");
        assertSafeTemplateCSS(Object.entries(style).map(([property, declaration]) => `${property}:${String(declaration)}`).join(";"));
      }
      if (["src", "href", "poster"].includes(name)) assertTemplateAssetURL(value, `${tag.name} ${name}`, name !== "href");
    }
    if (tag.name === "style") {
      const close = tags.find((candidate) => candidate.closing && candidate.name === "style" && candidate.start >= tag.end);
      assertSafeTemplateCSS(html.slice(tag.end, close?.start));
    }
  }
  return { html, css };
}
