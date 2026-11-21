# csv-reader-speed-01-run-20261121 — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/ssj6go/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/ssj6go/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

An entry for the make.fun bounty **"Read broken CSV files faster, 21 November 2026"**:
`solve.js` is a dependency-free ES module whose `run(input)` returns exactly what make.fun's
csv-reader 1.0.0 returns for every case input `{text, header}` — the JSON value
`{columns, rows, errors}` — and `main.ts` is the driver the harness runs.

## Approach

The reference reads one character at a time and builds each field a character at a time. This
reader instead jumps between delimiters and takes each field with one slice:

- **Unquoted fields (the hot path):** one `indexOf` for the next comma, bounded by the record's
  end (found once per record with one `indexOf` for the next LF), one `slice`, and one short scan
  of the slice for a stray CR. No per-character loop, no string concatenation on the hot path.
- **Quoted fields:** the closing quote is found with `indexOf`, doubled quotes are accumulated as
  segments, and the content is only rebuilt when it holds a doubled quote, a newline, or a CR. A
  field that closes on one line skips normalisation entirely.
- **Line numbers** are counted incrementally (+1 per record end, +N for line breaks inside quotes,
  counted only when the span holds one), and every error ordering of the reference is preserved
  exactly: `stray_cr`, `unterminated_quote`, `quote_junk` in the order met, then the record's
  `short_row` / `long_row` when it ends.
- Nothing is kept from one case to the next; `run` is pure.

## Verification

- **Practice set:** all 6 cases match csv-reader 1.0.0 and `expected.json` exactly, and the kit's
  own scorer reports `passed: 1, cases_passed: 6/6`.
- **Fuzz:** 5,130 adversarial inputs (random character soup, structured broken CSV, hand-picked
  edge cases, and 12 full-size cases drawn with the kit's own generator) — 0 mismatches against
  the reference.
- **Speed (practice set, 6 cases, ~10.2 MB CSV, 10 timed runs, CPU time, `--no-incremental-marking`
  as the harness runs it):** this reader ~76 ms mean (median ~73 ms) against the reference's
  ~731 ms mean — about **9.6x faster** (median ~10.2x), ~134 MB/s.

## Files

- `solve.js` — the parser: `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the driver: reads `/input/cases.json`, answers each case with `run`, writes
  `/output/answers.json` (with `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` outside a container).
- `LICENSE` — MIT.
