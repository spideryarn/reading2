# Slimming AGENTS.md, and giving the docs a spine

**Status:** in progress, 2026-08-27. Greg asked for it after reading `AGENTS.md` and finding it
bloated.

`AGENTS.md` (which `CLAUDE.md` symlinks to) is 54KB and is loaded into every agent's context on
every turn. Two thirds of it is the docs table, whose rows have grown from signposts into
paragraph-long retellings of each doc's contents — a second copy of the opening of every doc, with
dates and war stories, in the one file guaranteed to be read.

Measured before any change:

```
docs table (46 rows)      36,007 bytes   67%
working agreements        10,983         20%
folders (plans/reusable)   3,255          6%
how we write docs          2,318          4%
header + contract          1,496          3%
```

## What Greg asked for

> For really important docs, highlight them as important, and/or allow them to be a tiny bit
> longer. Less important docs should have a really short blurb. Get rid of the dates and the detail
> from the war stories (maybe just some teasers so that the agent is motivated to read the doc).
> Make sure the signposting in docs to other docs is really good, and structure things so that we
> have a smaller number of "overview" docs that signpost out to lots of smaller details docs, e.g.
> architecture-overview, design-overview, security-overview, etc etc. … Then the AGENTS.md would
> include signposts and blurbs for the important/overview docs, and only the filenames for all the
> sub-documents.
>
> — Greg, 2026-08-27

And, on the working agreements: keep "a very brief hint of the issues and/or reasons to read the
docs". And: a couple of very specific rules (filesystem layout, CSS) should move out into docs and
be signposted to.

## The shape

Six **overview docs** are the only things in `AGENTS.md` that get a blurb. Everything else is a bare
filename under the overview it belongs to. An agent looking for something reads one blurb, opens one
overview, and the overview has the real signposts.

| Overview | Covers | Exists? |
|---|---|---|
| `vision.md` | why this exists, the principles, the anti-goals | yes |
| `architecture.md` | the pipeline, what a block is, where the data lives | yes |
| `reading-view-overview.md` | everything the reader sees in the browser | **new** |
| `design-css-overview.md` | how it looks: stylesheets, tokens, type, colour | yes |
| `security-overview.md` | the threat model, and who owns which defence | **new** |
| `code-quality-overview.md` | the checks: test, typecheck, lint, static analysis, browser, perf | **new** |
| `dev-and-deployment-overview.md` | running it locally, and shipping it | **new** |

Two docs keep a blurb of their own despite sitting under an overview, because they are the two
things an agent is most likely to need and most likely to get wrong: `block-ids.md` (the one
contract) and `granularity-zoom.md` (the feature this app is for).

### Rules for a new overview doc

- Short. A page. If it grows past ~6KB it has stopped being an overview.
- Its job is signposting: one line per detail doc, saying what is in it and *why you would open it*.
- A teaser is allowed — "the bug that made the microphone look broken" — but no dates, no retelling.
- It links **down** to its detail docs and **up** to `AGENTS.md`; each detail doc gets a line at the
  top pointing back up to its overview, so the tree can be walked in both directions.
- No new facts. Everything in an overview is already written down somewhere; if the writing turns up
  something undocumented, say so rather than inventing it.

## Moving the working agreements out

Five bullets retell a story that is already written elsewhere. The **rule** stays in `AGENTS.md` as
an imperative sentence with a one-clause hint of why; the story moves to the doc that owns it. Any
literal command an agent copies (`git commit … -- <files>`, the `run-codex.ts` line) stays, because
those get pasted rather than read.

| Bullet | Story moves to |
|---|---|
| the commit recipe and the 2026-08-26 shared-index accident | `version-control.md` |
| the GPT Sol review, its fallback and its traps | `docs/reusable/codex-cli-as-subagent.md` |
| "prefer boring" and its two exceptions (Postgres, shadcn) | `vision.md` |
| renaming, and hunting every reference | `docs/reusable/rename-or-move.md` |
| streaming any model call a person waits on | `comments.md` |

The two specific rules Greg spotted:

- **the filesystem one** — "each stage writes JSON under `data/<slug>/`, cached on a content hash" —
  goes to `architecture.md`, which already documents the storage layout. It is also half wrong now
  that Postgres is arriving, which is the second reason not to keep a copy in `AGENTS.md`.
- **the CSS one** — the shadcn exception and how far it is allowed to spread — goes to `vision.md`
  (the principle it overrides) and `design-css-overview.md` (the practice).

## Also

- `docs/reusable/` gets a `README.md` index; `AGENTS.md` keeps one line pointing at it.
- The three-folder paragraph about `plans/`, `postmortems/` and `research/` says "neither folder is
  listed here" after describing three, and repeats itself. One short paragraph instead.
- The header paragraph explaining what `spideryarn2` is and what granularity zoom is duplicates
  `vision.md`. Cut to a sentence.

## Acceptance

Not "no fact lost", which nothing can check. These can be:

- `AGENTS.md` under 16KB. **Landed at 14.7KB, from 54.1KB.**
- Every imperative that was in the working agreements is still in the working agreements. Sol went
  through them line by line and the list is in the review; two had been dropped by the first draft
  and were put back (the ToC/zoom single-structure rule, and stages staying independently runnable).
- `tests/doc-links.test.ts` green on the new structural assertions: every doc under
  `docs/project/` is claimed by exactly one entry point, every claim resolves to a file, and the
  entry point really links to what it claims.

## Risk

Several agents are editing this tree, including `AGENTS.md` itself — a row was added to the table
while this plan was being written. So: new files first, edits to shared docs late and small, and
`AGENTS.md` re-read immediately before it is rewritten.


## What GPT Sol's review changed

The review is in [agents-md-slimming-review-sol.md](agents-md-slimming-review-sol.md). It agreed
with the goal and disagreed with the method, in one sentence worth keeping:

> The dangerous mistake is treating operational rules as documentation: memoryless agents will not
> open a linked document unless their task gives them a reason to.

Acted on:

- **Every imperative stays.** The first draft had quietly dropped two. Sol produced a table of all
  eighteen with a keep/move verdict on each; that table is the record of what this file must not
  lose next time somebody trims it.
- **"Anything expensive is cached on a content hash" is false**, and `database.md` had already said
  so — naming `AGENTS.md` as the source of the claim. It is true of two stages of seven. Corrected
  here and in [architecture.md](../project/architecture.md#conventions) rather than moved.
- **`security-overview.md` → [`security-map.md`](../project/security-map.md)**, H1 "Security map".
  Two files called `security*` with the same H1 was the confusion the split existed to prevent.
- **The new security map said "one reader"**, which [auth.md](../project/auth.md) contradicts: there
  is no allowlist, and every reader gets their own shelf. Fixed.
- **`prompt-caching.md` was an orphan** — no candidate entry point linked it. Now under
  architecture.
- **Bare filenames are not enough** for `copy.md`, `links.md`, `ideas.md`, `column-context.md`,
  `chat-tools.md` or `comments.md`, whose names don't say what they are. Those get a three-to-eight
  word discriminator; the self-evident ones don't.
- **The rot check**, which is the review's most useful single idea, and which was not in the plan at
  all. `AGENTS.md`'s own "↳" lines are the index, so the test parses them and fails on an orphan, a
  doc claimed twice, a claim that resolves to nothing, or an entry point that doesn't link what it
  claims. It reads the working tree rather than `git ls-files`, so an untracked new doc fails
  immediately. It found two real gaps on its first run.
- **No 45-file backlink pass.** Sol's advice was to land the indexes and the test first and let
  backlinks follow, given how many of these docs other agents are editing right now. The four new
  entry points and `vision.md` link *down* and carry an "Up:" line; the detail docs do not yet link
  up. That is the obvious next piece of work.
- **Don't copy the pipeline command inventory** into the dev overview — that is the same
  second-copy rot being removed. Replaced with a pointer to `setup-dev.md` and `package.json`.

Not acted on: Sol's suggestion of a separate `docs/project/index.json`. `AGENTS.md`'s own list is
already the index, and a second file would be one more thing to keep in step.
