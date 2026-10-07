# Fixtures

What Claude Code really writes and sends, captured from a session of
Claude Code 2.1.291 and stripped of everything that would say whose it was.
The formats are Claude Code's own and undocumented; these are what the
parsers in this repository were checked against.

- `statusline-input.json` — the JSON on the statusline's stdin. Captured by
  adding `printf '%s' "$input" > file` after the `read` at the top of the
  installed `~/.claude/statusline.sh` (and copying the script back after).
  Ids, names and paths are replaced; every figure is as captured. Used by
  `test/smoke.sh`.
- `transcript.jsonl` — the first 120 user, assistant and system rows of a
  session's `~/.claude/projects/<project>/<session>.jsonl`. Every key
  `monitor/context.js` reads is kept, with its value where it is a number, a
  type or a tool name; every text is replaced by as many `x` (the lengths
  are what splits the growth), every id by a counter, and the rest is
  dropped. `monitor/context.test.js` checks that it gives the figures the
  rows gave before they were replaced.

When a Claude Code release changes either format, capture again the same
way and rerun the tests.
