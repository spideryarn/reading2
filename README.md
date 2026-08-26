# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

The default AI reading tool compresses: paste an article, get bullet points, done. Useful for
triage, corrosive for understanding. We want the opposite — tools that make deep reading *cheaper*,
not optional. Scan the landscape quickly, then burrow into the actual prose at the point you care
about, ask questions there, and come away with something retained.

The first feature is **granularity zoom**: the article at any of several levels of compression,
vertical for position in the piece, horizontal for how much detail. Alongside it are a glossary, a
search, summaries at whatever length you ask for, and a chat that never takes the article off the
screen.

`spideryarn2` is just this working directory. The app this is an offshoot of is
[documented here](docs/project/original-version/overview.md) — it is far larger, it works, and it is
a library to consult rather than a backlog to import.

## Running it

```bash
npm install
cp .env.example .env.local     # add an OPENROUTER_API_KEY
npm run dev                    # http://localhost:5273
```

That opens the library at `/`, with a committed example article so a fresh clone has something to
read. Everything else — the per-stage pipeline commands, which model does which job, what each
secret is for — is in [setup-dev.md](docs/project/setup-dev.md).

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

## The one contract that matters

Every block of the article gets a **stable id** (`spya-k3m9qt`), and every feature — ToC, summaries,
scroll position, highlights, notes, questions — addresses text by that id, never by character offset
or CSS selector. Ids are minted once and preserved on every later run, so they survive re-extraction.

The format, the reasoning, and the one way to get range checks silently wrong are in
[block-ids.md](docs/project/block-ids.md). Read it before touching anything that resolves an id.

## Working here

Read [CLAUDE.md](CLAUDE.md) — it's the working agreement, for people as much as for agents. The
short version: several sessions work this tree at once, so stay inside your stage, never run a git
command that throws work away, and commit your own files by name
([version-control.md](docs/project/version-control.md) has the recipe and why it has the shape it
does).
