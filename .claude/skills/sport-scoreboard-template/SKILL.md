---
name: sport-scoreboard-template
description: Author, curate or retire ProScoreboard scoreboard templates (corner bug, lower third, full-screen, courtside) for a sport in this repository. Use when asked to make new scoreboards for a sport, recreate broadcast graphics in HTML/CSS, bind native runtime fields and conditional is* show/hide elements, render previews, or prune the gallery to the best designs per sport and placement.
---

# Sport scoreboard templates

A good template looks like the scoreboard a viewer of that sport already knows, and every live
value and state the production scoreboard can drive is wired into it. Quality over quantity:
**at most 10 active templates per sport per placement.** Retire weaker designs instead of piling
up variants (`tools/curation.test.mjs` enforces the cap).

Read `AGENTS.md` and `README.md` first; they are binding (no scripts in HTML, neutral stored
values, append-only `published/`, no new dependencies, Node 22).

## 1. Study the sport, then design

- Look at real broadcast and venue graphics of the sport (TV scorebugs, league lower thirds,
  arena boards, end-of-match line scores). Note what is always on screen, how it is grouped and
  what is emphasised. Recreate the *conventions* in original HTML/CSS. Never copy protected
  logos, wordmarks, league/broadcaster branding, typefaces you cannot ship, or real names.
- Per-sport conventions and the audits of earlier designs live in `reviews/sport-conventions/`:
  [baseball](../../../reviews/sport-conventions/baseball.md),
  [softball](../../../reviews/sport-conventions/softball.md),
  [basketball](../../../reviews/sport-conventions/basketball.md),
  [soccer](../../../reviews/sport-conventions/soccer.md),
  [volleyball](../../../reviews/sport-conventions/volleyball.md),
  [pickleball](../../../reviews/sport-conventions/pickleball.md). Condensed:
  - **Table tennis**: two competitor rows (combined name covers doubles pairs), games won and
    current points side by side with points dominant, a server indicator per side, neutral
    GAME POINT / MATCH POINT label, per-game history columns that appear as games start,
    best-of label, time-out and yellow/red card badges. Courtside boards show the player *at each
    court end* (courtSide* fields) so ends swap with `isSwitched` / a flipped board.
  - **Pickleball**: score call (server-receiver-server number), serving team plus doubles server
    number, games won, game history, timeouts.
  - **Volleyball**: sets won beside current-set points, serve indicator, set history, timeouts.
  - **Basketball**: game clock as a hero beside the scores, period, shot clock, team fouls and
    bonus, timeouts remaining, possession arrow.
  - **Soccer**: central `ABC 1-0 XYZ` with the running clock, added time, half, red cards,
    penalty shootout and break states.
  - **Baseball / softball**: runs (with H/E on line scores), inning with top/bottom arrow,
    base diamond, balls-strikes count and outs; softball uses its own inning count.
- A table tennis layout recoloured for another sport is not acceptable; that is what was retired
  on 2026-11-13.

## 2. Binding contract

- Live fields are elements whose class is the runtime field name, with matching
  `data-osb-component="field" data-osb-field="<name>"` (layouts use `data-osb-component="layout"`).
  The public registry is `contract/runtime-fields.json`; `inspectTemplate()` lists unknown names
  as warnings and missing core fields as errors.
- **Superset rule**: the server repo's `docs/scoreboard/template-requirements.json` lists, per
  sport and board (`live` for corner/lower-third, `summary` for full-screen, `courtside`), every
  required field. A template must contain every supported field *and* every conditional
  `is*` show/hide element for its board, even ones hidden in the current state, so the
  production runtime can show them. Check with the server's static checker:
  `node scripts/qa/template-check.mjs <file> --sport <sport> --board live|summary|courtside`
  (prints `N/N required fields present`).
- Conditional elements: the class sits on the element that shows the badge, it starts hidden
  (`style="opacity:0"` or the pattern the existing sport set uses), and lives in a fixed-size slot
  so showing it causes no layout shift. Game point and match point are separate sibling labels in
  one shared slot, with `slot:has(>.isMatchPoint[style*="opacity: 1"])>.isGamePoint{opacity:0!important}`
  and reduced-motion support for any animation. Service indicators stay separate per side
  (`isACurrentlyServing isA="true"` / `isBCurrentlyServing`).
- Core match fields (`combinedA/BName`, `jerseyColorA/B`, `currentA/BGameScore`,
  `currentA/BMatchScore`) are required by inspection. When a design legitimately shows other
  fields instead (courtside ends, a summary built on game history), keep the core fields in a
  never-displayed group (`.osb-core-fields{display:none!important}`) rather than showing the
  wrong value.
- Stored values are neutral: names and metadata empty, numbers `0`. Preview text comes from
  `getPreviewDefaults()` / fixtures, never from saved HTML. `neutralizeScoreboardTemplateHTML(html)`
  must return the file unchanged.

## 3. Authoring workflow

1. Write `templates/html-replications/starter-<sport>-<placement>-<slug>.html` (full document,
   embedded `<style>`, no scripts). The `starter-` prefix makes the app save a private copy on import.
   **Transparent page backdrop (owner rule, 2026-11-18).** The output is composited over live video,
   so everything behind the scoreboard is transparent, for every placement including full-screen:
   `html`, `:root`, `body`, `main` used as a page wrapper, and any stage/canvas that covers the
   viewport (`position:fixed;inset:0`, `100vw`x`100vh`) get no background, box-shadow, vignette,
   overlay or backdrop-filter. Paint colour only on the scoreboard's own panels, bars, chips and
   cards (and its conditional cards). A full-screen design is a card on a transparent page, not a
   painted frame. If a panel is translucent and was meant to sit on a page colour, give the panel
   that ground itself (for a gradient that must line up across panels:
   `background:linear-gradient(<tint>,<tint>),var(--panel-ground) fixed`). A design whose whole frame
   is the graphic needs an owner decision in `tools/transparent-backdrop-exemptions.json` (bound to
   its content hash). `node tools/check-transparent-backdrop.mjs` (also run by `npm test`) checks the
   CSS; the server repo's `scripts/qa/template-transparency.mjs --templates-dir <checkout> --check`
   renders every published template through the real output page and fails on any opaque pixel
   outside the scoreboard.
2. Add a manifest entry in `templates/html-replications/manifest.json`: `output`, `title`,
   `published: true`, `placement` (`corner`, `lower-third`, `full-screen`, `courtside`), `palette`,
   `motif`, `tags`, `description` (what is bound and what is hidden by default), `sport`,
   `scoringMode: "native"`, `runtimeSupport`, `aliases: []`. Only set `defaultForSports` when you
   mean to change a sport's default; at most one active default per sport.
3. Validate: `validateSafeScoreboardTemplateDocument({html, css: ''})` and
   `inspectTemplate(html).errors` must be empty.
4. `npm run catalog`, then render previews for the new/changed files:
   `PLAYWRIGHT_MODULE_PATH=<server repo>/node_modules/playwright/index.mjs npm run previews -- --only <file.html>`
   and `npm run catalog` again. After editing an existing document run
   `node tools/build-catalog.mjs --invalidate-stale-previews` first.
5. Run `npm run lint`, `npm run catalog:check`, `npm test`, `npm run previews:check`,
   `npm run audit:export`.
6. App-side check from the server repo (reads this checkout exactly as the app reads GitHub):
   `node --import tsx scripts/qa/template-source-check.mjs --dir "<this checkout>"`; it must pass
   and prints active counts per sport and placement.
7. Live check: the server repo's `scripts/qa/template-live.mjs` puts templates on a real
   scoreboard and plays a match through the scoring API; its `--repo` mode (being added) runs it
   against this repository's templates. Use it before claiming a template works live.

## 4. Quality bar and curation

- Look at **every** rendered PNG (`previews/<hash>.png`, path in `catalog.json`). Build a contact
  sheet per sport and placement to compare. Reject: truncated names, tiny unreadable text, empty
  boxes, clutter that is not live data, wrong-sport furniture, inconsistent A/B alignment, any
  colour behind the scoreboard (judge the full 1920x1080 frame on a checkerboard, not only the crop).
- Keep variety across the ten: different structures (stacked rows, split, score-left, linescore),
  light and dark, different accent palettes. Ten palette swaps of one layout count as one design.
- Retiring: set `"retired": true` and `"published": false` on the manifest entry and rebuild.
  Never delete the HTML, preview or `published/` blobs; imported user scoreboards are snapshots.
- Commit with a Lore message (why, constraints, tests). Do not push or publish unless asked.
