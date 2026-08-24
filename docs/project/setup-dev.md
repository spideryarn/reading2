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

## The pipeline stages

Each stage runs on its own against a slug, so any one can be re-run without the others
([architecture.md § Pipeline](architecture.md#pipeline)).

| Command | Stage | Writes |
|---|---|---|
| `npm run extract -- <url>` | 1–2, fetch + Readability ([content-extraction.md](content-extraction.md)) | `output/<slug>.html` |
| `npm run blocks -- <article.html>` | 3, split into blocks and mint stable ids ([block-ids.md](block-ids.md)) | `<article>.blocks.json` |
| `npm run toc:flatten -- …` | 4, ToC → tree ([table-of-contents.md](table-of-contents.md)) | `tree.json` |
| `npm run validate-tree -- <dir>` | checks a `tree.json` against the invariants in [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) | — |
| `npm run build` | production bundle | `dist/` |

**Run the validator.** A tree that violates the invariants doesn't crash the client — it silently
draws a *wrong article*. See [`example/README.md`](../../example/README.md).

## Where things live

- `data/<slug>/` — real pipeline output. Gitignored.
- [`example/`](../../example/README.md) — the hand-authored placeholder the client falls back to when
  `data/<slug>/` doesn't exist yet.
- `output/` — the prototype extractor's scratch output, including the test article.
- No test runner yet; `npm test` is still a stub.

## Before writing LLM code

Load the `claude-api` skill for current model ids and parameters. Don't hardcode a model from memory.
