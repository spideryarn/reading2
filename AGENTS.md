# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

The product is **Spideryarn**; `spideryarn2` is just this working directory, and the app it's an
offshoot of is [documented here](docs/project/original-version/overview.md). The first feature is
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
| [database.md](docs/project/database.md) | **where the data lives**: one directory per article today, one file per stage — and the *read* seam is `src/api.ts` while the write path is six stage modules, which is the mistake most estimates of this migration start from. Also **how to connect to the remote**: which of the three hosts to use and why the obvious one won't work from Vercel, the enforced SSL that `pg` doesn't do by default, and the three credentials none of which is the superuser |
| [supabase-local.md](docs/project/supabase-local.md) | **the whole Supabase stack in Docker on this laptop**: `npm run db:start`, the two settings that are not the default (a `5436x` port block so it can run beside the old app's, and a Postgres version that tracks the remote rather than the CLI), why the local keys are not secrets, and the five ways it goes wrong quietly — a stale socket that looks like a running daemon among them |
| [fetching.md](docs/project/fetching.md) | **stage 1**: the size cap that counts the right bytes, the charset sniff, why Node's own text decoder is wrong about curly quotes, and the certificate failure that works fine in your browser |
| [content-extraction.md](docs/project/content-extraction.md) | the Readability extraction stage |
| [web-client.md](docs/project/web-client.md) | the reading view (stage 6): where the client code is and the constraints it works under |
| [tooltips.md](docs/project/tooltips.md) | the spine's hover tooltips: which library, why Floating UI over Radix and Tippy, and the four things that fail silently |
| [keyboard.md](docs/project/keyboard.md) | ↑ / ↓ step through the article, and the level they step by is whichever column the pointer is in |
| [glossary.md](docs/project/glossary.md) | **the terms this piece uses, and where it uses them**: a *mode* in the band rather than a page, so it cost the layout one line; the two bugs from the original it is shaped around — output tokens are what time out, and "keep the first one" systematically deleted the more specific phrase — the richness-scored dedup their plan wrote and never built, why occurrences are found by us rather than asked of the model, why the word boundary is not `\b`, the condition attached to keeping the model's difficulty and centrality scores and the threshold slider that handed the one number in it to the reader — and **why an entry says two things rather than one**: what the author means (from the article) and what you need to bring to it (the model's own knowledge), which is what stopped entries describing the page the reader is looking at, and made provenance a label instead of a warning triangle. The web is per-term and reader-initiated, and it is `explain` with a different selection rather than a second mechanism |
| [summaries.md](docs/project/summaries.md) | **the article at whichever length you ask for**: a *mode* in the band, and the previous version's named length ladder wired to every level of the tree rather than to one hardcoded tooltip; why the shortest rung is free and the panel therefore works before anybody has paid a model call, one batched call per parent and the 89% that buys, the partial salvage that stops one malformed entry taking eight good ones with it, why a fallback down the ladder has to say so out loud, and the expertise axis they built that nobody ever measured |
| [comments.md](docs/project/comments.md) | select a sentence and the model explains it: the dialog (not a column), when it searches the web, and why the anchor is the quote rather than an offset |
| [url-state.md](docs/project/url-state.md) | every bit of view state lives in the URL: the parameters, which ones push history and which replace, and why position is a *section* |
| [column-context.md](docs/project/column-context.md) | how a gist column reads: the whole level in a panel with the current item held on the reading line — Greg's centred fisheye, chosen over three alternatives built beside it; the research, GPT's review, what the panel replaced and what it cost |
| [ingest-queue.md](docs/project/ingest-queue.md) | **paste a URL and it becomes an article**: the five steps as data, why p-queue and not BullMQ or pg-boss, why it polls rather than streaming, and an honest account of how far "idempotent" actually goes |
| [library.md](docs/project/library.md) | the homepage: browsing past articles, `/read/<slug>`, what a card says and why the blurb is the root gist, and the one file a move to Postgres goes behind |
| [design-css-overview.md](docs/project/design-css-overview.md) | **the map for anything visual** (stub): the four stylesheets and the order they load in, which of the three mechanisms owns a given rule, the colour and type tokens, the sans that replaced Georgia and why the previous version's docs were wrong about its own fonts, the vertical rhythm, and an honest list of what isn't decided. Its live counterpart is **`/design`** ([`DesignPage.tsx`](src/web/DesignPage.tsx)) — every token, face, weight and component variant on one page, with contrast measured in the browser; look at it after touching `tokens.css` |
| [icons.md](docs/project/icons.md) | Lucide, not Phosphor: why, the one stroke weight everything uses, the loading spinner recipe, and the two ways swapping a glyph for an SVG breaks a layout quietly |
| [auth.md](docs/project/auth.md) | **the one-email beta gate** (stub): why auth here is about an open proxy and an open wallet rather than user accounts, why Supabase Auth won, the list of five providers that RLS restricts you to, and the one test that has to exist |
| [search.md](docs/project/search.md) | **finding a passage by its words, or by what it says**: one box with two matchers behind it and one results list, why the literal one is the default (it is the free one), the wall the borrowed docs warn about that `annotateHtml` had already gone round — and why we did *not* need the CSS Custom Highlight API — the confidence unit that changed silently in their version and the four counts in the log line that would catch it here, the shared `findQuote` rule that stops the panel and the prose disagreeing, and why the search wash is a different hue rather than a different alpha |
| [security.md](docs/project/security.md) | **two untrusted parties, and neither is another user** — the content, and the URL: why Readability let `<img onerror>` reach the reading view, where the sanitiser sits and why it's stage 3, the video-embed allowlist, the confirmed path traversal in the read API and the fixture fallback that disguised it as a refusal, the four ways to break it silently, and an honest list of what's still open |
| [logging.md](docs/project/logging.md) | **what the server says to whoever is running it**: why Pino, the three ways its config deliberately differs from the original version's, what each level means here, why redaction being path-based makes the message string a rule rather than a preference, Vercel's one-day retention and the two traps in its log view, why the pipeline's token counts are logged from the seam rather than from inside anyone's stage — and why the CLI's `console.log` output is not logging and is staying |
| [prompt-caching.md](docs/project/prompt-caching.md) | **paying for the article once**: the three caches and why it is three rather than one, the `←READER IS HERE` marker that sat inside the article body and meant explain never hit a cache in its life, the one renderer every prompt now goes through, the 1,024-token floor under which a breakpoint is accepted and does nothing, why a fan-out that fires all at once pays the write four times and reads none — and the two halves of checking it, since a broken cache returns the right answer and only costs more |
| [linting.md](docs/project/linting.md) | `npm run lint`: why Biome rather than ESLint (TypeScript 7 removed the API ESLint needs), the config-file extension that silently discards your settings, and which rules are off on purpose |
| [typechecking.md](docs/project/typechecking.md) | `npm run typecheck`: the three tsconfigs, the strict flags we turned on and the one we didn't, and the guard that stops a typecheck checking nothing |
| [setup-dev.md](docs/project/setup-dev.md) | install, `npm run dev`, the command for each pipeline stage, and **which model everything uses** — one constant in [`src/models.ts`](src/models.ts), in the two spellings the Anthropic SDK and OpenRouter each want |
| [original-version/](docs/project/original-version/overview.md) | **a folder, not a file** — the app this is an offshoot of, one doc per feature: what we borrowed, what it already solved, what it got wrong, and [what to rebuild first](docs/project/original-version/borrow-list.md) |
| [testing.md](docs/project/testing.md) | the test runner, what's deterministic enough to test, what we deliberately don't — and **[`evals/`](evals/README.md)**, which is the other thing: run by hand, calls a model or measures one's output, results committed so the next change is compared against a number rather than a memory |
| [browser-testing.md](docs/project/browser-testing.md) | how to drive the reading view in a browser, and the ways it lies to you: colour, sticky positioning, and a hidden tab that fires no scroll events at all |
| [open-questions.md](docs/project/open-questions.md) | undecided calls, each with a recommendation so nobody is blocked |

`docs/plans/` holds plans for work that is being done or has just been done — the reasoning and the
evidence behind a change, written before it landed and kept afterwards so the *why* survives.

`docs/postmortems/` holds one file per bug worth understanding — what the root cause actually was,
which commit introduced it, the fix that's right for the long term, and what would have caught the
whole class of it earlier. Not listed here either; list the folder.

`docs/research/` holds the working behind a decision — the options weighed, the sources, and the
dead ends — kept so nobody has to run the search again. A plan says what we're doing; a research doc
says what else we could have done and why we didn't.

Neither folder is listed here. There are a lot of them and they keep arriving, so list the directory
and read the file names — they say what each one is about, and the first paragraph of a plan says
the rest.

`docs/reusable/` holds notes that aren't about this project and are meant to be carried elsewhere:

- [docs/reusable/codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md) — dispatching a
  GPT/Codex subagent from Claude Code via [`scripts/run-codex.ts`](scripts/run-codex.ts), for
  cross-family review or delegated implementation
- [docs/reusable/third-party-library-selection.md](docs/reusable/third-party-library-selection.md) —
  how to pick a dependency: bias towards long-lived, heavily-documented libraries, then write the
  decision down. Followed for Vitest in [testing.md](docs/project/testing.md)
- [docs/reusable/silent-success.md](docs/reusable/silent-success.md) — **the pattern behind most of
  a day's bugs.** A thing reports success while doing nothing, and the check you'd naturally run
  returns the answer you were hoping for — because it shares an assumption with the code. A dozen
  worked examples and the habit that catches them.
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
- **New doc ⇒ new signpost.** Every time you add a doc under `docs/project/`, add a line for it to
  the table above in this file. A doc nothing links to may as well not exist. Plans and research docs
  don't get a line — they're found by listing their folder — but link to them from the project docs
  they bear on.
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

- **Explain plainly.** Whenever you explain something, summarise, or ask a question — in chat, in a
  doc, in a commit message — use plain words and short sentences. Say the thing itself, not a
  gesture at it. No jargon where an ordinary word will do, no hedging padding.
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
  **Two deliberate exceptions, both 2026-08-25 and both Greg's call.**

  *One — the database.* "Filesystem over database" is being reversed: storage moves to Supabase
  Postgres, *"in readiness for deploying this properly to the web."* The principle didn't lose an
  argument, it ran out of runway — a single writable disk is the thing serverless hosting does not
  have, so the choice is a database or no deploy. Planned in
  [postgres-migration.md](docs/plans/postgres-migration.md), **not yet built**; until it is, the
  filesystem layout in [database.md](docs/project/database.md) is still what's true. Note that
  "one server process" in this bullet goes with it, and that everything else here — TypeScript, ESM,
  `tsx`, no framework churn — is untouched.

  *Two — shadcn.* Tailwind v4 and shadcn components went in at Greg's
  request — *"Let's switch to using Shadcn."* That is framework churn, and it was weighed against
  this bullet rather than slipped past it: the plan
  ([shadcn-migration.md § Honest assessment](docs/plans/shadcn-migration.md#honest-assessment))
  states the cost in full and recommends only the cheap half of it. The principle was not forgotten;
  its owner overrode it. It still governs everything else, and it still governs how far shadcn
  spreads — [web-client.md § Tailwind and shadcn](docs/project/web-client.md#tailwind-and-shadcn-components)
  says what is deliberately staying hand-written.
- Before rebuilding something the previous version already solved — AI headings, multi-granularity
  summaries, Readability edge cases, overlapping highlights, stable element ids — check
  [original-version/](docs/project/original-version/overview.md). It's a library to consult, not a backlog
  to import: that project is far larger in scope, and this one is staying tight.
- **Log from the server, `console.log` from the CLI** — the rule is the destination, not the
  function name. Anything in a request path goes through [`src/log.ts`](src/log.ts), and a
  `console.log` there is a bug. Never put anything sensitive, or any article prose, in a log.
  [logging.md](docs/project/logging.md) has the why, the levels, and what fails silently.
- **Run `npm test` and `npm run typecheck` when you finish a change, not just before you commit.**
  Both are deterministic and take a few seconds, and finding out at commit time that a change from
  half an hour ago was wrong is the expensive way to find out. `npm run lint` too, on the files you
  touched — its baseline is not clean yet, so read it as advice rather than a gate; see
  [linting.md](docs/project/linting.md). What the tests cover, and what they don't, is in
  [testing.md](docs/project/testing.md); why the typecheck needs a script of its own rather than a
  bare `tsc` is in [typechecking.md](docs/project/typechecking.md).
- **Reproduce a bug with a failing test before you fix it.** Write the test first and watch it go
  red — a test that was never red proves nothing. Then fix, and check it's gone green.
- **Root-cause every bug in a subagent, and write it up.** When you're fixing a bug, hand the
  investigation to a subagent and tell it to keep going until it really understands the cause — not
  the line that broke, but why that line was written. It should come back with: the root cause, which
  commit(s) introduced it and when, the fix that's best for the long term rather than the quickest,
  what we can learn from it, how we'd avoid this whole class of problem in future, and whether
  anything should be rearchitected. Then write that up as a new `.md` under `docs/postmortems/`.
- **Do browser work in a Sonnet subagent.** Anything driving Claude-in-Chrome — browser automation,
  checking the reading view in a real browser, screenshots — should be delegated to a subagent with
  `model: "sonnet"` rather than run in the main thread. It's mostly click-look-click, the screenshots
  are large, and keeping them out of the main context is worth more than the extra reasoning. Tell
  the subagent to read [browser-testing.md](docs/project/browser-testing.md) first, and ask it back
  for the conclusion, not the page dumps.
- Before writing any Anthropic SDK code, load the `claude-api` skill for current model ids and
  parameters; don't hardcode a model from memory.
- **Never run a git command that throws work away.** Other agents' unsaved edits are sitting in
  this same tree and there is no second copy of them. So: no `git checkout -- …`, no `git restore`,
  no `git stash`, no `git reset --hard`, no `git clean`, no switching or rebasing branches — not
  even "just on my own file", because you can't tell whose edits are in it. Undo your own mistake by
  editing the text back the way it was. If you think you really need one of these, ask Greg first.
- **Commit when the work is done.** When a piece of work is finished and working — or you've reached
  a good stopping point — commit it, without waiting to be asked.
- **Committing, with several agents in one working tree.** We're deliberately not using git
  worktrees yet — not worth the complexity — so the tree has other agents' in-flight edits in it.
  Commit only your own files, by naming them explicitly and doing it in one atomic command:

  ```
  git reset && git add <your files> && git commit -m "…"
  ```

  The leading `git reset` unstages anything someone else left staged. Never `git add -A`, `git add .`
  or `git commit -a`. And don't stress if someone sweeps up one of your changes anyway — it happens,
  it's recoverable, keep going.
