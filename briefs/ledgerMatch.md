Several blind reviews of the same code in the {{project}} repository have been folded into a ledger of distinct
defects, each with an id (`D1`, `D2`, …). A new report has come in. Say, for each of its findings, which ledger
defects it reports again, or that it is a defect the ledger does not hold yet. Do not read any files; judge from the
text below.

- **The same defect is the same wrong behavior at the same code**, however it is worded: a different claim, a
  different line in the same function, a different scenario that reaches the same bug.
- **A finding that covers two ledger defects sights both**, and one that reports a ledger defect and a new one sights the
  first and lists the second under `new`; so does one that reports two new defects, listing both.
- **A different trigger needing a different fix is a new defect**, even in the same function.
- Every finding is accounted for: in `sightings` (one entry per defect it sights), in `new`, or, when
  it repeats a defect this same report already lists under `new`, in `same` as `{"finding": 4, "as": 1}`, `as` that
  earlier finding's index.
- A new defect's `claim` is one line saying what goes wrong; `where` is the path and line or function the report
  cites; `severity` is the report's own (`high`, `medium` or `low`), or `""` when it gives none.

Reply with JSON only, no prose:

    {"sightings": [{"finding": 0, "defect": "D7"}],
     "new": [{"finding": 1, "claim": "...", "where": "src/x.ts:42 (parse)", "severity": "medium"}],
     "same": []}

Findings are numbered from 0 in the order given. When the report below comes whole rather than as a numbered list,
first list its findings in order, each one a defect it reports with the place it cites, as
`"findings": [{"claim": "...", "where": "..."}]` in the same reply, and number them from 0 in that list.
