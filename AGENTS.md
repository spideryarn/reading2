# spideryarn2

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.

See [docs/project/vision.md](docs/project/vision.md).

The first feature is **granularity zoom**: the article rendered at any of several levels of
compression. Vertical = position in the article. Horizontal = how much detail. Scroll right toward
the full text, left toward a one-sentence gist.
See [docs/project/granularity-zoom.md](docs/project/granularity-zoom.md).

## Docs

- [docs/project/vision.md](docs/project/vision.md) — what we're trying to do, the principles, and what we're deliberately *not* doing
- [docs/project/granularity-zoom.md](docs/project/granularity-zoom.md) — the core feature: the tree, generation, interaction, failure modes
- [docs/project/architecture.md](docs/project/architecture.md) — pipeline stages, storage layout, server, stage ownership
- [docs/project/content-extraction.md](docs/project/content-extraction.md) — the Readability extraction stage (owned by another agent)
- [docs/project/open-questions.md](docs/project/open-questions.md) — undecided calls, each with a recommendation so nobody is blocked

`docs/reusable/` holds notes that aren't about this project and are meant to be carried elsewhere:

- [docs/reusable/CODEX_CLI_AS_SUBAGENT.md](docs/reusable/CODEX_CLI_AS_SUBAGENT.md) — dispatching a
  GPT/Codex subagent from Claude Code via [`scripts/run-codex.ts`](scripts/run-codex.ts), for
  cross-family review or delegated implementation

## How we write docs here

We keep **lots** of documents under `docs/project/`, and they exist mainly to carry **intent** —
Greg's suggestions, the goals, the design constraints, the decisions and why they were made. Not
descriptions of code, which the code already provides.

- **Quote Greg directly.** Where a document captures something he said, use his exact wording, or as
  near to it as possible, in a blockquote — the phrasing carries intent that a paraphrase loses.
  Attribute and date it. If you later find you've flattened a quote into your own voice, put his back.
- **Signpost heavily.** Every document should link out to the other documents and to the relevant
  bits of code (e.g. [`src/extract.ts`](src/extract.ts)), so an agent dropped into any one file can
  find its way to everything else. Cross-link both directions; deep-link to specific sections.
- **Record decisions where they belong.** When something in
  [open-questions.md](docs/project/open-questions.md) gets decided, write it into the relevant doc
  and delete the question. That file should shrink.
- **Write down anything a future reader would otherwise have to reverse-engineer** — especially the
  reason a design went one way rather than the obvious other way.

## Current state

- [`src/extract.ts`](src/extract.ts) — fetch a URL, run Mozilla Readability, write a standalone HTML
  file to `output/`. This is the prototype that pipeline stages 1–2 are growing out of.
- `output/noema-mythology-of-conscious-ai.html` — the working test article (Anil Seth, ~54 min read,
  long and mostly *unstructured* prose, which is deliberately the hard case).
- Everything else is unbuilt.

## The one contract that matters

Every block of the extracted article gets a **stable id** (`p0001`, `p0002`, …) in document order.
Ids are assigned once, at extraction, and are the anchor for *everything* downstream: the table of
contents, summaries at every level, scroll position, highlights, notes, questions. Features address
text by block id, never by character offset or CSS selector. If you change how ids are assigned, you
invalidate every cached artefact — bump the pipeline version rather than silently re-numbering.
Open sub-questions: [Q2](docs/project/open-questions.md#q2) (stability across re-extraction),
[Q3](docs/project/open-questions.md#q3) (what counts as a block).

## Working agreements for agents

- Several agents work this repo in parallel. Stay inside your stage — see
  [architecture.md § Stage ownership](docs/project/architecture.md#stage-ownership) — and talk to
  other stages through the JSON artefacts on disk, not by reaching into their code.
- Currently claimed: **extraction / Readability** and **the table of contents** are owned by other
  agents. Note that the deeply-nested ToC and the granularity-zoom tree are
  [the same structure](docs/project/granularity-zoom.md#the-tree) — coordinate rather than building two.
- Keep pipeline stages independently runnable and independently cacheable. Each writes JSON under
  `data/<slug>/`; anything expensive is cached on a content hash.
- Prefer boring: filesystem over database, one server process, TypeScript + ESM throughout, `tsx` to
  run. "It can be a simple one at first" — no framework churn while the ideas are still moving.
- Before writing any Anthropic SDK code, load the `claude-api` skill for current model ids and
  parameters; don't hardcode a model from memory.
