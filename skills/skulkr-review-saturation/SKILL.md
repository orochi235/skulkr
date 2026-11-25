---
name: skulkr-review-saturation
description: Run sequential review passes over a named Skulkr audit area or a batch of areas, deduplicate concrete defects, and fold each area's report into its Skulkr saturation ledger. Use for review-only saturation requests.
---

Find the target repository and resolve area IDs and exact file lists from its configured Skulkr partition. Check the relevant repository instructions and use Skulkr's reviewer brief as the standard for what constitutes a finding. Record the commit and any in-scope working-tree changes. Read adjacent files or tests for evidence and report only defects located in the named area.

Stay blind to other reviews of the area. Do not read its saturation ledger (`<state>/saturation/<area>/`, or the landed copy under `<record.dir>/saturation/<area>/` in the repository, `.skulkr/saturation/` in weasel), other reports on it, or `skulkr scour ls`: the ledger's estimates assume each occasion found its defects independently.

Run one area at a time in the requested priority order. For each area, perform sequential passes, varying the review lens and keeping a pass ledger. Start with the files and contracts, then trace callers, state transitions, numeric boundaries, error handling, or other relevant paths. Each pass needs a fresh search for defects. Verification and deduplication alone do not constitute a pass. Keep prior findings available for deduplication and describe the passes as context-sharing.

Deduplicate by root cause at the source and its triggering behavior. Give each distinct finding a stable ID, path and line, concrete trigger, observed and expected behavior, severity, and evidence status. Use targeted read-only probes when practical. Follow the applicable safety boundary. Leave production code and tests untouched.

After each pass, record the number of new distinct findings. Reset the no-new streak to zero when any new finding appears. Stop the area at three consecutive passes yielding zero new findings or after pass 40, whichever occurs first. If interrupted, save the actual progress and the next pass number. Do not count incomplete passes.

Write each area's report outside the repository, at `$TMPDIR/skulkr-saturation/<project>/<area-id>-codex.md`, never in the repository's tree. Include scope and snapshot (the full commit sha), pass ledger with pass, focus, new count, cumulative count and streak, a deduplicated findings index, reproduction details, and the stop reason. An interrupted area's report stays there, and a later run resumes from it. Avoid statistical saturation estimates for context-sharing passes.

When an area's report is finished, fold it into the area's ledger as one occasion, from the repository's root:

    node ~/src/skulkr/bin/skulkr.mjs scour ingest <area-id> <report> --source codex --at <snapshot sha> [--tenant <name>]

Pass `--tenant` when the project is registered (`node ~/src/skulkr/bin/skulkr.mjs tenants ls`; weasel is). The ledger keeps the raw report under its `reviews/`, so delete the scratch copy once the ingest prints its `1/40 codex: …` line. If the ingest refuses because the ledger is frozen at another commit, keep the report and say so; never pass `--fresh`, which sets the existing ledger aside. Leave landing (`scour land`) to the user: it commits to and pushes the project's `main`.

For a batch, finish and ingest each area's report before advancing. Continue in partition order within the requested group and then through remaining areas if requested. Report which areas were ingested, which reports are waiting in the scratch directory and why, and which remain in progress.
