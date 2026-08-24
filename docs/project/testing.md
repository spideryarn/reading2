# Testing

> Start with deterministic TypeScript tests.
>
> — Greg, 2026-08-24

```bash
npm test           # once
npm run test:watch # while working
```

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

Tests live in [`tests/`](../../tests), not beside the source, so `tsconfig.json`'s `include: ["src"]`
keeps them out of the build.

## What we test, and what we don't

Everything here is **deterministic**: no network, no LLM calls, no clock, no unseeded randomness.
`mintId` takes its random source as an argument precisely so a test can pin it.

| File | What it pins |
|---|---|
| [`tests/ids.test.ts`](../../tests/ids.test.ts) | the id format and uniqueness — [block-ids.md](block-ids.md) |
| [`tests/blocks.test.ts`](../../tests/blocks.test.ts) | what counts as a block, and **id survival across re-extraction** |
| [`tests/toc-flatten.test.ts`](../../tests/toc-flatten.test.ts) | tree → sidebar rows — [table-of-contents.md](table-of-contents.md) |
| [`tests/validate-tree.test.ts`](../../tests/validate-tree.test.ts) | the validator catches each **structural** way a tree can go wrong |
| [`tests/validate-tree-rows.test.ts`](../../tests/validate-tree-rows.test.ts) | which leaves may carry a row, and label length — the **editorial** half |
| [`tests/toc-build.test.ts`](../../tests/toc-build.test.ts) | `buildTree` — the model's proposal → the stored tree, and leaf growth |
| [`tests/api.test.ts`](../../tests/api.test.ts) | `data/<slug>/` → `example/` fallback — [web-client.md](web-client.md) |
| [`tests/url-state.test.ts`](../../tests/url-state.test.ts) | what a link means, and the section arithmetic behind `?at=` — [url-state.md](url-state.md) |
| [`tests/layout.test.ts`](../../tests/layout.test.ts) | column fitting: the pixel widths [granularity-zoom.md](granularity-zoom.md#too-many-levels-fit-the-columns-dont-just-scroll-them) promises, and that a wider window never shows *less* of the article |
| [`tests/doc-links.test.ts`](../../tests/doc-links.test.ts) | every relative link in the docs resolves — **file and anchor** |

The validator has two test files on purpose. Structural failures exit non-zero because a broken
partition draws a wrong article; editorial ones only warn, because failing a build over clumsy prose
teaches everyone to ignore the validator. Splitting them also lets the two be edited without
colliding.

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
- **Fetching and Readability** ([content-extraction.md](content-extraction.md)). Needs the network,
  or a large fixture corpus. Worth doing when extraction bugs start costing time.

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

It knows two things beyond slugifying headings, both learned the hard way:

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
