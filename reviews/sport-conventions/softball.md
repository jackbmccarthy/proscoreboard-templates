# Softball broadcast conventions

Written 2026-11-13. Softball (fast pitch; the server's `wbsc-fast-pitch-basic-2026` preset) uses the
same graphic language as baseball. See [baseball.md](baseball.md) for the shared rules: diamond with
lit bases, a grouped `B-S` count with outs beside it, an inning number with a ▲/▼ half indicator,
prominent runs, optional H/E, and a line score. The anti-patterns and the runtime field table are the
same. The audit is in [softball-audit.md](softball-audit.md).

## Softball-specific differences

- **7 regulation innings.** Line scores show columns 1 to 7. Extra-inning columns (8, 9, 10...)
  appear only once played; WBSC uses the international tie-breaker from the 8th. Inning-progress
  trackers have 7 pips, not 9.
- **Labels say SOFTBALL.** Graphics carry a softball identity. Broadcast packages favour optic yellow
  (the ball colour) and brighter collegiate palettes, so the new templates use their own softball
  palettes instead of re-using the baseball colours.
- **Count limits are the same** (4 balls, 3 strikes, 3 outs). The runtime enforces the same 0 to 4 /
  0 to 3 / 0 to 3 ranges.
- **Run-rule and time-limit endings** are common in softball. A "FINAL" summary must not assume 7
  innings were played. The line-score columns for unplayed innings stay blank via `isGame{N}Started`.
- Base distances and pitching style do not change the graphic.
