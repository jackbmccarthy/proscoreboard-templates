# Baseball broadcast conventions

Written 2026-11-13 for Jack's sport-native template review. It describes what real TV and stream
baseball graphics show and how they group it. The audit in [baseball-audit.md](baseball-audit.md)
measures the published templates against it.

## What every live baseball graphic shows

1. **Teams and runs.** Two team rows, with the visiting team on top by convention. Runs (R) are the
   largest number on the graphic. Team colours run as a slab or chip beside each name.
2. **Base diamond.** Three bases (second at the top, third on the left, first on the right) drawn as
   rotated squares. Occupied bases are lit. This is the single most recognisable baseball element.
   The diamond sits next to the count, not apart from it.
3. **The count, as one group.** Balls and strikes read together as `B-S` (for example `2-1`). Outs
   sit right next to them (`1 OUT`, or two out dots). Balls, strikes and outs share one cluster.
   They are never spread through a footer of loose facts.
4. **Inning with a half indicator.** The inning number has a top/bottom arrow (▲ for the top half,
   ▼ for the bottom). Words like "TOP 6" or "BOT 6" are also used. A plain "INNING 6" label loses the
   half, which viewers rely on.
5. **Situation box.** The inning, diamond, count and outs together form the "situation". Scorebugs
   keep them in one compact block beside the score block.

## Common, often optional

- **R / H / E.** Hits and errors appear as smaller columns after runs on fuller bugs and on all line
  scores.
- **Line score.** A row of innings 1 to 9 with per-inning runs, then R H E. Unplayed innings stay
  blank. Extra-inning columns appear only when they are played. This is the standard
  between-innings and final graphic.
- **Inning progress.** A pip or tick per inning, lit as the game advances.
- **Event / round tab** over the bug. A "LIVE" mark once the game starts. An "INNING BREAK" / "MID" /
  "END" state between halves. A "FINAL" badge on summaries.
- Pitch count, batter/pitcher names and pitch speed appear on network bugs. The runtime does not
  provide them, so they are out of scope.

## What a table-tennis derivative looks like (anti-patterns)

- Two name rows with a small side stat in the games-won slot ("HITS 7"). A big score. Then a footer
  strip of text facts: `INNING 6 | BALLS 2 | STRIKES 1 | OUTS 1`.
- No diamond. No count grouping. No half-inning indicator. Counters are static text that never updates.

## Runtime fields (OpenScoreboard Server, native diamond records)

| Need | Field | Binding notes |
| --- | --- | --- |
| Names / colours | `combinedAName`, `combinedBName`, `jerseyColorA/B` | registry fields |
| Runs | `currentAGameScore`, `currentBGameScore` | projected for native records |
| Hits / errors | `hitsA/B`, `errorsA/B` | text, class or `data-sport-stat` alias |
| Inning | `inning` | number |
| Half | `inningHalf` (`top`/`bottom`), `halfInning` (`TOP`/`BOTTOM`) | text only |
| Count | `balls`, `strikes`, `outs` | numbers, text only |
| Bases | `bases` | text list such as `1,3`; **no per-base state** |
| Batting side | `battingSide` (`A`/`B`) | text only |
| Line score | `game{N}AScore/BScore`, `isGame{N}Started` | N>9 bind as extended history (opacity only) |
| States | `isMatchStarted`, `isInBetweenGames` | opacity booleans |
| Summary | `isComplete` | **not bound by the scoreboard runtime** |

How the new templates handle the text-only fields:

- **Half-inning arrow.** `inningHalf` is drawn in a monospace font in a 3ch window. "top" is 3ch wide
  and "bottom" is 6ch, so the text width slides a two-arrow strip and lights ▲ or ▼. No script is
  needed. Empty text lights neither.
- **Count dots.** The count cannot become live dots. CSS cannot turn a digit into N dots without a
  custom font, and the safety contract only allows image data URLs. So the count is numeric (`2-1`,
  `1 OUT`).
- **Bases.** The `.diamond > .base.<first|second|third>` markers are the repository's established
  convention, and preview fixtures light them. At runtime they stay unlit, because `bases` is only a
  string. The live list (`1,3`) is printed under the diamond so operators still see runners.

Runtime gaps to close: per-base booleans (for example `isRunnerOnFirst/Second/Third`), or a
`data-osb-value` attribute written for text fields. A count/outs pip representation, and an
`isComplete` conditional binding.

## Layout stability (owner rule, 2026-11-18)

Transient conditionals sit in offset slots, overlays or fixed reserved slots and never move other
components (authoring skill section 2a; server check `scripts/qa/template-layout-stability.mjs`).

- Transient here: count dots, outs dots, runner diamond, at-bat marker, half-inning break banner.
- Structural here: line-score columns as innings are played (incl. extra innings), final.
- Audit of main d1669f9: 8 of 8 pass. Advisory only: the half-inning label ("Top 1" -> "Bottom 1") and the blanked count text at the break change text width and shift a neighbour; keep those labels in fixed-width boxes.
