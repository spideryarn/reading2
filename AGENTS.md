# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

The product is **Spideryarn**; `spideryarn2` is just this working directory, and the app it's an
offshoot of is [documented here](docs/project/original-version.md). The first feature is
**granularity zoom** — the article at any of several levels of compression, vertical for position in
the piece, horizontal for how much detail.

**This file is a signpost, not a spec.** Everything real lives in `docs/project/`.
`CLAUDE.md` is a symlink to this file — there is only one of it, so edit either name freely.

## Docs

Start with [vision.md](docs/project/vision.md), then whichever of these you need:

| Doc | What's in it |
|---|---|
| [vision.md](docs/project/vision.md) | what we're trying to do, the principles, and what we're deliberately *not* doing |
| [granularity-zoom.md](docs/project/granularity-zoom.md) | the core feature: the tree, the node shape, generation, interaction, failure modes |
| [block-ids.md](docs/project/block-ids.md) | **the spine** — the id format, and why ids are random rather than sequential |
| [table-of-contents.md](docs/project/table-of-contents.md) | the deeply-nested ToC: schema, granularity, the generation prompt |
| [architecture.md](docs/project/architecture.md) | pipeline stages, what a block is, storage layout, server, stage ownership |
| [content-extraction.md](docs/project/content-extraction.md) | the Readability extraction stage |
| [web-client.md](docs/project/web-client.md) | the reading view (stage 6): where the client code is and the constraints it works under |
| [tooltips.md](docs/project/tooltips.md) | the spine's hover tooltips: which library, why Floating UI over Radix and Tippy, and the four things that fail silently |
| [url-state.md](docs/project/url-state.md) | every bit of view state lives in the URL: the parameters, which ones push history and which replace, and why position is a *section* |
| [setup-dev.md](docs/project/setup-dev.md) | install, `npm run dev`, and the command for each pipeline stage |
| [original-version.md](docs/project/original-version.md) | the app this is an offshoot of: what we borrowed (brand, tokens, typography), what it already solved, what we're leaving behind |
| [testing.md](docs/project/testing.md) | the test runner, what's deterministic enough to test, and what we deliberately don't |
| [browser-testing.md](docs/project/browser-testing.md) | how to drive the reading view in a browser, and the ways it lies to you: colour, sticky positioning, and a hidden tab that fires no scroll events at all |
| [open-questions.md](docs/project/open-questions.md) | undecided calls, each with a recommendation so nobody is blocked |

`docs/reusable/` holds notes that aren't about this project and are meant to be carried elsewhere:

- [docs/reusable/codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md) — dispatching a
  GPT/Codex subagent from Claude Code via [`scripts/run-codex.ts`](scripts/run-codex.ts), for
  cross-family review or delegated implementation
- [docs/reusable/third-party-library-selection.md](docs/reusable/third-party-library-selection.md) —
  how to pick a dependency: bias towards long-lived, heavily-documented libraries, then write the
  decision down. Followed for Vitest in [testing.md](docs/project/testing.md)
- [docs/reusable/silent-success.md](docs/reusable/silent-success.md) — **the pattern behind most of
  a day's bugs.** A thing reports success while doing nothing, and the check you'd naturally run
  returns the answer you were hoping for — because it shares an assumption with the code. Six worked
  examples and the habit that catches them.
- [docs/reusable/css-sticky-containing-block.md](docs/reusable/css-sticky-containing-block.md) —
  why `position: sticky` can be declared correctly and do nothing: its range is its containing
  block's size minus its own, so a `100vw` bar in a `100vw` parent has zero range and fails
  silently. Found here, but not about this project.
- [docs/reusable/gjdutils-instructions.md](docs/reusable/gjdutils-instructions.md) — **read this
  first.** Greg keeps a library of reusable "how to do this kind of task well" instructions in
  [gjdutils](https://github.com/gregdetre/gjdutils/tree/main/docs/instructions). When a task matches
  one, follow it rather than inventing a process. Copied in so far:
  - [capture-sounding-board-conversation.md](docs/reusable/capture-sounding-board-conversation.md) —
    writing a conversation up as a document: quote Greg verbatim, synthesise the rest
  - [generate-mermaid-diagram.md](docs/reusable/generate-mermaid-diagram.md) — authoring `.mermaid`
    files and rendering them to SVG, plus the house style for colour, shape and labels
  - [rename-or-move.md](docs/reusable/rename-or-move.md) — `git mv`, then hunt down every reference
  - [write-deep-dive-as-doc.md](docs/reusable/write-deep-dive-as-doc.md) — researching a topic and
    writing it up as a reference doc with its sources attached

## The one contract that matters

Every block of the article gets a **stable id** (`spya-k3m9qt`), and every feature — ToC, summaries,
scroll position, highlights, notes, questions — addresses text by that id, never by character offset
or CSS selector. Ids are minted once and preserved on every later run, so they survive re-extraction.

The format, the reasoning, and the one way to get range checks silently wrong are all in
**[block-ids.md](docs/project/block-ids.md)** — read it before touching anything that resolves an id.

## How we write docs here

We keep **lots** of documents under `docs/project/`. A doc here is really only two things:

1. **Intent** — Greg's suggestions and directions, the goals, the design constraints, the decisions
   and why they were made. Mostly in his own words.
2. **Signposts** — links to the other docs and to the code, so an agent dropped into any one file
   can quickly find the relevant place.

Not descriptions of code, which the code already provides.

- **Update the docs as you go.** Any time you create or change functionality, consider whether a doc
  under `docs/project/` needs creating or updating, and do it in the same piece of work.
- **File names are lower-case kebab-case.** `table-of-contents.md`, not `TABLE_OF_CONTENTS.md`.
  This holds everywhere under `docs/`, including `docs/reusable/`, even when the doc was copied in
  from somewhere that shouted. Rename on sight and fix the links.
- **New doc ⇒ new signpost.** Every time you add a doc, add a line for it to the table above in this
  file. A doc nothing links to may as well not exist.
- **Quote Greg directly.** Where a document captures something he said, use his exact wording, or as
  near to it as possible, in a blockquote — the phrasing carries intent that a paraphrase loses.
  Attribute and date it. If you later find you've flattened a quote into your own voice, put his back.
- **Signpost heavily.** Every document should link out to the other documents and to the relevant
  bits of code (e.g. [`src/blocks.ts`](src/blocks.ts)), so an agent dropped into any one file can
  find its way to everything else. Cross-link both directions; deep-link to specific sections.
- **Record decisions where they belong.** When something in
  [open-questions.md](docs/project/open-questions.md) gets decided, write it into the relevant doc
  and delete the question. That file should shrink.
- **Write down anything a future reader would otherwise have to reverse-engineer** — especially the
  reason a design went one way rather than the obvious other way, and *especially* where the decision
  went against the recommendation written down at the time.

## Working agreements for agents

- Several agents work this repo in parallel. Stay inside your stage — see
  [architecture.md § Stage ownership](docs/project/architecture.md#stage-ownership) — and talk to
  other stages through the JSON artefacts on disk, not by reaching into their code.
- The deeply-nested ToC and the granularity-zoom tree are
  [the same structure](docs/project/granularity-zoom.md#the-tree), produced by stages 4 and 5
  together. They must not diverge into two trees.
- Keep pipeline stages independently runnable and independently cacheable. Each writes JSON under
  `data/<slug>/`; anything expensive is cached on a content hash.
- Prefer boring: filesystem over database, one server process, TypeScript + ESM throughout, `tsx` to
  run. "It can be a simple one at first" — no framework churn while the ideas are still moving.
- Before rebuilding something the previous version already solved — AI headings, multi-granularity
  summaries, Readability edge cases, overlapping highlights, stable element ids — check
  [original-version.md](docs/project/original-version.md). It's a library to consult, not a backlog
  to import: that project is far larger in scope, and this one is staying tight.
- **Run `npm test` before you commit.** It is deterministic and takes ~2s. What's covered, and what
  isn't, is in [testing.md](docs/project/testing.md).
- Before writing any Anthropic SDK code, load the `claude-api` skill for current model ids and
  parameters; don't hardcode a model from memory.
- **Committing, with several agents in one working tree.** We're deliberately not using git
  worktrees yet — not worth the complexity — so the tree has other agents' in-flight edits in it.
  Commit only your own files, by naming them explicitly and doing it in one atomic command:

  ```
  git reset && git add <your files> && git commit -m "…"
  ```

  The leading `git reset` unstages anything someone else left staged. Never `git add -A`, `git add .`
  or `git commit -a`. And don't stress if someone sweeps up one of your changes anyway — it happens,
  it's recoverable, keep going.
