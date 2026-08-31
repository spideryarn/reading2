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

### Signing in needs four more

Since 2026-08-27 the app has a gate ([auth.md](auth.md)), and **without these the client throws at
module load and you get a blank page** — deliberately, because the alternative is a sign-in button
that does nothing and no clue why.

```
VITE_SUPABASE_URL=http://127.0.0.1:54361
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…      # npx supabase status prints it
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…           # the same one; the server verifies with it
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=…           # read by the Supabase stack, not by us
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=…
```

**The `VITE_` ones are compiled into the browser bundle**, so they are public by construction and
must only ever hold the *publishable* key. `tests/no-secrets-in-bundle.test.ts` is the guard, and it
decodes JWT payloads rather than searching for the word `service_role` — a legacy service-role key
does not contain it in the clear.

Three things that will waste your afternoon otherwise.

**Vite reads `.env.local` at startup**, so a new `VITE_` variable needs `npm run dev` restarting.

**The redirect allow-list is baked into the running container, not read from the file.**
[`supabase/config.toml`](../../supabase/config.toml) names `http://localhost:5273` and
`http://127.0.0.1:5273` with `/**`, and GoTrue only picks that up when it starts. Check what is
actually live rather than what the file says:

```bash
docker inspect supabase_auth_spideryarn2 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep URI_ALLOW_LIST
```

If `/**` is missing there, `npx supabase stop && npx supabase start`. Until you do, a Google
sign-in **succeeds** and then returns you to the bare site URL instead of `/auth/callback` — so
the callback never runs and you lose your place, with nothing anywhere saying why.

**And the port has to be 5273.** Several agents run `npm run dev` in this one tree; if 5273 is
taken, Vite quietly picks 5274 or 5275, which is not on the allow-list, and Google sign-in fails
for a reason that has nothing to do with your code.

**That one key now pays for everything.** Until 2026-08-27 it covered only the calls that happen in
a request handler — the explain-this-passage call in [`src/explain.ts`](../../src/explain.ts)
([comments.md](comments.md)), the chat in [`src/converse.ts`](../../src/converse.ts)
([chat-mode.md](../plans/chat-mode.md)), and search — while the seven pipeline stages went straight
to `api.anthropic.com` on an `ANTHROPIC_API_KEY` of their own. Greg's call, 2026-08-27:

> I'm fine with gating everything through OpenRouter. Their reliability is good, and this gives us
> simplicity/consistency/flexibility.

So without this key the reading view still renders, selecting a passage returns an error into the
dialog, a chat message returns one into the thread — **and nothing can be ingested at all.** What
the pipeline stages did *not* do is change protocol: they still speak Anthropic's Messages shape
through the Anthropic SDK, pointed at OpenRouter's Anthropic-compatible endpoint. See
[ai-gateway.md](ai-gateway.md) and the header of
[`src/messages-stream.ts`](../../src/messages-stream.ts), which is the source of truth for it.

`ANTHROPIC_API_KEY` is no longer read by any model call in `src/`, and **since 2026-08-31 it is not
in `.env.local` either.** The last two things that still spent on it directly were evals; one of
them — the judge in [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts) — moved
onto the same Skin the pipeline uses, having had no reason not to. The other did not, and cannot:
the PDF bake-off compares talking to Anthropic directly against going through OpenRouter, so an arm
forced onto OpenRouter would be comparing OpenRouter with itself. Without the key that bake-off
skips its four `transport: "anthropic"` arms and says so; everything else in the repo is unaffected.
[`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts) fails if a second
Anthropic-direct caller appears.

**`.env.local` wins over the shell**, so `SPIDERYARN_CHAT_MODEL=… npm run dev` does *not* do what
it looks like it does — put the line in the file instead. This paragraph said the opposite until
2026-08-27, having been left behind by the reversal two sections down, which is where the reasoning
is.

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
tier each job is on. Change the model for a tier there and every job on that tier moves together;
before 2026-08-25 the same constant was declared separately in four files and one of them had
drifted a version behind.

| Tier | The model | Reached through |
|---|---|---|
| **capable** | Claude Sonnet 5 — `anthropic/claude-sonnet-5` on the wire, stamped `claude-sonnet-5` | OpenRouter, on both wires — see below |
| **quick** | GPT-5.6 Luna — `openai/gpt-5.6-luna` | OpenRouter |
| **embeddings** | Voyage 4 — `voyageai/voyage-4` | OpenRouter, and not a *tier* — see below |
| **PDF reader** | GPT-5.6 Luna — `openai/gpt-5.6-luna` | OpenRouter, and not a *tier* either — `PDF_READER_MODEL` |
| **dictation** | Gemini 3.1 Flash Lite — `google/gemini-3.1-flash-lite` | OpenRouter, and not a tier — `DICTATION_MODEL` |

**Every one of those goes through OpenRouter**, since 2026-08-27 and Greg's decision to gate the
whole app through one vendor. What still varies is not the vendor but the **wire** — which protocol
the request is written in — and that axis has its own doc: [ai-gateway.md](ai-gateway.md). The short
version is that the seven pipeline stages speak Anthropic's Messages shape
([`src/messages-stream.ts`](../../src/messages-stream.ts)) and everything else speaks OpenAI's
chat/completions shape ([`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)), both to
OpenRouter.

### Three spellings, and only one of them is a name

A model id is an address, and this app holds two different addresses for the same model. **Neither
of them is what the model is called.** The distinction cost nothing until something displayed one:
on 2026-08-27 `/profile` listed all ten jobs with their raw wire ids, so seven rows read
`claude-sonnet-5` and three read `anthropic/claude-sonnet-5`. Every string was the right thing to
send, and the page was still wrong, because the question it exists to answer is *which model writes
what* and it came back in two spellings depending on a transport detail the reader cannot see.

**What those two spellings mean changed later the same day, and the pair survived the change.** They
used to be *vendor A's address and vendor B's address* — one for the Anthropic SDK talking to
`api.anthropic.com`, one for OpenRouter. Now everything is OpenRouter, every task sends
`anthropic/claude-sonnet-5`, and `CAPABLE_MODEL` is on no request at all. It stayed because the
second job it was doing is the one that never moved: it is the **name stamped into stored
artefacts**, and `glossary.ts`, `summarise.ts` and `tweets.ts` each compare a file's `generator`
against it to decide whether the work is stale. Moving the stamps to the prefixed spelling would have
marked the whole corpus stale in one edit and regenerated it at full price — a large bill, for a
migration whose whole purpose was to see the bill. So the rule that arrived with `/profile` is the
rule that saved it: **a provider prefix is an address, not a name.**
[ai-gateway.md § Two spellings](ai-gateway.md#two-spellings-of-one-model-and-why-both-survive) has
the rest.

So `src/models.ts` separates the three jobs that one string was doing, and **nothing outside that
file gets to choose between them**:

| Ask for | With | You get |
|---|---|---|
| what a task actually sends | `resolveModel(task)` | `{ id, provider, wire, source }` — the wire id, who serves it, which protocol it speaks, and whether the environment chose it |
| just the id | `modelFor(task)` | the same `id` |
| which protocol it speaks | `wireFor(task)` | `"messages"` or `"chat"` |
| what to show a person | `displayName(id)` | one name per model, no provider prefix |

`wireFor` was `providerFor` and answered `"anthropic"` or `"openrouter"` until 2026-08-27. The
function did not disappear when the vendor split did, because the question it was really answering —
*what does this request look like?* — is still a live one. `Provider` is now a type with exactly one
member, which is the decision written down where somebody will trip over it rather than an oversight.

**There is exactly one public task-level model function**, and that is deliberate. There used to be
two — `modelFor` and `modelForOpenRouter` — one of which knew which wire a task was on and one of
which did not, and the one that did not would cheerfully answer for `labels`, a stage that has never
sent a chat/completions request in its life. Reaching for the wrong one of a similarly-named pair
gets you a real model id and a wrong answer. The tier→OpenRouter-id helper is now private and takes
a tier. (When that was written the wrong answer was a *vendor* mismatch as well as a wire one;
`labels` now really does go to OpenRouter, and the function is still private, because the bug was
never about which vendor — it was about a public function answering a question it could not know.)

**`resolveModel` reads `SPIDERYARN_*_MODEL`, and an earlier version of it deliberately did not.**
That was wrong. The three request-path calls each read their own override, so `/api/models` could
report the default while the call sent something else — on a page that says, in its own words, that
it shows *what the server is configured with*. One resolver serves the callers and the report now,
and `source` tells the page to add "set in the environment" rather than passing an experiment off as
the app's configuration. The same applies to effort: the route calls `effortFor`, not raw
`STAGE_EFFORT`, so `SPIDERYARN_PIPELINE_EFFORT` shows up too.

Which task is on which wire is a `Record<Task, Wire>` (`TASK_WIRE`), not a list plus a default — so
an unassigned task fails to compile rather than quietly getting the pipeline answer. `PIPELINE_TASKS`
and `REQUEST_PATH_TASKS` are derived from it.

Two things worth knowing about `displayName`. It is a **table of literals**, not
`id.split("/").pop()` — the same rule the file applies to wire spellings, and not a hypothetical
one: the previous model pair would have stripped to `claude-sonnet-4.5` against Anthropic's
`claude-sonnet-4-5`, so the two rows would have gone on disagreeing while looking mended. And an id
it does not know **falls back to the raw string**, which is ugly on screen on purpose — an unlisted
model is a table somebody forgot to extend, and that is the only way anyone finds out.

That request-path list used to have a second copy inside `modelsInUse` in
[`src/routes.ts`](../../src/routes.ts) — the copy deciding what the page *claimed*, while this file
decided what ran. [`tests/models.test.ts`](../../tests/models.test.ts) is the rest of the guard.

`/profile` shows the name, the effort where there is one, and the provider, with the exact wire id
on hover — and three extra rows for the **PDF transcriber, the embedding model and the dictation
model**, all on no tier and therefore in no table the route can loop over, so a page called *what's
running* was listing ten Claude jobs and quietly omitting the app's calls to a model from somebody
else. They are in `NON_TASK_MODELS`; sharing an inventory does not merge the decisions, and none of
them is going on a tier. The provider column now reads `openrouter` on every row, which is the
honest answer and no longer an interesting one — the column that varies is the wire, and the page
does not show it.

Most of the above beyond the first fix came from a GPT-5.6-sol review, 2026-08-27.

**The embedding model is not one of the two tiers**, and is listed above only so there is one place
that names every model this app calls. A tier is a choice about how much reasoning a task needs;
`voyageai/voyage-4` does no reasoning, and it was picked by measurement rather than by judgment —
[the eval](../../evals/results/embedding-retrieval-2026-08-26.md) put four models over this
project's own articles. It lives in [`src/embeddings.ts`](../../src/embeddings.ts) rather than in
`src/models.ts` for that reason. Only the Force diagram's dotted links use it today
([diagram.md](diagram.md)); [semantic-search.md](../plans/semantic-search.md) is the other planned
caller.

**Every job is on the capable tier today.** The quick tier is about a tenth the price and nothing
here has been measured on it, so it exists as a named option rather than as a change: moving a job
means running an eval under [`evals/`](../../evals/README.md) first and writing down what it cost.
Greg, 2026-08-26 — *"use your judgment about which tasks to use for which (default to capable-model
for now)."*

**Changing a row is not the whole of moving a job**, and the file carries the list: the completion
ceilings were sized for a model that does not spend a reasoning allocation out of them, the
web-search cap is one only Anthropic honours, and a truncated answer is stored here as a finished
one. The seven pipeline stages cannot move by that table at all, and setting one of them to `quick`
makes the app refuse to start rather than pretend it worked.

**The reason that guard exists shifted on 2026-08-27, and the guard did not.** It used to be a
*vendor* fact: those stages went to `api.anthropic.com`, and Luna is not there. Now everything is
OpenRouter, and what still separates them is the **wire** — they speak Anthropic's Messages shape,
and all seven send `thinking: { type: "adaptive" }`, which the chat/completions shape has no
equivalent for at all ([ai-gateway.md § Why the stages were not translated](ai-gateway.md#why-the-stages-were-not-translated)).
So moving one to the quick tier still means moving it to the other wire first, and that is still a
rewrite of the call rather than a config change. The error the guard throws was worded for the old
reason — *"only reachable through OpenRouter"*, now true of everything and therefore saying
nothing — and was rewritten the same day to name the wire instead.

**And the one on that list that has no guard at all: the provider pin.** All three request-path
calls send `provider: { order: ["anthropic"] }` ([`PROVIDER_ORDER`](../../src/openrouter-stream.ts)),
which exists so repeat calls land on the upstream holding the prompt cache. It is an ordered
*preference*, not `allow_fallbacks: false`, and that is the right call — an Anthropic outage should
cost a reader a cache miss, not the feature. But it means that pointing a request-path task at an
OpenAI model leaves an Anthropic preference on a request no Anthropic upstream can serve, and
OpenRouter simply falls through to the real provider and answers. **Nothing raises, nothing logs,
and the answer is correct** — you would only ever find it in the bill. The pin has to become a
function of the model id before any request-path row goes to `quick`; today it is a constant, and
this paragraph is the only thing standing between the two. See
[silent-success.md](../reusable/silent-success.md), which is the shape of it.

**Still true, and now true on both wires.** The Messages wire has a pin of its own —
`MESSAGES_PROVIDER` in [`src/messages-stream.ts`](../../src/messages-stream.ts) — which is the same
constant shape and would be wrong in the same silent way if a pipeline stage were pointed at a
non-Anthropic model. That half is covered, because the load-time check above stops the row being
flipped at all. The request-path half is not. Two differences between the two pins are worth knowing:
`MESSAGES_PROVIDER` also sends `require_parameters: true`, which stops a fallback upstream serving
the request having quietly dropped `cache_control` or `thinking`, and `PROVIDER_ORDER` does not.
`DICTATION_MODEL` deliberately sends no pin at all, for exactly the reason this paragraph gives — it
is a Gemini model.

Four things that file will tell you and this one will not: why the two spellings are not derived
from each other, why the quick tier has no Messages-wire spelling *and cannot have one*, why the
provider pin and the cache breakpoint have to move with the model, and why editing the capable
model marks stored tweet threads stale.

Per-call overrides, for a one-off comparison run. These take a model id, not a tier, and they
bypass the tier table entirely — but **not** the reporting: `resolveModel` reads them, so `/profile`
shows the model you actually set and marks the row *set in the environment*. Remember that
`.env.local` beats the shell, so these go in the file rather than in front of the command.

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
| `npm run fetch -- <url> [dir]` | 1, fetch the page and say what came back ([fetching.md](fetching.md)) | `data/<slug>/raw.html` or `raw.pdf`, plus the `raw.json` manifest |
| `npm run extract -- <url>` | 1–2, fetch + Readability ([content-extraction.md](content-extraction.md)) | `output/<slug>.html`, `data/<slug>/meta.json` |
| `npm run pdf:pass0 -- <file.pdf>` | 2, what a PDF says for free: pages, words, scan or not, running headers. No model, no network | nothing — it prints |
| `npm run pdf -- <file.pdf> [slug]` | 2, **the other extractor**: a model reads the pages, the transcription is checked against the PDF's own text, and the result is the same `article.html` Readability would have made ([content-extraction.md § Two extractors](content-extraction.md#two-extractors-one-artefact)) | `output/<slug>.html`, `data/<slug>/meta.json`, `data/<slug>/pdf-chunks/` |
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
