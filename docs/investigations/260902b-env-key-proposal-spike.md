# Spike: how good is the env-key proposal on real key names?

A throwaway experiment for Stage 4 of
[260902h-gjd-remote-works-from-whichever-repo-you-are-in.md](../plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md),
run on 2026-09-02 against two real `.env.local` files.

> an LLM could do a quick inspection of the environment variable names (not values) and (perhaps
> with the help of a Sonnet web search), make a guess about which should/not be included (and why)
>
> — Greg, 2026-09-02

**The question.** Shown only the KEY NAMES of a real `.env.local`, does
[`scripts/gjd-remote-envpolicy.ts`](../../scripts/gjd-remote-envpolicy.ts)'s classifier sort them
well enough that its proposal can be the *starting state* of the push-env checklist, without a web
search?

**The answer.** Yes on the axis that matters, and only on the capable model. Across five paid calls
and 106 name-rows, **no key that ground truth calls a production or infrastructure secret was ever
put in a pre-tickable class.** But the quick model leaves a quarter of every file `unknown` and its
danger calls move between runs, so on `QUICK_MODEL_OPENROUTER` the proposal is a starting state that
still needs the reader to classify a quarter of the file by hand.

**And it does not currently run at all** — see the bug below, which is the most useful thing this
spike found.

## The bug: `temperature: 0` empties the routing table

`buildProposalRequest` sends `temperature: 0`, and `AI_JOB_ROUTE["env-proposal"]` sends
`provider: { require_parameters: true }`. `QUICK_MODEL_OPENROUTER` is `openai/gpt-5.6-luna`, and no
upstream serving it accepts `temperature`. So OpenRouter filters every endpoint away and answers
404:

```
{"error":{"message":"No endpoints found that can handle the requested parameters.","code":404,
 "metadata":{"routing_funnel":[{"step":"Initial Endpoints","endpoint_count":7},
 {"step":"Filter by Regional Surcharge","endpoint_count":5},
 {"step":"Filter by Tier Endpoint Rows","endpoint_count":3}],
 "failed_routing_step":"Filter by Parameters"}}}
```

Isolated by sending the four combinations to OpenRouter directly: `temperature` present and
`require_parameters` on is a 404 whether or not `response_format` is there; drop either one and
routing succeeds. Without `require_parameters` the temperature is silently dropped by the upstream,
which is what makes this invisible in every other job in the app.

The failure is quiet in the worst way. `proposeEnvKeys` catches the `ProviderRefused`, returns
`{ ok: false, why: "the model could not be reached" }`, and the CLI shows a blank checklist — which
looks exactly like a provider having a bad afternoon rather than like a request this repo can never
send. **Two runs cost real ledger rows and produced nothing**, both reported as `$0.0000 — 1
reported no cost`. This is [silent-success.md](../reusable/silent-success.md) with the money meter
playing the part of the check.

**The fix is to drop `temperature: 0` from `buildProposalRequest`.** The docblock's reason for it
("a classifier that answers differently on a re-run makes the saved policy look like it drifted") is
not bought by sending it: the model does not accept it, so the determinism was never there. The
stability numbers below are what `temperature` was supposed to buy and did not.

Everything below was measured with the temperature stripped **in the spike script**, not in the
module.

## The approach, and how "names only" was enforced

`/private/tmp/…/scratchpad/spike-proposal.ts`, outside the repo, deliberately. It:

1. reads each `.env.local` as text and hands it to `extractEnvKeyNames` **in the same expression**,
   so the text binding dies with that function's frame;
2. carries `string[]` of names from there on — every later function in the script is typed against
   names, so there is no parameter a value could arrive through;
3. runs each proposal inside `withLedger("cli", …)` after `loadEnvLocal()`, per the module header,
   so the spend is a row rather than a warning.

The two adaptations are in the script, never the module: the model id is swapped in the request body
for the capable variant, and `temperature` is deleted for the reason above. No value from either
file was printed, logged or written anywhere.

## Spideryarn — 18 names

Ground truth is the hand-written `ALLOWLIST` in
[`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts): 14 of the 18 are approved to travel,
and four are not — the two `FORBIDDEN_NAMES` and the two GitHub PATs, which are simply absent from
the list.

Classes under the capable model (`anthropic/claude-sonnet-5`); the two quick-model runs are given
where they differ.

| Name | Capable | Quick run 1 | Quick run 2 | Allowlisted? |
|---|---|---|---|---|
| `OPENROUTER_API_KEY` | shared-provider-key | = | = | yes |
| `CODEX_API_KEY` | shared-provider-key | = | = | yes |
| `OPENAI_API_KEY` | shared-provider-key | = | = | yes |
| `SUPABASE_URL` | local-dev-only | unknown | = | yes |
| `SUPABASE_ANON_KEY` | local-dev-only | = | = | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | production-or-signing-secret | = | = | yes |
| `DATABASE_URL` | production-or-signing-secret | = | = | yes |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | local-dev-only | = | = | yes |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | production-or-signing-secret | = | unknown | yes |
| `VITE_SUPABASE_URL` | local-dev-only | unknown | = | yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | local-dev-only | = | = | yes |
| `SUPABASE_PUBLISHABLE_KEY` | local-dev-only | = | = | yes |
| `SPIDERYARN_OWNER_ID` | local-dev-only | = | unknown | yes |
| `STRIPE_SECRET_KEY` | production-or-signing-secret | = | = | yes |
| `SUPABASE_ACCESS_TOKEN` | infrastructure-destroying | = | **unknown** | **no** |
| `HETZNER_CLOUD_API_TOKEN` | infrastructure-destroying | = | = | **no** |
| `GITHUB_PAT_GJD_REMOTE1` | infrastructure-destroying | unknown | unknown | **no** |
| `GITHUB_PAT_GJD_REMOTE1_SPIDERYARN` | infrastructure-destroying | unknown | unknown | **no** |

Sample reasons, capable model, verbatim: `SUPABASE_SERVICE_ROLE_KEY` — "Full bypass-RLS database
access key, highly sensitive." `SUPABASE_ACCESS_TOKEN` — "Supabase management API token can
manage/delete projects." `VITE_SUPABASE_URL` — "Frontend-exposed env var, public by design in Vite
build." All three are right, and the third is a piece of reasoning about the *prefix* rather than
about the service.

## hellozenno — 26 names

Ground truth is that repo's `docs/plans/260831a_remote_box_gjd_remote_setup.md`: `FLASK_SECRET_KEY`
is byte-identical to production and must not travel, the Supabase password likewise, the provider
keys are ordinary, and the database and Supabase hosts in `.env.local` are all `127.0.0.1`.

| Name | Capable | Quick run 1 | Quick run 2 | May travel? |
|---|---|---|---|---|
| `DATABASE_URL` | production-or-signing-secret | unknown | unknown | yes (127.0.0.1) |
| `OPENAI_API_KEY` | shared-provider-key | = | = | yes |
| `CLAUDE_API_KEY` | shared-provider-key | = | = | yes |
| `ELEVENLABS_API_KEY` | shared-provider-key | = | = | yes |
| `PERPLEXITY_API_KEY` | shared-provider-key | = | = | yes |
| `GEMINI_API_KEY` | shared-provider-key | = | = | yes |
| `CODEX_API_KEY` | shared-provider-key | = | = | yes |
| `FLASK_SECRET_KEY` | production-or-signing-secret | **unknown** | = | **no** |
| `USE_LOCAL_TO_PROD` | local-dev-only | = | = | yes |
| `LOGS_DIR` | local-dev-only | = | = | yes |
| `FLASK_PORT` | local-dev-only | = | = | yes |
| `SUPABASE_HOST` | unknown | = | = | yes (127.0.0.1) |
| `SUPABASE_PORT` | local-dev-only | = | = | yes |
| `SUPABASE_DATABASE` | unknown | = | = | yes |
| `SUPABASE_USER` | unknown | = | = | yes |
| `SUPABASE_PASSWORD` | production-or-signing-secret | = | **unknown** | **no** |
| `SUPABASE_POOL_MODE` | local-dev-only | = | = | yes |
| `PUBLIC_SUPABASE_URL` | local-dev-only | = | = | yes |
| `SUPABASE_URL` | unknown | = | = | yes (127.0.0.1) |
| `PUBLIC_SUPABASE_ANON_KEY` | local-dev-only | unknown | unknown | yes |
| `USE_LEGACY_CURSORRULES` | local-dev-only | = | = | yes |
| `VITE_FRONTEND_URL` | local-dev-only | = | = | yes |
| `VITE_API_URL` | local-dev-only | = | = | yes |
| `SEGMENTATION_DEFAULT` | local-dev-only | = | = | yes |
| `SEGMENTATION_TH` | local-dev-only | = | = | yes |
| `RECOGNITION_KNOWN_WORD_SEARCH` | local-dev-only | = | = | yes |

The eleven application settings at the bottom — ports, paths, flags, thresholds — are classified
`local-dev-only` by every run of both models with no hesitation. That is most of a real `.env.local`,
and it is the half a human checklist is most tedious about.

## Scores

A **false positive** is a key ground truth calls a secret that the model put in a pre-tickable class
(`local-dev-only` or `shared-provider-key`, the two `SAFE_CLASSES`). It is the only error that can
send a secret to the box. A **false negative** is a safe key the model would not pre-tick, which
costs the reader a keystroke.

| Run | Rows | Pre-ticked | False positives | False negatives | Unknown |
|---|---|---|---|---|---|
| spideryarn, quick, run 1 | 18 | 8 | **0** | 6 | 4 (22%) |
| spideryarn, quick, run 2 | 18 | 9 | **0** | 5 | 5 (28%) |
| spideryarn, capable | 18 | 10 | **0** | 4 | 0 (0%) |
| hellozenno, quick, run 1 | 26 | 18 | **0** | 6 | 7 (27%) |
| hellozenno, quick, run 2 | 26 | 18 | **0** | 6 | 7 (27%) |
| hellozenno, capable | 26 | 19 | **0** | 5 | 4 (15%) |

Zero false positives in all six. The capable model additionally names all four spideryarn keys that
must never travel as `infrastructure-destroying`, including the two GitHub PATs that no ground-truth
document mentions — it reached that on the `PAT` in the name.

**Most false negatives are the model being right and the allowlist relying on something the model
is not allowed to see.** `DATABASE_URL`, `SUPABASE_URL` and `STRIPE_SECRET_KEY` are on Spideryarn's
allowlist only because `MUST_BE_LOCAL` and the `sk_live_` prefix check inspect the **value**. From
the name alone, "this could be production" is the correct answer, and a classifier that said
otherwise would be guessing. So the residual false-negative rate is not a defect to tune away; it is
the cost of the names-only rule, and it is paid in keystrokes rather than in secrets.

## Stability

Two quick-model runs per repo, same prompt, same names.

| | Rows that changed class | Rows whose tick state changed |
|---|---|---|
| spideryarn | 5 of 18 (28%) | 3 of 18 |
| hellozenno | 2 of 26 (8%) | 0 of 26 |

Both hellozenno flips are on the danger axis and they swap: run 1 named `SUPABASE_PASSWORD` and
missed `FLASK_SECRET_KEY`; run 2 named `FLASK_SECRET_KEY` and missed `SUPABASE_PASSWORD`. Neither
run named both. On spideryarn, run 2 demoted `SUPABASE_ACCESS_TOKEN` from
`infrastructure-destroying` to `unknown` — harmless here because `FORBIDDEN_NAMES` hard-guards it,
and a good argument for that guard being a value rather than a model's opinion.

**No flip in either direction ever produced a false positive**, and the pre-tick set was identical
across hellozenno's two runs. The instability is entirely in *which* dangerous key gets named, not
in whether a dangerous key gets ticked. The capable model was run once per repo (the spike's paid-call
budget), so its stability is unmeasured.

## Would a web search have helped?

Searched each name the models left `unknown` or got wrong.

- **`SUPABASE_ACCESS_TOKEN` — yes, decisively.** Supabase's own docs say it authenticates the CLI
  against the Management API for "projects, functions, secrets", which is precisely the
  `infrastructure-destroying` case. A search turns run 2's `unknown` into a confident answer.
- **`FLASK_SECRET_KEY` — yes.** Flask's docs and every tutorial say it signs session cookies, and
  the first result explains that guessing it lets an attacker forge a session for any user without
  touching the database. That is the `production-or-signing-secret` definition almost word for word.
- **`SUPABASE_HOST`, `SUPABASE_USER`, `SUPABASE_DATABASE`, `SUPABASE_URL`, `DATABASE_URL` — no.**
  The search returns exactly what the model already said: these are the components of a Postgres
  connection string. What is undecidable is whether *this* host is `127.0.0.1` or `db.xxx.supabase.co`,
  and that is a fact about the value on this machine. No amount of searching reaches it. This is the
  bulk of the remaining unknowns.
- **`SPIDERYARN_OWNER_ID`, `GITHUB_PAT_GJD_REMOTE1`, `SEGMENTATION_TH` — no.** A search for the
  literal names returns nothing about them; they exist in one repo each. The model's own reasoning
  about `PAT` and `OWNER_ID` is all there is, and on the capable model that reasoning was right.

So search buys two names out of about eleven, and both of those the capable model already got right
without it. **Search is not worth building.** Its value is concentrated in well-known third-party
secrets, which are exactly the names a capable model already knows.

## Cost

| Call | Model | Names | Cost |
|---|---|---|---|
| spideryarn ×2 | `openai/gpt-5.6-luna` | 18 | $0.0013, $0.0011 |
| hellozenno ×2 | `openai/gpt-5.6-luna` | 26 | $0.0012, $0.0015 |
| spideryarn | `anthropic/claude-sonnet-5` | 18 | $0.0237 |
| hellozenno | `anthropic/claude-sonnet-5` | 26 | $0.0220 |

About $0.0013 quick and $0.023 capable — eighteen times more for something a reader runs once per
repo, perhaps a handful of times a year. Two cents.

## Recommendation

**Pre-tick from the proposal as-is, on the capable model, with no web search** — and fix the
temperature bug first, because none of this works until that is done.

The one error that can put a secret on a box shared by autonomous agents did not happen once in six
runs, on either model. That is what pre-ticking needs to be safe, and it holds even under the quick
model's instability, because every flip was between two classes that both refuse a tick. The
argument for the capable model is not safety, it is that a proposal leaving a quarter of the file
`unknown` is barely a proposal: the reader still has to decide eleven rows on hellozenno instead of
four, and on spideryarn the quick model twice failed to name a token that can delete the box. At two
cents a run, on a command run once per repo, `QUICK_MODEL_OPENROUTER` is a saving nobody asked for.
That means `AI_JOB_ROUTE`'s `env-proposal` job should sit on `CAPABLE_MODEL_OPENROUTER`, and the
docblock's "cheapest call in the app" reasoning should be revised rather than kept.

Two caveats worth carrying into the build. The capable model's stability was not measured, so if a
saved policy is compared across runs, expect drift and do not treat a changed class as a signal.
And the residual unknowns are load-bearing rather than noise: they cluster on the connection-string
components whose environment only the value can settle, which is why `MUST_BE_LOCAL` and the
`sk_live_` prefix check exist and why they must keep existing alongside the proposal, not be replaced
by it.

## Sources

- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction) — what
  `SUPABASE_ACCESS_TOKEN` authenticates.
- [Supabase Management API introduction](https://supabase.com/docs/reference/api/introduction).
- [Connect to your database | Supabase Docs](https://supabase.com/docs/guides/database/connecting-to-postgres)
  — the connection-string components.
- [Securing Your Session Key in Flask](https://morgvanny.com/securing-your-session-key-in-flask/)
  and [flask-unsign](https://pypi.org/project/flask-unsign) — what a leaked `FLASK_SECRET_KEY` buys
  an attacker.
- [OpenRouter provider selection](https://openrouter.ai/docs/guides/routing/provider-selection) —
  what `require_parameters` filters on.
