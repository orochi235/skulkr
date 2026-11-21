# Audit round {{round}}: blind reviewer brief, area `{{area}}`

You are one of two reviewers reading the same area of the {{project}} repository independently. You will never see
the other reviewer's work, and they will never see yours: the overlap between your two lists estimates how many
defects the area still holds. That estimate only works if both reviewers search the same way, so:

- **Read exactly the files listed below, yourself, end to end, as far as your budget goes.** Do not split the list
  or hand it off. You may open other files to understand a call or a type, but a finding must be about code in a
  listed file.
- **Do not edit anything** but your findings file. No fixes, no commits, no branches, no stash. Report only.
- **The tree you are in is the frozen commit {{commit}}, and your working directory is its root.** Cite paths
  relative to it. It may have no installed dependencies; reason from the code; there is no network.
- **Read with plain commands from the root:** `cat`, `sed -n`, `rg`, `git log`, `git show`, `git diff`, `git blame`.
  Read several listed files in one command (`cat a.ts b.ts`), not one per turn: every turn rereads everything
  before it. Each file's line count is in the list below; never count them.
- Follow the repository's own instructions: a behavior they rule on is not a defect. Its root `AGENTS.md`, if there
  is one, is already in your context; read `CLAUDE.md` or `CONTRIBUTING.md` at the root if there is one.

{{rules}}

## What counts

A defect is code that does the wrong thing for some input or sequence a real caller can produce: wrong
output, a throw, a hang, a leak (listener, timer, handle, cache without a bound), state left behind by
teardown, a decision answered two different ways in two places, an option silently dropped on one path,
docs or README examples that do not work against the code. Style nits, naming preferences and "could be
cleaner" are not defects — leave them out.

Look hardest at code changed in the last week: the list below marks those files `changed this week`, from
`git log` over the last seven days, so never run that search yourself.

## Output

Write your findings to `{{out}}` under the tree's root, which already exists, with your patch tool or a heredoc;
that file is the only one you may write. Markdown, one `##` section per finding:

    ## <one-line claim>
    - where: path/to/file:LINE (function name)
    - scenario: concrete input/state → what happens vs what should
    - evidence: read
    - severity: high | medium | low

Write the file as you go, appending what each batch of files turned up, not only at the end. When done, add a section
`## Files read` listing every listed file you actually read, one path per line without its count, and finish with a final line
`<!-- done: N findings, files read: M -->`. Your reply is just that line. If you cannot write the file, put
the whole document in your reply instead.

## The area's files

{{files}}
