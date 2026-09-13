// Mechanically extracted from the public static scoreboard contract. No server runtime imports.
import { readTemplateHTMLTags } from "./static-html.mjs";
import { scoreboardTextDefault } from "./live-field-defaults.mjs";
/** Clear runtime-owned values without reserializing authored tags, styles, or layout. */
export function neutralizeScoreboardTemplateHTML(html        )         {
  return rewriteScoreboardText(html, true);
}

function rewriteScoreboardText(html        , fillEmptyValues         , onText                            )         {
  const tags = readTemplateHTMLTags(html);


  const stack         = [];
  const edits                                        = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const closesParagraph = new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
  let cursor = 0;
  const textOwner = () => {
    for (let index = stack.length - 1; index >= 0; index--) {
      if (stack[index].value !== undefined) return stack[index];
      if (stack[index].separate) break;
    }
  };
  const rememberText = (end        ) => {
    const owner = textOwner();
    const rawText = stack.some((node) => ["style", "script", "title", "textarea"].includes(node.name));
    if (!owner || rawText) return;
    const gap = html.slice(cursor, end);
    let start = cursor;
    for (const comment of gap.matchAll(/<!--[\s\S]*?-->/g)) {
      const stop = cursor + comment.index ;
      if (html.slice(start, stop).trim()) owner.text.push({ start, end: stop });
      start = stop + comment[0].length;
    }
    if (html.slice(start, end).trim()) owner.text.push({ start, end });
  };
  const finishField = (node      ) => {
    if (node.value === undefined) return;
    if (node.text.length) onText?.(node.openEnd);
    node.text.forEach((range, index) => edits.push({ ...range, value: index === 0 ? node.value  : "" }));
    if (fillEmptyValues && !node.text.length && node.value) {
      const start = node.emptySlot ?? node.openEnd;
      edits.push({ start, end: start, value: node.value });
    }
  };
  for (const tag of tags) {
    rememberText(tag.start);
    if (!tag.closing) {
      // This restricted tokenizer does not repair HTML5 implied closures. Reject
      // ambiguous live containers instead of erasing a following static sibling.
      const implied = stack.some((node) => node.name === "p" && closesParagraph.has(tag.name)
        || node.name === "li" && tag.name === "li"
        || ["dt", "dd"].includes(node.name) && ["dt", "dd"].includes(tag.name)
        || ["td", "th"].includes(node.name) && ["td", "th", "tr", "tbody", "tfoot", "thead"].includes(tag.name)
        || node.name === "tr" && ["tr", "tbody", "tfoot", "thead"].includes(tag.name)
        || ["tbody", "thead", "tfoot"].includes(node.name) && ["tbody", "thead", "tfoot"].includes(tag.name));
      if (implied && stack.some((node) => node.value !== undefined)) throw new Error("Use explicit closing tags around scoreboard live fields before importing or saving.");
    }
    if (tag.closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== tag.name) index--;
      if (index >= 0) {
        if (index !== stack.length - 1 && stack.some((node) => node.value !== undefined)) throw new Error("Close every scoreboard live-field element and its children before its container.");
        const node = stack[index];
        const owner = textOwner();
        if (!node.hasChildren && !node.separate && owner && node !== owner) owner.emptySlot ??= node.openEnd;
        stack.slice(index).forEach(finishField);
        stack.length = index;
      }
    }
    if (!tag.closing && stack.length) stack[stack.length - 1].hasChildren = true;
    if (!tag.closing && !voidTags.has(tag.name)) {
      const fields = [...(tag.attributes.class || "").split(/\s+/), tag.attributes["data-osb-field"], tag.attributes["data-field"]];
      const value = fields.filter(Boolean).map((field) => scoreboardTextDefault(field, "live")).find((value) => value !== undefined);
      const separate = ["style", "script", "title", "textarea", "svg"].includes(tag.name)
        || Object.hasOwn(tag.attributes, "data-osb-static") || tag.attributes["aria-hidden"] === "true"
        || Boolean(tag.attributes["data-osb-field"] || tag.attributes["data-field"])
        || fields.some((field) => /^(?:is[A-Z]|courtSideIs|courtSide[AB]View$|country[AB]$|imageURL|teamLogoURL|(?:teamJersey|jersey)Color)/.test(field || ""));
      stack.push({ name: tag.name, value, separate, openEnd: tag.end, hasChildren: false, text: [] });
    }
    cursor = tag.end;
  }
  if (stack.some((node) => node.value !== undefined)) throw new Error("Close every scoreboard live-field element before importing or saving.");
  const output           = [];
  let end = html.length;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output.push(html.slice(edit.end, end), edit.value);
    end = edit.start;
  }
  output.push(html.slice(0, end));
  return output.reverse().join("");
}
