# Improve the codebase — the 2026-09-06 sweep

The fourth run of [improve-the-codebase.md](../reusable/improve-the-codebase.md), **one day** after
[260905b](260905b-improve-the-codebase-third-sweep.md) and against a tree that took **140 non-merge
commits** in between. Read that one first: this sweep starts where it stopped, and its Stage 2 —
six class-killers, scored and staged as *"the next job"* — is the largest single thing this run has
to report on.

**The headline is a number that did not move.** All six of `260905b`'s T2.1 class-killers are still
unbuilt today, re-verified against this tree rather than taken from that plan's word. So are
`sweepAbandonedDrafts` (T2.2) and both of its Tier 3 items. In the same twenty-four hours,
`src/routes.ts` grew 423 lines and `src/web/styles.css` grew 3,056.

That is not a finding about anybody's diligence. It is the third consecutive sweep to write down
that the *generalizing* step waits while the tree moves, and this run is the first one able to say it
with a **one-day** control: nothing about these six is hard, and nothing about them is contested.
They were simply not the thing anybody was doing.

**The one place this run adds new evidence rather than re-counting old** is T2.1 below: a
containment mechanism built on 2026-09-05, given one adopter out of thirteen, and then not extended
when the very next commit wired the app's most expensive mode into the path it does not protect.

## Scope line

**Swept:** `src/` (all), `tests/`, `scripts/`, `evals/`, `api/`, `styles/`, `docs/project/`,
`docs/plans/`, `docs/postmortems/`, `package.json`, `biome.jsonc`, `knip.jsonc`, `.gitignore`,
`.env.example`, and the agent memory directory. Seven breadth agents — four by lens (what the code
says about itself in its newest writing; duplication and rival mechanisms; inert defences and dead
code; knowledge stranded in commit bodies and memory) and three by zone (the web client; the
server/pipeline/store; the tests and the type system) — then verification by hand of every claim
carried below.

**Not swept, and blind to:** the remote database (out of scope for an unattended run, per AGENTS.md);
anything visible only in a browser; concurrent transactions and races; provider streams that end
without throwing. A static sweep finds none of those.

**One method note, because it changed a finding.** Two agents' strongest claims were partly wrong in
opposite directions, and both were caught only by re-deriving them here — see § *Every finding is a
claim, including this sweep's* at the foot. Nothing in the tiers below rests on an agent's word
alone.

## Baseline, measured on this tree

At `84521f3b`, in the primary checkout, 2026-09-06.

| | 2026-09-05 (previous sweep) | today |
|---|---|---|
| `src/routes.ts` | 7,757 lines | **8,180** (+423 in one day) |
| `src/web/styles.css` | 12,830 | **15,886** (+3,056 in one day) |
| `src/web/App.tsx` | — | 6,013 |
| knip unused files | 12 | **14** |
| knip unused exports / types | 141 / 122 | **185 / 139** |
| source files invisible to `grep` | 5 | **0** ✅ |
| `260905b` T2.1 class-killers built | — | **0 of 6** |

**The NUL-byte class is closed, and it is the one unambiguous win since yesterday.**
`tests/no-raw-nul-bytes.test.ts` exists and the tree has zero raw NUL bytes
(`git ls-files | while read f; do LC_ALL=C grep -qP '\x00' "$f" && echo "$f"; done` → empty).
That class had recurred three times across two sweeps while it was a paragraph in a doc; it stopped
recurring the day it became a test. **This is the whole argument of `260905b` demonstrated once,
cheaply, and it is why the tiers below prefer a check to a sentence every time.**

`npm test` was **not** run at the start. Load average was 37 with seven agents and a dozen worktrees
live, which is the condition [260903d](260903d-improve-the-codebase-second-sweep.md) showed makes a
red result meaningless. It was run at the end instead, and the result is worth writing down as a
worked example of that same condition:

```
Test Files  9 failed | 746 passed | 1 skipped (756)      — 3,725s, load ~100
```

**Nine red; one of them real, and it was mine.** Every one was re-run alone before being believed or
dismissed, which is the only reason the split is known:

| | files | verdict |
|---|---|---|
| `step-failure-seam`, `chat-anchor`, `export-route`, `admin-store`, `extraction-scorer`, `hierarchy-deepen-wave` | 6 | **contention** — all pass one file at a time on this tree, 138 tests green |
| `cold-start-lazy-imports`, `pdf-bundle-trace` | 2 | **missing build** — both fail on *"has a build to inspect"*, the empty-`dist/` condition a fresh worktree always has and which [260905b](260905b-improve-the-codebase-third-sweep.md) hit in these same two files. Pass after `npm run build` |
| `eager-client-graph` | 1 | **a real regression, introduced by T1.5 in this sweep** — see there. Fixed |

The first draft of this paragraph said "not one of them a real failure", which was written before the
re-runs finished and was false. It is left visible rather than quietly corrected, because a batch of
reds that is *mostly* noise is the exact condition under which the one real failure gets waved
through — and this document's own § *Every finding is a claim* is about claims made in the
comfortable direction.

An earlier attempt at the same run was **SIGTERM'd at load 200** after 257 files with zero failures —
`EXIT=143`, which `scripts/tmux-job.ts` exists to make distinguishable from a pass. Believing either
of those two runs without re-running the reds one at a time would have produced a false report in
opposite directions: the first says nine things are broken, the second says nothing is.

---

# Tier 0 — live defects

**None.** Said plainly rather than left to inference: nothing found this run is breaking a reader's
request today.

Two items below are reader-facing and one of them spends money, so the temptation to promote them
was real and is recorded as refused. T2.3 (`PublishRefused` offering a retry that cannot help) needs
a refusal to happen first, and the specific outage that made it acute on 2026-09-05 **was
structurally fixed** the same day. T2.1 (twelve uncontained modes) needs a throw. Both are latent,
both are proved, neither is firing.

---

# Tier 1 — cheap, mechanical, evidence in hand

## T1.1 · `npm run lint` still cannot tell you that its config was read ✅ built in this sweep

**Evidence: reproduced**, here, today — which is the one thing `260905b` did not have when it scored
this as its highest-value class-killer (its item **b**).

[linting.md](../project/linting.md#the-file-is-biomejsonc-and-the-extension-is-load-bearing) records
the incident (a comment in a file named `biome.json` silently drops the rest of the config; 83
warnings the config switched off reappeared), records the tell, records a detection command — and
that command is wired into nothing. `package.json`'s `lint` script is still
`biome lint --max-diagnostics=none .`, unchanged.

Reproduced in a scratch directory with a two-rule config, taking care to read **biome's** exit code
rather than a pipe's:

| | exit | the `noExplicitAny` finding |
|---|---|---|
| config present | **1** | reported as an error |
| config renamed away | **0** | reported as an *info*, and the command passes |

So a lost config does not merely lose rules: it silently downgrades errors to advice and the gate
goes green. Every lint-shaped fix in this codebase — the import-cycle rule, `noFloatingPromises`,
and T2.2's proposed sanitiser rule — sits on top of that.

**And there is a second, dated reason to build it now.** `npx biome rage` reports, against today's
config:

```
Biome Configuration:
  Error:   The use of the recommended field has been deprecated, and will removed
           in the next major version of Biome. Use preset instead.
  Status:  Loaded successfully.
  Path:    biome.jsonc
```

`npm run lint` prints none of that (`grep -ci deprecat` over its output → 0). `"recommended": true`
at `biome.jsonc:85` is the field the whole rule set hangs from, and the next major version removes
it. That is this exact class with a delivery date on it.

**The fix is a test, not a script line**, and that is a change from `260905b`'s sizing. `biome rage`
answers the question directly and machine-readably, so the guard asserts `Status: Loaded
successfully`, the `Path`, and — the part that makes it more than a smoke test — that a rule this
repo deliberately turns **off** is actually off, which is a claim only a live config can satisfy.

> **A note that belongs here rather than in a postmortem.** linting.md's own paragraph warns *"don't
> pipe it through `tail`, which is how this was missed for half an hour"*. The first attempt at the
> reproduction above did exactly that, read `tail`'s exit code, and recorded `exit=0` for both arms —
> the wrong answer, in the direction that would have killed the finding. The doc said so; the doc was
> not enough. That is `260905b`'s transmission argument arriving unprompted inside the work of acting
> on it.

## T1.2 · A failure code two files emit is registered nowhere, and the test built to catch that cannot see it ✅ built

**Evidence: proved from the code.**

`ai-unusable` is emitted at `src/referee-claims-run.ts:180` and `src/referee-criteria-run.ts:456`.
It is **not** in `CODE_KINDS` (`src/messages.ts:273`) — read the whole map to confirm rather than
grepping for it.

Both files say so themselves, in comments dated before this sweep:

- `referee-claims-run.ts:171` — *"steps to pay it: export it there **and** register `ai-unusable` in `CODE_KINDS`."*
- `referee-criteria-run.ts:444` — *"both matter: export it there, **and register `ai-unusable` in
  `CODE_KINDS`**"*

and [260902e](260902e-codebase-rework-umbrella-what-is-worth-doing-next.md) already recorded it as
known debt on 2026-09-02. Four days, three written reminders, no registration.

**Today the consequence is benign, and that is the interesting part.** `kindOfMessage` returns
`null`, `failureKindOf` returns `undefined`, and `?? "retry"` supplies `retry` — which happens to be
the right answer, because the sentence says *"asking again usually works"*. The code is correct by
coincidence of a default, not by declaration.

**The class-killer is the second half, and it is why this is not just two lines.**
`tests/messages.test.ts` builds its universe from `import * as messages from "../src/messages.js"`
(`:11`, `:156`) — so it can only ever check codes that `messages.ts` itself exports. A code minted
in `referee-*-run.ts` is invisible to the one test whose job is this invariant, which is why three
written reminders were needed at all. A source-scan test over `src/` for the bracketed-code idiom
makes the next one impossible. The precedent for a static test of this shape is already in the tree
(`tests/no-raw-nul-bytes.test.ts`, `tests/client-imports.test.ts`) rather than something to invent.

### And the two "mechanical steps" were never two steps, which is the actual answer

**This was found by building it, and it is the most useful thing in this section.** Adding the table
entry alone turned an existing assertion red. `messages.test.ts` asserted
`codes(EVERY) === keys(CODE_KINDS)` — an equality, checking both directions at once — and the
reverse direction silently required that **every registered code's sentence live in `messages.ts`**.
`ai-unusable`'s does not.

So the cheap half could not land on its own. Satisfying that equality meant first moving
`CLAIMS_UNUSABLE` and `ANSWER_UNUSABLE` into `messages.ts`, which means changing them from bare
strings to `ReaderFacingFailure` objects, which ripples to both `throw` sites and to `routes.ts`.
**Three agents wrote "two mechanical steps" and every one of them was wrong about the second being
mechanical** — that is why four days of reminders produced nothing, and no amount of re-reading the
reminders would have revealed it.

The fix taken: split the equality into a **subset** assertion in `messages.test.ts` (a message here
must have a table entry) and move the **no-orphan** direction into the new tree-wide test, where the
universe is `git ls-files src` instead of one module's exports. An orphan is now caught wherever its
sentence lives, and all 81 keys pass it. Moving the two constants into `messages.ts` remains the
right end state and is Tier 2, not this stage; it belongs with [copy.md](../project/copy.md)'s own
batch, which already owns that decision.

Every direction was watched red before being made green: removing the registration named both
sites, a bogus `ai-nobody-writes-this` was reported as an orphan, and so was a bogus `jb-orphan`.

### The first version of this was a weakening, and the review caught it

**Recorded because the claim it corrects is the kind this document exists to be careful about.**
The first cut of the tree-wide orphan check filtered to the `ai-` family, matching the assertion
above it. That silently dropped orphan cover for the other 47 entries in `CODE_KINDS` — GPT Sol's
counter-example was `"jb-orphan": "bug"`, which passed both the new test *and* the loosened
assertion in `messages.test.ts`. So the "nothing that was checked is now unchecked" claim was
**false as first written**, and is true only of the widened version that shipped.

It is the same shape as the three errors at the foot of this document: a claim about coverage,
checked against the case that motivated it rather than against the case that would break it.

## T1.7 · Two different sentences share one failure code ✅ found by the review

**Evidence: proved from the code.** Found by GPT Sol while reviewing T1.2's guard, which is worth
saying plainly: the guard was written, watched red, watched green, and is blind to this.

`CLAIMS_UNUSABLE` (`src/referee-claims-run.ts:177`) and `ANSWER_UNUSABLE`
(`src/referee-criteria-run.ts:453`) are **two different sentences ending in the same
`[ai-unusable]`**. `messages.test.ts` holds a "gives each distinct message its own code" invariant
for the sentences it can see; these are the sentences it cannot, so nothing was enforcing it here.

Left as a finding rather than fixed, deliberately: unifying the two sentences or minting a second
code both change what a reader is shown, which is [copy.md](../project/copy.md)'s decision and not a
sweep's to take unasked. It should be settled at the same time as moving the two constants into
`messages.ts`, since that move forces the question anyway.

**And registering the code turned out not to be pure bookkeeping**, which is the second thing the
review found. `authored()` in `src/monitoring-scrub.ts` is `kindOfMessage(message) !== null`, so a
message carrying a registered code now has its **full text forwarded to Sentry** rather than
withheld. Correct for these two — both are fixed literals with nothing interpolated — and noted at
the `CODE_KINDS` entry itself, because the next sentence given this code must stay free of article
prose. `monitoring-scrub.ts` justifies its allowlist by *"`tests/messages.test.ts` round-trips every
sentence in that file"*, and these two sentences are not in that file: the justification now has a
hole exactly the width of this code.

## T1.3 · knip has been telling us to delete a config entry, in its own output ✅ built

**Evidence: reproduced.** `npx knip` ends with:

```
Configuration hints (1)
playwright-core    knip.jsonc  Remove from ignoreDependencies
```

`knip.jsonc:106` ignores `playwright-core` on the stated grounds that it is reached only through a
runtime `createRequire` in `scripts/remote-smoke-browser.mjs`, which knip cannot resolve. That was
true when written. It is not true now — `scripts/measure-annotation.ts:140` has a plain static
`import { chromium } from "playwright-core"`, and `scripts/browser-sign-in.ts:74` a static type
import — so knip resolves it without help and the entry suppresses nothing.

A dead ignore is worse than none: it is exactly the shape that hides a *real* unused dependency
later. Delete the entry and the comment that argues for it.

## T1.4 · A doc comment points at a function that does not exist ✅ built

**Evidence: reproduced.** `src/routes.ts:694` says *"`servePublicAsset` in src/public/routes.ts says
why."* `git grep -n servePublicAsset -- src tests scripts api` returns **that comment and nothing
else**. The mechanism is `sendBytes` plus the `asset` case in `ASSET_READS`
(`src/public/routes.ts:155`, `:278`). The `no-store` claim the sentence makes is itself correct; only
the signpost is dangling. One line.

## T1.5 · The residue `260905b` recorded, re-verified — one shrank, one stands ✅ built

Recorded so this is not re-found a fifth time.

- **The two `en-GB` date formatters still stand**, at `src/billing-plan.ts:721` and
  `src/messages.ts:4100` (line numbers moved; the sites are the same). `billing-plan.ts` still says
  in prose that they must agree, and that sentence is still the only thing keeping them in step.
  Exhaustive: `git grep -n "en-GB" -- src/` returns nine hits, of which these two are the
  `toLocaleDateString` pair. One import.
- **The block-row selector is down from four copies to two**, at `src/web/scroll.ts:530` and `:668`.
  The other two were absorbed into `rowsForBlockIds` (`src/web/rows.ts`) on 2026-09-05 for a measured
  performance reason. This is a dedup that left copies alive, which the method warns reads as done —
  so it is finished here rather than left at two.

**The date dedup had a cost neither I nor the review saw, and a guard caught it.** Giving
`messages.ts` an import of `billing-plan.ts` put `billing-plan.ts` into the intersection of the
reader's startup closure and the admin/design closure, which
`tests/eager-client-graph.test.ts` asserts is a curated list. `tests/client-imports.test.ts` passed
throughout — both modules are on *its* allowlist — so the two guards are asking genuinely different
questions and only the second could see this.

The glance it asks for comes out free: `BillingSection.tsx`, `PricingPage.tsx` and `useBilling.ts`
already import `billing-plan.ts`, so the reader downloaded it before this edge existed and the only
new fact is that the admin closure reaches it too. It is a leaf, so nothing follows it in. That is
precisely the second of the two zero-cost cases that test's own header predicts — *"a module already
on this list gaining an import of its own … so it arrives here without anybody having touched an
admin file"* — and the prescribed remedy, one line plus a reason, is what was done.

Worth recording for one reason: this is the sweep's own argument landing on the sweep. A curated
list with a derived check around it caught, within one run, a consequence that a careful author and
a strong cross-family review had both missed.

## T1.6 · Small, verified, and **not** done — today's residue

Counted and confirmed; none is worth a stage, and they are listed so the next run does not re-find
them.

- **Captured fixtures under `tests/fixtures/data-root/**` are linted**, unlike the two other
  captured-input directories that `biome.jsonc:37,48` excludes with a stated rationale.
  `npx biome lint tests/` reports 10 `noDoubleEquals` findings inside saved `raw.html` pages that are
  not our code. Same class as the existing exclusions, one directory over. Two paths.
- **`.gitignore` states twice that `git status` must stay readable** — because the commit recipe in
  AGENTS.md leans on it — and right now it is not: eight untracked files of agent debris sit in the
  repo root (`.tmp-*.mts` ×6, `privacy-*.png` ×2). Nothing has ever been *committed* by accident, so
  this is untidiness rather than a defect; it is recorded because the principle is written down twice
  and enforced nowhere, and because deleting another agent's files is not this sweep's call.
- **`tests/blocks-baseline.test.ts:623,635`** — `(first.parts?.blocks as {...}).blocks` throws a
  cryptic `TypeError` rather than failing cleanly if `parts` is ever absent. Biome already flags it
  (`noUnsafeOptionalChaining`, 2 hits). Not a false pass; a worse failure message.

---

# Tier 2 — worth doing, each with its own test and review

## T2.1 · A containment mechanism with one adopter out of thirteen, and the next commit drove past it

**Evidence: proved from the code.** This is the one substantially new finding of this sweep.

On 2026-09-05, [260905h](260905h-a-mode-failure-should-leave-the-article-readable.md) established
that a throw inside one mode must not take the article with it, and built `FeatureBoundary`
(`src/web/FeatureBoundary.tsx`) to enforce it. Before that day the app had exactly one boundary, in
`main.tsx`, whose fallback **replaces its children** — so a throw in any panel took the prose, the
spine, the dock and every route with it.

**`FeatureBoundary` is used in exactly one place in the application:**

```
$ git grep -n "FeatureBoundary" -- src
src/web/App.tsx:56    import { FeatureBoundary } from "./FeatureBoundary.js";
src/web/App.tsx:3483  <FeatureBoundary            ← mode === "ideas"
src/web/App.tsx:3511  </FeatureBoundary>
src/web/FeatureBoundary.tsx:109  export function FeatureBoundary({
```

Thirteen non-`plain` modes ship (`src/modes.ts:19`). One is contained. `summary`, `diagram`,
`quotes`, `timeline`, `debate`, `search`, `referee`, `glossary`, `remember`, `outline`, `chat` and
`hierarchy` render their bands bare, at `App.tsx:3443` and downwards.

**This was correct when it landed and stopped being correct within hours.** Stage 1 of `260905h`
scoped itself to Ideas deliberately — the boundary has to enclose the controller's own computation,
so Ideas' controller had to move to `src/web/modes/` first, and that extraction *was* the stage. The
plan is explicit that the rest is inherited work rather than a decision:

> **Leave the boundary where it is and add nothing.** The counter is that the review's own
> acceptance criterion — *one independently failing feature, still a usable reader* — is unreachable
> from one root boundary, and **every mode added after this one inherits the same blast radius**.

Then `037de8f7` ("Opening a mode starts it generating", 2026-09-06) wired Debate into auto-run
(`activation.ts:182`, `auto-run-targets.ts:52`) — **after** the containment pattern existed, without
extending it. Debate is described at `activation.ts:161` as *"the dearest mode press in the app — two
metered calls"*.

**And the test states the general claim while proving the particular one.**
`tests/a-broken-mode-leaves-the-article-readable.test.tsx` opens *"**One mode may break without
taking the article with it**"*, and every one of its cases mocks Ideas, because Ideas is the only
mode it *can* exercise. The file is excellent — each containment assertion carries a positive control
against exactly the silent-success failure this repo keeps meeting — and its title is a promise the
app keeps for one thirteenth of itself.

**Two pieces, and the cheap one first.** A static test that every mode band in `App.tsx` renders
inside a `FeatureBoundary` costs an afternoon and makes the fourteenth mode impossible to add
uncontained — the class-killer, and it goes red today, which is what makes it worth writing. The
rollout itself is per-mode and needs the same controller-extraction Ideas got, so it is several
stages and wants its own plan. **Do the test first even though it will be red**, and let it be red
against a documented allowlist that shrinks; a green test over one mode is what we have now.

**Not** the rejected shape: `260905h` considered and refused a boundary around each `*Panel.tsx`,
because a mode's likely throw is in its controller, outside such a boundary. The rollout has to
follow Ideas' extraction, not shortcut it.

## T2.2 · `portalDrift` compares five features by hand, and a sixth is invisible

**Evidence: proved from the code.** `260905b`'s item **a**, still unbuilt, re-verified and re-sized.

`scripts/stripe-setup.ts:937` compares the live Stripe Portal configuration against what we want with
hand-written `if`s over `subscription_update`, `subscription_cancel`, `invoice_history`,
`payment_method_update` and `customer_update`. Today's Stripe SDK (`stripe@22.6.1`,
`node_modules/stripe/esm/resources/BillingPortal/Configurations.d.ts:88`) declares **exactly those
five**, so the comparison is complete right now.

That is the point: it is complete by coincidence of nobody having upgraded the SDK. Keyed off
`Record<keyof Stripe.BillingPortal.Configuration.Features, …>`, a sixth feature could not compile
without a decision — and a sixth feature going unnoticed is precisely how `subscription_update` was
missed, at the cost of a paying customer unable to upgrade for a month
([260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md)).

Highest known cost of anything in this document, still small, still a script rather than a request
path. It is the item this sweep would build second if it built two.

## T2.3 · A refusal that cannot come out differently is reported as "worth another go" — and the obvious fix is wrong

**Evidence: proved from the code, reachable path traced.**
[260905f](../postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md)
lists this as its recommendation 4, unbuilt.

The path: `PublishRefused` (`src/store/pg-revisions.ts:391`) carries `status` and `reasons` and **no
`failureKind`**. `endAsStorageFailure` (`src/jobs.ts:1509`) records
`failureKindOf(err) ?? "retry"`; `failureKindOf` finds no field and no bracketed code in the message,
so the job is stored `retry`, `jobWorthRetrying` returns true, and the reader is shown
`[jb-step-again]` — *"a step that stops like this often comes out differently on a second attempt —
so trying again is worth a go."* Each attempt has already completed and **paid for** its model call
before reaching the gate: four refusals on one article cost $0.35 on 2026-09-05, one of them $0.2454.

`jobs.ts:1428` already makes the whole argument, for a different error: *"Persisting the second as
`retry` put a Retry button, and a promise that pressing it was safe, on a job that could only fail
identically."*

**The one-line fix — `readonly failureKind = "bug"` on the class — is wrong, and this is recorded
because it was proposed and nearly taken.** Reading all the throw sites, they are not one kind:

| site | reason | retry? |
|---|---|---|
| `pg-revisions.ts:513` | the slug is a reserved address | permanent |
| `:551` | the slug belongs to another reader | permanent |
| `:1690` | there is no such article | permanent |
| `:1705`–`:1709` | no such revision / wrong article / already published | permanent |
| **`:1749`** | **something else published while this draft was being written — "start again from what is there"** | **transient, and retrying is exactly right** |

A blanket `bug` would tell a reader who lost a benign write race that another go will not help, when
another go is the entire remedy. So the shape is a kind **per reason**, which is a small design
decision rather than a field — and it should carry `260905f`'s recommendation 3 (a bracketed code
that survives `sanitise` and reaches Sentry) at the same time, since most of that outage was
invisibility rather than breakage.

**Note what did not need doing.** The acute half of `260905f` — a tightened tree invariant wedging
every article that already broke it — **is fixed**, structurally and well:
`reasonsNotToPublish` now exempts `checkTree` problems when the publication does not change the tree
(`src/store/pg-revisions.ts:1455`ff), so the next invariant anybody tightens over stored trees
reports rather than wedges. An agent reported this as an open repair gap; it is not one.

## T2.4 · One retry rule, two implementations, in the two files whose headers say that must not happen

**Evidence: proved from the code; drift *not* proved, and that distinction is the finding's size.**

`withRun` (`src/searches.ts:137`) and `withCriterion` (`src/referee-criteria-store.ts:67`) are
independent implementations of the same three-condition "same id, same text, and a row that actually
failed" retry check, and of the same rebuild-on-reset structure. Compare `searches.ts:150-155` with
`referee-criteria-store.ts:76-80`.

**`referee-criteria-store.ts`'s header says three times that this rule has one implementation**, and
one of the three is an overclaim rather than a different frame:

- `:10` — it *"holds the mint-or-retry rule **that must not exist in two implementations**"*;
- `:43` — *"lifted out for the same reason: both stores call it, so the three-condition retry rule
  … has one implementation rather than two behaviours"*;
- `:21` — *"Everything else — the fingerprint, **the retry rule**, the colour, the trim — is
  deliberately identical, and where it is identical it is ***imported*** from src/searches.ts rather
  than copied."*

The first two are about `withCriterion` being shared between the Postgres and filesystem stores, and
were true in that frame. **The third names the retry rule among the things imported rather than
copied, and the retry rule is copied.** That is the sentence a future editor would rely on.

**And the reason for the split has since evaporated.** "Both stores call it" was the justification;
the filesystem store was deleted on 2026-09-05
([260903f](260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md)), and this file's
own header records that. There is one store now, so the function is lifted out for a reason that no
longer exists — which does not make it wrong, but does remove the argument against folding the rule
back into one place.

The rule behind it is a real production bug — a permanent spinner,
[260826f](../postmortems/260826f-search-retry-remints-instead-of-resetting.md).

**Not drifted today**, and honestly so: `referee-criteria-store.ts` was created *after* the
colour-survives-retry fix landed in `searches.ts`, so it inherited that fix by being copied late
rather than by sharing code. The exposure is prospective and the next fix is the one that splits
them. Worth a shared helper; not worth alarm.

## T2.5 · Six hand-written copies of "serve one owned binary blob", including its security half

**Evidence: proved from the code.** `git grep -n "X-Content-Type-Options" -- src` → **6 set-sites**:
`src/routes.ts:560`, `:645`, `:732`, `:801`, `:7060`, and `src/public/routes.ts:159`.

Each repeats the same contract by hand: owner check → manifest lookup → **storage key rebuilt from
the manifest, never from the URL** → `blobStore().get()` → content type, length, `nosniff`,
cache-control. None has drifted — every one still sets `nosniff`, checked individually. But
`sendArticleAsset`'s own docblock (`src/routes.ts:696`, added yesterday) says it was *"modelled on
`sendPlate` line for line"*, which is the copying mechanism described in the method, caught in the
act, on a security-relevant contract. A parameterised `serveOwnedBlob({lookup, cacheControl, …})`
concentrates it before the seventh.

## T2.6 · Seven copies of the OpenRouter key check, and an outlier that tells the reader the wrong thing

**Evidence: proved from the code, reachable path traced.** The outlier was a hypothesis when the
breadth agent reported it; tracing it moved it, and made it the same defect as T2.3.

Twelve places in `src/` read `process.env.OPENROUTER_API_KEY` (`git grep -n
'process.env.OPENROUTER_API_KEY' -- src`, 12 hits, all read). **Seven** are the same four-line block
— `loadEnvLocal()`, read the key, `line.error(…)` for the operator, `throw
NOT_CONFIGURED.message` for the reader: `src/converse.ts:1386`, `explain.ts:458`,
`quiz-mark.ts:544`, `search.ts:549`, `referee-claims-run.ts:385`, `referee-criteria-run.ts:502`,
`referee-mirror.ts:1468`. `src/embeddings.ts:502` calls this *"the way every other OpenRouter caller
in this repo gets it"*. Each carries the same comment explaining the split: *"Two audiences, two
sentences… the thrown message is for the reader, and does not name an environment variable or a
dotfile."*

**`src/pdf-read.ts:781` is the copy that dropped the undocumented half**, and unlike the two other
deviations (`messages-stream.ts`, `embeddings.ts`) it carries no comment saying why:

```ts
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");
```

No `loadEnvLocal()`, no operator log line, and — the part that matters — **no bracketed code**. Its
seven siblings throw `NOT_CONFIGURED`, which is `kind: "ours"`, carries `[ai-not-set-up]` and says
*"trying again will not help"*. This one resolves through `failureKindOf` to `undefined`, so
`jobs.ts:1509`'s `?? "retry"` records it as retryable and the reader is offered another go at an
unset API key, which no number of attempts will set.

So this is **T2.3's defect a second time, by a different route**: a permanent failure reported as
transient because nobody declared a kind. The reader never sees the raw sentence (the missing code
means `stepGaveUp` supplies the generic one, so the doc path and the variable name do not leak),
which is the one thing that goes right here. Fix is one line — throw what the other seven throw —
and it belongs with T2.3 rather than on its own, because they are one class and the argument for
both is the same.

## T2.7 · Knowledge that landed where one reader will find it

Each verified by reading the destination doc's headings first, not by grepping invented phrasing —
the discipline that killed five of six false gaps in an earlier trawl.

- **The aggregate publisher-word cap** is live at `src/pdf-frontmatter.ts:83`
  (`MAX_SET_ASIDE_FRACTION` — half the window's words, breaching it discards the whole publisher list)
  and exists in prose only in commit `e13becdf4`'s body.
  [content-extraction.md](../project/content-extraction.md) § *Two ways of being wrong* documents only
  the per-record cap. It is a prompt-injection bound; it belongs in the doc.
- **`import type` counts as a shared-module violation** — commit `d138c609`, and the guard's own
  header records the relaxation being written and reverted inside a day, twice.
  [testing.md](../project/testing.md):316 names `client-imports.test.ts` as *"a rule with a
  bundle-size measurement behind it"* and nowhere states this counter-intuitive nuance. One line on
  that row.
- **Two worktree traps that have no doc home**: `EnterWorktree` *resumes* an existing tree, so a task
  briefed as unstarted may be most of the way done; and worktree isolation refuses a subagent's Bash,
  so an agent spawned before `EnterWorktree` quietly downgrades to reading.
  [worktrees.md](../project/worktrees.md) § *Starting one* covers neither, and both bear directly on
  how agents are told to work here.
- **`--formatter-enabled=true` silently overrides the deliberate formatter-off decision** —
  205 changed lines, 8 of them the author's. [linting.md](../project/linting.md) explains at length
  *why* the formatter is off and never says which flag turns it back on by accident.
- **MIT over AGPL-3.0, and why** — commit `6978e9b`'s body records the decision and the rejected
  option; no doc mentions either. Destination genuinely unclear (`positioning.md` is the closest and
  is a stretch), so this one is for Greg to place rather than for an agent to file.

---

# Tier 3 — named and sized, not started

## T3.1 · Split `src/routes.ts` — and this run finally has the material to decide it

Named Tier 3 by all three previous sweeps and by
[260902e § 3.1](260902e-codebase-rework-umbrella-what-is-worth-doing-next.md). **7,294 → 7,757 →
8,180 lines across three sweeps.** Recorded, again, not to defer to it a fourth time believing it is
happening. It is not happening.

What is new is that the shape is now settled rather than open:

- **The problem is not the 8,180 lines, it is that they are one function.**
  `serveAuthenticatedApi` (`:6555`–`:8180`) is a single 1,625-line function: ~500 lines computing 51
  path matches, then a ~1,100-line `if (…) { …; return; }` chain. Adding a route means editing two
  distant places inside it, which is also why it is the tree's worst merge-conflict site — 36 of 783
  non-merge commits since 2026-09-01 touch it, and merge `cf780c7e`'s own message records seven
  textual conflicts including this file.
- **Biome has been putting a number on it the whole time**, measured here 2026-09-06:
  `noExcessiveCognitiveComplexity` scores it **244 against a threshold of 25** — the highest in the
  tree by a wide margin. That rule is set to `info` on purpose, as triage rather than a gate, and
  `biome.jsonc` is careful to say a high score means "go and look" rather than "this is wrong",
  because the metric punishes a long flat dispatcher about as hard as genuinely nested logic. Both
  things are true here: it *is* a flat dispatcher, and 244 is still ten times the line the rest of
  the tree lives under.
- **A per-domain *file*, not a per-route *table*.** Owner identity flows through `AsyncLocalStorage`
  (`setRequestOwner`/`currentOwnerId`), not through closure state threaded down the chain, so each
  domain can become a standalone `async function tryChatRoutes(req): Promise<boolean>` called in
  sequence. That is ordinary function composition, **not** the registry shape rejected for `App.tsx`'s
  mode dispatch in `260902o` — and the distinction is principled: `src/public/routes.ts` already runs
  a real data-driven table successfully *because that surface is homogeneous* (validate → one read →
  200), while the authenticated surface has SSE streams, four module-scope lock registries
  (`routes.ts:1010`, `:3800`, `:3970`, `:4211`), uploads and live sessions. A table would be wrong
  here for the same reason it was wrong there.
- **What it does not buy**, stated so the next sweep can weigh it honestly: no route gets shorter and
  no total line count falls. The payoff is fewer simultaneous editors in one region, and a next
  editor reading one domain instead of 8,180 lines.

## T3.2 · The rest of `260905b`'s Stage 2, unstarted

Items **c** (a path-scoped biome rule so a second `DOMPurify.addHook` cannot land outside
`src/sanitize-policy.ts`, the seam [security-map.md](../project/security-map.md) names as the
untrusted-HTML boundary), **d** (`stepGaveUp`'s generic `blocked` fallback logs nothing), **e**
(`isTocCurrent`, two independently-maintained staleness checks) and **f** (`isAdmin`, re-scoped —
now **12** production call sites, up from 11 yesterday, four of them in the client). Each
re-verified as unbuilt today. **(c) depends on T1.1**: a path-scoped lint rule is worth exactly as
much as the guarantee that the config was read.

## T3.3 · `sweepAbandonedDrafts` still has no caller

`src/store/pg-revisions.ts:1952`, defined; **25** comments across eight source files and six test
files reason carefully about what it does to a draft; nothing calls it.
`src/store/revisions.ts:29` concedes the consequence — each abandoned draft keeps a full copy of the
article's `revision_blocks`, *"so that is storage rather than tidiness, and it remains a real gap"*.
Wiring it needs a schedule and a decision about where periodic work lives. **Greg's call**, unchanged
from yesterday.

---

# What came back clean

Negative results from a real sweep, recorded so the next run does not re-spend agents here.

- **The NUL-byte class is closed** — zero raw NUL bytes, guard test in place. See the baseline.
- **The CSS mechanism held under the heaviest churn in the tree.** `styles.css`'s +3,056 lines are
  additive per feature (Debate band +360, dock move +170/−39, gutter rework +253/−157), not a second
  mechanism. The three biggest new components carry zero `tw:` utilities, so `styles.css` still owns
  100% of the new chrome exactly as [design-css-overview.md](../project/design-css-overview.md)
  prescribes. Apparent duplicate selectors (`.dock`, `.reader`, `.fb-actions`) are the file's
  documented convention of splitting one selector by concern.
- **Stage ownership holds**, re-checked against the newest files: `link-previews.ts:78` and
  `chat-tools.ts:60` import `fetchDocument` from stage 1, which is a shared leaf utility that never
  touches `raw.html`/`raw.json` — not an artefact-boundary crossing.
- **The newest store code follows the established locking convention** — `pg-rate-limit.ts:95`
  uses READ COMMITTED plus `pg_advisory_xact_lock` and fencing tokens for lease renewal, citing
  `pg-feedback.ts`. Careful propagation, not drift.
- **The test suite's easy findings are exhausted**, and the agent that swept it said so plainly.
  Zero unconditional `it.skip`/`describe.skip`; all 43 skips are environment-gated and there is a
  guard (`tests/one-store-only.test.ts`) against the dangerous ternary form. Zero snapshot tests. The
  `toContain('inner join')` tautology the method quotes was already found and fixed — `admin-queries.test.ts:136`
  names that postmortem and now asserts bound parameters instead of vocabulary.
- **A same-day near-miss was caught by the type system, not by a person.** Two branches independently
  minted `requestTarget`/`sameTarget` in one file with no textual conflict — two notions of one
  authorization key, the classic shape — and `tsc` caught it at merge `1876627d`. One definition of
  each survives, in `src/urls.ts`.
- **Four "unused" candidates were checked and are deliberate**: `readBaseline`/`hasEarlierBlocks`
  (a narrower interface, documented), `currentOwnerId` in webhook scope (a security invariant,
  documented), `valenceGap` (deferred by a named Sol review), and the whole
  `store-migration-witness` apparatus (still a wired-in regression guard, 14s subprocess, not inert
  despite the migration it audits being finished).

---

# One level up: is the approach sound?

**Yes, and for the reason the previous two sweeps gave** — this codebase writes down *why* at the
point of decision, including where a decision went against advice recorded at the time. Nothing here
disturbs that.

**What this run adds is a control the previous one could not have.** `260905b` argued that the
repo's characteristic failure is transmission: a conclusion reached, written for the next *reader*,
and never addressed to the next *tool*. It offered that as an argument with two clean cases and one
confounded census. Twenty-four hours later:

- the one item it converted into a **check** — the NUL-byte guard — closed a class that had recurred
  three times over two sweeps while it was a paragraph;
- the six it left as a **plan** are all exactly where it left them, and the one-day interval rules out
  "they were newer or bigger" as the explanation, because none of them is more than an afternoon;
- `ai-unusable` (T1.2) has now been written down three times in two files and one plan without being
  registered, while the test that exists to enforce it structurally cannot see it;
- and the containment pattern (T2.1) reached one mode out of thirteen and was driven past the
  following morning by a commit that wired the most expensive mode into the unprotected path.

That is four instances, and none of them is a failure of understanding. **The conclusion this sweep
draws is narrower and more actionable than "write more checks": the check has to be able to see the
thing it is about.** `tests/messages.test.ts` cannot see a code in another file. The Ideas boundary
test cannot see an unwrapped mode. Both are good tests that verify their subject and are structurally
blind to its neighbours — and in both cases the blindness is invisible from the test's own green
result, which is [silent-success.md](../reusable/silent-success.md) one level up from where that doc
usually applies.

**So the ranking inside "convert it to a check" is: a check whose universe is derived beats a check
whose universe is enumerated.** `no-raw-nul-bytes` walks `git ls-files`. `messages.test.ts` walks one
module's exports. That is the whole difference between the class that closed and the one that did
not, and it is the design note for every guard proposed above.

**One caution against over-reading it.** Twenty-four hours is a short interval and a busy one; six
unbuilt items is not evidence of neglect, and the same day landed a great deal of careful work,
including three P1s a review caught before a merge. The claim here is about *which* work waits, not
how much gets done.

---

# Stages

**Stage 1 — Tier 1, and it landed with this plan.** T1.1 (the config-live guard), T1.2 (register the
code, plus the derived-universe test that makes the next one impossible), T1.3 (the stale knip
entry), T1.4 (the dangling signpost), T1.5 (the residue). Eleven files — six source and config, one
new fixture, two new tests, and four docs for Stage 4 — no behaviour change in any request path
beyond the Sentry-forwarding note in T1.7, and each guard watched red before it was made green.

**Stage 2 — T2.1's static test, red, with an allowlist.** The cheapest half of the containment
finding and the one that stops the fourteenth mode arriving uncontained. It is a stage on its own
because the rollout it implies is not.

**Stage 3 — T2.2**, `portalDrift` keyed off the SDK type. One afternoon, a script rather than a
request path, and the only item here with a known customer-facing cost behind it.

**Stage 4 — T2.7's doc moves, four of five done in this sweep.**
[content-extraction.md](../project/content-extraction.md) gains the aggregate publisher-word cap and
the two pieces of reasoning behind it; [testing.md](../project/testing.md)'s `client-imports` row now
says that `import type` counts; [linting.md](../project/linting.md) names the
`--formatter-enabled=true` flag and what one run of it cost; [worktrees.md](../project/worktrees.md)
gains the two `EnterWorktree` traps, which bear on how every delegating agent here is told to work.
The fifth — MIT over AGPL-3.0 — is left for Greg to place, because no existing doc is a good home
and inventing one is not an agent's call.

**Its own plan, not a stage:** the T2.1 rollout, T2.3's per-reason kinds, T2.5's `serveOwnedBlob`,
and everything in Tier 3.

---

# Every finding is a claim, including this sweep's

Three claims in this document were wrong when first written, all three in the direction that would
have made the sweep look more productive. Recorded because the method says to, and because the
pattern in them is the same one.

- **`rowsForBlockIds` "has no production caller."** It has two. The grep behind that claim searched
  for `from "./rows"`, and this repo writes `from "./rows.js"`. Caught by re-running the search a
  second way, which is the only reason it is not in Tier 1 above as a dead-code finding.
- **"The 2026-09-05 tree-invariant outage has no repair path and is unaudited on production."** It
  was fixed the same day, structurally, at `pg-revisions.ts:1455` — a carried-forward tree's problems
  are reported rather than refused. The agent that reported it had read the *comments describing the
  gap* and not the code below them.
- **The `PublishRefused` one-line fix** (§ T2.3) would have shipped a wrong answer to a reader in a
  benign race, on the strength of evidence that was entirely about a different throw site. The
  finding was right and the fix beside it was not, which is the specific trap
  [improve-the-codebase.md](../reusable/improve-the-codebase.md) names.

All three share a shape: **a claim about an absence, checked by one grep, in a tree where the thing
was present under a spelling the grep did not cover.** The method's existing rule is "cross-check a
surprising zero with a second tool"; what these add is that a zero here is more often a *wrong
pattern* than a *broken tool*, and the cheap defence is to grep for the thing's neighbours and see
whether they show up.

**A fourth was caught by the review rather than by me**, and it is the same shape one level up: the
claim that moving the orphan check was "strictly stronger" (§ T1.2). It was checked against the case
that motivated it — `ai-unusable` — and not against the case that would break it, a non-`ai-` key.
Sol produced that case in one line. **The three above were found by re-deriving my own claims; this
one was not, and I had already re-derived it.** That is the argument for the cross-family review
stated as cheaply as it can be: it is the fourth sweep in a row where the review came back with
something the sweep's own discipline had missed, and the second where the missed thing was a
coverage claim about the sweep's own guard.

## Not doing, and why

- **Splitting `routes.ts`, `styles.css` or `App.tsx`** — Tier 3, Greg's call, and refused before.
  T3.1 now carries the shape and the numbers so the decision can be made rather than deferred again;
  it is still not started here.
- **knip's 185 unused exports / 139 types** — declined by
  [260903a](260903a-improve-the-codebase-sweep.md) as *"mechanical, zero line count, high diff
  noise"*. Still true; the growth is tracked in the baseline rather than acted on.
- **Deleting the untracked agent debris in the repo root** — not this sweep's files, and not its call.
- **Deleting the three redundant memory files** `260905b` named, plus the four this run found
  redundant — an agent should not delete another agent's memory on its own judgment. Named for Greg.
- **The `isAdmin` re-scope** (`260905b` item f) — 12 call sites, four in the client with no server
  project to pass, and the source postmortem itself concludes a deploy-time identity check is the
  better fix. Re-size before scheduling; do not start it from any table.
- **Any change to the remote database** — out of scope for an unattended run.

## What the next sweep should know

**The easy findings are genuinely exhausted, and two independent agents said so in those words.**
Four sweeps in nine days have taken the tautological tests, the dead code, the false comments and the
copy-paste. What is left is either a decision (T3.1, T3.3), a rollout (T2.1), or a design (T2.3) —
and the honest read is that a fifth *sweep* is worth less than building any one of them.

**Prefer a check whose universe is derived over one that is enumerated.** See § One level up. If you
propose a guard, ask what it is structurally unable to see, and whether that blind spot is where the
next instance will land.

**The one-day control is available again, and worth taking.** If a sixth sweep runs, the cheapest
useful thing it can do first is re-verify this document's Tier 1 and Tier 2 against that day's tree
before looking for anything new — a deferral is a claim and it decays, and this run's most useful
single number came from re-counting yesterday's rather than finding today's.
