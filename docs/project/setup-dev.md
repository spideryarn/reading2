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

That opens the **library** at `/` — every article you have run through the pipeline, plus the
committed `example/` fixture so a fresh clone has something to read ([library.md](library.md)).
Click one and you are at `/read/<slug>`, which is the reading view ([web-client.md](web-client.md)).
Old `/?slug=<slug>` links still work; they are rewritten on the way in.

## Secrets

One file, `.env.local`, gitignored, loaded by [`src/env.ts`](../../src/env.ts):

```bash
cp .env.example .env.local     # every variable, commented, with no values in it
```

```
OPENROUTER_API_KEY=sk-or-…
```

[`.env.example`](../../.env.example) is the only env file in git — `.gitignore` has `.env*` and then
`!.env.example` — so it must never gain a real value. `.env.prod` records what the remote project
needs and is **loaded by nothing**: `src/env.ts` reads `.env.local` and only `.env.local`.

It is needed by the two LLM calls that happen in a request handler rather than in the pipeline:
the explain-this-passage call in [`src/explain.ts`](../../src/explain.ts)
([comments.md](comments.md)), and the chat in [`src/converse.ts`](../../src/converse.ts)
([chat-mode.md](../plans/chat-mode.md)). Without it the reading view works normally, selecting a
passage returns an error into the dialog, and a chat message returns one into the thread.

A variable already in the environment wins over the file, so
`SPIDERYARN_CHAT_MODEL=anthropic/claude-opus-5 npm run dev` does what it looks like it does.
The pipeline stages use the Anthropic SDK and want `ANTHROPIC_API_KEY` instead.

`CODEX_API_KEY` is the odd one out: nothing in the app reads it. It is for
[`scripts/run-codex.ts`](../../scripts/run-codex.ts), which dispatches a GPT/Codex subagent for
cross-family review — see [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md). That
script loads `.env.local` through the same `src/env.ts`, so the key needs no exporting. It is
optional (`codex login` works too) but takes precedence, which makes it the fallback when a ChatGPT
subscription runs out of credits. Not `OPENAI_API_KEY` — `codex exec` does not read that one, so
exporting it buys nothing and leaks a secret into every subprocess.

More generally, prefer `.env.local` over `~/.zshrc` for every key here. A secret exported from a
shell profile reaches every process you ever start, and a *login* shell re-exports it even to a
child that was deliberately given a sanitised environment — which is measured in
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md#it-is-not-sufficient-and-here-is-the-measurement).

### `.env.local` beats what the shell exported

> Where are we getting OPENROUTER_API_KEY from? Use the one in .env.local for local stuff.
>
> — Greg, 2026-08-26

**This reversed on 2026-08-26**, and the reversal is worth a paragraph because the old rule sounded
more sensible than it was. `src/env.ts` used to say *"a variable already in the environment wins …
`.env.local` is the convenience, not the authority"*, so that `OPENROUTER_API_KEY=… npm run dev`
would do what it looks like it does.

The trouble is that a deliberate `FOO=x npm run dev` and a line in `~/.zshrc` are **the same thing**
to a child process. On this machine both `~/.zshrc` and `~/.zprofile` exported an
`OPENROUTER_API_KEY` that was a *different key on a different OpenRouter account* from the one in
`.env.local` — so every command in every shell used the wrong account, and the file that names the
key was ignored. It surfaced as an eval that could not reach Voyage at all, returning
`404 No endpoints available matching your guardrail restrictions`, which reads exactly like a
mistyped model id and is really one account's privacy settings refusing a provider the other allows.

So the file wins, and **when it overrides something it says so on stderr, by name and never by
value**:

```
[env] .env.local overrode OPENROUTER_API_KEY from the shell environment.
```

One thing still beats the file: a variable **this process set for itself** after startup. `env.ts`
snapshots the environment at module load, so "unchanged since startup" means inherited and loses,
while "different from the snapshot" means deliberate and wins. Without that,
`tests/explain.test.ts` — which sets `OPENROUTER_API_KEY = "test-key"` and then calls code that
loads the file — would have had the real key put back underneath it, and a test that makes no model
call could have started making one.

**To override for one command, edit `.env.local`.** Prefixing the command no longer does it, which
is the price of the file being authoritative, and the warning above tells you when it bit.

In production there is no `.env.local`, so `process.env` is the only source and none of this
applies.

## Which model everything uses

**One file: [`src/models.ts`](../../src/models.ts).** It names two tiers and a table saying which
tier each job is on. Change it there and everything moves together; before 2026-08-25 the same
constant was declared separately in four files and one of them had drifted a version behind.

| Tier | The model | Reached through |
|---|---|---|
| **capable** | Claude Sonnet 5 — `claude-sonnet-5`, or `anthropic/claude-sonnet-5` | the Anthropic SDK *and* OpenRouter, one spelling each |
| **quick** | GPT-5.6 Luna — `openai/gpt-5.6-luna` | OpenRouter only |

**Every job is on the capable tier today.** The quick tier is about a tenth the price and nothing
here has been measured on it, so it exists as a named option rather than as a change: moving a job
means running an eval under [`evals/`](../../evals/README.md) first and writing down what it cost.
Greg, 2026-08-26 — *"use your judgment about which tasks to use for which (default to capable-model
for now)."*

Four things that file will tell you and this one will not: why the two spellings are not derived
from each other, why the quick tier has no Anthropic-SDK spelling *and cannot have one*, why the
provider pin and the cache breakpoint have to move with the model, and why editing the capable
model marks stored tweet threads stale.

Per-call overrides, for a one-off comparison run. These take a model id, not a tier, and they
bypass the table entirely:

| Variable | Overrides |
|---|---|
| `SPIDERYARN_EXPLAIN_MODEL` | the explain-a-passage call |
| `SPIDERYARN_CHAT_MODEL` | the chat |
| `SPIDERYARN_SEARCH_MODEL` | the meaning-based passage search |
| `SPIDERYARN_PIPELINE_EFFORT` | all three article-reading stages' effort at once |

## The database, locally

There is a full Supabase stack in Docker for this repo — Postgres, auth, Studio — and **nothing in
the app talks to it yet**. It is there to develop the storage layer against.

```bash
npm run db:start       # needs Docker running: `open -a OrbStack`
npm run db:status      # URLs and keys
npm run db:stop
```

Studio is at <http://127.0.0.1:54363>. The ports, the two settings that are not the CLI defaults, and
the ways it fails quietly are in [supabase-local.md](supabase-local.md).

## The pipeline stages

Each stage runs on its own against a slug, so any one can be re-run without the others
([architecture.md § Pipeline](architecture.md#pipeline)).

| Command | Stage | Writes |
|---|---|---|
| `npm run fetch -- <url> [dir]` | 1, fetch the page and say what came back ([fetching.md](fetching.md)) | `data/<slug>/raw.html`, or `raw.pdf` |
| `npm run extract -- <url>` | 1–2, fetch + Readability ([content-extraction.md](content-extraction.md)) | `output/<slug>.html`, `data/<slug>/meta.json` |
| `npm run blocks -- <article.html>` | 3, split into blocks and mint stable ids ([block-ids.md](block-ids.md)) | `<article>.blocks.json` |
| `npm run toc -- <blocks.json> [dir]` | 4, the tree **and** its nav labels ([table-of-contents.md](table-of-contents.md)). Two model passes — the structure in one call, the labels in parallel batches — but one command, and nothing is written until both finish | `tree.json`, `labels.json`, `blocks.json` |
| `npm run labels -- <dir>` | 4b on its own, against a `tree.json` that already exists ([src/labels.ts](../../src/labels.ts)). The stage to re-run when you have changed the label prompt and do not want to pay for a new tree | `labels.json`, and rewrites `tree.json` |
| `npm run toc:flatten -- …` | 4, tree → the flat sidebar rows ([table-of-contents.md](table-of-contents.md)) | — |
| `npm run arc -- <dir>` | 5b, one article-level sentence per part ([granularity-zoom.md § The arc](granularity-zoom.md#the-arc)) | `arc.json` |
| `npm run tweets -- <dir>` | 5c, the article as a numbered thread ([tweet-thread-page.md](../plans/tweet-thread-page.md)) | `tweets.json` |
| `npm run glossary -- <dir>` | 5d, the terms this piece uses ([glossary.md](glossary.md)). Run it again to add more | `glossary.json` |
| `npm run summarise -- <dir>` | 5e, the article and each of its parts and sections at two more lengths ([summaries.md](summaries.md)). Several batched calls, not one; running it again replaces the file | `summary.json` |
| `npm run validate-tree -- <dir>` | checks a `tree.json` against the invariants in [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) | — |
| `npm run build` | production bundle | `dist/` |
| `npm test` | the deterministic unit tests ([testing.md](testing.md)) | — |
| `npm run eval:toc -- <dir>…` | not a test — measures nav-label quality against committed artefacts ([evals/README.md](../../evals/README.md)). Calls no model; run it after any change to stage 4 | `evals/results/<slug>-<date>.json` |
| `npm run typecheck` | every tsconfig, plus the guards that the checking happened ([typechecking.md](typechecking.md)) | — |
| `npm run lint` | Biome over `src/`, `tests/`, `scripts/` ([linting.md](linting.md)) | — |

The comment endpoints have no CLI stage — they are driven from the reading view. They write
`data/<slug>/comments.json`; deleting that file forgets every question asked about the article, and
nothing else breaks.

**You do not have to run any of this by hand.** Paste a URL into the homepage's add box and the
ingest queue runs the same chain in the server process, with each stage named as it goes —
[ingest-queue.md](ingest-queue.md). The commands are for when you want one stage on its own, or want
to see its output.

**Except `tweets` and `glossary`, which an add never runs.** Both are in the pipeline's order and
neither is in its default list, so each is produced only when something asks for it by name — the
commands above, or `POST /api/jobs { slug, steps: ["tweets"] }` / `{ steps: ["glossary"] }`. Each
costs a model call over the whole article and each is somewhere you go — a page, and a mode — rather
than part of making an article readable
([tweet-thread-page.md](../plans/tweet-thread-page.md#the-one-real-snag-stated-precisely),
[glossary.md](glossary.md)). Read them back with `GET /api/tweets/<slug>` and
`GET /api/glossary/<slug>`, both of which also say whether what they return still describes the
article.

They are also the two stages that will not re-run over their own good output: each checks whether its
artefact still matches the blocks on disk rather than whether the file exists. Add
`force: ["tweets"]` to write a different thread.

**`force: ["glossary"]` does something different, and it is the one asymmetry here.** Forcing the
glossary does not replace the list, it **appends another batch of terms** to it — that is what the
panel's "Find more" button is. To start the list over, delete it first:
`DELETE /api/glossary/<slug>`, then run the step. See [glossary.md § Finding more](glossary.md).

They are literally the same code: each script above is a thin argv wrapper around an exported
function, and the queue calls that function. So there is one code path per stage and no way for the
CLI and the queue to drift — which is the thing to preserve if you change a stage.

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

- `data/<slug>/` — real pipeline output. Gitignored. Every directory in here with a `blocks.json`
  and a `tree.json` appears on the homepage ([library.md](library.md)).
- [`example/`](../../example/README.md) — the hand-authored placeholder the client falls back to when
  `data/<slug>/` doesn't exist yet.
- `output/` — the prototype extractor's scratch output, including the test article.
- [`tests/`](../../tests) — Vitest unit tests. `npm test` (once) or `npm run test:watch`. See
  [testing.md](testing.md).

## Before writing LLM code

Load the `claude-api` skill for current model ids and parameters. Don't hardcode a model from memory.
