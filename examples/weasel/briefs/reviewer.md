# Audit round {{round}}: blind reviewer brief, area `{{area}}`

You are one of two reviewers reading the same area of the weasel repo independently. You will never see the
other reviewer's work, and they will never see yours: the overlap between your two lists estimates how many
defects the area still holds. That estimate only works if both reviewers search the same way, so:

- **Read exactly the files listed below, yourself, end to end, as far as your budget goes.** Do not spawn
  subagents or split the list. You may open other files to understand a call or a type, but a finding must be
  about code in a listed file.
- **Do not edit anything** but your findings file. No fixes, no commits, no branches, no stash. Report only.
- **The tree you are in is the frozen commit {{commit}}, and your working directory is its root.** Cite paths
  relative to it. It may have no node_modules; reason from the code.
- **Read with the tools, not the shell.** Read opens files (several in one turn), Grep searches, Glob lists. The
  only shell commands you may run are `git log`, `git show`, `git diff` and `git blame`, from where you are: never
  `cd`, never `git -C`, one command per call, never chained with `;`, `&&`, `|` or a loop. Anything else is
  refused, and a refused call still costs a turn. Each file's line count is in the list below; never count them.
- Root `CLAUDE.md` (terminology, module rules, traps table) is already in your context, so never open it;
  read the `docs/traps/*.md` file for your area if its table names one. `docs/unruled.md` lists calls already made — a behavior ruled
  there is not a defect (search it; it is large).
- Every call rereads everything before it, so read in few calls: open several listed files at once (parallel
  reads in one turn), not one file per turn.

## What counts

A defect is code that does the wrong thing for some input or sequence a real caller can produce: wrong
output, a throw, a hang, a leak (listener, timer, GPU resource, cache without a bound), state left behind by
teardown, a decision answered two different ways in two places, an option silently dropped on one path,
precision lost far from the origin, prototype-chain lookups on user-keyed tables, timers with computed
delays bypassing `after`, docs/README examples that do not work against the code. Style nits, naming
preferences and "could be cleaner" are not defects — leave them out.

Earlier rounds fixed a lot; look for what is still there, especially in the files the list below marks
`changed this week` (from `git log` over the last seven days; never run that search yourself).

## Output

Write your findings with the Write tool to `{{out}}` under the tree's root, then add to it with Edit; that file is
the only one you may write, and the shell cannot write it. Markdown, one `##` section per finding:

    ## <one-line claim>
    - where: path/to/file.ts:LINE (function name)
    - scenario: concrete input/state → what happens vs what should
    - evidence: read
    - severity: high | medium | low

Write the file as you go, appending what each batch of files turned up, not only at the end. When done, add a section
`## Files read` listing every listed file you actually read, one path per line without its count, and finish with a final line
`<!-- done: N findings, files read: M -->`. Your reply is just that line. If you cannot write the file, put
the whole document in your reply instead.

## The area's files

{{files}}
