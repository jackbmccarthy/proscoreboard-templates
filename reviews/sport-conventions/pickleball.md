# Pickleball broadcast conventions

Reference: PPA Tour, MLP and APP stream graphics. Native racket scoring (side-out, doubles first/second
server, games to 11 win by 2, best of 3 or 5).

## What a pickleball graphic always shows

| ID | Convention | How broadcasts group it | Live field(s) |
| --- | --- | --- | --- |
| P1 | **Games won next to points** | One row per team: names (doubles pairs), games won, large points. | `currentAMatchScore`, `currentAGameScore` (+ B) |
| P2 | **Serving team** | Ball/paddle marker on the serving team; side-out moves it. | `isACurrentlyServing` (isA) / `isBCurrentlyServing` |
| P3 | **Server number (doubles)** | The "1" / "2" next to the serving team, read as the third number of the score call. Hidden in singles. | `isSecondServer` (isA for team A, plain for team B); singles detected by an empty `playerA2` |
| P4 | **Score call** | "8-6-2": server's score first, receiver second, server number third. | Duplicated `currentAGameScore`/`currentBGameScore`, order flips while `isBCurrentlyServing` is shown |
| P5 | **Game number / game history** | "GAME 3" tag; completed games (11-7, 8-11) in a small ledger. | `isGame{N}Started`, `game{N}AScore`/`game{N}BScore` |
| P6 | **Game point / match point** | Neutral banner, match point takes precedence. | `isGamePoint`, `isMatchPoint` |
| P7 | Timeouts | Timeout-used marks and an active countdown badge. | `isATimeOutUsed`, `isATimeOutActive`, `timeOutTimerA` (+ B) |
| P8 | Penalty cards | Yellow/red card flags per team (technical warnings). | `isAYellowCarded`, `isARedCarded` (+ B) |
| P9 | Identity | Player/team colour chips; team (MLP club) colours and logos. | `jerseyColorA/B`, `teamJerseyColorA/B`, `teamLogoURLA/B` |
| P10 | Event context and team ties | Event, round, and for team events the club names and tie score. | `eventName`, `matchRound`, `teamAName`, `teamAScore` (+ B), `isMatchStarted` |

Not pickleball: table-tennis "GAMES/POINTS" header-only layouts with a single serve dot and no server number.

## Placement expectations

- **Corner scorebug**: P1, P2, P3, P6 mandatory; P4 or P5 expected.
- **Lower third**: P1-P6 plus P10.
- **Full screen** (between games / final): game ledger (P5) dominant, games won (P1), team tie when present.

## Runtime gaps found while writing this spec

- No singles/doubles boolean; templates infer doubles from a non-empty `playerA2`.
- No current-game-number text field for racket records; templates stack `isGame{N}Started` labels so the
  highest started game shows.
- No team-event boolean; team tie (`teamAName`/`teamAScore`) blocks are present but hidden by default.
- `isSecondServer` is not in `contract/runtime-fields.json` or the preview fixture, so previews always show
  server 1.

## Layout stability (owner rule, 2026-11-18)

Transient conditionals sit in offset slots, overlays or fixed reserved slots and never move other
components (authoring skill section 2a; server check `scripts/qa/template-layout-stability.mjs`).

- Transient here: serve markers and the doubles second-server number, GAME POINT / MATCH POINT, timeout card and countdown, timeout used, cards, between-games banner, warm-up.
- Structural here: doubles names, team-match strip, game-history columns, final, the full-screen between-games card layout. The score call that reads the server's score first may swap its two numbers when the serve changes (a reorder, not a push).
- Audit of main d1669f9: 1 of 6 pass; corner and lower boards collapse/rearrange the points and call columns at the break, and the lower call panel and head-to-head put the timeout badge and cards inline in the name sub-line.
