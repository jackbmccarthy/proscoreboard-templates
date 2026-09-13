// Mechanically extracted from the public static scoreboard contract. No server runtime imports.
import registry from "./runtime-fields.json" with { type: "json" };
import { readTemplateHTMLTags, validateSafeScoreboardTemplateDocument } from "./static-html.mjs";
const SCOREBOARD_RUNTIME_FIELDS = registry.fields;
const CORE_FIELDS = [
  "combinedAName", "combinedBName", "jerseyColorA", "jerseyColorB",
  "currentAMatchScore", "currentBMatchScore", "currentAGameScore", "currentBGameScore"
];
const RUNTIME_FIELDS = new Set([...SCOREBOARD_RUNTIME_FIELDS.map((field) => field.field), "eventName", "matchFormatLabel", "courtName"]);

export function inspectScoreboardTemplate(html        , css        )                               {
  const errors           = [];
  const warnings           = [];
  const fieldMap = new Map                                              ();
  let tags                                          = [];
  let embeddedCSS = "";
  let documentText = "";
  try {
    validateSafeScoreboardTemplateDocument({ html, css });
    const documentTags = readTemplateHTMLTags(html);
    const hiddenTextTags = new Set(["head", "style", "title", "script"]);
    const hiddenStack           = [];
    for (let index = 0; index < documentTags.length; index++) {
      const tag = documentTags[index], next = documentTags[index + 1];
      if (hiddenTextTags.has(tag.name)) {
        if (tag.closing) hiddenStack.pop();
        else hiddenStack.push(tag.name);
      }
      if (!tag.closing && tag.name === "style" && next?.name === "style" && next.closing && !/\bprint\b/i.test(tag.attributes.media || "")) embeddedCSS += `\n${html.slice(tag.end, next.start)}`;
      if (!hiddenStack.length) documentText += ` ${html.slice(tag.end, next?.start ?? html.length).replace(/<!--[^]*?-->/g, " ")}`;
    }
    tags = documentTags.filter((tag) => !tag.closing);
  }
  catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const assets                                         = [];
  const layoutNames = ["rowContainer", "columnContainer", "fixedRowContainer", "fixedColumnContainer", "aspectRatioContainer"];
  const layouts = layoutNames.map((className) => ({ className, count: 0 }));
  for (const tag of tags) {
    const classes = new Set((tag.attributes.class || "").split(/\s+/));
    const declared = tag.attributes["data-osb-field"];
    if (declared && !classes.has(declared)) errors.push(`${declared} metadata must match its actual runtime class on the same element.`);
    if (declared && !RUNTIME_FIELDS.has(declared)) warnings.push(`${declared} is not in the AI capability registry; confirm its native runtime binding.`);
    const runtimeFields = [...classes].filter((field) => RUNTIME_FIELDS.has(field) || field === declared);
    if (runtimeFields.includes("isGamePoint") && runtimeFields.includes("isMatchPoint")) errors.push("Game point and match point require separate sibling elements in a shared slot, not conflicting classes on one element.");
    else if (runtimeFields.length > 1) warnings.push(`Multiple runtime fields share a ${tag.name} element; confirm their updates do not conflict.`);
    for (const field of runtimeFields) {
      const current = fieldMap.get(field) || { count: 0, tags: new Set        () };
      current.count++;
      current.tags.add(tag.name);
      fieldMap.set(field, current);
      if (SCOREBOARD_RUNTIME_FIELDS.find((candidate) => candidate.field === field)?.valueType === "image" && tag.name !== "img") {
        errors.push(`${field} must use an img element for runtime image updates.`);
      }
    }
    for (const layout of layouts) if (classes.has(layout.className)) layout.count++;
    const component = tag.attributes["data-osb-component"];
    if (component === "layout" && !layoutNames.some((name) => classes.has(name))) {
      // Custom CSS grid/flex layouts are valid and must not be forced into a column.
      warnings.push("A custom layout uses authored CSS; verify it at its intended viewport.");
    }
    const role = tag.attributes["data-osb-asset-role"];
    if (role) {
      assets.push({ role, tagName: tag.name });
      if (tag.name !== "img" || !["background-art", "decoration", "event-logo", "sponsor-logo"].includes(role)) errors.push(`Unsupported static asset role ${role}; use an img with a supported asset role.`);
    }
  }
  const fields = [...fieldMap.entries()].map(([field, value]) => ({ count: value.count, field, tags: [...value.tags] })).sort((a, b) => a.field.localeCompare(b.field));
  CORE_FIELDS.forEach((field) => {
    const count = fieldMap.get(field)?.count || 0;
    if (!count) errors.push(`${field} requires at least one runtime class.`);
  });
  fields.filter((field) => field.count > 1).forEach((field) => warnings.push(`${field.field} is repeated ${field.count} times; all instances receive runtime updates.`));
  const serveA = tags.filter((tag) => (tag.attributes.class || "").split(/\s+/).includes("isACurrentlyServing") && Object.hasOwn(tag.attributes, "isa")).length;
  const serveB = tags.filter((tag) => {
    const classes = (tag.attributes.class || "").split(/\s+/);
    return classes.includes("isBCurrentlyServing") || (classes.includes("isACurrentlyServing") && !Object.hasOwn(tag.attributes, "isa"));
  }).length;
  if (serveA !== serveB) errors.push("Service indicators must include matching A and B fields.");
  if (!serveA && !serveB) warnings.push("This template has no service indicators.");
  for (const [field, pattern] of [["matchFormatLabel", /\bbest\s*[- ]?\s*of\s*\d+\b/i], ["courtName", /\b(?:court|table)\s*(?:no\.?\s*|#\s*)?(?:\d+|[a-z])\b/i]]         ) {
    if (!fieldMap.has(field) && pattern.test(documentText)) warnings.push(`${field} is not bound; review the static ${field === "courtName" ? "court/table" : "match format"} label before use.`);
  }
  const effectiveCSS = `${embeddedCSS}\n${css}`;
  const transparentRoot = [...effectiveCSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(([, selectors, declarations]) => selectors.split(",").some((selector) => /^(?:html|body)(?:[.#][\w-]+)*$/.test(selector.trim())) && /(?:^|;)\s*background(?:-color)?\s*:\s*transparent\s*(?:!important\s*)?(?:;|$)/i.test(declarations));
  if (!transparentRoot) {
    warnings.push("Confirm that the document root remains transparent.");
  }
  if (!layouts.some((layout) => layout.count > 0)) warnings.push("No runtime layout container is declared; verify the authored layout at its target size.");
  return { assets, errors: [...new Set(errors)], fields, layouts, warnings: [...new Set(warnings)] };
}
