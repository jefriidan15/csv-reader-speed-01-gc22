# csv-reader-speed-01-gc22

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jefriidan15/csv-reader-speed-01-gc22/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jefriidan15/csv-reader-speed-01-gc22/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as
csv-reader does on every input (`{columns, rows, errors}` for `{text, header}`),
including its whole broken-row policy — stray CRs, quote junk, unterminated quotes,
short and long rows, BOM, CRLF and lone CRs inside quotes — but scans with
C++-accelerated `indexOf`/`slice` instead of one character at a time.

- `solve.js` — the fast reader: `run(input)` returns csv-reader's answer.
- `main.ts` — the driver the harness runs: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json`.

## How it is fast

The common field (unquoted, no stray CR) is one string slice bounded by two
`indexOf` calls; the common quoted field (no doubled quote, no CR/LF inside) is
one `indexOf` for its closing quote plus one slice. Only broken fields fall back
to segment-accumulating slow paths that re-scan exactly as the reference does.
On the practice set (~11 MB, 6 cases) the parser runs in ~0.12 s against
csv-reader 1.0.0's ~0.58 s.

## License

MIT — see [LICENSE](LICENSE).
