# Soccer (football) broadcast conventions

Reference for authoring and auditing soccer scoreboards. Audit results:
[soccer-audit.md](soccer-audit.md) (table) and `soccer-audit.json` (detail).

## What real soccer graphics always show

| ID | Convention | How it is grouped on air | Live binding |
| --- | --- | --- | --- |
| SC-CENTRAL | One-line "ABC 1 - 0 XYZ": the two scores sit together in the middle, team names outside | Central score block flanked by names with kit-colour chips/shields | `currentAGameScore` / `currentBGameScore`, `combinedAName/BName`, `jerseyColorA/B` |
| SC-CLOCK | Running match clock (counts up, 67:24) | Clock block at the left of the bug or right of the strip | `clockMinutes`, `clockSeconds` |
| SC-ADDED | Added/stoppage time "+3" | Small tab hanging off the clock | `addedTime` (`+3` or empty); `addedTimeVisible` class on the wrapper |
| SC-HALF | Half / period indicator | Small label next to/under the clock | `periodLabel` (`H1`, `H2`, `ET1`) |
| SC-RED | Red cards on the team | Small red card rectangle beside the team name | `isARedCarded` / `isBRedCarded` (opacity), `redCardsA/B` count |
| SC-YELLOW | Yellow cards (summary graphics and some bugs) | Yellow card rectangle beside the team or a discipline table | `isAYellowCarded` / `isBYellowCarded`, `yellowCardsA/B` |
| SC-PENS | Penalty shootout score | "PENS 4-3" line under the score during a shootout | `shootoutAScore` / `shootoutBScore`; `shootoutAttempts` class on the container |
| SC-BREAK | Half-time / break state | HT replaces the clock; HALF-TIME flag on full-screens | `isInBetweenGames` (opacity) |
| - | Live indicator | Small blinking dot while play is live | `isMatchStarted` (opacity), animation removed under reduced motion |
| - | Summary | Final score, half-by-half goals, extra time rows, discipline | `game1..4A/BScore`, `isGame3/4Started` for ET rows, cards, `teamFoulsA/B`, `isComplete` |

Team fouls are not a soccer broadcast stat on scorebugs; they belong only in summary
statistics. Aggregate scores for two-legged ties are a common convention but the runtime has
no aggregate field.

## Authoring rules used for the sport-native set

- Superset: every required field from the server's `template-requirements.json` is bound.
  Fields without a runtime action (`addedTimeVisible`, `shootoutAttempts`, `isComplete`) are
  present as classes so the requirement audit passes, but cannot toggle on their own.
- The penalties line is hidden by default (`display: none`): the runtime has no
  shootout-active flag and the shootout score is `0`, not empty, outside a shootout.
  Operators can reveal it in the editor for a shootout.
- Stored names, event/round, added time and card counts are blank; scores `0`; clock `00:00`.
  Previews come from repository fixtures (clock, half and fouls via sample hooks); cards,
  added time and HT have no fixture sample and preview hidden.
- Reduced motion disables the live-dot animation and all transitions.

## Runtime gaps found (Jack decides)

- No shootout-active boolean (`shootoutAttempts` is an array the template runtime cannot read).
- No aggregate score field for two-legged ties; no team short-code (ABC) field, so names are
  truncated with ellipsis instead.
- `isComplete` has no runtime display action, so FULL TIME flags never toggle; HALF-TIME uses
  `isInBetweenGames`, which is also true at the break before extra time.
- Preview fixture gap: `periodLabel` previews as `2` (live `H2`); cards, added time and HT are
  not in the fixture, so previews show them hidden.

## Layout stability (owner rule, 2026-11-18)

Transient conditionals sit in offset slots, overlays or fixed reserved slots and never move other
components (authoring skill section 2a; server check `scripts/qa/template-layout-stability.mjs`).

- Transient here: yellow/red cards, +N added time, half-time banner, penalty shootout strip.
- Structural here: extra-time columns once played, final and decided-on-penalties presentation.
- Audit of main d1669f9: 0 of 4 pass; cup tie, kit split and night slant collapse the card chips (`[style*="opacity: 0"]{width:0}`) so a card slides the name or the other hidden card; the full-time poster moves its header rows 113 px when the shootout strip appears.
