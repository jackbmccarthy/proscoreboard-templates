# Volleyball broadcast conventions

Reference: FIVB/VNL, NCAA and pro-league indoor broadcast graphics, plus beach (best of 3) tour bugs.
Runtime preset: `fivb-indoor-2025` (best of 5, sets to 25, deciding set to 15, 2 timeouts per set).

## What a volleyball graphic always shows

| ID | Convention | How broadcasts group it | Live field(s) |
| --- | --- | --- | --- |
| V1 | **Sets won next to current-set points** | One row per team: name, then a small sets-won box, then the large current-set points. Sets never sit in a footer. | `currentAMatchScore`/`currentBMatchScore` (= sets won; `setsWonA/B` share the element), `currentAGameScore`/`currentBGameScore` (current set points) |
| V2 | **Serve indicator** | A ball icon or bar beside the serving team's points; there is always exactly one serving team. | `isACurrentlyServing` (isA) / `isBCurrentlyServing` |
| V3 | **Current set number** | "SET 3" tag on the bug, never a generic "period" footer. | `data-sport-stat="set"` alias (runtime `currentPeriod`) |
| V4 | **Set history** | Completed-set scores in compact columns (25-21, 22-25, ...), winner's number emphasised, current set highlighted. | `game{N}AScore`/`game{N}BScore` revealed by `isGame{N}Started` |
| V5 | **Timeouts** | Two pips per team per set; a used pip dims; an active timeout shows a countdown badge. | `isATimeOutUsed`, `isATimeOutActive`, `timeOutTimerA`, `timeoutsRemainingA` (+ B) |
| V6 | **Set point / match point** | Neutral banner on the bug ("SET POINT", "MATCH POINT" takes precedence). | `isGamePoint` (= set point), `isMatchPoint` |
| V7 | **Deciding set** | "DECIDING SET" / "SET 5" accent when the 5th set starts. | `isGame5Started` (no `decidingSet` binding exists; see gaps) |
| V8 | Team identity | Kit colour chip or bar per team; team names, not player names. | `jerseyColorA/B` |
| V9 | Event context | Event name / round in a tab or header (lower thirds and full screens). | `eventName`, `matchRound` |
| V10 | Set break | Between-set state label; full-screen set-by-set summary. | `isInBetweenGames` |

Not volleyball: penalty cards in the status rail, "GAMES" labels, table-tennis server numbers.

## Placement expectations

- **Corner scorebug**: V1, V2, V3, V6 mandatory; V5 pips and compact V4 expected.
- **Lower third**: V1-V6 plus V9.
- **Full screen** (set break / final): set-by-set table (V4) dominant, sets won (V1), timeouts or result.

## Runtime gaps found while writing this spec

- `decidingSet` and `currentGame` are projected by the server but have no template binding
  (`fieldDispatcher` only binds registry classes and `multiSportFieldList`). Templates use `isGame5Started`
  and the `set` stat alias as stand-ins. Beach (best of 3) deciding set cannot be distinguished.
- `timeoutsRemainingA/B` are bindable but are not in the preview fixture, so previews show them blank.
- Only one "timeout used" boolean per team exists, so the second used timeout cannot dim a second pip.
