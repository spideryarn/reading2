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
| [`tests/validate-tree.test.ts`](../../tests/validate-tree.test.ts) | the validator catches each way a tree can go wrong |
| [`tests/api.test.ts`](../../tests/api.test.ts) | `data/<slug>/` → `example/` fallback — [web-client.md](web-client.md) |

**Not tested, on purpose (for now):**

- **Anything that calls an LLM.** Stage 4/5 generation is nondeterministic and costs money. The
  guard for that output is [`src/validate-tree.ts`](../../src/validate-tree.ts) run against real
  artefacts, not a unit test — see [granularity-zoom.md § The tree](granularity-zoom.md#the-tree).
- **The React reading view.** No DOM tests yet. When they arrive: `environment: "jsdom"` and
  `@testing-library/react`, and start with [`src/web/tree.ts`](../../src/web/tree.ts) `buildGeometry`,
  which is pure and is where a rowSpan bug silently draws a wrong article.
- **Fetching and Readability** ([content-extraction.md](content-extraction.md)). Needs the network,
  or a large fixture corpus. Worth doing when extraction bugs start costing time.

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
