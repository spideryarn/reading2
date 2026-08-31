# Every gate reads the working tree, and HEAD was broken for hours

**2026-08-31.** Four separate changes landed in HEAD without the other half of themselves. Every one
of them was green on every machine in the building, all afternoon, on every gate we have. HEAD did
not compile for at least two hours and no automated check anywhere could see it.

Nobody was careless. Six sessions were working in one checkout, and the property our gates measure
came apart from the property that matters.

```
   what `npm run typecheck` and `npm test` check   →   "this WORKING TREE is consistent"
   what a fresh clone, CI or a deploy needs        →   "HEAD is consistent"
```

Those are the same thing when one person is working. They stop being the same thing the moment two
people commit into each other's files.

## The four

Each is a **declaration committed without the thing it declares**, and each was found by a person
rather than by a machine — a different person from the one who caused it, every time.

| # | What was in HEAD | What was still untracked or unapplied | How it surfaced |
|---|---|---|---|
| 1 | `src/db/schema.ts` declaring `article_revisions.timeline` | `drizzle/0035_timeline.sql`, unapplied | `sqlstate 42703` at runtime, as *"this app asked its database for something it would not do"* |
| 2 | `src/pipeline.ts` + `src/store/artifacts-fs.ts` calling `readRawBytes`, 5 sites | `src/fetch.ts`, which defines it | Nothing. Found by reading HEAD by hand |
| 3 | `src/routes.ts` with passage validation | `tests/chat-spoken-route.test.ts` and one sibling | Nothing. HEAD had the guard and nothing exercising it |
| 4 | *(prevented)* a link to `docs/project/timeline.md` | the doc itself | Caught before the commit, by a peer, not by a test |

**Number 1 is the instructive one for how these feel from outside.** The reader-facing sentence names
no column, so a suite hitting it reads as a *store* failure. The session that met it spent minutes
convinced it was their own in-flight work. The cause was three layers away and in somebody else's
commit.

## The mechanism

Two of the four were split by a **broad pathspec**: a commit that took `git add -A`-shaped scope and
swept up a peer's edits to *some* files while leaving that peer's other files — the ones holding the
definitions — behind.

That is not the failure `AGENTS.md` warns about, and the difference is the whole postmortem:

> **If a peer has unfinished work inside a file you are committing**, the pathspec form takes their
> hunks too — check with `git diff HEAD -- <file>` … Then either commit it and say in the message
> whose work rode along, or leave that file out and ship the rest.

That covers the hunks you **took**. It says nothing about the half you **left behind** — and that is
the half that breaks HEAD, because:

- the hunks you took are visible in your own diff, and you are told to look at them;
- the files you did not take are visible **nowhere**. Not in your diff, not in your status, not in
  any gate.

You cannot review an absence. So a rule that says "look at what you are taking" cannot catch this,
however carefully it is followed.

## Why nothing went red

Every gate we have runs against the working tree, and in the working tree both halves exist:

- `npm run typecheck` compiles the files on disk — `fetch.ts` was complete there the whole time.
- `npm test` imports the files on disk — the untracked route tests ran and passed.
- `tests/doc-links.test.ts` reads the **filesystem**, not git, so an untracked doc under a tracked
  link is green. **It can only go red after somebody has already committed the mistake**, on a
  machine that does not have the file. It is a good regression test and a useless pre-flight check.

So the gates were not wrong. They were answering a question nobody had noticed was the wrong one.

## What would have caught the class

**A typecheck of HEAD**, built from a temporary clone or `git archive HEAD` rather than the working
tree. It would have caught instances 1, 2 and 3 the moment each landed, and it is a small amount of
work.

**But run only the typecheck there, not the suite** — and this caution is load-bearing, because the
obvious version of this gate has already failed here once. From
[code-quality-overview.md](../project/code-quality-overview.md): the deploy gate's worktree has no
gitignored `output/`, so about twelve tests fail there **structurally**, and forcing past it became
routine. **A gate people learn to force is worse than no gate**, because it teaches everyone to
ignore a red.

A typecheck does not have that problem: it needs no fixtures, no `output/`, no database, and it is
deterministic. It either compiles or it does not.

Where it belongs is an open question — `scripts/check.ts`, the deploy path, or neither yet. It should
**not** be added while several sessions are mid-landing, because a gate that reddens on a known-broken
HEAD stops everybody on day one and gets forced immediately, which is exactly the failure above.

## The rule that follows, and it is one habit not two

**A new file must be `git add`ed in the same command as anything that references it**, because a
pathspec cannot name an untracked file. The recipe already says this; today shows why it is not two
separate habits:

```
git add -- <every NEW file> && git commit -F <msg> -- <all your files>
```

And when committing a file you share: ask not only *whose hunks am I taking* but **what else does
this change need in order to stand up alone** — the migration, the definition, the test, the doc.

## A second trap, found while fixing the first

The session that owned instance 2 told its two agents to stop writing so it could take a clean
instant to commit. Neither replied. `ls -lT` showed one of the files had been written **27 seconds
earlier**.

> An agent's "stop" is not effective until it says so, and an idle notification is not proof either.

Committing then would have turned one broken HEAD into a broken HEAD *plus* a landed half-thought.
The check that works is the **mtime on the files it holds**, not the message. It chose to leave HEAD
broken a few more minutes, which was the cheaper of the two mistakes.

## What this is not

It is not an argument against working in a shared tree, and not an argument that anyone should have
been more careful. Every one of the four was committed by somebody following the rules, and in each
case **the person who committed and the person whose change was split were different people** —
which is precisely why no individual could see it. That is what makes it a tooling gap rather than a
discipline one.

The messages between sessions caught all four. Three instances in one afternoon, each found by
somebody other than whoever caused it, is a reasonable argument that the interruptions are worth
their cost.

## See also

- [version-control.md](../project/version-control.md) — the commit recipe and the accidents behind it.
- [silent-success.md](../reusable/silent-success.md) — the family this belongs to: a check that
  agrees with the code because it shares an assumption with it.
- [code-quality-overview.md](../project/code-quality-overview.md) — the gates, and the deploy-gate
  worktree whose structural failures made forcing routine.
- [timeline-mode.md](../plans/timeline-mode.md) — the work that produced instances 1 and 4.
