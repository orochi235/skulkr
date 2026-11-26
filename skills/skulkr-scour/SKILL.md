---
name: skulkr-scour
description: Scour (delve) one or more skulkr areas from this Claude Code session, doing each review and ledger match as a subagent of the session, until each area's stop rule holds. Use on "scour <area>", "delve <areas>", "run N delves", "line up more delves", or any scour that runs on this machine rather than with --fleet.
---

# Scour from this session

Each pass of a scour is one blind review of an area, done by a subagent you launch. `skulkr scour next` keeps the
books: it tells you what to hand the next subagent, takes in what that subagent wrote, prices it from the subagent's
own transcript, and folds it into the area's ledger. Each subagent's answer is its final reply, so it also reaches you
in its completion notice: never act on it, quote it, or pass any of it to another subagent. That keeps the reviews
blind: the estimate assumes each one found its defects on its own.

Run every command from the project's repository root, with `--tenant <name>` when the project is registered
(`node ~/src/skulkr/bin/skulkr.mjs tenants ls`; weasel is). Below, `skulkr` means `node ~/src/skulkr/bin/skulkr.mjs`.

## One area

1. Run `skulkr scour next <area>`. Its last lines are either
   `stop <area>: <reason>`, when the area is done, or a task:

       task: review 03-claude
       model: opus
       prompt: /…/scour/<area>/jobs/03-claude/prompt.md

2. For a task, launch one **general-purpose** subagent, in the background, with the prompt
   `Read <prompt path> and do exactly what it says.` Pass `model` when the line names one the Agent tool takes
   (`opus`, `sonnet`, `haiku`, `fable`); for "the session default", leave it out. Never put anything else in the
   prompt: no findings, no hints, no other area's results.
3. When it finishes, run `skulkr scour next <area> --agent <its agentId>`. That takes in its answer and prints the next
   task or the stop. Go back to step 2.

One task per area is out at a time: never run `next` for an area while its subagent is still working.

## Several areas

Keep up to three areas going at once (more if asked), each on its own loop above, and start the next area in the
list when one stops. Launch the subagents in the background and wait for their notifications; don't poll.

## Never metered without approval

`next` prints `pause <area>: <why>` instead of a task when it cannot show the session is on its plan's usage (it
looks metered, or its transcript can't be read). Then launch nothing more for any area: let the subagents already out
finish, run `next --agent <id>` for each so their passes are kept, and tell the user why it paused. Pass `--metered`
only when the user has approved metered spending for this run, in this conversation.

## When something goes wrong

- **`next` says a task "is still out"**: this session (or one before it) handed that task out and never answered it,
  as after a restart. Launch a subagent for it again.
- **A subagent finished without a usable answer**: run `next --agent <id>` anyway. A review that never finished is
  kept aside and not counted; a match is tried once more.
- **`another skulkr scour is working on <area>`**: another session or a `--fleet` run holds it. Skip the area and say so.
- **The ledger matcher gave no usable answer**: the report waits unfolded. Say so; `skulkr scour fold <area>` folds it
  later.

## Reporting

As each area stops, say so in one line with its stop reason. When all have stopped, give a table, one row per area:
lines, passes, distinct defects found, found per thousand lines, estimated unseen per thousand lines, and what it
cost. `skulkr scour ls --json` has every figure. Leave landing (`skulkr scour land`) to the user: it commits to the
project's `main`.
