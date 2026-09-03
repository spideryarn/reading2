# The bucket allowlist drifted again, and the check we built last time answered about the laptop

**Found 2026-09-03**, from the first live use of the Illustrated diagram sub-mode
([diagram.md](../project/diagram.md)):

> I had a problem with the new "Illustrated" Diagram sub-mode:
>
> ```
> Storage put failed (415): mime type image/jpeg is not supported
> ```
>
> It's showing the prompts, but no image.
>
> — Greg, 2026-09-03

The missing plate is the smallest thing in this write-up. The same 415 has been silently refusing
**every image of every article ingested on production since 2026-08-30**, inside a step that catches
it, reports success and leaves the image hot-linked to the publisher.

And the check built to detect exactly this, after exactly this bug, one month ago, was wired to
nothing — and could not have been pointed at production if anybody had thought to run it. It
returns a green tick about the Docker container on your laptop.

## What is actually true, measured

`GET /storage/v1/bucket` against the project in `.env.prod`, read-only, 2026-09-03 from the Mac:

```json
{ "id": "sources", "public": false, "file_size_limit": 52428800,
  "allowed_mime_types": ["application/pdf", "text/html"] }
```

[`supabase/config.toml:195`](../../supabase/config.toml) has declared five since 2026-08-29:
`application/pdf`, `text/html`, `image/png`, `image/jpeg`, `image/gif`. `bucketDrift` on those two
inputs says `bucket "sources" does not accept image/gif, image/jpeg, image/png`.

So every image upload to production 415s, and has since the day production could ingest at all.

## The blast radius, which is not the plate

`assets` is in `DEFAULT_INGEST_STEPS` ([`src/pipeline.ts:282`](../../src/pipeline.ts)), and the
comment above it says why it is not optional:

> an article whose images are still hot-linked to the publisher announces the reader's IP to that
> publisher on every single read. That is the privacy leak this step exists to close, so closing it
> cannot be something somebody has to ask for.

It reaches Storage by the identical `CONTENT_TYPE` → `putIfAbsent` path the plate does, so it has
been taking the identical 415 — and swallowing it. In
[`src/collect-assets.ts`](../../src/collect-assets.ts):

```ts
const reason = reasonFor(err);            // :637
if (reason) { … fail(url, reason); return; }
storageErrors.push((err as Error).name || "Error");   // :657
fail(url, "storage");
```

`reasonFor` (`:552`) only classifies a `FetchFailure`; a Storage refusal is a plain `Error` built by
`fail()` in [`src/store/blobs-supabase.ts:91`](../../src/store/blobs-supabase.ts), so it returns
`null` and falls through. `.name` on a plain `Error` is the string `"Error"`. The image is marked
failed, left hot-linked, and the step returns `` `${run.stored} images stored, ${run.failed} left
hot-linked` `` — a success detail. The only trace anywhere is one pino line
([`src/pipeline.ts:2073`](../../src/pipeline.ts)) carrying:

```
storageErrors: ["Error"]
```

No status, no message, no URL, deduplicated to one element however many images failed. **A
repo-wide configuration break and a flaky publisher produce the same log line.** That is the whole
reason four days passed.

The window opens 2026-08-30 — production ingest was itself broken until then, so nothing was
uploading before that — and closes when the bucket is repaired. Spideryarn has had paying readers
since 2026-09-03. The step whose entire purpose is to stop a reader's IP reaching the publisher on
every read has not been doing it for any article ingested in that window.

## How the gap opened

**[`e5f421c1`](../../supabase/config.toml), 2026-08-29**, "The comment said the allowlist was not
enforced, and the probe that proved it had measured the filesystem", is the introducing commit. It
widened `config.toml` to five types and PATCHed the local bucket by hand. It is a careful commit —
it ran `check-buckets` *before* the change and watched it fail naming exactly the three missing
types, on the explicit grounds that "a drift detector that has never been seen to fire is not
evidence that there is no drift" — and it says the remaining half out loud:

> Local bucket only. The remote project is a separate, authorised step and has not been touched.

So this was not forgotten in the moment. It was correctly identified, correctly deferred, and then
lost — and it stayed lost because nothing in the repo can carry a deferred manual act. Where it was
lost is visible in the plan it was built from:

| [`260829b-hosting-the-articles-images.md`](../plans/260829b-hosting-the-articles-images.md) | what it says |
|---|---|
| § trap 2, `:410` — the list you **read** | adding image types is a PATCH to the live bucket, "**locally and on the remote project**, by hand" |
| § Build order, step 3, `:585` — the list you **work through** | "Run `scripts/check-buckets.ts`; widen the `sources` MIME allowlist by hand, **locally**; run it again." |

The trap list had it right and the build order dropped half of it. Nobody works through a trap list;
you read it once, at the start, and then you execute the numbered steps. The remote half fell into
the gap between the two and there is nothing anywhere else to catch it: **no script in this tree
issues a bucket write at all**, and `git log --all -S"storage/v1/bucket" --since=2026-08-28` returns
exactly one commit, `7527ff1a` — the plan doc written about this bug today. No code.

## The check that was supposed to prevent this

[260828a-the-config-file-is-not-the-bucket.md](260828a-the-config-file-is-not-the-bucket.md), one
month earlier, is the same drift on the other environment. It named the class, recommended a
check, and the check was built the same day: `bucketDrift` and `declaredBuckets` in
[`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts), fronted by
[`scripts/check-buckets.ts`](../../scripts/check-buckets.ts). Both halves were watched saying yes —
the pure function against fixtures for every kind of difference, the script against the real
container put back into the broken state.

It is a correct check. It is also, today, the reason nobody found this, in two separate ways.

**It runs when somebody remembers, and nothing else.** `check-buckets` appears in no `package.json`
script, no test, no hook and no deploy step; a repo-wide grep finds it only in its own header, in two
source comments, and in prose — plans and docs telling a person to run it. `deploy.ts` imports twenty-one names from
`deploy-checks.ts` — every judging function in that file except `bucketDrift` and `declaredBuckets`,
which sit in the deploy's own checks module, tested, and are never called by the deploy. 260828a listed
that caller as one of three, and said honestly: "Two of the three callers below are still to come."
They never came.

**And it cannot be aimed at production.** `check-buckets.ts` calls `loadEnvLocal()`, and `.env.local`
deliberately beats the shell environment ([`src/env.ts`](../../src/env.ts) — and the reason is a good
one: a `~/.zshrc` export and a deliberate `FOO=x npm run …` look identical to a child process). So
the invocation documented in the script's own header, aimed at a remote project, does this —
reproduced 2026-09-03, not reasoned:

```
$ SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod key> npx tsx scripts/check-buckets.ts
[env] .env.local overrode SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from the shell environment.
Declared: sources
Running:  sources

✓ every declared bucket matches the running project     # exit 0 — against 127.0.0.1:54361
```

Anyone who ran the check to ask whether production had drifted was told it had not. It printed a
verdict and no target. Its header says "Pointing it at production is the intended use, not the
accident to prevent", so the file is confidently wrong about itself.

The repo had **already solved this precedence trap twice** and `check-buckets` did not get the fix:
`readEnvProd` in [`src/env.ts`](../../src/env.ts) is the shared escape hatch, and
[`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts) documents this precise
trap in its own header. Both predate the day it mattered.

## The class

The plan proposed **"a declaration that no running system reads"**. That is true, it is 260828a's
name, and it is not the class — it is the *standing condition*. `config.toml` has described a bucket
nothing reconciles since the day it was written; that hazard was named a month ago, correctly, and
naming it prevented nothing. A class name that has already failed to prevent its own recurrence has
not earned another outing. Two sharper things happened here, and they are genuinely distinct.

**Class 1: an instrument that cannot be aimed at what it measures, and passes instead of refusing.**
The failure is not that the check was absent or wrong. It was present, correct, tested, and it
answered a question nobody asked, in the affirmative. That is worse than having no check, because a
check that exists retires the worry: the question "has production drifted?" was answerable in one
command that returned a tick. The tell is structural and greppable — **a check that takes a target
and prints only a verdict.** The remedy is equally structural: any check with a target must print
the target it actually reached, above the verdict, and must fail closed when it cannot reach the one
it was named. This is a specimen from the second table in
[silent-success.md](../reusable/silent-success.md) — the checking apparatus lying rather than the
product — and it is the sharpest one we have, because the instrument was built by the postmortem for
the very bug it then failed to see.

**Class 2: a required manual act recorded in the list that is read, not the list that is worked.**
Trap lists are read once; build orders are executed line by line. Anything that must happen and
cannot be executed by a machine has to live in the list somebody ticks off, or it has a half-life.
Here trap 2 said "locally *and on the remote project*" and build order step 3 said "locally", and
the commit dutifully did what the build order said, and said so. The remedy is not "read the traps
more carefully": it is that a manual act gets its own numbered build-order item with its own
verification, or — better, and what stage 1 does — stops being manual.

The two compose into the actual mechanism, and neither alone explains it: **the manual half was
dropped, and the only instrument that could have noticed answered about a different machine.**

There is a third thing, which is not a class but a process fault, and it is the most valuable
sentence here.

## A postmortem's recommendation is not done when the artefact exists

260828a's recommendation was implemented — into a script that ran only when somebody already
suspected the bug, and that gave the wrong answer when they did. Every individual step was done
well. The function is pure, the tests are real, the drift was watched being caught. What was never
done is the only thing that matters: **something runs it, unbidden, against the target that broke.**

A detector you have to remember to run is a detector for a bug you already suspect, and by then you
do not need it. 260828a even recorded the shortfall — "two of the three callers are still to
come" — and that honest note is exactly where the class recurred. So the rule this repo should carry
out of here:

> A postmortem recommendation is open until something runs it without being asked, against the
> environment the bug happened in. A merged artefact closes nothing.

The corollary is a review question worth asking of any new guard: *what invokes this, and what does
it say when it is pointed at the wrong thing?* Both answers here were available on day one.

## What would have caught the whole class, ranked

Ranked by ease against value. Items 1–3 are stage 1 of
[260903j-illustrated-415-and-one-click-paint.md](../plans/260903j-illustrated-415-and-one-click-paint.md);
4 and 5 are recommendations.

**1. Make the check print its target and be able to reach production. (Cheapest, and everything else
depends on it.)** `check-buckets.ts` gains `--prod` through the existing `readEnvProd`, refuses a
`localhost` URL under that flag, and **always prints the project host it reached above the
verdict**. The mechanism already exists twice in the repo, so this is reuse, not design. It is first
not because it is the biggest but because every other item is unsafe or useless without it: a repair
path bolted onto the current environment handling PATCHes the laptop while printing that production
is fixed, which is
[database.md § `DATABASE_URL=… npm run db:migrate` does not do what it looks like](../project/database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like)
with a different noun.

**2. Wire `bucketDrift` into `scripts/deploy.ts`. (Nearly free — the function is pure and already
tested — and it is the one that would have caught *this*.)** Any deploy after 2026-08-29 would have
refused. This is the caller 260828a named and did not build, and it is the item that converts the
guard from "somebody remembers" to "nobody can avoid it". Its cost is a handful of lines beside
the twenty-one other names `deploy.ts` already imports from that module and wires the same way.

**3. Make `storageErrors` say what failed. (One line; it prevents nothing and shortens
everything.)** `(err as Error).name` is `"Error"` for every Storage refusal. Carrying the message and
the status instead — no URLs, nothing sensitive — turns four days of invisible repo-wide breakage
into one log line that names itself, and it does that for every future cause of a Storage failure,
not just this one. It is ranked below 2 because it is detection-after-the-fact rather than
prevention, and above 4 because it costs almost nothing and generalises furthest.

**4. A repair path (`--apply`) so widening a bucket is a typed command. (Moderate cost, and it
closes the gap that opened this.)** The reason the settings drifted is that applying a declaration is
a `curl` reconstructed from a doc by a person under time pressure — two acts where there should be
one. A flag somebody types is still the deliberate security decision 260828a insisted on; what it
removes is the reconstruction. **Must land after item 1**, or it writes to the wrong project and
reports success.

**5. The close-out rule above, applied to postmortems. (Free; costs discipline, which is why it is
last.)** Ranked last on reliability rather than on value — habits are the weakest prevention we
have. But it is the only item that addresses the *history* rather than this instance, and it is
cheap to try: when a postmortem's recommendation is marked built, name the thing that will invoke
it, or say plainly that nothing does.

**Not recommended: make a Storage failure fail the `assets` step.** It sounds like the obvious
answer — the error is being swallowed, so stop swallowing it. But "one image must never fail the
step" is a deliberate design decision and a right one: a single publisher serving one odd image
would then break the whole ingest, which trades a privacy leak for a total outage. Item 3 gets the
visibility without the trade.

## A near-miss inside this write-up, which is the same class again

The first draft of the production finding rested on the bucket's `created_at` and `updated_at` being
equal (`2026-08-27T16:56:50.520Z`), read as proof it had never been modified. That inference is
false and was caught before it landed. Supabase Storage does not bump `updated_at` when a bucket is
PATCHed — measured against the *local* bucket, which has demonstrably been modified in place (widened
by hand on 2026-08-29, and reading all five types today) yet shows equal timestamps too, with a
`created_at` predating the widening so it was not recreated either.

**A field that never moves and a field that did not move look identical.** Reaching for a timestamp
as proof of absence, without first checking the field moves when the thing happens, is the
postmortem's own lesson landing on the person writing it up. The finding never needed it: the drift
is directly measured `allowed_mime_types`, and the reason for it is the commit message and the plan.

## See also

- [260828a-the-config-file-is-not-the-bucket.md](260828a-the-config-file-is-not-the-bucket.md) — the
  same drift, one month earlier, on the local container
- [260903j-illustrated-415-and-one-click-paint.md](../plans/260903j-illustrated-415-and-one-click-paint.md) — the fix
- [260829b-hosting-the-articles-images.md](../plans/260829b-hosting-the-articles-images.md) — the
  work whose build order dropped the remote half
- [deployment.md § The `sources` bucket has to exist on the remote too](../project/deployment.md#the-sources-bucket-has-to-exist-on-the-remote-too)
- [silent-success.md](../reusable/silent-success.md) — the family, and the table this belongs in
