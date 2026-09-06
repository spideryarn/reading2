# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

Everything in this repo is downstream of that sentence.

## The problem

Nearly every AI reading tool makes the same move: compression. Paste an article, get bullet points,
done. That is genuinely useful for triage and genuinely corrosive for understanding. You come away
with a fluent impression of the piece and none of its texture: no argument you could reconstruct,
no sentence you could quote, no sense of where the author was strong and where they were
hand-waving. The summary replaced the reading instead of supporting it.

This worry is older than this repo. The much larger app this one grew from named it as the central
risk — the AI doing too much, the reader getting lazy, nothing internalised — and offered a framing
worth keeping: imagine *"a bunch of smart postdocs who you could give any instructions to"*. You
would not ask them to read for you. You would ask them to make your own reading better.

## The bet

Make deep reading *cheaper*, not optional. Scan the landscape quickly. Descend on demand into the
actual prose, at the point you care about. Stay oriented at whatever altitude you are flying. Ask
questions at the moment of confusion, in place. Come away with something retained.

The first feature built on this is **granularity zoom**
([granularity-zoom.md](docs/project/granularity-zoom.md)): the article at several levels of
compression, vertical for position in the piece, horizontal for how much detail. The leftmost level
is a sentence for the whole piece; the rightmost is always the author's verbatim prose; move
sideways and the text expands or contracts without you losing your place.

Three commitments separate this from the summariser it superficially resembles:

- **The text is the destination, not the source material.** Every generated line is a door into the
  prose, not a wall in front of it. We never silently rewrite the author's words: generated text
  lives at generated altitudes, and the rightmost level is verbatim, always.
  [vision.md § Principles](docs/project/vision.md#principles).
- **Nothing the model says is unanchored.** Every block of the article has a stable id, and anything
  the model asserts is tied to one, so the passage it came from is one press away. That contract is
  spelled out [below](#the-one-contract-that-matters).
- **It is a reading tool, not a writing or chat tool.** The article never leaves the screen. And
  when a design call is genuinely close, the tiebreak is: which option will best help the reader
  form their own rich, updated internal representation — digest, understand, learn, notice,
  integrate, critique?

## What exists today

This is an experiment first and a product second — but it is a real one now, with accounts, a beta
gate, billing, and paying readers since 2026-09-03. The readership is small and knows what it signed
up for, so we still optimise for how fast we can move. One bet on one idea —
granularity zoom — plus the reading assistants the same block-id spine makes cheap. Select a
sentence and the model explains it, researching the web when it needs to
([comments.md](docs/project/comments.md)). A glossary of the terms the piece uses in a non-obvious
way, defined from the piece itself ([glossary.md](docs/project/glossary.md)). Search by exact words
or by what a passage says, hits marked in the prose ([search.md](docs/project/search.md)). Summaries
of the whole piece or any part, at a length you choose ([summaries.md](docs/project/summaries.md)).
A chat whose every claim carries a block id you can press
([260826a-chat-mode.md](docs/plans/260826a-chat-mode.md)). A library of what you have read
([library.md](docs/project/library.md)).

Chat deserves a flag, because "a chatbot with the article stuffed in the context window" is a named
anti-goal here ([vision.md § Anti-goals](docs/project/vision.md#anti-goals)). It was built anyway,
at Greg's request, and the argument that what was built is not the anti-goal — along with an honest
account of where that argument is weakest — is in
[260826a-chat-mode.md § Say the awkward thing first](docs/plans/260826a-chat-mode.md#say-the-awkward-thing-first).
Also not this, ever: "read it in 2 minutes", engagement mechanics, or confident claims with no path
back to the source.

`reading2` is an offshoot of a working app that is far larger — accounts, a database,
deployment, a year of building. [original-version/](docs/project/original-version/overview.md) is
the map to it: a library to consult, not a backlog to import. This repo stays deliberately tight
where that one is broad.

## Running it

You need **Node 26**, **Docker running**, and an **OpenRouter API key**. Nothing else — no Supabase
account, no Google credentials, no keys on anybody's dashboard.

```bash
npm install
cp .env.example .env.local     # add an OPENROUTER_API_KEY
npm run db:start               # Docker; first run pulls ~2 GB of images
npm run db:status              # copy its two keys into .env.local — see below
npm run setup                  # migrations, an account, and a shelf with something on it
npm run db:admin-password      # the password for dev-admin@spideryarn.local
npm run dev                    # http://localhost:5273
```

**The database has to be up before `npm run setup`**, because seeding the account needs keys that do
not exist until the stack has started. `npm run setup` refuses rather than guessing if you skip it.

That opens the library at `/` once you sign in, with a few seeded articles so a fresh clone has
something to read. **The ordering matters and the reasons are worth two minutes** —
[setup-dev.md § Quickstart](docs/project/setup-dev.md#quickstart) has these same commands with a
"did it work?" check after each and a table of what the failures mean. Everything else — the
per-stage pipeline commands, which model does which job, what each secret is for — is in the rest of
that file.

```bash
npm test          # vitest
npm run typecheck
npm run lint      # advice, not a gate — the baseline isn't clean yet
```

## Where the real documentation is

**This file is a signpost, and so is [CLAUDE.md](CLAUDE.md).** Everything real lives in
`docs/project/`, and [CLAUDE.md](CLAUDE.md) has the full table — one line per doc, saying what is in
it. Start there. The handful worth naming here:

| Doc | What's in it |
|---|---|
| [vision.md](docs/project/vision.md) | what we're trying to do, the principles, and what we're deliberately *not* doing |
| [granularity-zoom.md](docs/project/granularity-zoom.md) | the core feature: the tree, generation, interaction, failure modes |
| [architecture.md](docs/project/architecture.md) | pipeline stages, what a block is, storage layout, who owns which stage |
| [block-ids.md](docs/project/block-ids.md) | **the one contract that matters** — see below |
| [setup-dev.md](docs/project/setup-dev.md) | install, dev, every pipeline command, and which model each job uses |
| [version-control.md](docs/project/version-control.md) | the GitHub remote, and the commit recipe for a tree with several agents in it |
| [original-version/](docs/project/original-version/overview.md) | the larger app this came from: what we borrowed, what it already solved, what it got wrong |

`docs/plans/` holds the reasoning behind work being done or just done; `docs/postmortems/` one file
per bug worth understanding; `docs/research/` the options weighed behind a decision. None of them
are indexed — list the folder and read the file names.

**And three tutorials**, self-contained HTML explainers written for somebody who knows the product
and has never opened the code. Open them in a browser rather than reading the source:

| Tutorial | What it explains |
|---|---|
| [architecture.html](docs/tutorials/architecture.html) | **start here** — the whole system: the fifteen pipeline steps, the block id everything hangs off, the revision swap, and the request path |
| [import-pipeline-and-database.html](docs/tutorials/import-pipeline-and-database.html) | the same pipeline one level deeper, with the job lifecycle and how it fails |
| [revisions-and-the-schema.html](docs/tutorials/revisions-and-the-schema.html) | what a revision carries, and the four refusals that stop a bad draft publishing |

## The one contract that matters

Every block of the article gets a **stable id** (`spya-k3m9qt`), and every feature — Hierarchy, summaries,
scroll position, highlights, notes, questions — addresses text by that id, never by character offset
or CSS selector. Ids are minted once and preserved on every later run, so they survive re-extraction.

The format, the reasoning, and the one way to get range checks silently wrong are in
[block-ids.md](docs/project/block-ids.md). Read it before touching anything that resolves an id.

## Contributing

Contributions are welcome, and the most useful one is not code.

**The easiest and best way to help is the Feedback button**, top-right of the reading view once you
are signed in. A really well-described bug report or feature request — what you were doing, what you
expected, what happened instead, and *why it mattered to your reading* — **feeds directly into the
product-building pipeline**. Reports are stored, triaged, and worked through in batches, with a note
kept under [`docs/user-feedback/`](docs/user-feedback/) and the reasoning written down
([feedback-reports.md](docs/project/feedback-reports.md) is the process;
[260904b](docs/plans/260904b-address-user-feedback-reports-batch.md) is what one batch looks like).
Nothing here has produced more change per minute spent than a precisely-described report.

**And if you want to write code, I'd love to work with you.** Get in touch first at
**hello@spideryarn.com** — say what you want to build and we'll work out whether it fits, which
saves you building something the vision doc rules out
([vision.md § Anti-goals](docs/project/vision.md#anti-goals) is worth a read either way).
[setup-dev.md](docs/project/setup-dev.md) takes an empty checkout to a running app, and
[docs/tutorials/architecture.html](docs/tutorials/architecture.html) explains how the whole thing
works to somebody who has never opened the code.

**One unusual condition on pull requests.** If you built it with an AI agent — and most of this repo
was — include the prompts and the conversation alongside the diff. Greg, 2026-09-06:

> If someone wants to submit a pull request, they have to also include the prompts/conversation with
> their agents that helped them build it, so I can understand their intent/approach.

Paste them into the PR description, or add them as a file under `docs/plans/`. This is not a
formality: in a codebase where the code is cheap and the *intent* is the scarce thing, the
conversation is the part that says what you were trying to do and what you decided not to do — which
is exactly what a reviewer needs and a diff never shows. It is the same reason every piece of work
here keeps a plan doc.

## Working here

Read [CLAUDE.md](CLAUDE.md) — it's the working agreement, for people as much as for agents. The
short version: several sessions work this tree at once, so stay inside your stage, never run a git
command that throws work away, and commit your own files by name
([version-control.md](docs/project/version-control.md) has the recipe and why it has the shape it
does).
