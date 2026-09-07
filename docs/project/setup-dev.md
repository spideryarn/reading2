# Setup and dev commands

**New here? The quickstart below is the whole of it** — an empty checkout to an app you are signed
into. Everything after it is depth: what each secret is for, which model does
which job, how to run one pipeline stage on its own. You do not need any of that to start.

For the *why* behind any of it — what the Docker stack is standing in for, what shipping looks like,
and what the production host takes away that your laptop gives you for free — read
[260906a-deployment-and-infrastructure.html](../tutorials/260906a-deployment-and-infrastructure.html)
in a browser. It is written for somebody who has never opened the code.

## Quickstart

### What you need first

- **Node 26.** It is what Greg's laptop and the remote box both run, pinned in
  [`infra/hetzner/variables.tf`](../../infra/hetzner/variables.tf) — *"a major-version gap between
  the two is where 'works on my machine' comes from"*.
- **Docker, running.** The database is a full Supabase stack in containers (Postgres, GoTrue,
  Studio). On a Mac that is usually OrbStack — `open -a OrbStack`. **The first `npm run setup` pulls
  around 2 GB of images**, so do it on a connection you do not mind.
- **An OpenRouter API key**, from <https://openrouter.ai>. Every paid model call in the app goes
  through it ([ai-gateway.md](ai-gateway.md)). Without one the app runs and articles already in the
  database still read perfectly — but nothing can be ingested, and selecting a passage returns an
  error into the dialog.

Nothing else. No Google credentials, no Supabase account, no Vercel, no keys on any dashboard.

### The commands, in this order

**There is a chicken-and-egg in the middle of this and it is the only hard part.** `npm run setup`
seeds an account, which needs the local stack's keys; the keys do not exist until the stack has been
started. So the stack goes up first, you copy three values, and then the rest of setup runs.

```bash
git clone https://github.com/spideryarn/reading2.git && cd reading2
npm install
cp .env.example .env.local     # every variable, commented, with no values in it
                               # → put OPENROUTER_API_KEY=sk-or-… in it now

npm run db:start               # Docker. First run pulls ~2 GB of images.
npm run db:status              # → copy the three values below into .env.local

npm run setup                  # db:start (again, harmlessly), migrate, seed the
                               # account, seed a shelf. Stops at the first failure.
npm run db:admin-password      # prints the password for dev-admin@spideryarn.local
npm run dev                    # http://localhost:5273
```

The three values to copy out of `npm run db:status`, which prints them as
`SERVICE_ROLE_KEY` and `PUBLISHABLE_KEY`:

```
SUPABASE_SERVICE_ROLE_KEY=…         # seeding the account needs this
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…      # the server verifies sessions with it
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… # the same value again, for the browser
```

`SUPABASE_URL` and `VITE_SUPABASE_URL` already have the right value in `.env.example`, so those two
lines need nothing.

**Why the order is what it is**, since every step of it has been somebody's lost afternoon:

- `db:seed-owner` — the third thing `npm run setup` does — reads `SUPABASE_SERVICE_ROLE_KEY` and
  `SUPABASE_PUBLISHABLE_KEY`, and **refuses rather than guessing** if either is missing. Run
  `npm run setup` on a freshly-copied `.env.example` and it will start the database, apply the
  migrations, and then stop with a message naming the variable. That is the design working, not a
  bug — but it is why `db:start` and `db:status` come first here.
- The **client** throws at module load without `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, so running `npm run dev` before you have them gives you a
  **blank page** — deliberately, because the alternative is a sign-in button that does nothing
  ([§ Signing in needs four more](#signing-in-needs-four-more)).
- Vite reads `.env.local` once, **at startup**. Adding a variable means restarting `npm run dev`.

### Signing in

The landing page has an email form. Use **`dev-admin@spideryarn.local`** and the password
`npm run db:admin-password` printed. There is no Google step and nothing to click on a dashboard —
`db:seed-owner` created the account and generated the password, which is what makes a machine you
can only reach over ssh usable
([supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach)).

Neither seeded address is a real person's, on purpose. `dev@spideryarn.local` owns what the CLI and
the pipeline write; `dev-admin@spideryarn.local` is the one you sign in as.

### Did it work?

The **library** at `/` should have a few articles on it — `npm run setup`'s last step seeds them, so
a fresh clone has something to read rather than an empty shelf ([library.md](library.md)). Click one
and you are at `/read/<slug>`, the reading view ([web-client.md](web-client.md)). Then paste a URL
into the add box and watch the pipeline stages go past by name
([ingest-queue.md](ingest-queue.md)) — that is the end-to-end check, and it is the first thing that
spends money.

Two commands worth running once so you know they pass: `npm test` and `npm run typecheck`.

### If it didn't

| What you see | What it is |
|---|---|
| A blank page, and a console error naming `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` | The three lines above are missing from `.env.local`, or Vite has not been restarted since you added them |
| The dev server refuses to start, naming `npm run db:start` | The containers are down. `assertStoreReachable` in `vite.config.ts` runs one `select 1` before booting, on purpose — see [below](#the-database-locally) |
| Vite says it is on **5274** or 5275 | Something else has 5273. Sign-in will fail for reasons that have nothing to do with your code — the port is on the redirect allow-list and the alternatives are not |
| Google sign-in succeeds and dumps you on the bare site URL | The allow-list is baked into a running container, not read from the file. [§ Signing in needs four more](#signing-in-needs-four-more) has the `docker inspect` to check it |
| The reading view works, but an ingest fails immediately | No `OPENROUTER_API_KEY` in `.env.local` |

When something is broken and it is not on that list, [debugging.md](debugging.md) is where to start.

## One process, one terminal

That is deliberate — [architecture.md § Server and client](architecture.md#server-and-client):

> One process, one command: `npm run dev`. The API is currently mounted as **Vite dev middleware**
> rather than as a separate server, so there is nothing to run in a second terminal while the ideas
> are still moving.

**Everything serves from Postgres, and there is no way back to `data/`** — since 2026-09-05, when
the filesystem store and the `SPIDERYARN_STORE` flag went
([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § F). The
dev server, the CLI stages, seeding, the evals and the test suite all read one store, and nothing has
to be told which. **Do not set `SPIDERYARN_STORE`**: it decides nothing and is read by nothing. A
tombstone in `src/store/live.ts` threw on any value but `postgres` while
Vercel still carried the variable — silently ignoring somebody who asked for the store that is gone
is the failure this whole migration was leaving behind — and stage I deleted it on 2026-09-06 once
Greg had taken the variable out of Preview and Production.
[`tests/one-store-only.test.ts`](../../tests/one-store-only.test.ts) is what keeps the name unread.

`npm run dev` had defaulted the flag to `postgres` since 2026-09-02, and the reason it did is the
reason the store move happened at all: the filesystem adapter cannot fence two servers over one
checkout and the database can, which cost a third of all the AI spend we have ever made
([260902j](../plans/260902j-one-job-claimed-by-many-servers-and-the-money-it-spends.md)).

**So a stopped database now refuses to boot the dev server.** `assertStoreReachable` in
`vite.config.ts` runs one `select 1` first and fails loudly, naming `npm run db:start`,
`DATABASE_URL`, and the way back to disk. Before that, every setting could be present with the
containers merely down and the server would start fine and die on the first `/api` request.

**`npm run setup` is the whole of the database side of a fresh checkout**, and the one command to
remember when building a box: it runs `db:start`, `db:migrate`, `db:seed-owner` and
`db:seed-dev` in order and stops at the first failure saying what to do
([`scripts/setup-local.ts`](../../scripts/setup-local.ts),
[supabase-local.md](supabase-local.md)). The last of those creates the account you sign in as and
generates its password — `npm run db:admin-password` prints it — so there is no Google step and
nothing to click on a dashboard.

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

**`OPENAI_API_KEY` is a second, separate bill**, and it is optional: only live conversation mode
([live-conversation.md](live-conversation.md)) reads it, because OpenRouter has no realtime API to
route to. It is a **different account** from `OPENROUTER_API_KEY`, so the spend cap set on the
OpenRouter account does not cover it, and `npm run cost` cannot see a penny of it — the audio goes
from the reader's browser straight to OpenAI and no row is written
([ai-gateway.md](ai-gateway.md)). A cap for it has to be set in the OpenAI dashboard.

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
([260826a-chat-mode.md](../plans/260826a-chat-mode.md)), and search — while the seven pipeline stages went straight
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
| **dictation** | GPT Transcribe — `openai/gpt-transcribe` | OpenRouter's `/v1/audio/transcriptions`, and not a tier — `DICTATION_MODEL`. The one job not on chat/completions; it takes a `keywords` vocabulary, which is why it is there ([260907c](../plans/260907c-dictation-onto-an-openai-transcriber.md)) |

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
([diagram.md](diagram.md)); [260826n-semantic-search.md](../plans/260826n-semantic-search.md) is the other planned
caller.

**Every job is on the capable tier except one.** The quick tier is about a tenth the price, and
`link-summary` — how a hovered link's destination stands to the piece being read
([links.md](links.md#and-what-it-has-to-do-with-the-piece-in-your-hands)) — was **written for it**
rather than moved onto it, on 2026-09-05. That distinction is the whole of the policy: a new job may
be born on the quick tier by judgment, and **moving an existing one still means running an eval under
[`evals/`](../../evals/README.md) first and writing down what it cost**. Greg, 2026-08-26 — *"use
your judgment about which tasks to use for which (default to capable-model for now)."*

What that one job measured, which is all this repository knows about the tier: $0.00015 a call, 2–5
seconds, and **no reasoning tokens reported at all** at `effort: "low"` — the 1,024-token floor the
paragraph below warns about did not appear on the upstream that served it. That is one week's
evidence from one job, not a general fact.

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
| `SPIDERYARN_QUIZ_MARK_MODEL` | marking an answer in Remember's quiz |
| `SPIDERYARN_REFEREE_MIRROR_MODEL` | Mirror, the model reading a referee's own notes |
| `SPIDERYARN_REFEREE_CRITERIA_MODEL` | Criteria, one of a referee's own questions run over the paper |
| `SPIDERYARN_REFEREE_CLAIMS_MODEL` | Claims, pulling what the paper claims about itself |
| `SPIDERYARN_REFEREE_CANDIDATES_MODEL` | Candidates, the editor's conversation about who could review the paper |
| `SPIDERYARN_LINK_SUMMARY_MODEL` | how a hovered link's destination stands to the piece being read — **the one job on the quick tier**, so this is the variable for asking whether the cheap model is good enough |
| `SPIDERYARN_PIPELINE_EFFORT` | all three article-reading stages' effort at once |

`MODEL_ENV_VAR` in [`src/models.ts`](../../src/models.ts) is the list this table copies, and the
copy is why two rows were missing until 2026-09-01: `quiz-mark` had been added at the quiz stage and
`referee-mirror` an hour before this line was written, and neither arrival touched the table. A
variable that exists and is not written down here reads as a variable that does not exist, so the
rule is the one this repo already keeps — when you add a row there, add it here in the same change.
**And it went wrong again the same day**: `referee-criteria` had landed with the paragraph above
already written and still did not reach the table, so it was added alongside `referee-claims` rather
than found later. Three misses in one day is a copy asking to be derived, and the honest fix is a
test that reads `MODEL_ENV_VAR` and this table and compares them.

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
([architecture.md § Pipeline](architecture.md#pipeline)) — and **the queue is how you do that**, from
a browser as `POST /api/jobs { slug, steps: ["arc"], force: ["arc"] }`
([ingest-queue.md](ingest-queue.md)), and from a terminal as the four commands below.

**The eight article-reading stages lost their command lines on 2026-09-01** — `arc`, `tweets`,
`glossary`, `ideas`, `quotes`, `timeline`, `quiz` and `sketch`. Each read `blocks.json`, `tree.json`
and `meta.json` out of a folder and wrote its artefact back beside them, which is a second way to do
what a job already does — and the job is the one that exercises the store writes, the half that
actually breaks. A stage CLI writing to a different store than the queue reads has cost us a day
here before ([260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md)).

### The stage commands are one script, and they drive the queue

**Changed on 2026-09-05**, in stage E of
[260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md).
The five that were left had the same fault as the eight above, only quieter: each did a bare
`fs.writeFile` to a path off `process.cwd()`, reaching neither the artefact store nor `data-root.ts`
(deleted 2026-09-05). Under Postgres they wrote files nothing reads, and reported success.

They are [`scripts/stage.ts`](../../scripts/stage.ts) now — one script, four npm names, `enqueue`
then `advanceJob` in a loop. **It is the same code the queue runs**, which is what makes a re-run
safe: a new draft off the published revision each time, published when the job settles, block ids
carried rather than re-minted. Read that file's header for the whole contract; the four things worth
knowing here:

- **By slug, and only one you already have.** A slug that is not yours is refused before anything is
  queued — deliberately indistinguishable from one nobody has, which is the privacy rule. Typing
  `npm run blocks -- typoo` used to create an article row and a failed revision and leave the wreck
  on your shelf.
- **Without `--force`, nothing happens and it says `skipped`.** Note that the job still settles and
  still publishes a revision — an identical one. Three runs of `blocks` over one article, two forced,
  gave three new revisions and **one distinct id set**, measured 2026-09-05.
- **`--force` re-runs the step; it does not buy a fresh answer.** These runs share the article's
  `checkpoints` rows, which is what makes a killed run cheap to repeat — and it means a forced
  `hierarchy` on an unchanged article replays the structure call it already paid for, and a forced
  `labels` replays the batches. Two consecutive forced `hierarchy` runs, measured 2026-09-05 while
  the two were still one step: two model calls, then **zero**. Changing what a
  `force` means to a checkpoint is a queue-wide question, not a CLI one — the browser's Refresh does
  the same thing.
- **Naming one step runs one step.** `--force` cascades over the steps *in that job*, which for a
  one-step job is that step. There is no auto-chaining; several steps is `POST /api/jobs`. `fetch` on
  its own is refused outright, for the reason the `ingest` row below gives.
- **It starts slower** — a few seconds — because importing `src/jobs.ts` pulls in most of the module
  graph. That is import time, not work.

| Command | Stage | Notes |
|---|---|---|
| `npm run ingest -- <url> [--force]` | 1–5, **the whole ingest** ([fetching.md](fetching.md), [ingest-queue.md](ingest-queue.md)) | Replaced `npm run fetch`, which was fetch-only and cannot exist on the queue: publication happens once, when the job settles, so a fetch-only job on a new article pays and then fails to publish — and on an existing one *succeeds*, publishing new raw bytes beside stale derived content. **An address already on the shelf is adopted**, and without `--force` every step is `skipped`; `--force` forces `fetch` and `cascadeForce` takes the rest with it, which is the refresh. Measured 2026-09-05: forced, the same article came back with `41 blocks, 0 new ids (41 kept)` |
| `npm run ingest -- <file.pdf>` | the same, entered through an upload | Mints an upload record, puts the bytes, **claims** it, enqueues and notes the slug — `queueAnUpload`'s order (`src/routes.ts`), and the claim is the move that fails silently: without it the article is perfect and the record stays `pending` with no verified size. `--force` is refused here and only here: every upload mints a fresh slug, so two runs of one file are two articles |
| `npm run extract -- <slug> [--force]` | 2, Readability over the stored document ([content-extraction.md](content-extraction.md)) | |
| `npm run blocks -- <slug> [--force]` | 3, split into blocks and mint stable ids ([block-ids.md](block-ids.md)) | Freshness is structural: the stored HTML is re-split and compared block for block ([architecture.md § Conventions](architecture.md#conventions)) |
| `npm run hierarchy -- <slug> [--force]` | 4, the tree and an **empty** labels manifest ([hierarchy.md](hierarchy.md)). One model pass since 2026-09-06 — the structure — and the labels are the row below | Writing a pending manifest **deletes this revision's `labels` receipt**, so running this always makes the labels step runnable again. A forced re-run still replays the structure out of the article's checkpoints and buys nothing new (measured 2026-09-05); judging a *structure*-prompt change is `npm run eval:hierarchy-structure` |
| `npm run labels -- <slug> [--force]` | 4b, the `navLabel` on every paragraph, in parallel batches ([hierarchy.md § Why they are two steps](hierarchy.md#two-steps)) | **Back since 2026-09-06**, and this row said the opposite until then: *"`npm run labels` is retired. There is no `labels` step and adding one would be a pipeline redesign to keep a debugging command."* It is a step now, so the command is one line of `package.json` rather than a redesign. What has **not** changed is what `--force` buys: the batches come back out of the article's checkpoints, so a forced re-run on an unchanged tree costs nothing and answers the same. Judging a label-prompt change is still `npm run eval:hierarchy`; making `force` mean something to a checkpoint is a queue-wide decision |
| `npm run pdf:pass0 -- <file.pdf>` | 2, what a PDF says for free: pages, words, scan or not, running headers. No model, no network | prints; writes nothing |
| `npm run eval:pdf-read -- <file.pdf> [slug]` | **not a stage runner** — the PDF extraction-quality tool, and it was `npm run pdf` until 2026-09-05 | It prints the pages, the chunk plan and the per-chunk recall table ([`src/pdf-score.ts`](../../src/pdf-score.ts)), which is where the numbers in [evals/pdf/README.md](../../evals/pdf/README.md) come from; the queue's `detail` for that step is the title and nothing else. It writes `output/<slug>.html` and `data/<slug>/meta.json` **for a person to look at**, not as store artefacts. Ingesting a PDF is `npm run ingest -- <file.pdf>`. Nothing is remembered between runs: the chunk checkpoints are rows keyed on an `articles` row this command does not have ([database.md § Checkpoints](database.md#checkpoints-work-a-failed-attempt-already-paid-for)) |
| `npm run hierarchy:flatten -- …` | 4, tree → the flat sidebar rows ([hierarchy.md](hierarchy.md)) | — |
| `npm run validate-tree -- <dir>` | checks a `tree.json` against the invariants in [granularity-zoom.md § The tree](granularity-zoom.md#the-tree) | — |
| `npm run build` | production bundle, both passes — the client, then the API function ([deployment.md](deployment.md)) | `dist/`, `api-dist/` |
| `npm test` | the deterministic unit tests ([testing.md](testing.md)) | — |
| `npm run eval:hierarchy -- <dir>…` | not a test — measures nav-label quality against committed artefacts ([evals/README.md](../../evals/README.md)). Calls no model; run it after any change to stage 4 | `evals/results/<slug>-<date>.json` |
| `npm run typecheck` | every tsconfig, plus the guards that the checking happened ([typechecking.md](typechecking.md)) | — |
| `npm run lint` | Biome over `src/`, `tests/`, `scripts/` ([linting.md](linting.md)) | — |

The comment endpoints have no CLI stage — they are driven from the reading view. They write rows in
the `comments` table (`data/<slug>/comments.json` until 2026-09-05); deleting them forgets every
question asked about the article, and nothing else breaks.

**You do not have to run any of this by hand.** Paste a URL into the homepage's add box and the
ingest queue runs the same chain in the server process, with each stage named as it goes —
[ingest-queue.md](ingest-queue.md). The commands are for when you want one stage on its own, or want
to see its output.

**Except `tweets` and `glossary`, which an add never runs.** Both are in the pipeline's order and
neither is in its default list, so each is produced only when something asks for it by name:
`POST /api/jobs { slug, steps: ["tweets"] }` / `{ steps: ["glossary"] }`. Each
costs a model call over the whole article and each is somewhere you go — a page, and a mode — rather
than part of making an article readable
([260825g-tweet-thread-page.md](../plans/260825g-tweet-thread-page.md#the-one-real-snag-stated-precisely),
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

**There is one code path per stage, and since 2026-09-05 there is no longer even a wrapper around
it.** The stage commands *are* the queue — `scripts/stage.ts` enqueues a job and advances it — so
the thing that used to be worth preserving ("the script and the queue call the same exported
function") is now true by construction rather than by discipline. The evals are the remaining
callers that reach a stage directly, and `npm run eval:pdf-read` is the one command that does.

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

- `data/<slug>/` — until 2026-09-05, real pipeline output, gitignored, and every directory in here
  with a `blocks.json` and a `tree.json` appeared on the homepage. Pipeline output is now Postgres
  rows ([library.md](library.md)); nothing writes this layout on an ordinary run any more
  ([architecture.md § Storage](architecture.md#storage)).
- [`example/`](../../example/README.md) — the hand-authored placeholder. Nothing reads it at request
  time any more; `npm run setup` seeds it into Postgres like any other article.
- `output/` — the prototype extractor's scratch output, including the test article.
- [`tests/`](../../tests) — Vitest unit tests. `npm test` (once) or `npm run test:watch`. See
  [testing.md](testing.md).

## Before writing LLM code

Load the `claude-api` skill for current model ids and parameters. Don't hardcode a model from memory.
