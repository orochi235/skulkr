# Audit round {{round}}: conflict brief, area `{{area}}`, branch `{{branch}}`

The fixes on `{{branch}}` conflict with what the batch `{{batch}}` already holds, usually another area's fixes to the
same file, so the batch cannot take them as they are. Your job is to finish the merge so it keeps both.

The top commit of this tree is `{{branch}}` merged into the batch, with git's conflict markers left in these files:
{{paths}}. What the batch changed in them since the round's commit is `{{ours}}`; what the branch changed is
`{{theirs}}`. Between the markers, the part after `<<<<<<<` is the batch's and the part before `>>>>>>>` is the branch's.

## Where you work

- You are in a copy of the {{project}} repository: the batch's tip with that marked merge committed on top, and its
  dependencies installed. Work only here. Never `git stash`, never switch branches, never reset or rebase past the
  current commit: your commits on top of it are what the controller takes back, as patches.
- Follow the repository's own instructions. Its root `CLAUDE.md` is already in your context, so never open it;
  read `AGENTS.md` or `CONTRIBUTING.md` at the root if there is one.
- Leave `.skulkr/` alone and out of every commit.
- Every call rereads everything before it, so read in few, targeted calls, and a check's verdict rather than its
  log (`… | tail -5`).

{{rules}}

## What to do

1. Read both patches, then each marked file around its markers, and work out what each side meant.
2. Resolve every conflict keeping both sides' intent: both fixes, both tests, both entries. Where both added to the
   same list or file, keep both additions, merging only what is truly the same thing twice. Where they genuinely
   contradict, keep the batch's and adapt the branch's change to it.
3. Remove every marker: no line may start with `<<<<<<<`, `=======` or `>>>>>>>` where git left one.
4. Run the test files of the conflicting paths, and those testing them, one at a time (`{{test}}`). Fix what the
   resolution broke; never weaken a test to make it pass.
5. Commit the resolution as one commit, with a subject in the style of this repository's `git log`. Leave the tree
   clean: everything you mean to keep committed, nothing else changed.

The controller then runs `{{command}}` over every file the merge changes; what you report does not count as passing.

## Report (your final reply, nothing else)

One line per conflicting file: `resolved (how) | not resolved (why)`.
