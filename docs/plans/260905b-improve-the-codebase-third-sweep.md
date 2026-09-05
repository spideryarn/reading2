# Improve the codebase — the 2026-09-05 sweep

The third run of [improve-the-codebase.md](../reusable/improve-the-codebase.md), two days after
[260903a](260903a-improve-the-codebase-sweep.md) and
[260903d](260903d-improve-the-codebase-second-sweep.md), against a tree that took **438 commits —
276 of them not merges** — in between (`git log --since=2026-09-03`, run 2026-09-05). Read those two
first; this one starts where they stopped and does not re-open what they settled.

**The headline is not a bug.** Across the 21 postmortems that name an open recommendation, **41 of
74 code-verifiable recommendations are still unbuilt today** — re-verified against this tree rather
than taken from the postmortems' own words, because a deferral decays in both directions.

What that count *suggests*, and what T2.1 is careful to label a hypothesis rather than a finding, is
that the unbuilt residue is disproportionately the **generalizing** step — the lint rule, the shared
signature, the static cross-check between two lists that must agree — while the fix scoped to the
one incident lands. That would be the opposite of what AGENTS.md says this codebase prefers. It is
also an open-enriched sample with at least three confounds, so it is written down as the most
interesting thing to test next, not as a result.

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

At `f1ee632f`. `npm test` was **not** run at the start: 13 worktrees shared one box and four other
agents' vitest processes were live, which is the condition
[260903d](260903d-improve-the-codebase-second-sweep.md) showed makes a red result meaningless. The
suites named below were run one file at a time instead, and the full suite was run at the end, when
load had dropped to 2.8.

**It went red first, and the 27 failures are worth recording because none of them was real.** Six
files, 27 tests: `pipeline-artifact-store`, `store-parity`, `store-roundtrip`,
`store-artefact-manifest` (a missing fixture corpus) and `pdf-bundle-trace`, `cold-start-lazy-imports`
(a missing build). All four paths are gitignored, so a fresh worktree has none of them — and
`npm run worktree:setup` never reached the step that fills `data/`, because it died on the merge
conflict first. [worktrees.md § A worktree with an empty `data/`](../project/worktrees.md) predicts
this exactly, at "~50 test failures"; 27 is within it.

Rather than reason about that, it was checked: `materialiseCorpus` was run on its own and
`npm run build` completed, after which **all six files pass** (232 + 4 tests). Then the whole suite,
on the same tree:

```
Test Files  663 passed | 1 skipped (664)
     Tests  11885 passed | 36 skipped (11921)
```

Plus `typecheck` clean across all three projects, `cycles` clean, `db:chain` clean, `build` exit 0,
and `lint` unchanged at its two pre-existing `noControlCharactersInRegex` errors in `src/html.ts`.

| | 2026-09-03 (previous sweep) | today |
|---|---|---|
| `npm run typecheck` | clean | **clean** (1,281 files across three projects) |
| knip unused files | 9 | **12** — all twelve verified false positives (preview pages, the witness config, one untracked scratch file). Measured in the primary checkout: knip cannot finish the file pass in a fresh worktree, because loading `vite.api.config.ts` refuses a missing `dist/` |
| knip unused exports / types | 124 / 103 | **141 / 122** — re-measured here, agreeing with the primary's run |
| jscpd clones | 258 | **293** |
| `src/routes.ts` | 7,294 lines | **7,757**, 85 commits in 30 days — still top of churn × complexity |
| worktrees sharing one Postgres | 11 | **13** |
| source files invisible to `grep` | *nobody had counted* | **5** |

**The Vercel function bundle, measured rather than worried about.** `260905a` handed the next sweep
a number — the `@vercel/nft` trace collected 4,413 files, up ~45% since 2026-09-03 — and said it was
"a thing to look at". Looked at, twice:

| trace | files | unzipped |
|---|---|---|
| the primary's `api-dist/`, built 2026-09-05 00:49 | 2,946 | 28.3 MB |
| a fresh `npm run build` in this worktree | 3,032 | 29.6 MB |

**Around 12% of Vercel's 250 MB standard limit, so there is ample headroom today.** That is what the
measurement supports, and it is less than "growth is not a risk" — nothing here establishes a rate.
The largest items are `jsdom` at 6.7 MB, `pdfjs-dist` at 3.3 MB and our own compiled `vercel.js` at
5.1 MB.

**The 4,413 is still unexplained, but it is now narrowed.** Two independent traces, against two
different builds, agree with each other to within 3% and disagree with the test's figure by ~45%. So
whatever the difference is, it is in **how `tests/pdf-bundle-trace.test.ts` counts** rather than in
the bundle — worth ten minutes from whoever next touches that file, and not a reason to hold
anything up. The trace ran in ~25s here against the 441s recorded this morning, which says most of
that earlier measurement was box contention rather than bundle size.

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

**What exactly goes wrong depends on which `grep` you have, which is worse than either behaviour on
its own.** The review corrected me here — my first draft said flatly "no match, no warning, no
non-zero exit", and that is only true of this box. Measured on the same reconstructed file:

| | result |
|---|---|
| ugrep 7.8.4 — what `grep` is on this box | no output, **exit 1**, indistinguishable from a real absence |
| GNU grep 3.11 — Sol's environment | `binary file matches`, exit 0: discoverable, but with no `file:line` and easy to scroll past |

So an agent cannot tell from the output whether a file was searched or skipped, and on this machine
a hit reads exactly like nothing being there. **Every audit this repo runs on itself is a grep** —
this sweep, [rename-or-move.md](../reusable/rename-or-move.md), and any agent asking who calls a
thing — and all of them read that zero as *there is nothing there*, which is
[silent-success.md](../reusable/silent-success.md) exactly. `git grep` and `rg` read these files
correctly throughout, which is the cheap cross-check when a zero surprises you.

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

Then twice more: a memory file *about this trap* was written with one in its own `description:` line,
and two `Bash` calls were refused outright with *"command contains control characters that would be
hidden in the approval dialog"*. Five accidental NULs by one author inside one hour, every one of
them while concentrating on this exact subject, is the measurement that settles how much a written
warning was ever going to be worth — and a sixth, below, was written by somebody else entirely while
this plan was being reviewed.

**And the review found the guard still under-covering, which is the same mistake one level up.** Its
first version listed the globs it wanted, and an allowlist of text has exactly the shape of the bug:
it fails silently, in the direction of checking less. It was missing 14 `.mts`, nine `.mjs`, and
every `.sql`, `.html`, `.sh`, `.toml` and `.json` in the tree. Its `SOURCE_FILES.length > 500`
witness guarded nothing either — `docs/` alone is 1,220 files, so every code glob could have vanished
and it would still have passed. Inverted: the test now reads `git ls-files --cached --others
--exclude-standard` and checks everything except a named list of genuinely binary extensions, so a
new kind of source file is covered the day it arrives, by nobody's decision. Untracked files are
included deliberately — both files that acquired a NUL here were brand new, and a tracked-only check
would have seen neither until after the commit it exists to prevent. Verified against the whole
tree: of 3,162 tracked files, 78 contain a NUL and every one is a real image, video or PDF.

**Then a sixth arrived from somebody else, and the guard caught it.** Merging `origin/dev` to land
this work brought `tests/helpers/memory-artefacts.ts` — a new file, written by another agent today,
carrying **three** raw NUL bytes in exactly the same idiom (`` `${slug}` `` + separator + `` `${step}` ``).
Nobody involved had read the 2026-09-03 write-up; there is no reason they should have. The test went
red on the merge, named the file, and the fix took a minute. **That is the whole argument for
preferring a check to a paragraph, and it arrived unprompted within an hour of the check existing.**
All nine suites that use the helper — 158 tests — pass with the escapes.

**And the seventh is the best evidence in this plan.** The first attempt to send this work for its
cross-family review failed before it started:

```
run-codex: The argument 'args[15]' must be a string without null bytes.
```

The review prompt embeds the diff, and the diff's `-` lines carry the eleven bytes being removed. So
**the evidence for the defect could not travel through the tooling while the defect was in it** —
the eleven had to be rewritten as a visible marker before a reviewer could be shown them at all. A
byte that silences `grep`, breaks `file`, is invisible in an editor, and blocks the review pipeline
is not a stylistic preference about how to spell a separator.

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
and production ended up with nothing to sell. It is the only file that imports the package, and
exactly three scripts import *it* — `stripe-setup.ts`, `stripe-check.ts`, `check-buckets.ts`. (The
first draft said five, having counted two files that only name it in a comment. *A citation is not
an instance*, for the third time in this document.) A `pg` upgrade that drops the transitive dependency, or a package manager
with stricter isolation, breaks the safety script and nothing else.

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

**What this count does and does not establish.** GPT Sol pushed hard here and was right to; the
first draft of this section claimed a causal pattern the table cannot carry. Three confounds, all
of them real:

1. **Selection.** The 21 were chosen *by* containing the words "still open". Postmortems whose
   general recommendations all landed are excluded by construction, so the search is enriched for
   exactly the association being claimed.
2. **An incident fix usually exists before its postmortem is written.** "The incident-shaped fix
   always lands" is therefore largely structural — near tautological — rather than a result.
3. **Age and effort are not separated from shape.** Generalizing recommendations are typically
   newer, bigger, and explicitly flagged as future work. Either could explain the split on its own.

And the table above is aggregate: it does not classify the 74 as incident-shaped or class-shaped, so
the pattern cannot be *derived* from what is shown. The method asks for counts shown rather than
summarised, and on the pattern claim this doc does not meet its own bar.

So, stated at the strength the evidence supports:

> **Proved:** an open-enriched search across 21 postmortems found 41 recommendations that are still
> unbuilt today, re-verified against this tree rather than taken from the postmortems' own words.
> Six were independently revalidated by hand (below), and one of those six turned out to be
> mis-sized.
>
> **Hypothesis, worth testing and not yet tested:** that what stays unbuilt is disproportionately
> the *generalizing* step — the lint rule, the shared signature, the static check that two lists
> agree — rather than the fix scoped to the one incident. Testing it needs a shape-and-age
> classification over all 70 postmortems, not the 21 that advertise an open item.

This matters because [260903e](../postmortems/260903e-three-attempts-to-build-a-control-for-recorded-not-fixed.md)
already rejected a superficially similar postmortem-wide pattern after spot-checking counterexamples.
The hypothesis is still the most interesting thing this sweep found; it is just not yet a finding.

**The six revalidated by hand**, scored on value, ease and risk rather than size alone — value and
ease pick the order, risk can veto:

| # | from | the class-killer | value | ease | risk |
|---|---|---|---|---|---|
| b | `260903e-three-attempts` | `npm run lint` never checks that biome's config **parsed**. Renaming `biome.jsonc` → `.json` silently reverts every rule to default and exits 0; [linting.md](../project/linting.md) records the incident (83 warnings silently reappeared) *and* the detection command, wired into nothing. | **high** — it is the floor under every other lint-shaped fix in this table, including (c) | one line in the `lint` script | none |
| a | `260904a-four-billing-faults` | `portalDrift` (`scripts/stripe-setup.ts:937`) compares Portal features with five hand-written `if`s. Keyed off `Record<keyof Stripe.BillingPortal.Configuration.Features, …>`, a sixth SDK feature cannot go unnoticed — which is exactly how `subscription_update` was missed, at the cost of a paying customer unable to upgrade for a month. | **highest** — the only one with a known customer-facing cost | small; the desired shape already exists | low; a script, not a request path |
| c | `260904d-a-presentation-rule` | Nothing stops a second `DOMPurify.addHook` landing outside `src/sanitize-policy.ts` — the boundary [security-map.md](../project/security-map.md) names as the untrusted-HTML seam. A path-scoped biome rule. | **high** — a security boundary, and the incident already breached it once | small, once (b) guarantees the config is live | none; lint only |
| d | `260904b-a-sentence-written-for-the-reader` | `stepGaveUp`'s generic `blocked` fallback logs nothing, so a step that should have declared a reader-facing reason and did not is invisible until a reader complains. The postmortem argues the would-have-fired case itself: the actual incident ran six hours. | medium — a signal, not a fix; bounded at one `warn` per fallback | one line | low, but it is a request path — check the log volume |
| e | `260827d-toc-status-never-checked` | One `isTocCurrent(run, blocksHash)` instead of the two independently-maintained inline checks at `src/store/pg.ts:659` and in `pg-revisions.ts`. A shared signature makes the two questions un-splittable. | medium | small refactor | medium — it changes a live staleness decision, so characterise first |
| f | `260828f-admin-id-was-the-local-one` | `isAdmin(userId)` takes a bare id and `ADMIN_USER_IDS` is a flat cross-project array. | **re-scoped — see below** | **not small** | — |

**(f) is the cautionary one, and it is mine.** The first draft repeated the postmortem's "three call
sites" estimate. There are **11 production call sites** today (`git grep -n 'isAdmin(' -- src`,
2026-09-05), and four of them are in the *client* — `App.tsx:589`, `Library.tsx:343`,
`admin-columns.tsx:204,260,330` — which has no server project to pass. Three more
(`billing/admission.ts`, `billing/summary.ts`, `store/contracts.ts:1719`) hold only an owner id. So
threading `(project, id)` is a seam change, not a signature tweak, and
[260828f](../postmortems/260828f-admin-id-was-the-local-one.md) itself later concludes the more
useful open fix is a **deploy-time identity check** instead. Re-scope before scheduling; do not start
it from this table.

**I inherited a stale estimate in the same document that says a deferral is a claim and it decays.**
Recorded rather than quietly corrected, because it is the cheapest possible demonstration of why
that rule is there.

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

**Two cautions against over-reading it.**

**The follow-through is not absent.** 28 of 74 recommendations *were* built, and the two previous
sweeps' guards have both since gone red on real regressions — the system works. Whether what is left
is *biased* towards the specific, or merely newer and larger, is the hypothesis in T2.1 and is not
settled here.

**And the transmission argument does not depend on that hypothesis**, which is why it is stated
separately. The NUL bytes and the biome config are each a complete case on their own: a conclusion
reached, written down, addressed to a reader, and then not acted on by the next author — verified
end to end, twice, without needing the census at all. That is enough to justify the rework. The
census would only tell us how *common* it is.

---

# Stages

**Stage 1 — written, reviewed, and landing in the same commit as this plan.** T1.1 (the five files,
the guard test, the equivalence proof), T1.2 (the undeclared dependency), T1.3 and T1.5 (three false
claims deleted), T1.4 (four assertions paired with the constants they render). No behaviour changes
anywhere; the one behaviour-adjacent edit is proved equivalent rather than assumed, twice — over
U+0000..U+2FFF here, and exhaustively over every UTF-16 code unit by the review.

**Stage 2 — the next job, and it is T2.1's six.** Each of a–f is a red test then a fix then its own
review, and they touch six disjoint file sets, so they can run in parallel. Start with (b) and (d):
both are one line, both close a class that has already cost real time, and (b) protects every other
lint-shaped fix in the list from being silently disabled. Then (a), (c), (e), (f).

**Stage 3 — T2.2 and the T1.6 residue.** A schedule for `sweepAbandonedDrafts` is a decision, not a
line, so it wants Greg. The three residue items are twenty minutes together.

## Landing it: two agents had fixed the same two bugs differently

`npm run worktree:setup` could not finish here, and the push needed the same merge. `origin/dev` had
moved 30 commits ahead of the primary's unpushed `f1ee632f`, and both had fixed the three reds that
[260905a](260905a-three-reds-on-dev-after-the-deploy-sweep.md) reported this morning — separately,
without meeting. Neither side was mine. Put to Greg as a proposal before an edit, per
[git-resolve-merge-conflicts.md](../reusable/git-resolve-merge-conflicts.md), and settled on
judgment:

- **`tests/shared-notice-hides-with-the-masthead.test.tsx` — kept this side's assertions, both
  sides' reasoning.** `origin/dev` asserts `toContain(SHARED_WITH_YOU)`; the primary asserts the same
  thing *through the renderer* and adds a non-empty guard, both of which came out of a GPT Sol
  review. Those are strictly stronger — `toContain("")` is vacuously true, and a raw comparison
  breaks on the first `&` in the copy. But `origin/dev`'s comment carried history the other lacked:
  *why* the sentence had to stop saying somebody sent this reader a link. That paragraph is now
  folded in.
- **`tests/public-dispatch.test.ts` — took `origin/dev`'s uuid.** Both sides replaced the colliding
  `…0000ed` with something unique, and neither replacement collides with anything (checked). The
  choice is arbitrary, so the tiebreak is that `origin/dev`'s is already what every other worktree
  runs against.

**And the merge's own silent success is worth a line.** Both sides had added the *same* import of
`SHARED_WITH_YOU`, on different lines. Git merged them without a conflict — into a file with the
identifier declared twice, which no longer parses. The merge reported success; only running the
suite found it. That is the shape this whole plan is about, arriving unprompted during the landing
of it.

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

**The review is the reason four of these findings are right.** It returned *not ready* and every
substantive objection held: the headline claimed a pattern its own table could not carry; the guard
was missing nine file types; item (f) repeated the postmortem's week-old estimate of three call
sites, where there are now eleven; and the four retargeted assertions had genuinely become weaker, because a test and a
component importing the same constant move together. That last one was a regression I introduced
while fixing a different one, and only a reader who did not write it was going to see it. **Budget
for the review. This is the third sweep in a row where it came back *not ready* and was right.**

**And one about the shape of a fix.** The most useful thing this run produced is not a fix but a
distinction: of the 50 test assertions that duplicate a source literal, 15 name an exported constant,
and **more than half of those must not be changed** because the wording is the requirement. A sweep
that had counted and not read would have landed a mechanical fix that turned eight real assertions
into tautologies. Count with a grep; clear each member by reading it.
