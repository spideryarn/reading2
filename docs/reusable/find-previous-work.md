# Find previous work

> **Provenance.** An amalgam, written 2026-09-01, of `FIND_PREVIOUS_WORK.md` and
> `FIND_CLAUDE_CONVERSATION.md` from Greg's `coding-agent-instructions` — cut down to the sources
> that actually exist here, and re-checked against this machine's stores.

Not project-specific. How to find what was done before — the conversation, the plan, the commit —
so you don't redo it, contradict it, or quietly undo it.

**Do this in a Sonnet subagent.** It is grep over hundreds of megabytes of transcript, and the
answer is a few lines: the id, the resume command, the doc path, and why the work was done. Tell it
to read this doc first, and ask it back for those lines rather than for what it read.

**What to bring back, per hit:** the resume command (`claude --resume <uuid>`), the doc path, the
commit SHA — plus *when*, and *why*, in the person's own words where you can find them.

## Most durable first

The sources decay at different rates, so search them in this order:

1. **Git history** — never expires, covers everyone, already in the checkout.
2. **Docs written to survive** — `docs/plans/`, `docs/postmortems/`, `docs/research/`.
3. **Local transcripts** — the fullest record, but this machine and this user only.
4. **In-flight work** — branches, worktrees, stash, reflog.

An empty transcript search means "not on this machine". It never means "no prior work exists" —
fall through to git and the docs before you conclude that.

### 1. Git

```bash
git log --oneline --since="2 months ago" -- <path>   # what touched this area
git log --all --grep='<keyword>' --oneline           # messages here are paragraphs of why
git show <sha> --format='%(trailers)' --no-patch     # who wrote it, and from which session
```

Commit messages in this repo carry the reasoning, not just the change, so `--grep` is worth more
than it usually is. A `Claude-Session: https://claude.ai/code/session_01ABC…` trailer is a join key:
grep that `session_…` id across the transcript store and you land in the conversation that wrote the
commit, because the agent typed the trailer into its own message.

### 2. Plans, postmortems, research

The richest source of *why*, including the option that was passed over —
[write-planning-doc.md](write-planning-doc.md). Files are named `yyMMdd<letter>-kebab-description.md`,
so they sort by the day the work started, and a plan shares its letter with its reviews.

```bash
ls -t docs/plans docs/postmortems docs/research | head -30
rg -il '<keyword>' docs/
```

### 3. Claude Code transcripts

```
~/.claude/projects/<project-slug>/<uuid>.jsonl
```

The uuid is the filename, and it is exactly what `claude --resume <uuid>` wants — from any
directory, though the original `cwd` keeps relative paths sane. The slug is the working directory
with every `/`, `.` and `_` turned into `-`, so a worktree gets a double dash; don't hand-build it,
just search every project.

```bash
grep -rl "a memorable phrase" ~/.claude/projects/
```

Then date and open each candidate — there is no title file, so the de-facto title is the first
substantial thing the user said:

```bash
python3 - ~/.claude/projects/*/<uuid>.jsonl <<'PY'
import json, sys
for path in sys.argv[1:]:
    first = last = opener = None
    for line in open(path, errors="ignore"):
        try: o = json.loads(line)
        except Exception: continue
        if o.get("timestamp"): first = first or o["timestamp"]; last = o["timestamp"]
        if opener is None and o.get("type") == "user":
            c = o.get("message", {}).get("content")
            if isinstance(c, str) and len(c.strip()) > 30:
                opener = c.strip().replace("\n", " ")[:140]
    print(f"{path.split('/')[-1][:-6]}  {first}..{last}\n  {opener}")
PY
```

Codex CLI sessions live at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and resume with
`codex resume <id>` — but the review wrapper here never resumes one, so the answer file it wrote is
usually what you want instead ([codex-cli-as-subagent.md](codex-cli-as-subagent.md)).

### 4. Work that hasn't landed

```bash
git branch -a --sort=-committerdate | head -20
git worktree list          # each may hold uncommitted work
git stash list
git reflog --date=iso | head -30
```

Read only. Nothing in this list is yours to tidy up —
[version-control.md](../project/version-control.md).

## Don't be fooled

- **Your own search is in the results.** Asking an agent to find a phrase puts that phrase verbatim
  into today's transcript, and the commit trailer you grepped for lands there too. Every check while
  writing this doc matched the session doing the checking. The source is the **oldest** hit where
  the phrase is genuine content.
- **The system prompt is in every transcript.** Anything from `AGENTS.md` matches nearly everything.
  Grep for distinctive wording, not for house vocabulary.
- **A match is not a quote.** A phrase read out of a file mid-session is in the transcript as well.
  Good enough to find the session; useless for saying who said it.
- **`mtime` is not the session date.** Use the timestamps inside the file.
- **The opening message is often "hello".** Read a few messages in before deciding a session is the
  wrong one.

## Keep it cheap

`git log`, `rg` and `grep` answer most of these questions for nothing. Read metadata — dates, cwd,
openers, file lists — before you read a body, and read a body only when the metadata has failed.
Never read a whole transcript to find out whether it is the right one.

## See also

- [git-commit-changes.md](git-commit-changes.md) — the other half: leaving a trail worth finding
- [codex-cli-as-subagent.md](codex-cli-as-subagent.md) — where the cross-family reviews are written
- [write-planning-doc.md](write-planning-doc.md) — the naming convention that makes `ls -t` useful
