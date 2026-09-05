# Review: the 2026-09-05 "improve the codebase" sweep

You are GPT Sol, giving a cross-family review of a periodic codebase-improvement sweep in
/home/greg/code/spideryarn2 (branch `worktree-sweep-260905b`, based on `dev` at `f1ee632f`).
The method is `docs/reusable/improve-the-codebase.md`; read it, and read the plan below.

Two things are under review, and please keep them apart:

**A. The plan document** — `docs/plans/260905b-improve-the-codebase-third-sweep.md`, reproduced
below. Its job is to be an honest umbrella: findings verified at the strength they are asserted,
counts shown rather than summarised, evidence states kept separate from tiers, a scope line naming
what the method is blind to, and a "not doing, and why" that the next run's search for prior
rejections will find.

**B. The code and doc changes already made** (Stage 1), diff below. These are committed with the
plan, so they need to be right now, not later.

## What I most want you to attack

1. **Is the headline claim overstated?** The plan says 41 of 74 code-verifiable postmortem
   recommendations are still unbuilt, and draws a pattern from it (the incident-shaped fix lands,
   the class-shaped fix does not). That census was produced by subagents, two of which hit tooling
   trouble; I state the denominator caveat in the doc. Is the caveat sufficient, or is the
   conclusion doing more work than the evidence supports? Is there a confound I have missed — for
   instance that the 21 postmortems were *selected* by containing the words "still open", so of
   course they contain open items?

2. **The NUL-byte fix (T1.1).** Eleven raw 0x00 bytes replaced by six-character Unicode escape
   sequences in five files, plus a new guard test. For `src/html.ts` the change also touches a regex
   character class that strips C0/C1 control characters from titles — a security-adjacent
   sanitisation path. I proved the new class equivalent to the old over U+0000..U+2FFF with 0
   disagreements, and proved the comparison can fail (34 disagreements against a deliberately wrong
   class). **Is that proof sufficient for a sanitisation path, or is there a case beyond U+2FFF, or
   a surrogate / lone-surrogate case, or a `u`-flag case, where the two classes could differ?** Note
   that the old class contained the raw byte pair 0xc2 0x9f (UTF-8 for U+009F) and the new one names
   U+009F by escape.

3. **Is the new test worth its keep?** `tests/no-raw-nul-bytes.test.ts` (full text below) globs the
   tree and asserts no file contains a zero byte. The method's own deletion and YAGNI tests say be
   suspicious of new machinery. Argue the other side if you can: is this a check that will produce
   false positives (some legitimate future need for a raw NUL in a source file), or that duplicates
   something biome or git already does? Note that biome's `noControlCharactersInRegex` catches the
   `src/html.ts` case both before and after the change, but catches none of the four
   template-literal cases.

4. **T1.4's discrimination.** Of 50 test assertions duplicating a source literal, 15 name an
   exported constant, and I claim 8 of those 15 **must not** be changed because they pin prompt text
   where the wording *is* the requirement, and importing the constant would make the assertion a
   tautology. I changed 4 of the other 7. Is that line drawn in the right place? Is
   `expect(host.textContent).toContain(SHARING_PERSONALISED)` actually stronger than the fragment it
   replaced, or have I traded a real assertion for a weaker one?

5. **Anything in the diff that is wrong, unsafe, or that changes behaviour where I claim it does
   not.** Especially: the `package.json` dependency addition (I ran
   `npm install --package-lock-only` in a worktree whose `node_modules` is a symlink to the
   primary's — is the resulting lockfile correct and complete?), and the rewritten comment in
   `src/store/contracts.ts` (is it now accurate?).

6. **The staging.** Stage 2 proposes six items from the postmortem census. Is starting with the two
   one-line ones right, or is that the "cheap and comfortable cluster winning on convenience" that
   the method warns about?

Be concrete and cite file:line. If a finding of mine is wrong, say so plainly. If the plan is not
ready to commit, say **not ready** and say why.

---

# The plan document

# Improve the codebase — the 2026-09-05 sweep

The third run of [improve-the-codebase.md](../reusable/improve-the-codebase.md), two days after
[260903a](260903a-improve-the-codebase-sweep.md) and
[260903d](260903d-improve-the-codebase-second-sweep.md), against a tree that took **751 commits** in
between. Read those two first; this one starts where they stopped and does not re-open what they
settled.

**The headline is not a bug.** It is a measured pattern: across the postmortems that name an open
recommendation, **41 of 74 code-verifiable recommendations are still unbuilt**, and *which* ones stay
unbuilt is not random. The incident-shaped fix always lands. The class-shaped fix — the lint rule,
the shared signature, the static cross-check between two lists that must agree — is what gets
written down and left. That is exactly the axis this method exists to work on, so the plan is
organised around it.

## Scope line

**Swept:** `src/` (all), `tests/`, `scripts/`, `evals/`, `api/`, `styles/`, `docs/project/`,
`docs/plans/`, `docs/postmortems/`, `package.json`, `package-lock.json`, `biome.jsonc`, `knip.jsonc`,
`vitest.config.ts`, `drizzle.config.ts`, `vercel.json`, `.env.example`, and the agent memory
directory. Seven breadth agents — four by lens (what the code says about itself; duplication and
rival mechanisms; dead code and inert defences; the test suite and the type system) and three by
zone (the web client; the pipeline/server/store; knowledge that leaked into commit bodies and
memory) — then one deep census by hand and by a fifth agent.

**Not swept, and blind to:** the remote database (out of scope for an unattended run, by AGENTS.md);
anything visible only in a browser; concurrent transactions; provider streams that end without
throwing. A static sweep finds no races.

**And one specific blindness, which turned out to be the sweep's best finding** — see T1.1. Five
source files were invisible to `grep`, so every lens above was silently blind to them, as were both
previous sweeps.

## Baseline, measured on this tree

At `f1ee632f`. `npm test` was **not** run as a baseline: 13 worktrees share one box and four other
agents' vitest processes were live, which is the condition
[260903d](260903d-improve-the-codebase-second-sweep.md) showed makes a red result meaningless. The
suites named below were run one file at a time instead.

| | 2026-09-03 (previous sweep) | today |
|---|---|---|
| `npm run typecheck` | clean | **clean** (1,281 files across three projects) |
| knip unused files | 9 | **12** — all twelve verified false positives (preview pages, the witness config, one untracked scratch file) |
| knip unused exports / types | 124 / 103 | **141 / 122** |
| jscpd clones | 258 | **293** |
| `src/routes.ts` | 7,294 lines | **7,757**, 85 commits in 30 days — still top of churn × complexity |
| worktrees sharing one Postgres | 11 | **13** |
| source files invisible to `grep` | *nobody had counted* | **5** |

**The Vercel function bundle, measured rather than worried about.** `260905a` handed the next sweep
a number — the `@vercel/nft` trace collected 4,413 files, up ~45% since 2026-09-03 — and said it was
"a thing to look at". Looked at: tracing `api-dist/vercel.js` today collects **2,946 files totalling
28.3 MB unzipped**, against Vercel's 250 MB ceiling. The largest single item is `jsdom` at 6.7 MB,
then `pdfjs-dist` at 3.3 MB and our own compiled `vercel.js` at 3.8 MB. **That is 11% of the limit,
so growth is not a risk and this can stop being an open worry.** My file count disagrees with the
test's 4,413 and I did not chase why — the byte figure is the one that bears on the ceiling, and the
trace ran in 22s here against 441s under load, which says most of that measurement was contention.

---

# Tier 0 — live defects

**None.** Said plainly rather than left to inference: nothing found this run is breaking a reader's
request today. The item closest to it (T2.2, a cleanup function with no caller) grows storage
slowly and is admitted in the code.

---

# Tier 1 — cheap, mechanical, evidence in hand

## T1.1 · Five source files are invisible to `grep`, and it is the third time ✅ done

**Evidence: reproduced.**

A composite key wants a separator that cannot occur in the data, and `\0` is the right choice. The
defect is writing it as a *byte* rather than as the escape: a template literal joining two halves
with the two-character escape, and one joining them with a literal `0x00`, produce the identical
string — and only the second makes every text tool treat the whole file as binary.

```
$ grep -rn "queue.failed" src/          → five hits, none in useIllustrated.ts
$ grep -arn "queue.failed" src/         → useIllustrated.ts:300, and the others
```

No match, no warning, no non-zero exit. **Every audit this repo runs on itself is a grep** — this
sweep, [rename-or-move.md](../reusable/rename-or-move.md), and any agent asking who calls a thing.
All of them read a silent zero as *there is nothing there*, which is
[silent-success.md](../reusable/silent-success.md) exactly.

| file | what the byte is doing |
|---|---|
| `src/web/useIllustrated.ts:300` | key separator |
| `src/web/IllustratedView.tsx:148,530` | key separator (×4) |
| `src/illustrated-plate.ts:905` | key separator (×2) |
| `evals/hierarchy-structure/run.ts:659,660` | key separator (×2) |
| `src/html.ts:70,76` | a C0/C1 range written as raw bytes, in a regex *and* in the comment above it |

**This is the third occurrence, and the history is the finding.** `src/store/import.ts` had one and
it "cost twenty minutes of believing a function did not exist"
([260826e](260826e-postgres-storage-implementation.md)); it was fixed, and nothing was left behind to
catch the next. Four more were found on 2026-09-03 and written up as *a trap to document*, with a
sentence "proposed for AGENTS.md's rename guidance"
([260903j](260903j-illustrated-415-and-one-click-paint.md)). **The sentence was never landed, and the
count has since grown to five** — `evals/hierarchy-structure/run.ts` acquired one *after* that
write-up, and acquired it in `evals/` precisely because the 2026-09-03 pass looked only at `src/`.

Fixed: all eleven bytes replaced with escapes, and `tests/no-raw-nul-bytes.test.ts` added so nobody
has to know the rule.

**The guard caught the guard — and then missed, which is the better half of the story.** Writing the
test's own doc comment I typed a raw NUL into it without noticing, and the first run listed
`tests/no-raw-nul-bytes.test.ts` among the offenders. Then I did it a *second* time, writing this
plan, and the test said nothing: its first glob list covered code and not prose. Found by hand.

Three accidental NULs by one author inside one hour, all while concentrating on the subject, is the
measurement that settles how much a written warning was ever going to be worth. `docs/**/*.md` is
now in the list — prose is the half agents grep hardest — and the whole docs tree is clean.

**Proved equivalent, not assumed.** For `src/html.ts` the regex was compared against the class the
old raw bytes described, over every code point `U+0000..U+2FFF`: **0 disagreements**, and the same
comparison against a deliberately wrong class gives 34 — so the zero means something. 265 tests
across the sanitize, illustrated and hierarchy-structure suites are green.

**Checked and *not* a finding:** biome's `noControlCharactersInRegex` fires on `src/html.ts` both
before and after (2 errors either way), so lint was not blind to the raw spelling and this is not a
second instance of the class. Lint-neutral.

**Left alone deliberately:** `BIDI` on `src/html.ts:65` holds raw *bidi* characters (U+202A and
friends). They are invisible in an editor, which is its own hazard, but they are not control bytes
and they do not blind `grep` — a different problem, not this one.

## T1.2 · The guard against a Stripe script reaching production depends on a package nobody declared ✅ done

**Evidence: proved from the code.**

`scripts/stripe-target.ts:36` does `import { parse } from "pg-connection-string"`, and
`pg-connection-string` appeared in neither `dependencies` nor `devDependencies`. It resolves today
only because `pg` depends on it (`node_modules/pg/package.json:35`, `^2.14.0`) and npm hoists it.

What makes this worth a line rather than a shrug is *which* file it is. `stripe-target.ts` is the
guard written after [260903h](260903h-stripe-scripts-reach-production.md) — the accident where
`.env.local` beat the shell, the Stripe half failed loudly, **the database half failed silently**,
and production ended up with nothing to sell. Four other scripts and `src/env.ts` import it. A `pg`
upgrade that drops the transitive dependency, or a package manager with stricter isolation, breaks
the safety script and nothing else.

Fixed: `"pg-connection-string": "^2.14.0"` in `dependencies`, lock updated with
`npm install --package-lock-only` so the shared `node_modules` was never touched. One line in each
file.

## T1.3 · A comment that has now been wrong in both directions ✅ done

**Evidence: proved from the code, with git history.**

`src/store/contracts.ts:29-33` said chat and searches "have **no interface here yet**: they still
write straight to the filesystem, which is why `postgres` mode currently serves them from files."
`ChatStore` is declared at line 718 of that same file and `SearchStore` at line 848, and
`src/store/index.ts:253,255` wires both to Postgres implementations.

The shape is what makes it interesting. That sentence was itself a **correction** — it ends "this
list said `ChatStore` and `SearchStore` were declared here when they were not, which is worse than
saying nothing." Written in `7359bdb0` (2026-08-26 11:22); `05b9983a` added both interfaces to the
same file **four hours later**. The corrected sentence outlived its own truth by longer than the
wrong one had. `src/store/db-errors.ts:60-66` describes the identical fact and was fixed on
2026-09-03; this copy was not, because nothing connects them.

Fixed, and the paragraph now says that a claim about what is wired is a claim that decays.

## T1.4 · Seven test assertions quote copy that the source exports under a name ✅ partly done

**Evidence: proved from the code — and the class was *reproduced* this morning.**

`260905a` fixed one of these hours ago:
`tests/shared-notice-hides-with-the-masthead.test.tsx` asserted a hard-coded substring of
`SHARED_WITH_YOU`, the copy changed under it, and the suite went red for no defect. Its own reasoning
— "editing the string in the test would go green and break again the next time anybody touches the
wording" — applies unchanged to the rest, and nobody had counted the rest.

**The census, both ways round.** Parsing `src/messages.ts` for exported literals and looking for them
in tests gives 7. Going the other way — every string assertion of ≥40 characters in `tests/` that
also appears verbatim in `src/` — gives **50**, of which **15 duplicate a string the source exports
under a name**. The two methods agree once the 15 are read, and the discrimination is the useful part:

- **7 are the defect** — reader-facing copy from `src/messages.ts`, rendered by a component, asserted
  as a fragment. Six are in `tests/access-sharing.test.tsx`, which *already imports that module*.
- **8 are not, and must not be "fixed"** — they pin prompt text (`QUIZ_SYSTEM`, `QUIZ_MARK_SYSTEM`,
  `AI_JOB_ROUTE`, the rules in `src/converse.ts`). There the wording **is** the requirement, and
  importing the constant would turn `expect(X).toContain(<a substring of X>)` into a tautology. This
  is written down because the mechanical fix is actively wrong on more than half the sites a naive
  grep returns.

Done: four sites now assert against the imported constant —
`SHARING_RIGHTS_CONFIRM`, `SHARING_PERSONALISED`, `SHARING_NOT_PERSONALISED` in
`tests/access-sharing.test.tsx`, and `SHARING_INVENTORY_UNKNOWN` in
`tests/metadata-sharing-card.test.tsx`. All 57 tests in the two files green.

**Left:** three more in `access-sharing.test.tsx` (`SHARED_IF_BUILT_NOTE`, `SHARING_INVENTORY_UNKNOWN`,
`SHARED_LINK_CARRIES`) plus the short-fragment assertions in the same file, which need a judgment per
site — several are `not.toContain(...)`, where a *fragment* is the stronger assertion and importing
the constant would weaken it. And **35 assertions quote a literal that is not exported at all**,
mostly inline UI copy in `CriteriaPanel.tsx`, `ProfilePanel.tsx`, `Metadata.tsx`. Extracting those is
the batch that [copy.md § What this does not cover yet](../project/copy.md#what-this-does-not-cover-yet)
already says is a gap rather than a decision — so it belongs to that plan, not to this one.

## T1.5 · Two docs describing code that moved ✅ done

**Evidence: proved from the code.**

- **`docs/project/sentry-error-monitoring.md`** said capture happens at "six seams:
  `src/routes.ts`'s outer catch and its three streams". `routes.ts` has **13 `captureFailure` call
  sites across seven routes** today (18 repo-wide). Same shape as
  [260903d T1.6](260903d-improve-the-codebase-second-sweep.md), where "six SSE streams" was seven —
  a count in prose that a shipping mode moves. Rewritten to name the *rule* and hand the reader the
  grep, rather than a number that will be wrong again next week.
- **`docs/project/worktrees.md:31`** said `npm run deploy` "fails earlier still, because a linked
  worktree's `.git` is a *file* and the deploy lock cannot be written inside it (`ENOTDIR`, measured
  2026-09-03)". `4405df8e` fixed exactly that on 2026-09-04, resolving the path with
  `git rev-parse --git-common-dir` — so every worktree now correctly contends for the primary's one
  lock. The doc line was written the day before the fix and nothing brought them together. Corrected,
  and "one barrier among three" is now two.

## T1.6 · Small, verified, and not done — the residue

Each counted and confirmed; none is worth a stage of its own, and they are recorded so the next run
does not re-find them.

- **Two identical `en-GB` date formatters**, `src/billing-plan.ts:425` (`readableDate`) and inline in
  `ingestQuotaReached` at `src/messages.ts:3646`. `billing-plan.ts:420` says outright *"The same rule
  and the same format `ingestQuotaReached` uses, so the page and the refusal name the same day"* —
  and that sentence is the only thing keeping them in step. Both are tested, separately; no test
  compares them. Exhaustive: `grep -n 'en-GB' src` returns these two for this option set. Fix is one
  import.
- **Four independent copies of the block-row selector** `` tr[data-block="${CSS.escape(id)}"] `` —
  `src/web/scroll.ts:505`, `:643`, `src/web/useColumnContext.ts:105`, `src/web/App.tsx:1459`.
  `scroll.ts`'s own header claims to be "the one place" a block is resolved for scrolling. One
  exported `blockRow(id)` would make that true. Not a fifth: `internal-links.ts:54` takes an
  arbitrary `doc`.
- **Three agent-memory files now redundant against the docs** —
  `drizzle-kit-generate-needs-a-tty` (word-for-word in
  [database.md](../project/database.md)), `typecheck-wrapper-covers-tests-tsc-does-not` (in
  [typechecking.md](../project/typechecking.md) in more detail), and
  `postgres-suites-fail-from-contention` (overtaken by the `private-postgres` lane that
  [testing.md](../project/testing.md) documents from 2026-09-04). Deleting a memory is Greg's call,
  not an agent's, so they are named rather than removed.

---

# Tier 2 — the cluster, and it is one cluster

## T2.1 · The postmortems' own class-killers, 41 of them, unbuilt

**Evidence: proved from the code**, item by item, against today's tree — a deferral is a claim and it
decays, so every "not built" line was re-checked rather than believed.

Of the 70 postmortems, **21 contain an open recommendation**. Within those 21, **74 recommendations
are code-verifiable** (purely procedural habits — "ask another model", "drive it in a browser" —
cannot be checked against a tree and were excluded):

| | count | share |
|---|---|---|
| **still unbuilt** | **41** | 55% |
| built since the postmortem was written | 28 | 38% |
| superseded by a different fix that closes the class | 2 | 3% |
| unclear | 3 | 4% |

**Read the denominator honestly:** 55% is the rate *within the postmortems that already say
something is open*, not across all 70. The unbiased figure would be lower. What the census
establishes is not a rate but a **pattern**, and the pattern is sharp:

> What gets built is the fix scoped to the one incident — a typed error class, a guard at the exact
> call site, a test pinned to the exact boundary. What stays open is the **generalizing** step: the
> lint rule that enforces the convention repo-wide, the shared signature that makes two questions
> un-splittable, the static check that two lists agree, the dedup of near-identical implementations.

That is worth stating one level up (below), because it is the opposite of what this codebase says it
prefers — AGENTS.md's *"Let the types catch it"* — and nobody could have seen it from inside any one
postmortem.

**The six worth doing first**, chosen for kills-by-construction over kills-by-test, and each cheap:

| # | from | the class-killer | size |
|---|---|---|---|
| a | `260904a-four-billing-faults` | `portalDrift` (`scripts/stripe-setup.ts:937`) compares Portal features with five hand-written `if`s. Keyed off `Record<keyof Stripe.BillingPortal.Configuration.Features, …>` a sixth SDK feature cannot go unnoticed — which is precisely how `subscription_update` was missed, at the cost of a paying customer unable to upgrade for a month. | small |
| b | `260903e-three-attempts` | `npm run lint` never checks that biome's config **parsed**. Renaming `biome.jsonc` → `.json` silently reverts every rule to default and exits 0; [linting.md](../project/linting.md) records the incident (83 warnings silently reappeared) *and* the detection command, wired into nothing. One grep in the `lint` script. | one line |
| c | `260904d-a-presentation-rule` | Nothing stops a second `DOMPurify.addHook` landing outside `src/sanitize-policy.ts` — the boundary [security-map.md](../project/security-map.md) names as the untrusted-HTML seam. A path-scoped biome rule. | small |
| d | `260904b-a-sentence-written-for-the-reader` | `stepGaveUp`'s generic `blocked` fallback logs nothing, so a step that should have declared a reader-facing reason and didn't is invisible until a reader complains. The postmortem argues the would-have-fired case itself: the actual incident ran six hours. One bounded `warn`. | one line |
| e | `260827d-toc-status-never-checked` | One `isTocCurrent(run, blocksHash)` instead of the two independently-maintained inline checks at `src/store/pg.ts:659` and in `pg-revisions.ts`. A shared signature makes the two questions un-splittable. | small refactor |
| f | `260828f-admin-id-was-the-local-one` | `isAdmin(userId)` takes a bare id and `ADMIN_USER_IDS` is a flat cross-project array. Comparing `(project, id)` is a **narrower signature that admits no cross-project id** — three call sites, by the postmortem's own estimate. | small |

Every one of these is a separate red-test-then-fix with its own review. **This is the next job, not
this one** — see Stages.

## T2.2 · `sweepAbandonedDrafts` has never had a caller

**Evidence: proved from the code.** Defined at `src/store/pg-revisions.ts:1786`; an exhaustive grep
over `src tests scripts evals api` returns the definition and **twenty comments**, and no call site.

The comments are the interesting part. `src/jobs.ts:1269` and `:2196`, `src/store/pg-jobs.ts:1173`,
`:1206`, `:1363`, `src/store/jobs.ts:226`, `:631`, `src/store/pg-session.ts:56` and three test files
all reason carefully about *what `sweepAbandonedDrafts` will do to a draft* — "spares a revision that
any job row names", "a draft it spares for ever" — and design around it. It does not run. Meanwhile
`src/store/revisions.ts:29` concedes the consequence in writing: each abandoned draft carries a full
copy of the article's `revision_blocks`, "so that is storage rather than tidiness, and it remains a
real gap".

Not Tier 0 (it grows slowly, and it is admitted), but it is the clearest case in the tree of a
mechanism that is *reasoned about* rather than *run*. Wiring it needs a schedule and a decision about
where periodic work lives, so it is a small design job rather than a line.

---

# Tier 3 — named and sized, not started

- **T3.1 · Split `src/routes.ts`.** Named as Tier 3 by both previous sweeps and by
  [260902e § 3.1](260902e-codebase-rework-umbrella-what-is-worth-doing-next.md). **The deferral has
  decayed again and this is the third sweep to write it down: 7,294 → 7,757 lines in two days**, 85
  commits in 30 days, still top of churn × complexity. Recorded not to defer to it a fourth time
  believing it is happening. It is not happening.
- **T3.2 · Schema-per-worktree test isolation.** Partly overtaken: the `private-postgres` lane landed
  2026-09-04 and [testing.md](../project/testing.md) now calls the old shared-database story "history
  rather than daily life". Four `shared-services` files remain. Re-size before restarting it.
- **T3.3 · The generalizing half of T2.1's other 35 items** — the `writeAtomic`/`readJson` dedup, the
  `mayPassThrough` static cross-check, the leaf-module import lint rule, the `isStructural` predicate
  migration. Each is its own plan; this doc's job is to name and size them, and stop.

---

# What came back clean

Negative results from a real sweep, recorded so the next run does not re-spend agents here.

- **The web client is coherent.** A whole-zone pass turned up one four-line dedup and nothing else.
  Escape-key handling looks like nine rival copies and is nine documented contracts; nuqs vs raw
  `URLSearchParams` is a documented split; the mode hooks all import the two shared hooks
  `new-mode.md` requires; `CACHEABLE` is derived and tested, not hand-maintained; the "13 modes, 4
  experimental" counts in the docs match `src/modes.ts` exactly.
- **The type system is not the weak point.** Zero real `as any` in `src/` or `api/`; the 29
  `as unknown as` sites are commented, single-purpose seam escapes. `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noUncheckedSideEffectImports` are all
  already on.
- **Stage ownership holds.** Cross-stage imports among the eight pipeline modules are shared leaf
  utilities, not artefact-boundary crossings.
- **Owner scoping.** `owned-slug.ts` / `require-slug.ts` / `articleIdForOwned`, hardened again
  2026-09-04 with a static guard on list queries; no gap found.
- **`PATCH` body validation** (`objectBody`/`fields`) is rolled out across all seven `PATCH` routes,
  not partially.
- **The bucket-allowlist class is genuinely closed** — all four recommendations of
  `260903f` are built, and `bucketDrift` runs from `scripts/deploy.ts` before migrations.
- **All twelve knip "unused files" are false positives** — ten preview pages reached from sibling
  `.html`, the witness config invoked by `--config`, and one untracked scratch file. Verified
  individually.
- **All 61 npm scripts point at files that exist.** Every `biome.jsonc` rule and allowlist entry
  carries a dated reason.
- **The function bundle is not growing towards anything.** 28.3 MB of a 250 MB ceiling.

---

# One level up: is the approach sound?

**Yes, and the previous sweep's answer stands** — this codebase writes down *why* at the point of
decision, including where a decision went against the advice recorded at the time, and that is rare
and worth protecting.

**But this run found the specific edge that habit has.** Three of the strongest findings here are
things this repo had **already discovered, already root-caused, and already written down**:

- the NUL bytes — found in 2026-08, found again in 2026-09-03, documented as a trap, and the count
  grew afterwards (T1.1);
- the biome config that can silently evaporate — the incident recorded, the detection command
  written into the doc, wired into nothing (T2.1b);
- and 41 postmortem recommendations, each of which somebody thought worth writing at the moment they
  understood the bug best (T2.1).

None of these is a failure of understanding. They are all the same failure of *transmission*: a
sentence in a doc, a paragraph in a plan, a recommendation at the foot of a postmortem — each of them
addressed to the next **reader**, and none of them addressed to the next **tool**. The reader is not
reliably there. `evals/hierarchy-structure/run.ts` got its NUL byte after the warning was written,
from an author who had no reason to have read it.

So the rework worth doing in this codebase is not more analysis. It is **converting conclusions it
has already reached into checks**, and the method's own ranking says which conversion to reach for:
a type the compiler refuses, then a lint rule, then a test, and only then a doc line. T1.1 is what
that looks like when it works — a paragraph proposed on 2026-09-03 and never landed, replaced by a
seventy-line test that caught its author within a minute of being written.

**One caution against over-reading it.** 28 of 74 recommendations *were* built, and the two previous
sweeps' guards have both since gone red on real regressions. The follow-through is not absent; it is
biased — towards the specific and away from the general — and a bias is a cheaper thing to correct
than an absence.

---

# Stages

**Stage 1 — done, committed with this plan.** T1.1 (the five files, the guard test, the equivalence
proof), T1.2 (the undeclared dependency), T1.3 and T1.5 (three false claims deleted), T1.4 (four
assertions retargeted). No behaviour changes anywhere; the two behaviour-adjacent edits are proved
equivalent rather than assumed.

**Stage 2 — the next job, and it is T2.1's six.** Each of a–f is a red test then a fix then its own
review, and they touch six disjoint file sets, so they can run in parallel. Start with (b) and (d):
both are one line, both close a class that has already cost real time, and (b) protects every other
lint-shaped fix in the list from being silently disabled. Then (a), (c), (e), (f).

**Stage 3 — T2.2 and the T1.6 residue.** A schedule for `sweepAbandonedDrafts` is a decision, not a
line, so it wants Greg. The three residue items are twenty minutes together.

## Not doing, and why

- **The 35 non-exported copy literals** (T1.4) — they belong to `copy.md`'s own stated batch, and
  moving them here would be a second answer to a question that doc already owns.
- **Splitting `routes.ts`, `styles.css` or `App.tsx`** — Tier 3, Greg's call, and already refused
  respectively. Unchanged.
- **Deleting the three redundant memory files** — an agent should not delete another agent's memory
  on its own judgment. Named for Greg.
- **The bidi characters in `src/html.ts:65`** — invisible in an editor, which is a real hazard, but
  a different one from the NUL bytes and not what this stage is about.
- **knip's 141 unused exports / 122 types** — explicitly declined by
  [260903a](260903a-improve-the-codebase-sweep.md) as "mechanical, zero line count, high diff noise".
  Still true; the growth from 124/103 is tracked above rather than acted on.
- **Any change to the remote database** — out of scope for an unattended run.

## What the next sweep should know

**The tools this method depends on can be lying to you, and you will not be told.** Five files were
invisible to `grep` for the whole of two previous sweeps and most of this one. Both agents that found
it found it *by accident*, chasing something else. Before trusting a zero, ask what would make the
search itself fail — and note that `git grep` and `rg` were right about these files the whole time,
so the cheap defence is to cross-check a surprising zero with a second tool.

**Read a deferral's date, not its words.** Three claims in this plan were stale in the *helpful*
direction — a postmortem's "still open" that had been built since, a memory file whose trap the docs
now cover better, an open worry about bundle growth that a measurement closed. The census marked 28
of 74 as built-since. Believing "not built" would have wasted a stage.

**And one about the shape of a fix.** The most useful thing this run produced is not a fix but a
distinction: of the 50 test assertions that duplicate a source literal, 15 name an exported constant,
and **more than half of those must not be changed** because the wording is the requirement. A sweep
that had counted and not read would have landed a mechanical fix that turned eight real assertions
into tautologies. Count with a grep; clear each member by reading it.


---

# The new test, in full

```ts
/**
 * **No source file contains a raw NUL byte, because `grep` goes silent on the
 * ones that do.**
 *
 * A composite key wants a separator that cannot appear in the data, and `\0` is
 * the right choice for that. The hazard is not the byte, it is *writing it as a
 * byte* instead of as the two-character escape: `` `${a}\0${b}` `` and a literal
 * `0x00` in the source produce the identical string, and only the second one
 * makes every text tool treat the whole file as binary.
 *
 * What that costs here is specific and large. `grep -rn` over `src/` prints
 * nothing for a file it has decided is binary — no match, no warning, no
 * non-zero exit. Every audit this repo runs on itself is a grep: the periodic
 * sweep in docs/reusable/improve-the-codebase.md, the rename hunt in
 * docs/reusable/rename-or-move.md, and any agent asking "who calls this?". All
 * of them read a silent zero as *there is nothing there*, which is
 * docs/reusable/silent-success.md exactly.
 *
 * **This is the third time.** `src/store/import.ts` had one, and it "cost twenty
 * minutes of believing a function did not exist"
 * (docs/plans/260826e-postgres-storage-implementation.md); it was fixed and
 * nothing was left behind to stop the next one. Four more were found on
 * 2026-09-03 and written up as a trap to document rather than a thing to fix
 * (docs/plans/260903j-illustrated-415-and-one-click-paint.md); the sentence was
 * never landed, and by 2026-09-05 the count had grown to five —
 * `evals/hierarchy-structure/run.ts` acquired one *after* that write-up, which
 * is what a written-down warning with no check is worth.
 *
 * So the fix is this test rather than a paragraph. Nobody has to know the rule:
 * the escape and the byte behave identically, so the only way to notice you
 * picked the wrong one is a check that reads the bytes.
 *
 * **Text files only, and deliberately so.** Fixtures, model captures and media
 * are excluded — a captured `.raw.json` is meant to be whatever the model sent,
 * and holding it to this rule would be holding the wrong thing to it.
 */
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Everything a person writes and an agent greps.
 *
 * `evals/` is in because that is where the fifth one landed, and it landed there
 * *because* the 2026-09-03 pass looked only at `src/`. **`docs/` is in for the
 * same reason, one generation later:** the first version of this list covered
 * code only, and the plan documenting this very finding
 * (docs/plans/260905b-improve-the-codebase-third-sweep.md) was written with a
 * raw NUL in it — caught by hand, not by this test, because prose was out of
 * scope. Prose is the half agents grep hardest.
 */
const SOURCE_FILES = [
  ...globSync("src/**/*.{ts,tsx,css}"),
  ...globSync("tests/**/*.{ts,tsx}"),
  ...globSync("scripts/**/*.{ts,tsx}"),
  ...globSync("evals/**/*.{ts,tsx}"),
  ...globSync("api/*.js"),
  ...globSync("styles/*.css"),
  ...globSync("*.config.ts"),
  ...globSync("docs/**/*.md"),
  ...globSync("*.md"),
];

describe("no source file carries a raw NUL byte", () => {
  it("finds every file a text search would silently skip", () => {
    /* The scan is over bytes, not over a decoded string: reading as utf8 and
       looking for the decoded character would work today but describes the wrong property.
       What breaks grep is the byte. */
    const offenders = SOURCE_FILES.filter((file) => readFileSync(file).includes(0)).sort();

    expect(
      offenders,
      `these files contain a literal 0x00, so \`grep\` treats them as binary and ` +
        `returns nothing for any pattern inside them. Write the escape (\\u0000) ` +
        `instead of the byte — the string value is identical.`,
    ).toEqual([]);
  });

  it("covers enough of the tree to be worth having", () => {
    /* A glob that quietly stopped matching would leave this test passing while
       checking nothing, which is the failure mode the file above is about. */
    expect(SOURCE_FILES.length).toBeGreaterThan(500);
  });
});
```

---

# The Stage 1 diff

```diff
diff --git a/docs/project/sentry-error-monitoring.md b/docs/project/sentry-error-monitoring.md
index 6665c0c6..15f76c9b 100644
--- a/docs/project/sentry-error-monitoring.md
+++ b/docs/project/sentry-error-monitoring.md
@@ -27,9 +27,12 @@ A failed ingest step arrives tagged `step`, `slug` and `jobId`, from `captureFai
 
 ## What reaches it, and what does not
 
-**Capture is an explicit call beside the log line, never a side effect of logging.** Six seams:
-[`src/routes.ts`](../../src/routes.ts)'s outer catch and its three streams, and
-[`src/jobs.ts`](../../src/jobs.ts)'s failed step and pump.
+**Capture is an explicit call beside the log line, never a side effect of logging.** The seams are
+[`src/routes.ts`](../../src/routes.ts)'s outer catch plus a call per streaming route, and
+[`src/jobs.ts`](../../src/jobs.ts)'s failed step and pump. The count moves every time a mode ships —
+it read "three streams" until 2026-09-05, by which time `routes.ts` alone had thirteen call sites
+across seven routes — so `grep -c captureFailure src/routes.ts` is the answer rather than a number
+written here.
 
 **The rule for the request seams is the status we answered with**, `>= 500` — the same threshold
 `logRequest` uses to choose between `warn` and `error`, so the log and the tracker cannot come to
diff --git a/docs/project/worktrees.md b/docs/project/worktrees.md
index 4827623e..f27f0d83 100644
--- a/docs/project/worktrees.md
+++ b/docs/project/worktrees.md
@@ -28,7 +28,7 @@ What is built:
 | the `level with origin/dev` gate | **Being on the trunk is not being level with it.** `preflight` only ever compared against `origin/main`, which proves the candidate contains current *production* and says nothing about current *trunk* — so a stale `dev` could promote code missing commits that had landed, and report success. The gate requires the captured sha to equal a freshly fetched `origin/dev`, and fails closed if the trunk cannot be read. Forcible as `--force-gate='level with origin/dev'`. |
 | [`vercel.json`](../../vercel.json) | `git.deploymentEnabled` is default-deny — `{"**": false, "main": true}` — so only production builds. |
 | [`.gitignore`](../../.gitignore) | `.claude/worktrees/` — where `claude --worktree <name>` puts a worktree. Ignored rather than merely untracked, because the primary would otherwise see every peer's whole checkout as untracked files and the commit recipe leans on `git status` being readable. |
-| [`.worktreeinclude`](../../.worktreeinclude) | `.env.local` and `.env`, copied into each new worktree. `.env.prod` deliberately absent. **It is no longer true that this is what stops a worktree deploying** — `deployBranchProblem` refusing `worktree-*` by name is, and `npm run deploy` fails earlier still, because a linked worktree's `.git` is a *file* and the deploy lock cannot be written inside it (`ENOTDIR`, measured 2026-09-03). Since that day `readEnvProd` ([`src/env.ts`](../../src/env.ts)) reads the **primary's** `.env.prod` when this one has none, so `npm run stripe:setup -- --prod` does work from here; it prints which file it read, on purpose. The absence is now one barrier among three rather than the barrier. |
+| [`.worktreeinclude`](../../.worktreeinclude) | `.env.local` and `.env`, copied into each new worktree. `.env.prod` deliberately absent. **It is no longer true that this is what stops a worktree deploying** — `deployBranchProblem` refusing `worktree-*` by name is. The deploy lock used to fail earlier still, because a linked worktree's `.git` is a *file* and the lock could not be written inside it (`ENOTDIR`, measured 2026-09-03) — **fixed on 2026-09-04 in `4405df8e`**, which resolves the path with `git rev-parse --git-common-dir`, so every worktree now contends for the primary's one lock rather than each quietly taking its own. Since 2026-09-03 `readEnvProd` ([`src/env.ts`](../../src/env.ts)) reads the **primary's** `.env.prod` when this one has none, so `npm run stripe:setup -- --prod` does work from here; it prints which file it read, on purpose. The absence is now one barrier among two rather than the barrier. |
 | [`scripts/typecheck.ts`](../../scripts/typecheck.ts) | `.claude/worktrees` in `SKIP_PATHS`. **The one scanner that actually walks in** — it recurses from the repository root, so a worktree's `tsconfig.json` became a project of the primary's. A **joined path, not a basename in `SKIP`**, because `.claude/` also holds the tracked hooks and settings, and skipping every directory of that name would hide a TypeScript hook added there later. biome, knip and jscpd need nothing: their globs are anchored allowlists. |
 | [`vite.config.ts`](../../vite.config.ts) | `server.watch.ignored` gains `**/.claude/worktrees/**`, so a peer's keystrokes do not reload your page. Plus a startup warning when the port is not allow-listed — see [Ports and the ceiling](#ports-and-the-ceiling). |
 | [`scripts/worktree-port.ts`](../../scripts/worktree-port.ts) | The range, `PRIMARY_PORT`, `portInRange`, `parseDevPortEnv` and `allowListedPorts`. **No allocator**: Greg redirected the design to dynamic allocation on 2026-09-01, and the reservation, its tests and an export added to `lockfile.ts` for it were deleted — see [Ports and the ceiling](#ports-and-the-ceiling). |
diff --git a/evals/hierarchy-structure/run.ts b/evals/hierarchy-structure/run.ts
index 908bfed9..b1ad87d6 100644
--- a/evals/hierarchy-structure/run.ts
+++ b/evals/hierarchy-structure/run.ts
@@ -656,8 +656,8 @@ async function main(): Promise<void> {
   /* The marker goes on last, and only if every cell it promised has a row.
      `--repeat` means one expected cell can have several results, so the test is
      coverage, not a count. */
-  const filled = new Set(runFile.results.map((r) => `${r.arm}<RAW-NUL-BYTE-HERE>${r.slug}`));
-  const missing = runFile.expected.filter((e) => !filled.has(`${e.arm}<RAW-NUL-BYTE-HERE>${e.slug}`));
+  const filled = new Set(runFile.results.map((r) => `${r.arm}\u0000${r.slug}`));
+  const missing = runFile.expected.filter((e) => !filled.has(`${e.arm}\u0000${e.slug}`));
   if (missing.length === 0) {
     runFile.completedAt = new Date().toISOString();
   } else {
diff --git a/package.json b/package.json
index 3b510a81..0ca04d00 100644
--- a/package.json
+++ b/package.json
@@ -99,6 +99,7 @@
     "pdf-lib": "^1.17.1",
     "pdfjs-dist": "^6.2.108",
     "pg": "8.23.0",
+    "pg-connection-string": "^2.14.0",
     "pino": "^10.3.1",
     "radix-ui": "^1.6.7",
     "react": "^19.2.8",
diff --git a/src/html.ts b/src/html.ts
index a95d81f1..8d2b05f8 100644
--- a/src/html.ts
+++ b/src/html.ts
@@ -67,13 +67,13 @@ const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
 /**
  * Everything that is a line break, a tab, or a control code, as one class.
  *
- * C0 (`<RAW-NUL-BYTE-HERE>`–``) and C1 (``–``). CR, LF and tab are in
+ * C0 (`\u0000`–`\u001f`) and C1 (`\u007f`–`\u009f`). CR, LF and tab are in
  * there by construction, which is deliberate: a `<meta content="…">` is a
  * single line, and a title containing a newline is not dangerous so much as
  * simply wrong — it renders as a space in some readers, as nothing in others,
  * and is a different string from the one anybody compared it against.
  */
-const CONTROLS = /[<RAW-NUL-BYTE-HERE>--]/g;
+const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
 
 /**
  * **Steps 1-3 on their own: one line, single spaces, no bidi overrides.**
diff --git a/src/illustrated-plate.ts b/src/illustrated-plate.ts
index 6e8daa98..1bfb7ade 100644
--- a/src/illustrated-plate.ts
+++ b/src/illustrated-plate.ts
@@ -902,7 +902,7 @@ function readVignettes(
     /* The same thing drawn twice is one row in the reader's list twice, and one
        instruction to the illustrator twice. Cheap to drop, and it is evidence
        the model lost its place. */
-    const key = `${v.block}<RAW-NUL-BYTE-HERE>${v.quote}<RAW-NUL-BYTE-HERE>${v.depicts}`;
+    const key = `${v.block}\u0000${v.quote}\u0000${v.depicts}`;
     if (already.has(key)) {
       faults.push({ where: at, what: "the same vignette again — dropped" });
       continue;
diff --git a/src/store/contracts.ts b/src/store/contracts.ts
index a63c7706..0699cf68 100644
--- a/src/store/contracts.ts
+++ b/src/store/contracts.ts
@@ -26,12 +26,19 @@
  *    has since landed, and its contract lives in [jobs.ts](jobs.ts), not here:
  *    a second `JobStore` was declared in this file and never implemented, so it
  *    drifted into declaring a different `claim`, `get` and expiry sweep from the
- *    real one, and it has been deleted. Chat and searches belong to this
- *    group and have **no interface here yet**: they still write straight to the
- *    filesystem, which is why `postgres` mode currently serves them from files.
- *    That is item 10 of docs/plans/260826e-postgres-storage-implementation.md, not an
- *    oversight — but this list said `ChatStore` and `SearchStore` were declared
- *    here when they were not, which is worse than saying nothing.
+ *    real one, and it has been deleted. Chat and searches belong to this group
+ *    and their interfaces are `ChatStore` and `SearchStore`, below, both wired
+ *    to Postgres in [index.ts](index.ts).
+ *
+ *    **This sentence has now been wrong in both directions, which is the part
+ *    worth keeping.** It first claimed the two were declared here when they were
+ *    not; the correction said they had "no interface here yet" and that
+ *    `postgres` mode served them from files — and four hours later `05b9983a`
+ *    added both interfaces to this very file. The corrected sentence outlived
+ *    its own truth by longer than the wrong one had. `db-errors.ts` describes
+ *    the same fact and was fixed on 2026-09-03; this copy was not, because
+ *    nothing connects them. A claim about what is wired is a claim that decays,
+ *    and prose is the wrong place to keep one.
  *
  * ## What is deliberately NOT in here
  *
diff --git a/src/web/IllustratedView.tsx b/src/web/IllustratedView.tsx
index b0ddffaf..ca3ec867 100644
--- a/src/web/IllustratedView.tsx
+++ b/src/web/IllustratedView.tsx
@@ -145,7 +145,7 @@ function usePlateBytes(
    */
   const sha256 = image?.sha256 ?? null;
   const ext = image?.ext ?? null;
-  const key = image === null ? "" : `${slug}<RAW-NUL-BYTE-HERE>${image.sha256}<RAW-NUL-BYTE-HERE>${image.ext}`;
+  const key = image === null ? "" : `${slug}\u0000${image.sha256}\u0000${image.ext}`;
   const [got, setGot] = useState<{ key: string; url: string } | null>(null);
   const [failure, setFailure] = useState<{ key: string; why: string } | null>(null);
   const url = got?.key === key ? got.url : null;
@@ -527,7 +527,7 @@ export function IllustratedView({ slug, blocks, onJump }: Props) {
                   one React key, which is a rendering bug that only appears on
                   an artefact nobody has yet. */}
               {plate.vignettes.map((v) => (
-                <li key={`${v.block}<RAW-NUL-BYTE-HERE>${v.quote}<RAW-NUL-BYTE-HERE>${v.depicts}`}>
+                <li key={`${v.block}\u0000${v.quote}\u0000${v.depicts}`}>
                   {/* **Close the overlay first, and always, not only when it is
                       open.** The article is `inert` under a modal `<dialog>`, so
                       a jump made from full screen scrolls a page nobody can see
diff --git a/src/web/useIllustrated.ts b/src/web/useIllustrated.ts
index 979220ff..5d5dff71 100644
--- a/src/web/useIllustrated.ts
+++ b/src/web/useIllustrated.ts
@@ -297,7 +297,7 @@ export function useIllustrated(slug: string, blocks: readonly Block[]): UseIllus
   const sketch = useSketchReadiness(
     slug,
     status === "none",
-    `${queue.failed ?? ""}<RAW-NUL-BYTE-HERE>${queue.job?.id ?? ""}`,
+    `${queue.failed ?? ""}\u0000${queue.job?.id ?? ""}`,
   );
 
   /**
diff --git a/tests/access-sharing.test.tsx b/tests/access-sharing.test.tsx
index 10f9bfd5..0e47435b 100644
--- a/tests/access-sharing.test.tsx
+++ b/tests/access-sharing.test.tsx
@@ -26,7 +26,13 @@ import type { ArticleSharing, PublicArtefacts, Visibility } from "../src/types.j
 import { createRoot, type Root } from "react-dom/client";
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 
-import { SHARING_ON, sharingConfirmBody } from "../src/messages.js";
+import {
+  SHARING_NOT_PERSONALISED,
+  SHARING_ON,
+  SHARING_PERSONALISED,
+  SHARING_RIGHTS_CONFIRM,
+  sharingConfirmBody,
+} from "../src/messages.js";
 
 vi.mock("../src/web/lib/supabase.js", () => ({
   supabase: {
@@ -281,7 +287,7 @@ describe("turning it on", () => {
     );
     expect(share?.disabled).toBe(true);
     // And the reason is on the page rather than in a tooltip.
-    expect(host.textContent).toContain("I have the right to share this article's text");
+    expect(host.textContent).toContain(SHARING_RIGHTS_CONFIRM);
     expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
   });
 
@@ -356,13 +362,13 @@ describe("what the dialog says about the reader's profile", () => {
        exists with the field somehow missing — defensive, and the branch has to
        be total. */
     await openDialog(withKinds(undefined as unknown as ArticleSharing["personalised"]));
-    expect(host.textContent).toContain("may have been written for your reader profile");
+    expect(host.textContent).toContain(SHARING_PERSONALISED);
   });
 
   it("says plainly when none were", async () => {
     await openDialog(withKinds([]));
 
-    expect(host.textContent).toContain("Nothing here was written for your reader profile");
+    expect(host.textContent).toContain(SHARING_NOT_PERSONALISED);
     // And NOT the hedge, which would leave the owner assuming the general case.
     expect(host.textContent).not.toContain("may have been written");
   });
diff --git a/tests/metadata-sharing-card.test.tsx b/tests/metadata-sharing-card.test.tsx
index eb7138a7..0dfdb672 100644
--- a/tests/metadata-sharing-card.test.tsx
+++ b/tests/metadata-sharing-card.test.tsx
@@ -21,6 +21,7 @@ import { createRoot, type Root } from "react-dom/client";
 import { NuqsAdapter } from "nuqs/adapters/react";
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
 import type { Article, PublicArtefacts } from "../src/types.js";
+import { SHARING_INVENTORY_UNKNOWN } from "../src/messages.js";
 import { CARD } from "../src/web/card.js";
 
 vi.mock("../src/web/lib/supabase.js", () => ({
@@ -237,7 +238,7 @@ describe("the sharing card, on the page that owns it", () => {
     await open();
 
     expect(host.textContent).toContain("Only you can read this");
-    expect(host.textContent).toContain("We could not work out what a shared link would carry");
+    expect(host.textContent).toContain(SHARING_INVENTORY_UNKNOWN);
     expect(host.textContent).not.toContain("Share with anyone");
   });
 
```


---

**A note on the diff above:** the eleven raw 0x00 bytes on its `-` lines have been replaced with the literal text `<RAW-NUL-BYTE-HERE>` so that this prompt could be passed to you at all. The first attempt was refused outright — `The argument must be a string without null bytes` — which is a sixth demonstration of the finding: the evidence for the bug cannot travel through the tooling while the bug is in it.
