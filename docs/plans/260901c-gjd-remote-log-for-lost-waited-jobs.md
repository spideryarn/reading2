# A log, so a `--wait` job that never ran can be noticed

Follows [260901a](260901a-gjd-remote-wait-duration-and-ssh-command.md), which added `--wait` and
said plainly that a box reboot loses every sleeping job and nothing replays it. This is the part
that makes the loss *visible*. Reviewed by GPT Sol before it was finished; several of its findings
changed the code, and one of them was a bug I had already written.

> My only worry is that we might schedule a prompt with a long wait period, and then something
> happens (e.g. the remote server gets rebooted) and it gets lost. Can we make sure to add a
> gjd-remote log (git-ignored) so that in principle if this happens, we can notice all the
> waited-but-never-ran requests from the logs. … The v1 could be basically just a folder with an
> append-only NDJSON file of all gjd-remote commands run.
>
> — Greg, 2026-09-01

## What it is

One append-only NDJSON file, one line per `gjd-remote` command, plus a richer line whenever a
session is actually created. On the box, the job script appends one line the instant before it
execs Claude. `gjd-remote log --lost` puts the two together.
[hetzner-remote-server-box.md § The log](../project/hetzner-remote-server-box.md#the-log) is the reference;
[`scripts/gjd-remote-log.ts`](../../scripts/gjd-remote-log.ts) is the whole of the logic and
[`tests/gjd-remote-log.test.ts`](../../tests/gjd-remote-log.test.ts) the whole of the proof.

## The thing that had to be measured first

The obvious way to ask "did Claude ever run?" is to look for the transcript,
`~/.claude/projects/*/<uuid>.jsonl`, which is already how `ls` finds a session's title. **It does
not answer the question.** Measured on the box, 2026-09-01:

| | transcript after 45s | process running |
|---|---|---|
| session started with a prompt | yes, within 15s, 16 lines | yes |
| session started with **no** prompt, never typed into | **none** | yes |

So a transcript proves Claude ran, and its absence proves nothing — which is the wrong way round
for detecting a loss. It is the same shape as the `claude agents --json` trap recorded in
[260901a](260901a-gjd-remote-wait-duration-and-ssh-command.md): a live session that no artefact
mentions. Sol added the other half, which is that presence proves less than it looks: an empty or
metadata-only file, a transcript restored from elsewhere, or a later manual `claude --resume` with
the same uuid all produce a file for a job that never ran when it was supposed to.

**So the job writes its own line**, in `~/gjd-remote/log/starts.ndjson`, immediately before the
`exec`. That file is on `/home`, which is a separate volume and survives the machine being
destroyed and recreated, not merely rebooted. Sol's precision is worth keeping: that line means
*launch attempted*, not *Claude definitely started* — there is a small window between the marker
and the exec.

## Where it lives, and why that is not what Greg asked for

`${XDG_STATE_HOME:-~/.local/state}/gjd-remote/gjd-remote.ndjson`, not a gitignored folder in the
checkout. Greg asked for gitignored; this went the other way on purpose, and Sol agreed it is the
right reading of the intent:

- **Worktrees are arriving** (a peer is building them now). A repo-relative log splits the record
  across N checkouts at exactly the moment you want one list of everything that was scheduled.
- **The repo is inside Dropbox**, so an append-only file written on every command syncs on every
  command.
- The log is about **the box**, which is one machine, not about a checkout.

`GJD_REMOTE_LOG_DIR` overrides it, `gjd-remote log --path` prints it, and the tests use the override
so they never touch Greg's own file.

## What Sol found, and what changed

**A leak I had written, and denied in a comment.** An unnamed session's name is
`slugify(first five words of the prompt)` — `provisionalName()` — so recording `name` and
`promptPath` records a fragment of the prompt, while the comment above the type said the file could
never contain one. Kept the name, because it is what makes the report readable and it is on screen
and in tmux anyway; the comment now says what is true, the file is `0600` in a `0700` directory
outside the repo, and there is a test asserting the name is in there so nobody can quietly widen it.

**A prompt sha, removed.** It proved nothing `writeRemote` does not already verify at creation, and
against natural-language prompts a 12-hex digest is a confirmation oracle: guess the sentence, hash
it, and the log tells you the guess was right.

**A real bug: kills were matched by name.** `gjd-remote ls` renames a provisional session to
Claude's own title, so by the time you kill it the name is usually not the name the launch was
logged under — and every renamed session that Greg killed deliberately would have been reported as
lost. Kills now record the session uuid, read out of the tmux environment *before* the session is
killed, and the match is on that. Proved end to end by letting a session be renamed, killing it
under the new name, and watching `--lost` stay quiet.

**PIPE_BUF is a guarantee about pipes, not files.** The first version of the comment claimed a
sub-4KB line appends atomically. This repo had already been told exactly that, by Sol, on
2026-08-28 — see the header of [`src/store/ai-calls-fs.ts`](../../src/store/ai-calls-fs.ts). The
ceiling stays as defence in depth, the record is now encoded once and written once with
`flush: true`, and the real protection is that the reader validates every line and counts what it
cannot read.

**A failed write of a launch record is now loud.** It was best-effort and silent, which quietly
creates a job nothing can ever notice the loss of. Sol's point was sharper than the fix — it argued
the write should happen *before* the session is created, so that failing means not scheduling at
all. That is right, and it is not what this does: writing first means a session that then fails to
create leaves a record that reads as lost forever. v1 keeps the write after creation and shouts,
naming the session so it can be killed. The window it leaves is the laptop dying between the two.

**"Nothing was lost" is refused when a line is unreadable**, because the damaged line is exactly
the one that would have said otherwise. `--lost` exits non-zero for losses *and* for damage.

**Schema versions above this reader's are unreadable**, not best-effort: a newer writer could add a
field that changes what an existing one means.

## What was deliberately not built

Sol asked for more, and most of it is right for a v2 rather than a v1:

- **A per-uuid remote manifest, written and read back before tmux starts**, with `waiting` /
  `launch_attempted` / `exited` events. Better evidence than one start line, and it removes the
  creation window above. Not built: it is a second schema, two clocks and merge logic, for a
  failure mode that has not happened yet.
- **A stable box id on `/home`**, so the reader can tell "a different machine now answers at this
  address" from "your job was lost". The address is recorded per launch, but nothing gates on it —
  and note that gating would have *hurt*: `/home` survives a rebuild, so the box-side evidence
  survives with it, and marking every pre-rebuild record "different box" would throw away good
  verdicts.
- **An overdue footer on `gjd-remote ls`**, which is where a vanished job would naturally be
  noticed. It needs the box's start list, and `ls`'s remote script is a shared, closely-tested file
  that a peer had work in.
- Sol also said to drop the line-per-command entirely and log only scheduled waits. Greg asked for
  all commands, so all commands it is.

## The evidence

- 35 unit tests. Every guard was **watched going red** by mutating it: the sentinel, the uuid
  validation, the kill clause, `started` read from `live`, the line ceiling, the clip, the marker's
  uuid guard, the schema bound, and `parseLine`'s shape check.
- End to end against the box, three sessions with three fates — one that ran, one killed with
  `gjd-remote kill`, and one whose tmux session was destroyed behind the CLI's back, which is
  exactly what a reboot looks like from the log's side. Reported `running`, `killed`, `lost`.
- The recovery line `--lost` prints was run verbatim and returned the original prompt.
- With the box unreachable: no verdicts, an explanation, exit 1 — not an empty table.
- Reading the log does not write to it, and the prompt text is not in the file.

Two bugs the smoke tests found that the unit tests did not, both from making kills carry the uuid:

- **Every `kill` line was listed as a launch of its own**, under the session's new name, because the
  reader filtered on "has an id" and kill lines now have one. It is `cmd === "new-claude"` and an
  id, and both halves are needed.
- **A session that started and was then killed reports `ran`, not `killed`**, because `started` is
  checked first. That is correct — it did run — but it means `killed` describes only a job that
  never started, which is the only kind this feature is about.
