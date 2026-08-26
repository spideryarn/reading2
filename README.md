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
  when a design call is genuinely close, the tiebreak is: which option leaves more of the thinking
  with the reader?

## What exists today

This is an experiment, not a product: no users, no accounts, one process. One bet on one idea —
granularity zoom — plus the reading assistants the same block-id spine makes cheap. Select a
sentence and the model explains it, researching the web when it needs to
([comments.md](docs/project/comments.md)). A glossary of the terms the piece uses in a non-obvious
way, defined from the piece itself ([glossary.md](docs/project/glossary.md)). Search by exact words
or by what a passage says, hits marked in the prose ([search.md](docs/project/search.md)). Summaries
of the whole piece or any part, at a length you choose ([summaries.md](docs/project/summaries.md)).
A chat whose every claim carries a block id you can press
([chat-mode.md](docs/plans/chat-mode.md)). A library of what you have read
([library.md](docs/project/library.md)).

Chat deserves a flag, because "a chatbot with the article stuffed in the context window" is a named
anti-goal here ([vision.md § Anti-goals](docs/project/vision.md#anti-goals)). It was built anyway,
at Greg's request, and the argument that what was built is not the anti-goal — along with an honest
account of where that argument is weakest — is in
[chat-mode.md § Say the awkward thing first](docs/plans/chat-mode.md#say-the-awkward-thing-first).
Also not this, ever: "read it in 2 minutes", engagement mechanics, or confident claims with no path
back to the source.

`spideryarn2` is an offshoot of a working app that is far larger — accounts, a database,
deployment, a year of building. [original-version/](docs/project/original-version/overview.md) is
the map to it: a library to consult, not a backlog to import. This repo stays deliberately tight
where that one is broad.

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
