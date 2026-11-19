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
- **Conditional components never move other components (owner rule, 2026-11-18)**: see section 2a.
  A conditional in a row that takes width only while shown fails the rendered check.
- Core match fields (`combinedA/BName`, `jerseyColorA/B`, `currentA/BGameScore`,
  `currentA/BMatchScore`) are required by inspection. When a design legitimately shows other
  fields instead (courtside ends, a summary built on game history), keep the core fields in a
  never-displayed group (`.osb-core-fields{display:none!important}`) rather than showing the
  wrong value.
- Stored values are neutral: names and metadata empty, numbers `0`. Preview text comes from
  `getPreviewDefaults()` / fixtures, never from saved HTML. `neutralizeScoreboardTemplateHTML(html)`
  must return the file unchanged.

## 2a. Layout stability: conditionals live in offset or reserved slots

Owner rule (Jack, 2026-11-18): "for a lot of the conditional components that only show during
certain times, you don't want other components to move around it ... offset it with translate Y or
X ... There should be dedicated like offset spots for most of the things like that, where it becomes
like a temporary box that appears for a little bit and then disappears." Country flags are the
exception. The field-by-field classification is the server repo's
`docs/scoreboard/conditional-layout-classes.json`.

- **Transient** (appears and disappears during play): serve / second server, possession, at-bat,
  game / set / match point (`is[AB]?GamePoint`, `is[AB]?MatchPoint`), active timeout cards and
  countdowns, timeout used / remaining pips, yellow/red cards, between-games / period-break banners
  and `nextGame`, warm-up, deciding set, BONUS, added time, shootout strip, shot clock shown/hidden,
  count / outs / runner dots. Turning one on or off must not move or resize names, scores, games or
  sets, line score, logos, clocks **or any other transient** (a yellow card must not push the hidden
  red card either).
- **Structural** (fixed by match/competition configuration, or changes only at a game/period/match
  boundary): country flags (only when the competition uses flags), logos and player images present
  or absent, singles vs doubles names, the team-match tie strip, home/away and switched ends, game /
  set ledger and line-score columns as games/innings are played (incl. extra innings / overtime),
  pre-match / final presentation, and the break/summary layout of a **full-screen** card. These may
  change layout between configurations or states, never mid-rally.

How the runtime hides things matters: most `is*` fields only set `opacity` (the box stays in
layout), but `is[AB]?TimeOutActive`, `is[AB]TimeOutUsed` and `isGame{N}Started` are toggled with
`display` (none while off), and text transients (`bonusA/B`, `addedTime`, `nextGame`,
`timeOutTimerA/B`, `timeoutClock`) are empty strings while off, so their boxes collapse. Patterns:

```css
/* 1. Offset slot: the chip hangs off an anchor that never grows (absolute + translate). */
.row{position:relative}
.row>.gp{position:absolute;left:100%;top:50%;transform:translate(.6rem,-50%);white-space:nowrap}
.bar>.tob{position:absolute;left:1rem;bottom:100%;transform:translateY(-.3rem)} /* timeout tab above the bar */

/* 2. Reserved fixed slot: the same box shown or hidden; only opacity/visibility change. */
.srv-slot{flex:0 0 1.4rem;height:1.4rem}            /* fixed track in the flex row */
.srv-slot>.isACurrentlyServing{width:100%;height:100%}
.cards{display:grid;grid-template-columns:repeat(2,1.1rem);gap:.25rem} /* both cards always laid out */
.bonus-slot{inline-size:4.2rem}.bonusA:empty{visibility:hidden} /* text transient: fixed width */

/* 3. Overlay: the break banner covers the area it replaces; the covered column keeps its width. */
.pts{position:relative}
.pts>.brk{position:absolute;inset:0;display:grid;place-items:center}
.board:has(.isInBetweenGames[style*="opacity: 1"]) .pts>.num{visibility:hidden} /* not display:none */

/* 4. Transform enter/exit: transforms never affect layout. */
.gp{transition:transform .25s,opacity .25s}.gp[style*="opacity: 0"]{transform:translateY(40%)}
@media (prefers-reduced-motion: reduce){.gp{transition:none}}
```

Never do this to a transient that shares a row with other content:
`.chip[style*="opacity: 0"]{display:none}`, `{width:0}`, `{max-width:0}`, a `:has(<transient>)` rule
that collapses a column or inserts a row, or an in-flow timeout badge / card inside the name
sub-line. Use `visibility:hidden` / `opacity:0` (box kept) instead of `display:none` (box removed)
whenever the element shares a row with stable content; use `display:none` only inside an
offset/overlay slot of its own.

Structural example (allowed): flags reserve their space only when the match uses flags, e.g.
`.board:has(.countryA[src=""]) .flag-col{display:none}`; it changes once per match, not mid-rally.
A pickleball score call that reads the server's score first may swap the two numbers when the serve
changes (a reorder of one sentence, reported as a swap, not a failure).

Check (renders through the real output page; a static lint was evaluated and rejected, see the
server repo's docs/DECISIONS.md 2026-11-18): in the server repo,
`node scripts/qa/template-layout-stability.mjs --templates-dir "<this checkout>" --only <id> --shots /tmp/ls`
toggles every transient on/off (and serve + game point, timeout + game point, card + match point)
and fails when any other element moves or resizes by more than 1 px, or when the in-flow box holding
a transient changes size. `--shots` saves the "on" frame with the moved boxes outlined (cyan: before,
red: after). Its `--ledger` result (`layout-stability.json`, bound to the content hash) is required by
`scoreboard-approval.mjs --check-approved`.

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
  colour behind the scoreboard (judge the full 1920x1080 frame on a checkerboard, not only the crop),
  any component that slides or resizes when a transient (serve, game point, timeout, card, break
  banner) appears or disappears (section 2a).
- Keep variety across the ten: different structures (stacked rows, split, score-left, linescore),
  light and dark, different accent palettes. Ten palette swaps of one layout count as one design.
- Retiring: set `"retired": true` and `"published": false` on the manifest entry and rebuild.
  Never delete the HTML, preview or `published/` blobs; imported user scoreboards are snapshots.
- Commit with a Lore message (why, constraints, tests). Do not push or publish unless asked.
