# Illustrated: the 415 that ate every plate, and one press that draws then paints

Status: **planned**. Worktree `illustrated-415-and-one-click`, 2026-09-03.

Two things Greg asked for after the first live use of the
[Illustrated](../project/diagram.md#illustrated) sub-mode:

> I had a problem with the new "Illustrated" Diagram sub-mode:
>
> ```
> Storage put failed (415): mime type image/jpeg is not supported
> ```
>
> It's showing the prompts, but no image.
>
> Also, let's have a way to generate it in one click even if there's no Sketch ready yet (it should
> first trigger that and then append the Illustrated to the queue after it automatically in one
> click).
>
> — Greg, 2026-09-03

They are unrelated in the code and are separate stages. The first is a **repeat of a class we have
already written up once** and did not prevent; the second is a **product decision that reverses a
decision made yesterday**, which is Greg's to make and he has made it.

## Part one: the 415

### What the reader saw, and why the picture is the only thing missing

`storePlateImage` (`src/illustrated-image.ts:64`) throws; the per-plate loop in
`src/pipeline.ts:3057-3069` catches it and calls `plateFailed`, which drops the image and keeps the
server's sentence. `IllustratedView.tsx:185` then renders that sentence where the plate would be,
and everything around it — the vignette list, and the `<details>` "What the illustrator was asked
for" — comes from the artefact rather than the bytes. Hence *prompts, no image*, per plate, with the
run still recorded as `N painted, M failed`.

**That behaviour is correct and is not what this stage changes.** Keeping the paid-for brief when
the bytes cannot be stored is the design (`tests/illustrated-step-registration.test.ts:436` pins
it). What is wrong is that the store refused the bytes at all.

### The cause: the bucket, not the code

`CONTENT_TYPE.jpeg` is `"image/jpeg"` (`src/store/blobs.ts:120`), the key ends `.jpeg`, and the
bucket's `allowed_mime_types` is what decides. Measured 2026-09-03 on the Hetzner box's local
Supabase (`http://127.0.0.1:54361`):

```
POST /storage/v1/object/sources/sha256/<hash>.jpeg  Content-Type: image/jpeg  → 200
bucket sources: ["application/pdf","text/html","image/png","image/jpeg","image/gif"]
```

So local is fine, and `scripts/check-buckets.ts` agrees. **Greg saw the 415 on production.**

The production bucket was created by hand on 2026-08-27 with
`allowed_mime_types: ["application/pdf","text/html"]` — the exact `curl` is quoted in
[deployment.md § The `sources` bucket has to exist on the remote too](../project/deployment.md).
The three image types were added to `supabase/config.toml` and **to the local bucket by hand** on
2026-08-29 (`docs/plans/260829b-hosting-the-articles-images.md` stage 3). Nothing in this repo
applies a config change to a bucket that already exists, and nothing in the deploy runs
`check-buckets`. So the strong hypothesis is: **the production `sources` bucket is still
`{application/pdf, text/html}`**, and has been since 2026-08-29.

**This is the same class as
[260828a-the-config-file-is-not-the-bucket.md](../postmortems/260828a-the-config-file-is-not-the-bucket.md),
happening a second time, in the same month, on the other environment.** That postmortem named the
class and recommended a check; the check was written and never wired to anything. That is the part
this plan fixes.

**The repo evidence is unanimous.** Commit `e5f421c1` (2026-08-29), which widened the allowlist,
says so in its own message: *"Local bucket only. The remote project is a separate, authorised step
and has not been touched."* Plan `260829b` § trap 2 (`:410`) had said the change must be made
"locally **and on the remote project**, by hand"; the build order at `:585` says only "locally", and
the remote half was dropped in between. No write to a remote bucket is recorded anywhere in the
repo after the 2026-08-27 `curl` that created it with `["application/pdf","text/html"]` —
`git log --all -S"storage/v1/bucket"` since 2026-08-28 returns no commits, and no script in the tree
issues a bucket write at all.

**Confirmation is one read and I cannot do it from this box** — there is no production service key
here, and the MCP Supabase server is pointed at the *local* project (`get_project_url` →
`http://127.0.0.1:54361`), which is how a first pass at this mistakenly reported production as
healthy. Greg runs one command, or pastes the answer:

```bash
SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod key> npx tsx scripts/check-buckets.ts
```

**And `assets` — which is in `DEFAULT_INGEST_STEPS` — has been failing the same way, silently, on
every article ingested on production since 2026-08-30** (production ingest was itself broken until
that day, so the window starts there rather than at 2026-08-29). It reaches Storage through the
identical `CONTENT_TYPE` → `putIfAbsent` path (`src/collect-assets.ts:623`), and it **catches the
error and carries on**: `reasonFor(err)` returns null for a Storage error, so `collect-assets.ts:636`
pushes the error's *name* — `"Error"` — onto `storageErrors`, marks the image `failed`, and leaves it
hot-linked. The step reports success, `"N images stored, M left hot-linked"`. The only trace is one
pino line carrying `storageErrors: ["Error"]` with no status, no message and no URL.

So a production-wide 415 looks exactly like publisher flakiness, and the step whose whole purpose is
to stop a reader's IP reaching the publisher on every read has not been doing it. **That is a bigger
deal than the missing plate**, and it is why this stage is first. It also adds one thing to stage 1:
`storageErrors` must carry the failure's **message** rather than its constructor name — same rule as
ever, nothing sensitive, no URLs, but a status code that says which of "the publisher" and "us" the
problem was.

### What changes

1. **A repair path.** `scripts/check-buckets.ts` gains `--apply`: it PATCHes the running bucket to
   match `supabase/config.toml`, prints the before and after, and refuses to do anything without the
   flag. Read-only stays the default. The existing doc says repair is deliberately absent because
   *"widening an allowlist is a security decision, not a side effect of running a check"* — a flag
   somebody types **is** that decision, and the alternative is a `curl` reconstructed from a doc
   under pressure, which is how the settings drifted in the first place.
2. **A deploy gate.** `scripts/deploy.ts` runs `bucketDrift` against the target project and refuses
   to deploy on drift. `bucketDrift` is already pure and already tested; this is wiring, and it is
   the prevention the last postmortem asked for.
3. **A test that would have caught it**, red first: the deploy check list must include the bucket
   check, and `bucketDrift` must report a missing MIME type as drift (assert the case that actually
   happened, not a synthetic one).
4. **The postmortem**, `docs/postmortems/260903f-the-bucket-allowlist-drifted-again-on-production.md`,
   written *before* the fix lands and naming the class: **a declaration that no running system
   reads.** Its recommendations are ranked, and the top-ranked one is stage 1 itself.

Not changing: the reader-facing sentence. `Storage put failed (415): mime type image/jpeg is not
supported` is ugly, but it is the sentence that let Greg diagnose this in one message, and the
alternative — a friendly generic — is the failure mode this repo keeps writing up.

## Part two: one press that draws the Sketch and then paints

### What it reverses

Yesterday's plan refused this deliberately, and the reasoning is quoted in `IllustratedView.tsx:227`:

> Not `enqueue(["sketch", "illustrated"])`, which turns one press into a hidden $0.20 charge and a
> three-minute wait that nothing warned about.

Greg has asked for the chain anyway. **The objection was never to the chain — it was to the
hiding.** So the chain lands and the price does not: the button says what both steps cost and how
long both take, before the press, which is the rule the empty state already follows for the single
step (`ILLUSTRATED_PRICE`, `ILLUSTRATED_WAIT`).

### The design

The pipeline already supports it. `STEP_ORDER` puts `illustrated` immediately after `sketch`, and
its comment says exactly what this needs: *"What the order buys is that a run naming both draws
before it paints"* (`src/pipeline.ts:211-217`). `orderSteps` sorts by that array, one job holds many
steps, and `POST /api/jobs { slug, steps: ["sketch", "illustrated"] }` is already a legal request.

So the whole change is on the client:

- `useStepJob.start` hardcodes `steps: [step]` (`src/web/useStepJob.ts:447`). It gains an optional
  set of **preceding** steps — named, not positional, and ordered by the server — so the illustrated
  view can ask for both. Nothing else's behaviour changes.
- `IllustratedView`'s `Empty` gets a fifth branch. The three refusal branches (`absent`, `stale`,
  `profile-changed`) stop being dead ends: each keeps its explanatory sentence and **gains a
  button** — *"Draw the Sketch, then paint"* — carrying the combined price and wait. The "press the
  chip one to the left" sentence stays as the other route, because a reader who wants to look at the
  Sketch first is not doing anything wrong.
- **`stale` and `profile-changed` need the Sketch re-drawn, not adopted.** The Sketch's own `stamp`
  already reports it out of date in both cases, so a plain `steps: ["sketch", "illustrated"]` re-runs
  it; this is asserted in a test rather than assumed, because "the stamp will notice" is precisely
  the kind of shared assumption `silent-success.md` is about.
- `JobProgress` gets a two-step job. Its `step` prop decides what it labels and watches; the plan
  keeps `step="illustrated"` (the thing the reader asked for) and the stage's done-condition
  includes: while the Sketch half runs, the band shows progress rather than a dead spinner or a
  button that looks pressable.

### What it costs, said out loud

Sketch is 121–194 s measured and the dearer half of the wait; Illustrated is $0.27–$0.40 and four to
seven minutes. The combined sentence uses the numbers already in `SketchView`/`IllustratedView`
rather than new hardcoded ones, so it cannot drift from the single-step copy.

### The simpler option passed over

Auto-arming the Sketch chip and then the Illustrated chip from the client — two jobs, two POSTs,
client-side sequencing. Rejected: it puts the ordering in the browser, where a closed tab loses it,
when the server's `STEP_ORDER` already does it correctly for free.

## Stages

Each ends green and committable.

1. **Postmortem + the bucket gate.** Postmortem written; `--apply` added to `check-buckets`;
   `bucketDrift` wired into `scripts/deploy.ts`; tests red-then-green; docs updated
   (`deployment.md`, the `blobs.ts` comment, `260828a`'s "what would have caught it"). Greg runs the
   read-only check against production and, if it drifts, `--apply`.
2. **One-click chain.** `useStepJob` preceding steps; `IllustratedView` refusal branches gain the
   button and the combined price; tests for all three refusal kinds and for the in-flight state.
3. **Browser + docs.** Drive a real browser on this box (Playwright, per `browser-control.md`):
   paint an article with no Sketch in one press, watch both steps run, see a plate. Update
   `docs/project/diagram.md` § Illustrated and the `IllustratedView` header comment that currently
   states the opposite decision. Final GPT Sol review of the code.

Done means: a plate renders on production for an article that had no Sketch, from one press.
