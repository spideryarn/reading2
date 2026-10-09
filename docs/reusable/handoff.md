# Hand off to the box before closing the laptop

Greg is about to close the laptop and wants the work to keep going. Your job: get everything that
matters off this machine, then put **one brief** in the Overseer's queue on the box, so it hands the
work to a fresh agent there. You do not start that agent yourself — the Overseer knows how loaded the
box is, and you don't ([overseer.md § Dispatching agents](../project/overseer.md#dispatching-agents)).

> Can we create a little handoff.md … that takes anything valuable that's local, packages it up,
> hands it off to the Overseer on the remote box for it to delegate to an agent so that then we can
> close our laptop without and the work will continue.
>
> — Greg, 2026-10-09

The receiving agent starts with nothing but the brief and `origin`. What isn't pushed or written in
the brief does not exist for it.

## 1. Get the work into git, and pushed

- **Your own finished work:** commit it the house way (AGENTS.md § Commit only your own files) and
  `git push origin HEAD:dev`.
- **Unfinished work in a worktree:** commit it on that worktree's branch with a `WIP:` message
  saying where it stopped, and push the branch under its own name — `git push origin HEAD` (the
  `origin/worktree-*` branches are this). **Not to `dev`**: half-done work there breaks every peer.
- **The plan doc,** if the work has one: update its status — what's done, what's next, what's
  undecided — and push it with the rest. That is the brief's backbone.
- **Other worktrees on this laptop** (`git worktree list`): run `npm run worktree:check` in each.
  Anything it calls unsafe is either yours — push it as above — or somebody else's, which you name
  in your report to Greg rather than touch.
- **Gitignored things the work needs** (`worktree:check` names them): keys in `.env.local` go with
  `gjd-remote push-env`; a file from `data/` or anywhere else goes with `gjd-remote upload <file>`.
- **Leave alone** untracked files that are Greg's own notes rather than part of the work; mention
  them.

Then check it landed: `git status` clean in what you pushed, and `git log origin/<branch> -1` shows
your commit. A push that printed success but went somewhere else is the usual way this fails.

## 2. Write the brief

A local file in your scratchpad. The receiving agent has none of this conversation, so it gets:

- **What the work is for,** with Greg's own words from this conversation quoted, not paraphrased.
- **Where it is:** the branch and commit, the plan doc, which stage, what is done and checked.
- **What's next,** concretely, and **what's undecided** — and which of those it may decide itself
  (the AGENTS.md rule: obvious → do it; a real product trade-off → ask Greg).
- **What it must not do** that it otherwise might — anything Greg ruled out here.
- **How to work:** its own worktree from that branch,
  [engineering-manager.md](engineering-manager.md), a GPT Sol review per stage, push to `dev` when
  green.
- **Anything that only works on the laptop** — the Chrome extension, the Mac's audio devices,
  Google Cloud Console — said plainly, so it waits for Greg rather than failing at it.

Start the file with a sentence, not a `-` bullet; step 3 passes it as a flag value.

## 3. Queue it for the Overseer

```
npx tsx scripts/gjd-remote.ts upload <brief.md>
npx tsx scripts/gjd-remote.ts ssh 'cd ~/code/spideryarn2 && npx tsx scripts/overseer-queue.ts add \
  --by greg --front --priority 1 --title "Handoff: <what>" --text="$(cat uploads/<brief.md>)"'
npx tsx scripts/gjd-remote.ts ssh 'cd ~/code/spideryarn2 && npx tsx scripts/overseer-queue.ts authorize <id> --by greg'
npx tsx scripts/gjd-remote.ts ssh 'cd ~/code/spideryarn2 && npx tsx scripts/overseer-queue.ts show <id>'
```

`--by greg` and `authorize` are yours to run because Greg asked for the handoff — say so in the
brief's first line. `add` prints the id. `show` must say **`dispatchable: yes`**; anything else
means the Overseer will never pick it up, however cleanly the `add` went.

## 4. Tell Greg

In a few lines: what was pushed and where, the queue id, anything left on the laptop and why. The
Overseer reads the queue on its own tick; if Greg wants it started this minute, the **Message the
Overseer** box on the dashboard's Overseer tab is the nudge, and that is his to type.
