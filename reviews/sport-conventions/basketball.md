# Basketball broadcast conventions

Reference for authoring and auditing basketball scoreboards. Audit results:
[basketball-audit.md](basketball-audit.md) (table) and `basketball-audit.json` (detail).

## What real basketball graphics always show

| ID | Convention | How it is grouped on air | Live binding |
| --- | --- | --- | --- |
| BK-CLOCK-HERO | The game clock is a hero element beside the scores, not a footer fact | Clock block between or beside the two team scores, as large as the scores | `clockMinutes` / `clockSeconds` |
| BK-CLOCK | Running game clock | Inside the clock block | `clockMinutes`, `clockSeconds` (`gameClock` gives `m:ss`) |
| BK-PERIOD | Period: Q1-Q4, OT1... | Pill next to or under the clock | `periodLabel` (`Q4`, `OT1`); `currentPeriod` is the bare number |
| BK-SHOT | Shot clock in a contrasting colour | Small box beside/under the game clock | `data-sport-stat="shotClock"` alias (whole seconds; empty when the shot clock is disabled). `shotClockStatus` carried in the hidden aux group |
| BK-FOULS | Team fouls per team | Small number under or beside each team | `teamFoulsA` / `teamFoulsB` |
| BK-BONUS | Bonus indicator per team | Chip/lamp on the team that is in the bonus | `bonusA` / `bonusB` (`BONUS` or empty, so `:empty` hides it) |
| BK-TIMEOUTS | Timeouts remaining per team | Pips or a "TO 2" count by each team | `timeoutsRemainingA` / `timeoutsRemainingB` (number) |
| BK-POSS | Possession arrow | Arrow toward the team with the ball | `possessionSide` (`A`, `B` or empty) |
| BK-TO-ACTIVE | Timeout banner | Covers the calling team's row with TIMEOUT and the countdown | `isATimeOutActive` / `isBTimeOutActive` (setVisible), `timeoutClock` |
| - | Team identity | Kit-colour stripe/plate per team, short team name, big score | `jerseyColorA/B`, `combinedAName/BName`, `currentAGameScore/BGameScore` |
| - | Quarter progress / break | Period pips; END-OF-PERIOD / BREAK flag | `isGame1Started`...`isGame5Started` (setVisible), `isInBetweenGames` (opacity) |
| - | Full-screen line score | Q1-Q4 + OT columns, totals, FINAL | `game{N}AScore/BScore`, `isGame{N}Started` for OT columns, `isComplete` |

Corner bugs carry clock, period, shot clock, scores, fouls, bonus, timeouts and possession.
Lower thirds mirror the two teams around a central clock module. Full-screen graphics are
line scores or halftime cards; shot clock and timeout banners are not needed there.

## Authoring rules used for the sport-native set

- Superset: every required field from the server's `template-requirements.json` (live board
  for corner/lower-third, summary board for full-screen) is bound even when hidden by state.
- Stored names, event/round, bonus, possession, timeouts and shot clock are blank; scores
  and game-history scores are `0`; the clock is `00:00`. Previews come from the repository
  fixtures (`sport-samples-v1`), which fill period, clock, shot clock and fouls through the
  `data-osb-static` + `data-sport-stat` sample hooks on the live elements.
- Point-state labels (`isGamePoint`, `isMatchPoint`) and match scores are kept in a hidden
  aux group for contract compatibility; they have no basketball meaning.
- Reduced motion disables every animation/transition.

## Runtime gaps found (Jack decides)

- No per-side possession boolean: `possessionSide` is text, so templates can show "POSS A"
  but cannot draw an arrow on the correct team. Suggest `isAPossession` / `isBPossession`.
- No per-timeout booleans: timeouts remaining is a number, so pip rows are not possible.
- No double-bonus state (`bonusA` is only `BONUS` or empty).
- `isComplete` / `isMatchComplete` and `shotClockStatus` have no runtime display action;
  FINAL flags bound to `isComplete` never toggle.
- Preview fixture gap: `periodLabel` previews as the bare period number (`4`, live `Q4`);
  bonus, timeouts, possession and timeout banners have no fixture sample, so previews show
  them hidden. Adding samples would change the fixture recipe and require regenerating
  every preview, so it was not done here.

## Layout stability (owner rule, 2026-11-18)

Transient conditionals sit in offset slots, overlays or fixed reserved slots and never move other
components (authoring skill section 2a; server check `scripts/qa/template-layout-stability.mjs`).

- Transient here: possession arrow, BONUS, timeout card and countdown, timeout pips, shot clock shown/hidden, period-break banner, clock running indicators.
- Structural here: overtime period columns once played, final.
- Audit of main d1669f9: 2 of 6 pass; BONUS takes width in the fouls row (arena-led, possession-rail), and the period break hides the shot clock (arena-stack recentres the period label) or inserts a row (hardwood-tab).
