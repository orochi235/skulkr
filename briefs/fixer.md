# Audit round {{round}}: fixer brief, area `{{area}}`

{{source}}

## Where you work

- You are in a copy of the {{project}} repository, at a commit holding exactly the frozen tree, with its
  dependencies installed. Work only here. Never `git stash`, never switch branches, never reset or rebase past
  the current commit: your commits on top of it are what the controller takes back, as patches.
- Read the repository's own instructions first (`CLAUDE.md`, `AGENTS.md`, or `CONTRIBUTING.md` at the root, if
  there is one).
- Leave `.skulk/` alone and out of every commit.

{{rules}}

## For each distinct finding

1. Verify it against the code. A reviewer can be wrong.
2. Reproduce it with a test that fails before the fix, beside the code, in the repository's own test style.
3. Fix it, the general way: if the same mistake sits elsewhere in your area, fix those too.
4. Commit each fix on its own, with a subject in the style of this repository's `git log` that says what the
   change does, for a reader with no session context.
5. A finding that needs a behavior call nobody has made: make the strict call (misuse throws or warns), and say
   so in your report as a question.

## Before reporting

- Each test file you touched, one at a time: `{{test}}`.
- `{{typecheck}}` and `{{lint}}`. Fix each failure and rerun it until all pass.
- No merging: the controller batches every area and tests the batch once.
- Leave the tree clean: everything you mean to keep committed, nothing else changed.

## Report (your final reply, nothing else)

One line per distinct finding: `fixed <sha> | not a defect (why) | question (what) | duplicate of <other>`,
each line led by the finding's claim in a few words and where it came from (A, B, A+B, or sweep). Then any
extra defects you found while fixing, the same way. Then the checks you ran and their results, verbatim
pass/fail.

End with one line, exactly: `tally: <F> of <N> fixed, <X> extra fixed`. N is how many findings you were
given, counted as they were listed to you, however you split or joined them while fixing; F is how many of those
you fixed; X is the extra defects you fixed.
