# The `gjd-remote` CLI, and why it has no argument-parsing library

The tool is [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts). What it connects to is
[260831c-remote-server-tmux-mosh.md](260831c-remote-server-tmux-mosh.md), which carries the tmux/mosh design and
the traps; this doc is only about the library choice, recorded because
[third-party-library-selection.md](../reusable/third-party-library-selection.md) asks for it and
because **the decision went against the researched recommendation**.

The ask, from Greg (2026-08-31):

> Ideally I want a single command I can run on my laptop that automatically SSH's in, sets up a new
> Claude session, etc. … so that we can create parameters for that command to automatically start a
> new session with a particular prompt, or to list existing sessions, or to resume an existing one.

## What the research said

Researched 2026-08-31 against the criteria in
[third-party-library-selection.md](../reusable/third-party-library-selection.md), whose first and
loudest criterion is **community depth, explicitly because that means more pretraining data for
coding models**. Numbers pulled live from the npm and GitHub APIs that day, not from memory.

| Library | Version (released) | Weekly downloads | Verdict |
|---|---|---|---|
| **commander** | 15.0.0 (2026-05-29) | 508M | **Recommended.** Zero deps, committed to that same day, 14 years of tutorials behind it |
| yargs | 18.1.0 (2026-07-26) | 259M | Runner-up. Comparable depth, heavier, 7 sub-deps |
| cac | 7.0.0 (2026-02-27) | 49M | Nicer API, thin corpus |
| citty | 0.2.2 (2026-04-01) | 30M | Downloads are mostly transitive via unjs tooling, not people building CLIs |
| clipanion | 4.0.0-rc.4 | 5.3M | **Avoid** — stalled on a release candidate since 2024-09, abandoned mid-rewrite |
| oclif | core 4.24.0 | 10.9M | Framework weight: scaffolding, plugins, packaging |
| `util.parseArgs` | built into Node | — | No subcommand routing or help generation; you write both |

Note the clipanion line, because **MindstoneRebel's fleet CLI uses clipanion**. Copying the system
we learned the design from would have meant adopting a library that has not shipped a stable release
in two years. Worth knowing before the next thing gets copied from there by reflex.

## What we did instead, and why

**No library. Node's built-in `parseArgs` and `styleText`, no dependencies at all.**

Not because the recommendation was wrong — on its own terms it is right, and for a larger command
surface it would win. The reason is narrower and worth stating plainly, because it is the kind of
thing that looks arbitrary in six months:

**Adding Commander means editing `package.json`, and at the time a peer had uncommitted work in it**
(mid-way through removing the `summarise` stage). In this tree a pathspec commit takes another
agent's hunks along with yours ([version-control.md](../project/version-control.md)), so landing a
dependency would have meant either committing their half-finished work or leaving the dependency
uncommitted and the tool broken for everyone else. Neither is worth it for six subcommands.

What Commander would have bought — subcommand routing and generated help — came to about forty
lines of `switch` and a template literal. What it would have cost was a shared file at the wrong
moment.

There is a second, weaker reason that would not have decided it alone but points the same way:
[vision.md § Principles](../project/vision.md#principles) says prefer boring and prefer fewer parts
touching each other. A personal tool with no dependencies is easier to reason about than one with
two.

## When to revisit

Switch to Commander if any of these become true — the change is contained to `main()`:

- The flag surface grows past what a `switch` reads well, or needs real validation (mutually
  exclusive options, `choices`, coercion).
- Help text starts drifting from behaviour, which is the failure mode of hand-written help.
- Anyone other than Greg has to maintain it.

`cli-table3` was also recommended, for the `gjd-remote ls` table. Not taken, for the same package.json
reason and because three columns of padded strings do not need a library. If the listing grows
columns that need wrapping or alignment, revisit that too.

## The name

It was `box` for an hour. Renamed on Greg's suggestion, and the rename is better than the
suggestion knew: **`box` is already a common word in this repo** — diagram boxes, bounding boxes,
`box` refs across a dozen files — so `grep box` was never going to find this tool, and a future
agent reading `box` in a comment could reasonably think it meant either. `gjd-remote` collides with
nothing and says whose it is.

## How a session gets its name

`gjd-remote new` takes no name. It starts under a placeholder and `ls` later adopts Claude Code's
own title for the work, so `s-0831-1136` becomes `remote-server-setup-for-claude-code`.

The mechanism, verified rather than assumed:

- **Claude writes `{"type":"ai-title","aiTitle":"…","sessionId":"…"}`** into its transcript at
  `~/.claude/projects/<cwd-with-slashes-as-dashes>/<session-id>.jsonl`. It is generated by a
  background call to a small fast model from your first prompt, and lands around line 13-19 — i.e.
  within the first couple of turns, not at the end.
- **`claude --session-id <uuid>`** pins the id at launch, so we know which transcript is ours.
  Without it we would be matching by "newest file in the directory", which breaks the moment two
  sessions share a working directory.
- **`claude --name` is passed only when Greg supplied a name.** Passing a placeholder would stop
  Claude generating a title at all, which is the thing we want.
- **The id lives in the tmux session's environment** (`tmux new-session -e CLAUDE_SESSION_ID=…`),
  not a mapping file. A file keyed by session name would go stale at exactly the moment `ls`
  renames the session.

**A session started without a prompt has no title until you type something**, because the title is
generated from the first prompt. That is not a bug to chase; it adopts a name on the next `ls`.

Three things considered and rejected:

- **Reading the tmux pane title.** Claude does set the terminal title (OSC 0/1/2), and tmux tracks
  it natively, so `#{pane_title}` looked promising. But the documented behaviour is that the title
  follows the *display name* — `<cwd>-<2 chars>`, e.g. `spideryarn2-3f` — and there is no
  documented guarantee it tracks the generated title. Unverified in a real pty, so not built on.
- **A hook.** There is no `SessionTitleGenerated` event; `SessionStart` fires before any title
  exists. Polling the transcript is the only route.
- **Asking a fast model for a slug up front**, before launching. Deterministic and available at
  launch time, but costs an extra paid call per session to name something the session is about to
  name for free.
