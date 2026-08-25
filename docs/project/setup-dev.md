# Setup and dev commands

Everything here is one process and one terminal, deliberately —
[architecture.md § Server and client](architecture.md#server-and-client):

> One process, one command: `npm run dev`. The API is currently mounted as **Vite dev middleware**
> rather than as a separate server, so there is nothing to run in a second terminal while the ideas
> are still moving.

```bash
npm install
npm run dev            # Vite + the /api/article/:slug middleware, http://localhost:5273
```

That opens the reading view on the `example` slug. Other slugs: `/?slug=<slug>` — see
[web-client.md](web-client.md).

## Secrets

One file, `.env.local`, gitignored, loaded by [`src/env.ts`](../../src/env.ts):

```
OPENROUTER_API_KEY=sk-or-…
```

It is needed by exactly one thing: the explain-this-passage call in
[`src/explain.ts`](../../src/explain.ts), which is the only LLM call that happens in a request
handler rather than in the pipeline ([comments.md](comments.md)). Without it the reading view works
normally and selecting a passage returns an error into the dialog saying so.

A variable already in the environment wins over the file, so
`SPIDERYARN_EXPLAIN_MODEL=anthropic/claude-opus-4.5 npm run dev` does what it looks like it does.
The pipeline stages use the Anthropic SDK and want `ANTHROPIC_API_KEY` instead.

## The pipeline stages

Each stage runs on its own against a slug, so any one can be re-run without the others
([architecture.md § Pipeline](architecture.md#pipeline)).

| Command | Stage | Writes |
|---|---|---|
| `npm run extract -- <url>` | 1–2, fetch + Readability ([content-extraction.md](content-extraction.md)) | `output/<slug>.html` |
| `npm run blocks -- <article.html>` | 3, split into blocks and mint stable ids ([block-ids.md](block-ids.md)) | `<article>.blocks.json` |
| `npm run toc:flatten -- …` | 4, ToC → tree ([table-of-contents.md](table-of-contents.md)) | `tree.json` |
| `npm run arc -- <dir>` | 5b, one article-level sentence per part ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)) | `arc.json` |
| `npm run validate-tree -- <dir>` | checks a `tree.json` against the invariants in [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) | — |
| `npm run build` | production bundle | `dist/` |
| `npm test` | the deterministic unit tests ([testing.md](testing.md)) | — |
| `npm run typecheck` | every tsconfig, plus the guards that the checking happened ([typechecking.md](typechecking.md)) | — |
| `npm run lint` | Biome over `src/`, `tests/`, `scripts/` ([linting.md](linting.md)) | — |

The comment endpoints have no CLI stage — they are driven from the reading view. They write
`data/<slug>/comments.json`; deleting that file forgets every question asked about the article, and
nothing else breaks.

**Run the validator.** A tree that violates the invariants doesn't crash the client — it silently
draws a *wrong article*. See [`example/README.md`](../../example/README.md).

## Adding a UI component

Chrome — buttons, toggles, disclosures — comes from shadcn now:

```bash
npx shadcn@latest add <component>     # never `init`; see below
```

Four things to know, all found by running it rather than reading about it
([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)):

1. **Move the file.** The CLI cannot resolve `@/` here — it reads the **root**
   [`tsconfig.json`](../../tsconfig.json) and our `paths` live in
   [`src/web/tsconfig.json`](../../src/web/tsconfig.json), where they belong. So it writes a literal
   `./@/components/ui/` directory at the repo root and reports success. Move the file to
   `src/web/components/ui/`, delete the stray `@` directory, and check `npm run typecheck` —
   [typechecking.md](typechecking.md#the-trap-the-shadcn-cli-cannot-resolve-the-alias-here).
2. **The `tw:` prefix is applied for you.** `"prefix": "tw"` in
   [`components.json`](../../components.json) is enough; the generated `cva` strings arrive already
   prefixed. The migration plan predicted a hand find-and-replace per file — it was wrong, and you
   should not do one.
3. **Never run `shadcn init`.** It writes a light `:root` palette and a `.dark` block, and loaded
   after `tokens.css` its `--background: oklch(1 0 0)` wins: white page, near-invisible orange.
   `components.json` is hand-written so nothing has to be guessed. `add` alone does not touch the
   palette — **diff [`styles/tokens.css`](../../styles/tokens.css) and
   [`src/web/tailwind.css`](../../src/web/tailwind.css) afterwards anyway** and revert anything that
   appeared there.
4. **Check what it installed.** The CLI installs the Radix packages but not always the rest — it
   added `radix-ui` and left `class-variance-authority` out. The build did **not** catch that,
   because nothing imported the component yet so vite never bundled it. `npm run typecheck` did.

Then read the generated class strings before using them. `data-[state=on]:bg-accent` is shadcn's
default on-state, and in this palette `--accent` is a raised dark **surface**, not the brand orange —
left alone it marks a pressed toggle with dark grey on a near-black page. Not an error, not visibly
broken, just the signal quietly gone.

## Where things live

- `data/<slug>/` — real pipeline output. Gitignored.
- [`example/`](../../example/README.md) — the hand-authored placeholder the client falls back to when
  `data/<slug>/` doesn't exist yet.
- `output/` — the prototype extractor's scratch output, including the test article.
- [`tests/`](../../tests) — Vitest unit tests. `npm test` (once) or `npm run test:watch`. See
  [testing.md](testing.md).

## Before writing LLM code

Load the `claude-api` skill for current model ids and parameters. Don't hardcode a model from memory.
