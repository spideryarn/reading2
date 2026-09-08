# The health check printed the fault and called itself healthy

**Found 2026-08-27**, by running `vercel env ls production` and reading the list rather than the
endpoint. `SUPABASE_SERVICE_ROLE_KEY` had never been added to the `spideryarn-reading2` project. The
value had been sitting in `.env.prod` the whole time.

Throughout, `GET /api/health` answered:

```json
{ "ok": true, "warnings": [], "env": { "SUPABASE_SERVICE_ROLE_KEY": false } }
```

Healthy on line one. The fault printed in full four lines later, in the same response. The endpoint
had no opinion about the contradiction, because nothing in it ever compared one of those booleans
against anything.

The missing variable is a dashboard field somebody forgot. Two things about it are worth the
write-up, and the second is the more useful one:

1. **The green light.** A health check that reports a value and has no opinion about it, in the file
   whose own header says a health check passing on a wrong deployment is worse than none.
2. **The guard that was already written, one file away.** Four places in this codebase ask "am I in
   production with a development-only fallback?" Three refuse. The fourth is the one that writes the
   bytes — and one of the three shipped **in the same commit**, a hundred lines from it, with a
   comment reasoning about exactly this hazard. The team knew the pattern; nothing obliged anybody to
   ask the question here. See [the four sites](#four-sites-ask-that-question-three-of-them-refuse-the-fourth-writes-the-bytes).

## What broke, and what only looked like it broke

[`src/store/blobs.ts`](../../src/store/blobs.ts) reads the key through `configured()`, which returns
`null` unless **both** `SUPABASE_URL` and the service key are set. `SUPABASE_URL` was set. So
`configured()` returned `null`, and its two callers each degraded quietly:

- **`uploadGrants()` returned `null`.** `POST /api/uploads` answers 503 with `[up-off]` —
  *"Uploading isn't switched on here … Trying again will not help until somebody finishes setting up
  its file storage."* Every PDF a reader chose off their own machine on www.spideryarn.com was
  refused, from the moment uploads landed (`2405408`, 2026-08-27 01:34) — and **still are at the
  time of writing**, because the key has not been set. The fix in this document makes the deployment
  *say* so; it does not put the key in. That is a dashboard field and it is somebody's to type
  the same day. The copy is accurate and it is well written. It was read by nobody, because the only
  person with an account had not tried it in production.
- **`blobStore()` fell back to `fsBlobs()`** — raw source bytes written to a serverless filesystem
  that does not outlive the request.

The second one is the one that loses data, and **in production it never actually ran.** `blobStore()`
has exactly one caller, `acquireUpload` in [`src/pipeline.ts`](../../src/pipeline.ts), reached only
by a job created from an upload that was minted — and minting was the thing being refused. Ingest
does not run on this host at all yet
([deployment.md § What does not work in production yet](../project/deployment.md#what-does-not-work-in-production-yet)).
So the data loss was **latent, not realised**. It is still the more serious half: it is armed by
*absence*, it is chosen silently, and it becomes real the day the queue runs on the host — which is
the direction the whole project is moving.

## Two introductions, fifteen hours apart

**`4dcc580`, 2026-08-26 11:44 — "Make the deployed API reachable, and stop three silent failures".**
This added `EXPECTED` to [`src/vercel-health.ts`](../../src/vercel-health.ts) as a flat
`readonly string[]` of ten names, rendered to booleans:

```ts
const env: Record<string, boolean> = {};
for (const name of EXPECTED) env[name] = Boolean(process.env[name]);
```

`SUPABASE_SERVICE_ROLE_KEY` was in that list from the first line of it. **And on that day the list
was right to be a report.** Nothing on the server read the key — `git grep` at that commit finds it
in exactly one place outside this file, [`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts),
a CLI script Vercel never runs. `.env.example` said so in as many words, and still does:

> `npm run db:seed-owner` needs the URL and the service-role key; **nothing else reads them**.

There was no consequence to attach to it, so no consequence was attached. A `breaks` string in
August 26's code would have been a lie.

The same commit is where the file's header was written, including the sentence this postmortem is
about: *"A health check that passes when the deployment is wrong is worse than no health check,
because it is the thing you point at to argue nothing is wrong."* That was said about the store, TLS
and the empty shelf — all three of which it does check. It was not said about the block directly
below it.

**`2405408`, 2026-08-27 01:34 — "Give the picker somewhere to send the file, and the queue a second
way in".** This added [`src/store/blobs.ts`](../../src/store/blobs.ts) and gave the key two runtime
consumers on the server, both of which degrade by falling back. Nothing in that commit went back to
`vercel-health.ts`, and nothing would have prompted anybody to: the name was already in the list, and
the list already said `false`.

That is the whole mechanism for the green light. **A variable was described before it was needed, and
the description never learned that it had become a requirement.** No line was edited to introduce it.
It was introduced by a line *not* being edited, which is why `git blame` on the broken behaviour
points at a commit that was correct when it was written.

`2405408` is also where the silent fallback was introduced — and, as the next section shows, where
the guard that should have gone with it was written for the neighbouring module.

## The fallback is not the bug, and the pattern for it was already written

`fsBlobs()` is deliberate and it should stay. blobs.ts argues for it plainly:

> Blobs follow the credentials: if this process has a Supabase service key, the bytes go to Supabase,
> because that is the only place a browser can put them. Otherwise they go under `data/_blobs/`,
> which is enough for tests and for a laptop with no container running — and cannot mint a grant, so
> nothing can accidentally depend on it in production.

Every clause of that is true, and the last one is where it goes wrong. It reasons that the *grant*
half cannot be faked, and concludes from that that nothing can accidentally depend on the filesystem
half. That holds for `uploadGrants()`, which returns an honest `null`. It does not hold for
`blobStore()`, which will happily write bytes anywhere and say nothing. The seam was designed so the
honest answer could be given for the thing that cannot be faked, and what remains for the thing that
*can* be faked is a working-looking filesystem.

So the defect is not the fallback. **It is that the fallback is chosen by the same condition on a
laptop and on a serverless host, and only one of those is a place where it is right.**

### Four sites ask that question. Three of them refuse. The fourth writes the bytes

This is the most interesting thing in the bug, and it is not a near-miss — the pattern is written
down, argued for in comments, and applied three times within twenty-four hours of the omission.

**[`src/owner.ts`](../../src/owner.ts):268** — 2026-08-26, from Fable's review. A development default,
and in production an error rather than a default:

```ts
if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  throw new Error("SPIDERYARN_OWNER_ID is not set, and there is no development owner in production…");
}
```

**[`src/store/index.ts`](../../src/store/index.ts):110–125** — `8cd0579`, 2026-08-27 08:48. The
fullest statement of it, and its comment is about *this hazard by name*:

> So this is a **boot-time refusal rather than a per-request one**. On Vercel it would have failed
> anyway — there is no writable disk — but it would have failed as ENOENT on the first read, which
> reads as a missing article rather than as a store that must never have been selected. Loud, at the
> moment the configuration is wrong, and before anybody's data is involved.

Substitute "bytes" for "article" and that paragraph is a description of `blobStore()`.

**[`src/upload-records.ts`](../../src/upload-records.ts):177** — and this is the one that makes the
asymmetry impossible to write off. `recordsSurviveTheRequest()` shipped **in `2405408` itself**, the
same commit as `blobStore()`, guarding the same feature against the same host:

```ts
export function recordsSurviveTheRequest(): boolean {
  return STORE === "postgres" || !process.env.VERCEL;   // `!process.env.VERCEL` in 2405408; corrected in e9a8392
}
```

Its docstring, written at the same sitting as the unguarded fallback next door:

> Deliberately **not** keyed on "is the filesystem writable" — it is, on Vercel, and that is precisely
> what makes the failure quiet. The refusal happens at the door rather than three minutes into an
> 11 MB upload, which is the difference between a limitation and a silent success.

**`src/store/blobs.ts`** — no guard. `blobStore()` returns `fsBlobs()` and the caller writes.

So the same commit contains the pattern and its omission, roughly a hundred lines apart, with the
correct one carrying a comment reasoning explicitly that a serverless filesystem *being writable* is
what makes the failure quiet. The author was thinking about exactly this while writing the module
that does it.

### Why the one that was missed was the one that was missed

Worth naming, because "apply it consistently" is not advice anybody can act on:

- **The three guarded sites all guard a thing that is obviously about the host.** An owner id, a
  store name, "does a record outlive a request" — each is a deployment-shaped question, and you ask
  it while thinking about deployment. `blobStore()` reads as a *dependency-injection* question:
  which implementation do I have credentials for. It is phrased as a capability lookup, and
  capability lookups do not feel like they have environments.
- **`uploadGrants()` sits directly above it and does the honest thing.** Reviewing that file, the
  eye lands on the `null` and the paragraph justifying it, and the neighbouring function looks like
  the same decision already made well. `blobStore()`'s own doc comment says *"Never null — the
  filesystem always works"*, which is true and is the sentence that closes the question.
- **The unguarded one is the only one of the four whose failure is a write.** The other three refuse
  before anything happens. This one succeeds, returns, and the damage is downstream and later — the
  same distance between cause and symptom that `store/index.ts`'s comment is about.

### So it belongs on a checklist

The knowledge existed and was written down four times; what was missing was any moment at which
somebody was obliged to ask. The question is short enough to be a checklist line, and it should go
somewhere a person meets when adding a seam rather than in a postmortem:

> **Does this env-dependent fallback need a production guard?** If a missing variable selects a
> different implementation rather than raising an error, ask what that implementation does on Vercel.
> If the answer is "quietly the wrong thing", refuse at boot or at the seam — see `src/owner.ts`,
> `src/store/index.ts`, `src/upload-records.ts`.

[architecture.md § Stage ownership](../project/architecture.md#stage-ownership) or
[deployment.md](../project/deployment.md) is the natural home. A grep for `process.env` next to a
`?:` or an `||` finds every candidate in this repo in one second, which is a static check as much as
a checklist line.

## Four moments this should have been caught, and why each one wasn't

**The plan asked the right question about the wrong machine.**
[260826u-pdf-upload-and-storage.md](../plans/260826u-pdf-upload-and-storage.md) opens with a readiness table, and one
row reads:

| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | **in `.env.local` already** |

`.env.local` is this laptop. The plan mentions the Vercel project nowhere. This is sharper than a
missed row, because the same document's thesis is that the laptop is not production — *"A multipart
route to `/api/upload` would work perfectly on this laptop and be dead on arrival in production,
which is exactly the trap."* It named the trap two sections after stepping in a smaller version of
it. Checking a credential is *available* is not the same question as checking it is available
**where the code will run**, and the two look identical when you are sitting at the machine where it
is.

**It was documented, correctly, from the day it shipped — and still never set. Documenting a
requirement is not checking it.** The same commit that shipped uploads (`2405408`) added a paragraph
to [deployment.md § The `sources` bucket](../project/deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too)
saying `SUPABASE_SERVICE_ROLE_KEY` *"must be present in the deployed environment"*, and describing in
advance the exact 503 that then happened. That sentence was true, prominent, in the right file, and
load-bearing on nothing. Prose creates no obligation on any process; it is where you explain a check,
and it is never the check. Note too that the env-var **table** three hundred lines up in the same
file — the one somebody actually works down when configuring a project — never gained a row, so even
the one artefact shaped like a checklist did not carry it.

**The automated production check delegated its judgement to the thing that was wrong.**
[`scripts/check-production-gate.sh`](../../scripts/check-production-gate.sh) does hit the endpoint:

```sh
if grep -q '"ok":true' <<<"$hbody"; then ok "GET /api/health → ok:true"
```

It fetched the whole body — the `env` block included — and looked at one boolean inside it. That
script's own header is the argument against what it then did:

> RUN THIS BEFORE THE GATE EXISTS TOO. It should fail, loudly … A checklist whose lines have only
> ever been seen to pass is not evidence of anything.

That instruction was followed for the gate lines, which were watched failing. The `ok:true` line had
never been seen to fail for an environment reason, and could not be: no environment fault could
produce a false there.

**And a human read the response and pasted it into the docs with the fault trimmed out.**
[deployment.md § It is up, and here is the reading of it](../project/deployment.md#it-is-up-and-here-is-the-reading-of-it)
quotes the live health JSON as evidence the deploy is good — `ok`, `warnings`, `node`, `region`,
`store`, `ssl`. The `env` block is elided. Trimming a long response to the interesting parts is
ordinary and reasonable; what makes it worth recording is *which* part reads as uninteresting. A
block of booleans nobody has ever had to act on is the first thing to go, and it was the only thing
in the response that was telling you something.

## Why the natural check agreed with the bug

Straight out of [silent-success.md](../reusable/silent-success.md). The assumption shared by the
code, the script, and the person reading the output was: **a health endpoint that reports a value has
an opinion about it.** Every one of them was on the same side of the gap between *reporting* and
*checking*.

It also hits the entry about absence: `warnings: []` is what a clean deployment and a detector with
nothing wired to it both produce. There is no way to tell them apart from the outside, which is why
the `env` block looked like corroboration rather than contradiction.

## The fix that landed, and what it does not cover

`EXPECTED` is now a table of `{ name, or?, breaks: string | null, valid?, where? }`. A missing
variable with a `breaks` string produces a warning naming **what stops working**, and any warning
makes the endpoint 503. GPT Sol reviewed the first version of that table and found it lying in both
directions — demanding `SUPABASE_ANON_KEY` by name when `src/auth.ts` accepts the publishable key
instead, which would have failed a working deployment; dismissing `NODEJS_HELPERS` as unread when
the *platform* reads it and it has to be exactly `"0"`; and pointing `ANTHROPIC_API_KEY` at
consequences that belong to `OPENROUTER_API_KEY`. Hence `or`, `valid` and `where`, and hence values
being trimmed, since `Boolean(" ")` is `true` and `configured()` in `blobs.ts` agrees with it.
`tests/health.test.ts` § *"the environment a deployment needs"* pins it, including the detail that
matters more than the assertions: a `beforeEach` giving the shelf an article, because without it the
"shelf is empty" warning is present on every call and the two `ok === false` assertions pass against
the unfixed handler. The first draft of that block was green before the fix — silent-success one
level up, in the test.

That is the right fix for what it covers, and it is the right shape: `breaks: null` for the ones
another part of the same handler already reports better, so the warning list does not become noise.
Four things it still does not reach:

1. **The list is still hand-maintained, and hand-maintained drift is the entire cause above.**
   Nothing makes `EXPECTED` agree with what the code reads. `SUPABASE_PUBLISHABLE_KEY` is in the
   table now, but only because a reviewer happened to read `src/auth.ts`; `SPIDERYARN_OWNER_ID` is
   read by `src/` and is still absent, and `ANTHROPIC_API_KEY` is listed while no line under `src/`
   reads it by name (the SDK takes it from the environment itself). Both are currently harmless. So
   was the service key, for fifteen hours. A test that walks `src/` for `process.env.` reads and
   asserts every one appears in `EXPECTED` would close this, and is the cheapest of the four.
   *Checked 2026-09-03: `ANTHROPIC_API_KEY` left `EXPECTED` on 2026-08-31 — by hand, which is the
   point — and `SPIDERYARN_OWNER_ID` is still read by `src/owner.ts` and still absent from it. **The
   test is still not built.***
   ***Checked 2026-09-07: still not built, and now with a measurement instead of an estimate.*** It
   was built and **twice refused in review** — nine established ways for an environment read to be
   silently skipped rather than refused, which disqualifies a check whose entire job is not to fail
   open. What the attempt produced is worth more than the estimate it replaces:

   - **The drift is 36 names, not a handful.** A sweep resolved 50 distinct reads under `src/`; 36
     were in neither `EXPECTED` nor any deliberate exclusion. **Six are now in `EXPECTED`** (all
     `breaks: null`), including `SPIDERYARN_OWNER_ID` above, so the specific drift this entry names
     is closed even though the general check is not.
   - **Three variables nobody had inventoried anywhere**: `SPIDERYARN_ENV_PINNED` (read two hops
     from `process.env`, via `applyEnvFile` into `pinnedNames`), `VITE_SENTRY_DSN` and
     `VITE_VERCEL_ENV`.
   - **"Every `process.env.X`" is the wrong target.** Sixteen names arrive through computed reads —
     `MODEL_ENV_VAR[task]` and four module-local constants — and a check blind to those is worse
     than none. Resolving them soundly turned out to need lexical binding analysis, which is where
     the nine holes came from.

   The design that would hold this, a cheaper alternative that makes the *reads* literal instead of
   the check clever, and the nine executed attacks any rebuild must go red on first, are all in
   [260907e](../plans/260907e-small-uncontested-postmortem-preventions-batch.md) § Stage 4. See also
   § *Derive the contract instead of restating it* below, whose claim about this check turned out to
   be false.*

   ***Built 2026-09-08, on the third attempt, and not the check this entry asked for.***
   [`tests/env-reads-are-literal.test.ts`](../../tests/env-reads-are-literal.test.ts) and
   [`tests/env-names-are-inventoried.test.ts`](../../tests/env-names-are-inventoried.test.ts) —
   about 2,600 lines with the sweep they share. This entry called it "the cheapest of the four" and
   § *Derive the contract instead of restating it* called it "a few lines"; both were wrong by two
   orders of magnitude, which is the more useful half of this update. What changed was the target, not the cleverness: rather than
   teach a check to resolve a computed read, the **reads** were made literal, so every
   `process.env.X` and `import.meta.env.X` under `src/` is a literal member expression and anything
   else is *refused* rather than skipped. Twelve reads that genuinely cannot be literal — a `.env`
   file writing into the environment, `MODEL_ENV_VAR[task]`, this file's own reporter indexing
   `EXPECTED` — are pinned by AST checksum, so changing one goes red and asks a person to re-read
   it. Every name the sweep resolves must then be in exactly one of four doors: `EXPECTED`, the
   client build inputs the build refuses to go without, a written allowlist with a reason per name,
   or Vite's own constants. A variable can no longer be neither reported nor deliberately excluded.
   [260908a](../plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md).

   **The limit goes in the same breath, because it is this postmortem's own distinction: it
   inventories names, not consequences.** It would not have caught the incident above.
   `SUPABASE_SERVICE_ROLE_KEY` was already in `EXPECTED` before `src/store/blobs.ts` started reading
   it and was still there afterwards — a membership test stays green straight through the commit, as
   § *Derive the contract instead of restating it* says at length. What went wrong was a *reported*
   variable quietly becoming required without gaining a `breaks` consequence, and deriving the
   contract, which is the fix for that, is still not built.
2. **It only sees the API function's runtime environment.** `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` are compiled into the browser bundle at build time — and missing
   them produced a blank site on the same day, a different failure of the same class. They are in
   the table now, and the check is honest about being weak: what it reads is the *current project
   setting*, not what the running bundle was built with, so **absent is conclusive and present is
   not**. Add them and never redeploy and it goes green over a blank page. A runtime endpoint cannot
   check a build-time input; only a build-stamped sentinel can, and that is not built.
   **Correction, 2026-09-03: it was built nine hours after this sentence was written, and better
   than a sentinel.** `missingClientEnv` in [`scripts/build-stamp.ts`](../../scripts/build-stamp.ts),
   called from `vite.config.ts`'s `buildStart`, **fails the Vercel build** when either name is unset
   — so there is no bundle to check afterwards, and nothing has to be read back. Landed the same day
   in `3b22e5b7`; `tests/build-stamp.test.ts` § `missingClientEnv` covers the whitespace case too.
   The health check's weakness above is unchanged and no longer matters for these two names.
3. **A filled slot is not a correct value.** A truncated key, or the right key for the wrong
   project, passes. So does a missing `sources` bucket, documented in the paragraph immediately
   beside the one this bug is about.
4. **It is a pull check.** Somebody has to fetch it and read it. This deployment was green for a day
   with somebody fetching it and reading it.

## What would have caught the class

- **Refuse at the seam, not at the reporter. This is the fix.** `blobStore()` should refuse on Vercel
  with no credentials, exactly as its three neighbours already do. It is two lines; the tests never
  set `process.env.VERCEL`, so nothing local changes; and it makes the class *impossible* rather than
  *visible*, which the health check can only ever do. A reporter catching a bad fallback downstream
  is a second reader of a decision that should never have been made silently — and it only works if
  somebody looks.

  Note which way round the two fixes point. The health check now says *"this deployment has no PDF
  upload"* to whoever fetches it. A guard at the seam says *"this process must not start"* to the
  platform, at boot, with the deploy going red. Only the second one needs no reader.
- **Derive the contract instead of restating it.** One declaration of each variable — who reads it,
  what breaks without it, which environments require it — imported by both the code that reads it
  and the health check, so a variable cannot gain a consumer without gaining an entry. Failing that,
  a static test asserting every `process.env.X` under `src/` appears in `EXPECTED` (with a named
  allowlist for the deliberate omissions) ~~would have gone red at `2405408`~~ and is a few lines. It
  fits beside the project-wide checks in [`scripts/check.ts`](../../scripts/check.ts).

  ***Checked 2026-09-07 — and the struck-out claim above was wrong, which is the more useful half of
  this entry.*** `SUPABASE_SERVICE_ROLE_KEY` was already in `EXPECTED` at `4dcc580`, before
  `src/store/blobs.ts` began reading it, and it was still there at `2405408`. A membership test
  therefore stays **green** straight through the commit that introduced this bug. What went wrong
  was not a missing name: it was a *reported* variable silently changing from optional to required
  without gaining a `breaks` consequence — which is the first bullet in this same list, deriving the
  contract, and is still not built.

  So this check is worth having for the drift it does catch — `SPIDERYARN_OWNER_ID` was read by
  `src/owner.ts` and absent from `EXPECTED` for eleven days, exactly as item 1 above says — but it is
  **not** the check that would have caught this incident, and a postmortem that overstates its own
  fix sends the next sweep down a blind alley. Found by GPT Sol while reviewing the plan to build it;
  the history was then checked by hand.
  [260907e](../plans/260907e-small-uncontested-postmortem-preventions-batch.md) § Stage 4.

  *Built 2026-09-08 — the membership half of this bullet, not the derivation half. See item 1 above
  for what landed and for the sentence that has to travel with it. The first half of this bullet,
  one declaration of each variable that both the reader and the health check import, is still the
  fix for the incident and is still not built.*
- **Compare the two lists by machine.** `.env.prod` exists precisely as "a record of what production
  needs" and is read by nothing. Diffing its names against `vercel env ls production` is what found
  this, done by hand, a day late. It belongs next to `check-production-gate.sh`.
  *Checked 2026-09-03: **still not built.** "Read by nothing" has since stopped being true in the
  narrow sense — `scripts/deploy.ts`, `deploy-checks.ts`, `check-owner-identity.ts` and
  `check-remote-auth.sh` all lift credentials out of it — but nothing compares its **names** against
  the platform's, which is the check this bullet asks for.*
- **Never let a checker read another checker's summary boolean.** `grep '"ok":true'` inherits every
  blind spot of the thing producing that boolean, and inherits them invisibly. Assert on the
  underlying facts as well — no required name `false` in the `env` block — or the outer check adds
  nothing but confidence.
- **When a name is listed before it is needed, say so where it is listed.** The original `EXPECTED`
  entry was correct as documentation and became wrong as a check without changing. An entry that
  had said *"reported only; nothing on the server reads this yet"* would have been a question the
  next person to give it a consumer had to answer.
- **A requirement recorded in prose is not a requirement.** Everything true about this bug was
  written in `deployment.md` before it happened. Prose is where you explain a check; it is never the
  check.
- **A pattern applied three times and skipped once is a checklist item, not a lapse.** See the
  checklist line above. Nothing about the three guarded sites made them memorable and nothing about
  the fourth made it forgettable — it simply did not look like an environment question at the moment
  it was written.

## Should anything be rearchitected

No. Two small changes and one checklist line — the architecture here is right and was right
throughout.

The two-interface split in blobs.ts (`RawSourceStore` and `UploadGrants`, GPT Sol's correction on
2026-08-26) is what kept this from being much worse: because there is no filesystem grant issuer,
`uploadGrants()` could give an honest `null` and the route could say a true sentence to the reader.
The whole finding is that the same honesty was not applied to the other half of the same seam.

That is worth stating carefully, because "we knew the right pattern and did not apply it" invites the
wrong response, which is to be more careful. Care does not help — the three guarded sites were not
guarded because anybody was careful, they were guarded because each one was written while thinking
about deployment. **The durable version is to attach the question to the shape rather than to the
occasion**: a fallback selected by a missing environment variable is a recognisable thing, greppable
in one line, and it should be asked about every time one appears.

The health endpoint is the right place for a *second* signal and the wrong place for the only one.
Keep it; stop treating it as the boundary.

## See also

- [deployment.md § The env block was a report, not a check](../project/deployment.md#the-env-block-was-a-report-not-a-check)
  — the operating note, and the env-var table that should have had the row
- [260826g-first-vercel-deploy-silent-failures.md](260826g-first-vercel-deploy-silent-failures.md) — four bugs in the
  same deployment, same shape; this is the fifth, in the file written to stop the first four
- [silent-success.md](../reusable/silent-success.md) — reporting a value is not having an opinion
  about it
- [260826u-pdf-upload-and-storage.md](../plans/260826u-pdf-upload-and-storage.md) — the plan, and the readiness table
  that checked the laptop
- [ingest-queue.md § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf) — what the reader
  was trying to do
