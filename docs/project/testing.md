# Testing

> Start with deterministic TypeScript tests.
>
> — Greg, 2026-08-24

```bash
npm test           # once
npm run test:watch # while working
```

Run [`npm run typecheck`](typechecking.md) alongside it before committing. The two catch different
things and neither is a substitute for the other — vitest never looks at the types, and `tsc` never
runs the code.

## The runner: Vitest

Chosen 2026-08-24 against [third-party-library-selection.md](../reusable/third-party-library-selection.md).
Vitest 4 is the default for a Vite + TypeScript + ESM project in 2026 — huge amount of
docs and discussion (so plenty of pretraining data for the coding models that work this repo), a
Jest-shaped API that everyone and every model already knows, and it reads our TypeScript and ESM
with no transform config at all. Jest 30 was the only real alternative and would have meant an ESM
story we'd have to maintain, for no gain. There was no close call here worth agonising over; if
that changes, write down why.

Config is in [`vitest.config.ts`](../../vitest.config.ts), deliberately **separate** from
`vite.config.ts` — that file mounts the `/api` dev middleware and the React plugin, and a node-side
unit test should not drag either in.

Tests live in [`tests/`](../../tests), not beside the source, so the node-side `tsconfig.json` keeps
them out of the stages it checks. They are not unchecked, though: they have a project of their own,
[`tests/tsconfig.json`](../../tests/tsconfig.json), because vitest strips their types without
looking at them — see [typechecking.md](typechecking.md).

## What we test, and what we don't

Everything here is **deterministic**: no network, no LLM calls, no clock, no unseeded randomness.
`mintId` takes its random source as an argument precisely so a test can pin it.

| File | What it pins |
|---|---|
| [`tests/ids.test.ts`](../../tests/ids.test.ts) | the id format and uniqueness — [block-ids.md](block-ids.md) |
| [`tests/blocks.test.ts`](../../tests/blocks.test.ts) | what counts as a block, and **id survival across re-extraction** |
| [`tests/sanitize.test.ts`](../../tests/sanitize.test.ts) | what a hostile article may not do to the reading view — every payload verified to survive Readability first, so none is hypothetical ([security.md](security.md)) |
| [`tests/sanitize-client.test.ts`](../../tests/sanitize-client.test.ts) | the browser sanitiser, and that **both bindings are one policy** — a shared corpus must come out byte-identical from server and client, because two passes that disagree are worse than one |
| [`tests/fetch.test.ts`](../../tests/fetch.test.ts) | stage 1 with no network: the lying `Content-Length`, the Shift_JIS page, the legacy encodings Node's own decoder still gets wrong, redirect loops, and every TLS failure that arrives as the same `TypeError` — [fetching.md](fetching.md) |
| [`tests/toc-flatten.test.ts`](../../tests/toc-flatten.test.ts) | tree → sidebar rows — [table-of-contents.md](table-of-contents.md) |
| [`tests/validate-tree.test.ts`](../../tests/validate-tree.test.ts) | the validator catches each **structural** way a tree can go wrong |
| [`tests/validate-tree-rows.test.ts`](../../tests/validate-tree-rows.test.ts) | which leaves may carry a row, and label length — the **editorial** half |
| [`tests/toc-build.test.ts`](../../tests/toc-build.test.ts) | `buildTree` — the model's proposal → the stored tree, and leaf growth |
| [`tests/token-budget.test.ts`](../../tests/token-budget.test.ts) | that a model call's `max_tokens` **grows with the article**, and that the estimate clears what a real tree cost — written after a typed-in number failed a 360-block article ([postmortem](../postmortems/toc-max-tokens.md)) |
| [`tests/api.test.ts`](../../tests/api.test.ts) | `data/<slug>/` → `example/` fallback — [web-client.md](web-client.md) |
| [`tests/url-state.test.ts`](../../tests/url-state.test.ts) | what a link means, and the section arithmetic behind `?at=` — [url-state.md](url-state.md) |
| [`tests/layout.test.ts`](../../tests/layout.test.ts) | column fitting: the pixel widths [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) promises, and that a wider window never shows *less* of the article |
| [`tests/keynav.test.ts`](../../tests/keynav.test.ts) | where ← / → land, and that → then ← is reversible — [keyboard.md](keyboard.md) |
| [`tests/annotate.test.ts`](../../tests/annotate.test.ts) | drawing a comment's mark over prose, and re-finding a quote whose offset went stale — [comments.md](comments.md) |
| [`tests/selection.test.ts`](../../tests/selection.test.ts) | mouse selection → a storable anchor: the minimum length, and clamping to one block |
| [`tests/comments.test.ts`](../../tests/comments.test.ts) | comment storage, and that two comments made at once don't eat each other |
| [`tests/comment-nav.test.ts`](../../tests/comment-nav.test.ts) | comments in reading order and stepping between them — including that the order comes from the block **index**, never the id string |
| [`tests/jobs.test.ts`](../../tests/jobs.test.ts) | the ingest queue's decisions — step ordering, the restart sweep, and the request parsing that stands between a POST body and `path.join("data", slug)` ([ingest-queue.md](ingest-queue.md)). **Nothing here runs a job**: queuing one fetches somebody's website and spends money at two model endpoints |
| [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | what an article gets called, and whether that name is safe to make a path out of |
| [`tests/glossary.test.ts`](../../tests/glossary.test.ts) | stage 5d's deterministic halves — the matching rule (including both directions in which `\b` is wrong about an accented letter), the **richness-scored dedup** that keeps the more specific phrase, the `javascript:` URL check, the occurrence pass, and `glossaryIsCurrent` ([glossary.md](glossary.md)) |
| [`tests/tweets.test.ts`](../../tests/tweets.test.ts) | stage 5c's deterministic halves — counting a post's characters, the artefact shape, how many posts to ask for, and **`threadIsCurrent`**, the first step freshness check in the repo ([tweet-thread-page.md](../plans/tweet-thread-page.md)) |
| [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) | every reference to a doc resolves — **file and anchor**, in source comments as well as markdown |

The validator has two test files on purpose. Structural failures exit non-zero because a broken
partition draws a wrong article; editorial ones only warn, because failing a build over clumsy prose
teaches everyone to ignore the validator. Splitting them also lets the two be edited without
colliding.

Two of these — `annotate` and `selection` — run under **jsdom** rather than the node default,
declared per-file with
`// @vitest-environment jsdom` so [`vitest.config.ts`](../../vitest.config.ts) stays node-only. That
is not convenience: the offset space comments are anchored in is *defined* as what the browser's
parser produces, so a hand-rolled equivalent tested under node would pass against itself and
disagree with Chrome. See [comments.md § The offset space](comments.md#offset-space).

**Not tested, on purpose (for now):**

- **The model call itself.** Stage 4 generation is nondeterministic and costs money. The guard for
  that output is [`src/validate-tree.ts`](../../src/validate-tree.ts) run against real artefacts —
  see [granularity-zoom.md § The tree](granularity-zoom.md#the-tree). Note the split, though:
  `buildTree` in [`src/toc.ts`](../../src/toc.ts) is the *deterministic* half of stage 4 — it takes
  the model's parsed proposal and grows the leaf layer — and it is exported and tested precisely so
  that only the genuinely nondeterministic part is untested.
- **The React reading view.** No DOM tests yet. When they arrive: `environment: "jsdom"` and
  `@testing-library/react`, and start with [`src/web/tree.ts`](../../src/web/tree.ts) `buildGeometry`,
  which is pure and is where a rowSpan bug silently draws a wrong article.

  **The gap is bigger than "no DOM tests" sounds, and 2026-08-25 measured it.** Adopting Tailwind
  produced three bugs the whole suite was blind to: a generated `.outline` utility drawing a border
  round the table, unlayered CSS outranking every utility we meant to write, and `dark:` rules that
  applied or not depending on the *viewer's* OS setting
  ([web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss)). Every one produced
  valid CSS that rendered. None of them could have gone red here, because nothing renders React and
  nothing computes a style — and the third could not have gone red in a DOM test either, since jsdom
  has no OS to ask.

  So this is the moment to reconsider `@testing-library/react`, and also the moment to be honest
  about its ceiling: it would have caught the class names, not the cascade. Anything that depends on
  the *resolved* value has to be checked in a real browser
  ([browser-testing.md](browser-testing.md#do-not-judge-colour-from-a-screenshot)).
- **Readability itself** ([content-extraction.md](content-extraction.md)). Needs a large fixture
  corpus. Worth doing when extraction bugs start costing time.

  **Fetching used to be on this list, and the reason it came off is worth copying.** It looked
  untestable for the same reason — "it needs the network" — and it wasn't: `fetchDocument` takes its
  fetch, clock, sleep, DNS lookup and jitter as arguments, so a redirect loop, a certificate with a
  missing intermediate and a body three times its declared size are all ordinary unit tests
  ([fetching.md](fetching.md)). What genuinely needs the network is finding out *what servers
  actually do*, and that is a research task whose output is fixtures, run once, not a test.

  The evidence that it was worth doing: running the finished module against real URLs still found a
  bug that 65 passing tests had missed — `dns.lookup` hangs its error code somewhere different from
  `fetch`, so every unresolvable domain was being reported as a generic connection failure.
  **Offline tests and one real run catch different things**, and neither replaces the other.

## Why the docs have a test

Unusual enough to justify. Doc rot bit three times in one session, and always the same way: **a
stale anchor resolves silently to the top of the page.** You click it, land somewhere plausible, and
never learn it stopped taking you where it said. Renaming a heading breaks every link into it, in
files you weren't editing, with no signal anywhere. Given how heavily this repo cross-links by
policy (AGENTS.md § How we write docs here), that is a standing tax, and one grep pays it.

[`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) checks the **working tree**, not committed
state, and that choice is the whole design. Several agents edit this repo at once, so one renaming a
heading can turn another's link red mid-flight; the tempting fix is to read `git show HEAD:…` so
in-flight edits are invisible. That gets it backwards. The rule here is to run `npm test` before you
commit, so checking the working tree is what stops a broken link *landing* — checking committed state
could only tell you it already had. A red result is always a one-line fix and always a real one.

**It covers source comments, and that is the case it exists for.** All three stale anchors that
prompted it were in comments — `Spine.tsx`, `tree.ts`, `styles.css` — and not one was in a markdown
file, so the first version of this test went green on every bug it was written in response to. That
was caught by mutation-testing it rather than by trusting it green, which is the same move as
everything else in this section: *a test that only ever runs green is indistinguishable from a test
that matches nothing.*

Comments need their own rule, because they don't use markdown link syntax. A bare
`granularity-zoom.md#the-tree` is resolved against the **docs** directories, not against the source
file that mentions it — `granularity-zoom.md` written in `src/web/tree.ts` means
`docs/project/granularity-zoom.md`, not `src/web/granularity-zoom.md`.

The one allowlist is `styles/tokens.css`, which cites the *original* app's own docs under a `Source:`
line naming that repo's absolute path. Those are correctly dangling here and are listed explicitly
rather than inferred: a rule like "the directory doesn't exist, so it must be external" would also
swallow a typo in a directory name, which is exactly a break worth catching.

It knows two more things beyond slugifying headings, both learned the hard way:

- **Explicit `<a id="…">` tags count.** `architecture.md` and `open-questions.md` both use them, and
  their anchors bear no relation to the heading above. A checker that only slugifies headings reports
  those as stale, and they aren't.
- **Headings inside code fences are not headings.** A `# comment` line in a shell block would
  otherwise mint an anchor that doesn't exist.

The first assertion in the file checks that the link parser found any links at all — a regex that
silently matched nothing would make everything below it pass forever.

## Sweep a continuous input; don't sample it

Where a function takes a continuous input — a window width, a scroll offset — assert the **shape** of
its output over the whole range rather than its value at a few widths someone thought to name.

`fitView` is the case that earned this. It was checked by hand at 1600, 1400, 1000, 860 and 700, and
looked right at every one. It was wrong between them: the spine's labels appeared at a fixed 1100px
and the rail's own growth ate two gist columns, so 1099px showed three levels and 1100px showed one.
Widening the window removed context. **Non-monotonicity is invisible to sampling by construction** —
every sampled point is individually plausible, and the defect lives only in the relationship between
them. A sweep from 320 to 2600 asserting "no width ever shows fewer columns than a narrower one"
found it immediately.

The property outlives the numbers, too. The pixel assertions in
[`tests/layout.test.ts`](../../tests/layout.test.ts) hold only until someone deliberately changes a
constant; "wider is never worse" holds through every future change to all of them.

Those pixel assertions are nonetheless **deliberately coupled** to the widths quoted in
[granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them), so
that changing a constant breaks the tests and forces the doc to be edited in the same breath. A doc
quoting numbers the code no longer produces is worse than a doc quoting none.

## The two things to know before adding a test

1. **`example/` is a fixture as well as a placeholder.** Several tests read
   [`example/blocks.json`](../../example/README.md) and `example/tree.json`. Changing them by hand
   can break tests — that's the point; it's the only guard the hand-authored fixture has.
2. **`src/validate-tree.ts` is a CLI**, with top-level `await` and `process.exit`. It's exercised as
   a subprocess, so its tests are slower (~1.5s) than everything else combined. If it ever grows a
   pure `validateTree(blocks, tree)` export, move those tests to it.

## A known limit, pinned by a test

A block with neither text nor a `src` — in practice only `<hr>` — gets a **fresh id on every
re-extraction**, because ids are carried over by matching content and a rule has no content.
Nothing points at a rule today (it's `gistable: false`, so no ToC row), but a tree leaf anchored to
one goes stale. `tests/blocks.test.ts` asserts the current behaviour so that fixing it is a
deliberate act rather than an accident. See [block-ids.md](block-ids.md).
