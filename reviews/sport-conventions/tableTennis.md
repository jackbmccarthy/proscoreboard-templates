# Table tennis broadcast conventions

Reference: ITTF / WTT (Champions, Contender, Star Contender) and Olympic table tennis broadcast graphics, national-league and
club streams. Runtime: legacy racket engine (best of 3/5/7 games, games to 11, win by 2, serve changes every 2 points and every
point at 10-10, one timeout per player/pair per match, yellow/red cards).

## What a table tennis graphic always shows

| ID | Convention | How broadcasts group it | Live field(s) |
| --- | --- | --- | --- |
| T1 | **Games won next to current-game points** | One row per player/pair: flag, name, a small games-won box, then the large current-game points. Games won is labelled ("GAMES" header or a distinct box) so it never reads as a second score. | `currentAMatchScore`/`currentBMatchScore` (games won), `currentAGameScore`/`currentBGameScore` (points) |
| T2 | **Server** | A ball icon on the serving player's row, immediately beside the points. Off before play, between games and at the end. | `isACurrentlyServing` / `isBCurrentlyServing` |
| T3 | **Doubles second server** | In doubles the serving pair's second-server state may show as a small marker; never in singles. | `isSecondServer`, `isDoubles` |
| T4 | **Game history** | Completed games in compact columns (11-7, 9-11, ...), winner's number emphasised; the game in play is NOT repeated in the history (its points are the big number). | `game{N}AScore`/`game{N}BScore` shown by `isGame{N}Started`; `isGame{N}AWon`/`isGame{N}BWon` |
| T5 | **Game number** | "GAME 3" tag while a game is in play; "GAME 3 NEXT" (or similar) between games, never a stale number. | `currentGame`, `nextGame`, `isInBetweenGames` |
| T6 | **Game point / match point** | Neutral banner attached to the bug ("GAME POINT"; "MATCH POINT" takes precedence), never floating away from it. | `isGamePoint`, `isMatchPoint` |
| T7 | **Timeout** | A used timeout leaves a visible trace (dimmed "T" or used pip); an active timeout shows a countdown badge on that player's row. | `isATimeOutUsed`, `isATimeOutActive`, `timeOutTimerA` (+ B) |
| T8 | **Cards** | Yellow / red card chips on the carded player's row. | `isAYellowCarded`, `isARedCarded` (+ B) |
| T9 | **Final / winner** | At the end the bug shows FINAL and marks the winner (winner's row emphasised, loser dimmed or a check/trophy mark); serve marker and game tag gone. | `isComplete`, `isAWinner`/`isBWinner` |
| T10 | **Player identity** | Country flag (or club colour) and a short name form that fits; doubles shows both partners ("LIN / FAN") without a leading slash on a wrapped line. | `countryA`, `jerseyColorA`, `combinedAName` and the short-name variants, `playerA2` |
| T11 | Event context | Event name and round in a header tab (lower thirds, full screens); headers fit or shorten with an ellipsis, never cut mid-word. | `eventName`, `matchRound` |
| T12 | Team matches | In a team event a tie strip shows both team names, the team score ("3 - 1", labelled as the tie) and logos, kept visually separate from the player match; the event header stays. | `isTeamMatch`, `teamAName`, `teamAScore`, `teamLogoURLA` (+ B) |

Not table tennis: periods, clocks, innings, possession, "SETS" labels, server numbers in singles.

## Placement expectations

- **Corner scorebug**: T1, T2, T6, T9 mandatory; T5 and a compact T4 expected; T7/T8 as small row chips.
- **Lower third**: T1-T9 plus T11; T12 when a team match.
- **Full screen** (between games / final): game-by-game table (T4) with the live or final points dominant, games won (T1),
  server and timeout/cards for the live board, winner treatment at the end (T9). The large numbers are the current points
  while a game is in play, not games won.
- **Courtside** (read by players at the table from several metres): two court-end panels with very large points, games won
  clearly separated and labelled, game number visible, serve ball, timeout trace, all secondary text large enough to read at
  distance; flips with `isCourtSideScoreboardFlipped` / `isSwitched` by swapping what each panel shows.

## Common defects to avoid (from the 2026-11-13 blind review)

- No winner treatment at FINAL; FINAL chip misaligned with other chips.
- Current game shown twice (history column plus big score).
- "GAME 1" still showing between games; serve ball lit during the break.
- Chip text clipping its border ("BETWEEN GAMES").
- Courtside: no game number, no used-timeout trace, footer too small, games digit adjacent to points digit ("10 10").
- Full screens whose big numbers are games won while live points are small and grey; full screens without server,
  timeouts or cards.
- Near-clones: several placements built from one layout recoloured. Each design needs its own composition.
