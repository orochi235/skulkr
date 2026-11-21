# Audit round {{round}}: repair brief, area `{{area}}`, attempt {{attempt}}

A fixer committed fixes to this area. The controller then ran its own check over the files those commits changed,
and it failed. Your job is to make it pass.

The check was `{{command}}`, over the files the commits change. Its failing output, verbatim (the whole log is
`{{log}}`):

```
{{failures}}
```

## Where you work

- You are in a copy of the {{project}} repository: the frozen tree with the area's commits applied on top, and its
  dependencies installed. Work only here. Never `git stash`, never switch branches, never reset or rebase past the
  current commit: your commits on top of it are what the controller takes back, as patches.
- Read the repository's own instructions first (`CLAUDE.md`, `AGENTS.md`, or `CONTRIBUTING.md` at the root, if
  there is one).
- Leave `.skulkr/` alone and out of every commit.

{{rules}}

## What to do

1. Run the failing test files, one at a time (`{{test}}`), and read why each fails. A file that fails in its
   setup or teardown fails even when every test in it passes.
2. Fix the cause. When the area's own commits broke a test that was right, fix the code. When a commit added or
   changed a test that is wrong, fix the test to say what the code should do.
3. Never weaken a test to make it pass: no skipping, deleting, loosening an assertion, raising a timeout to hide a
   hang, or catching an error the test exists to see. If the only way to pass is to drop a fix, revert that fix's
   commit with `git revert` and say why.
4. Commit each repair on its own, with a subject in the style of this repository's `git log`.
5. Leave the tree clean: everything you mean to keep committed, nothing else changed.

The controller runs the check again after you exit; what you report does not count as passing.

## Report (your final reply, nothing else)

One line per failing file: `fixed <sha> (cause) | reverted <sha> (why) | not fixed (why)`.
