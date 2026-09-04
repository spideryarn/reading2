# Doc gaps — a trawl, and what it found

**Status, 2026-09-04: the trawl is finished and reviewed; none of the edits it proposes are made.**
The register below is the deliverable and it is complete. What is left is Greg picking tiers, and
then a few hours of small edits to existing docs plus at most two new ones. Nothing is half-done and
nothing is blocked — see § [Where this stands](#where-this-stands).

**Nothing here is built.** This is a register of findings for Greg to approve or drop, in tiers.
Greg asked for the trawl on 2026-09-04, with the method delegated to Fable and the bulk reading to
GPT Luna, "because it's 10x cheaper than Sonnet".

**It has been through GPT Sol, and Sol deleted a third of it.** What survives is what survived that.
§ [What the review killed](#what-the-review-killed-and-why-the-method-let-it-through) is the honest
account, and is the most useful part of this document if you read only one section.

## What was searched, and what it cost

Six Luna calls, roughly 1.5M input tokens, an hour wall-clock at four-wide. The axes:

| | Corpus | Survived review |
|---|---|---|
| A | the leading docblock of every source file over 120 lines (450 files, 682 KB) | 2 of 7 |
| B | all 69 postmortems, clustered by the **class** each names | 3 of 6 |
| C | `docs/project/` itself — questions answered in five or more docs and owned by none | 2 of 7 |
| D | the 70 September plans, for decisions that never reached a project doc | 3 of 7 |
| E1–E4 | the **body** of every code-touching commit since 2026-08-28 (1.3 MB, four slices) | 8 of 17 |

**The subjects are useless and the bodies are essays.** That is the methodological finding worth
keeping: `git log --oneline` here yields "Thirteen identical arrows, and only one of them is yours",
while the body under it argues the decision, names the option rejected, and says which two places
must now agree. Fable spotted this before any Luna call went out; a trawl of subjects would have
returned nothing.

## What the trawl did *not* find, which is the headline

There is no large hole, and after review there is barely a medium one. Every doc has exactly one
owner and `tests/doc-links.test.ts` keeps it that way; no doc's code citations have rotted. (An
earlier draft of this line also claimed every source file over 400 lines was cited by some doc.
**That was false** — the check counted a citation from a *plan*, so `src/assets.ts` and
`src/collect-assets.ts`, cited by no `docs/project/` or `docs/reusable/` doc at all, read as covered.
That is how the one genuine missing doc nearly got missed.) The docs are in better shape than the trawl first
claimed — **most of the "gaps" were the search being bad at reading prose**, which is the finding in
§ What the review killed.

What genuinely leaks is narrow, and it is the project's own rules failing to fire rather than rules
that are missing:

1. **A decision recorded only in a commit body.** The author wrote twenty lines of *why* — into a
   message found by `git log --grep`, not by reading. "Update the docs as you go" does not fire,
   because it felt like documenting.
2. **A trap stranded in an agent's harness memory**, which [AGENTS.md](../../AGENTS.md) already
   forbids. Fifty-three were folded into docs on 2026-08-30 (`bdd5936b`); by 2026-09-04 the directory
   held seventeen again — though after review, only five of those seventeen are genuinely absent.
3. **A fact with a home *and* five copies** — "cite, don't restate" losing to the convenience of
   saying it again in the doc you are already editing.

---

## Tier 1 — a doc that says the opposite of what the code does

### 1.1 `content-extraction.md:62` says a bad transcription fails the step. It doesn't any more.

**This is Sol's finding, not the trawl's** — the trawl had it in Tier 3 and Sol promoted it, which
was the single change it most wanted made before you read this.

The doc says:

> **It is checked, and it can fail.** The transcription is scored per page against the PDF's own
> text layer, and the step fails, naming the page, rather than writing a half-transcribed article
> that reads fluently.

[`src/pdf-read.ts:2025`](../../src/pdf-read.ts) says:

> **A quality failure is recorded on the article, not thrown.** This used to `throw`, and the
> argument for throwing was good… What changed is evidence rather than opinion.

The evidence was rotated watermarks, chart labels and maths notation producing false refusals; the
result now lands on `meta.quality` and the article publishes. The stated cost is that a genuinely
landscape table stops counting towards recall. Commit `1ed4407e`.

**Why this one matters more than a stale sentence usually does.** The doc's claim is the reason a
reader would trust the pipeline — "we would rather refuse than publish something that reads fluently
and is wrong" is a promise about the product, and it is currently not true. Whether the *code* should
go back to throwing is a separate question worth asking; the doc should say what is true either way.

### 1.2 `comments.md:443` sends the next author to where the check used to live

Found independently by axes B, D, E2 and E3 — the most-converged finding of the run.

The WARNING box says *"`finish_reason` counts as a second witness. This is silent-success.md and the
check is in `explainStream`."* Since [260901g](260901g-one-stream-end-classification-shared-by-five-callers.md)
the check is `classifyEnd` returning `StreamOutcome`, in [`src/ai-call.ts`](../../src/ai-call.ts).

**Corrected by Sol, and the correction is the interesting half:** `classifyEnd` has **three**
production callers — `explain.ts`, `search.ts`, `quiz-mark.ts` — not seven. Four callers still hold
their own copy of the old sentence, exactly as the plan predicted, and the migration is unfinished.
So the doc is not merely stale; it points at one of the four *un*migrated implementations as the
example to follow, which is how this sentence propagated into six files over six days in the first
place.

**Where the contract should live.** The trawl split: axis D said `comments.md`, B/E2/E3 said
`ai-gateway.md`. `ai-gateway.md` is right — `comments.md` inherited the shared plumbing by accident
of being first. `comments.md` keeps a one-line citation; the anchors `#streaming` and `#stall-clock`
stay so nothing breaks.

---

## Tier 2 — five traps that live only in an agent's memory

Was eight. Sol found three already documented, and I had missed them — see § What the review killed.

| The trap | Owner |
|---|---|
| A backgrounded `npm test` is **SIGTERM'd under load and reported as exit 0**. "It never ran" and "it passed" are indistinguishable from outside | `testing.md` § A green run here proves less than it looks like |
| `npm run build:api` alone **refuses a stale client shell** after a commit — the commit is what invalidates it. Run `npm run build` | `deployment.md` § The build is two passes |
| A delegated browser subagent's `pkill -f vite` **kills every worktree's dev server**. The docs already recommend killing the listening PID; they never forbid the broad command, which is what an agent tidying up reaches for | beside that recipe in `browser-testing.md` — **not** `engineering-manager.md` (Sol's correction, and right: it belongs where the recipe is) |
| **Parallel subagents share one scratchpad** — the tool's "session-specific, isolated" is true of the session and false of the agents inside it | `engineering-manager.md` § Delegate |
| An eval run **in a worktree measures the fixture cut**, not the corpus — 84 blocks against 360. `matchesManifest` says `false` and nobody reads it | `testing.md` § Evals are not tests |

Two more are **half-covered**, and worth one clause rather than a paragraph: `playwright-browser-control.md:258`
already requires absolute screenshot paths but does not say the consequence is an untracked PNG in
the repo root (there are two sitting there now, from another session); `codex-cli-as-subagent.md:85`
already says to check the exit code *and* the answer file, but does not mention that the failure mode
is an intermittent 404 rather than a permanent outage.

The rest of the memory directory is machine-local — which credential this box lacks, which tmux
session holds a cron — and correctly stays where it is.

---

## Tier 3 — decisions living only in a commit body or a plan

One paragraph each, in the doc that owns the area, with the SHA. Eight, down from thirteen.

| Decision | Owner | Source |
|---|---|---|
| **The asset MIME allowlist is three types, and "no SVG in v1" is enforced at the Supabase bucket** as well as in our code — so a future editor cannot widen it on one side only. Only the generic existence of a bucket allowlist is documented today | `database.md` | `e5f421c1` |
| **The stream-end classifier reports transport facts; the caller decides policy.** Why `length` is not the classifier's problem, why unknown finish reasons stay explicit, why abort takes precedence — and that four of seven callers have not moved yet | `ai-gateway.md` | see 1.2 |
| **Mid-period quota accrues by the remaining-period fraction** and the column stores a delta, not an absolute — an absolute override silently opts the reader out of future tier changes | `billing.md` | `9797d456` |
| **PDF chunk planning is bounded by encoded bytes as well as words** (3 MB soft planning bound, distinct from the hard request ceiling), because image-heavy pages bypass the word limit — and it cannot split a page | `content-extraction.md` | `ff1e723b` |
| **The wave cascade's governor**: expand iff a node holds more than nine structural blocks or an unresolved authored heading; fewer than two kept children is refused. `src/hierarchy-cascade.ts` is called by nothing yet, so **keep this short while it stays unwired** (Sol) | `hierarchy.md` | `98ad0d14`, [260904c](260904c-hierarchy-structure-in-waves.md) |
| **Adding a billing dimension must audit the rules that were harmless when it had one value** — tie-breaks, vendor menus, interval assumptions, quota arithmetic. The billing postmortem names this as the next likely failure class | `billing.md` | [260904a](../postmortems/260904a-four-billing-faults-and-the-witnesses-that-agreed-with-the-code.md) |
| **Late props must not be frozen into initial React state.** A component latched `open` from a request-derived prop during the loading render and then hid the error when the prop changed. The code comment already stated the intended behaviour, so prose and review both gave false confidence | `web-client.md` | [260903d](../postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md) |
| **The generic database write boundary has no id/shape validation.** Rephrased by Sol, and the rephrasing matters: the trawl said "deleting the importer deleted the only validation", which is wrong — [`blocks.ts:272`](../../src/blocks.ts) still validates at the *producer*. What has no equivalent is the generic write seam | `block-ids.md` or `database.md`, not `content-extraction.md` | `b73ad746` |

**Also worth one signpost, not a paragraph:** `architecture.md` should point at
`ingest-queue.md:909`, which already explains the Vite module-copy failure and `src/process-state.ts`
in full, because the principle is general (eight write chains, six registries) and the story is filed
under the queue.

---

## Tier 4 — a fact with a home and six copies

`reading-view-overview.md:39` says of the auto-run rule: *"`src/web/useAutoRun.ts` is the whole rule,
in one place."* True of the code. False of the docs.

`ideas.md`, `quotes.md` and `timeline.md` each carry a **near-verbatim fourteen-line copy** of the
same section, "It starts itself when you press the mode", differing only in the mode name and the
button label. `glossary.md`, `diagram.md`, `new-mode.md` and `security-map.md` carry shorter
variants. Seven docs, one rule.

The risk is not length, it is drift: the next change to `useAutoRun` updates one or two of them, and
the others go on asserting the old behaviour in the same confident phrasing. That is Tier 1's shape,
waiting to happen three times at once.

**Proposal:** `reading-view-overview.md § True across the whole view` keeps the rule; the three
duplicates collapse to a short section naming the mode's own button label, its profile sentence, and
one citation.

**Not applied, and it needs Greg, for two reasons.** It edits `reading-view-overview.md`, which is an
entry point — the category `AGENTS.md` guards most closely. And Fable found the catch: the two-verbs
explanation (`ensure` is unforced and is what *both* the automatic run and the empty state's button
call, because `work_key` is computed from the request and two keys are two paid jobs; `regenerate` is
forced) **exists only in the three copies**. `reading-view-overview.md` contains neither word —
verified, `grep -n "ensure\|regenerate"` returns nothing. So a collapse that is not preceded by
moving that paragraph up **deletes a fact about money**, which is a worse outcome than the drift it
prevents. The three sections also genuinely differ in their last paragraph: ideas and quotes say
*Using your profile*, timeline has no profile tickbox at all.

The order is therefore: move the two-verbs paragraph into the overview first, check it reads as the
rule rather than as ideas-mode's rule, and only then cut the three.

---

## Tier 5 — candidate new docs

The trawl proposed eight. Sol cut it to two, and I agree on seven of the eight calls.

**Keep:**

1. **`article-images.md`** — the `assets` step is a whole pipeline stage (stage 4.5,
   [`src/assets.ts`](../../src/assets.ts) + [`src/collect-assets.ts`](../../src/collect-assets.ts))
   and the only one with no owning doc. It spans extraction, storage, content addressing, privacy,
   security, delivery and reader-visible fallback — durable ownership decisions, not an inventory.
   The reasoning is only in [260829b](260829b-hosting-the-articles-images.md). The trap is a good one:
   build the manifest from the stored string and look it up from the DOM and **every entry misses**,
   with no error — the publisher's URL left in place and a feature that appears to do nothing.
2. **`chat.md`, reframed** (Sol's reframing, and it is better than the trawl's). Chat is a
   first-class reading mode whose only home is a plan. The doc should own the *interaction* intent —
   citations, streaming, stop/retry/edit, persistence, and the line to `chat-tools.md`. The internal
   operation-state model the trawl wanted to document belongs in `web-client.md` or in the source
   headers where it already is.

**A section, not a file:**

3. **The z-index budget**, in `design-css-overview.md`. The trawl and Sol reached the same action by
   opposite reasoning, and the trawl's was right: Sol cited `design-css-overview.md:521` as evidence
   this is already recorded, but line 521 is the heading **"What is not written down yet"**, under
   which the doc says the budget "lives only as values in `styles.css`… **this is the most likely
   thing to break next**". Transcribing it is the cheapest item in the register.
4. **Offline reading**, in `library.md` — cache keys are user-plus-URL, eviction is whole-article,
   remembered identity never authorises a request, and there is deliberately no sync queue and no
   service worker. That last clause is the durable part.
5. **Tweet threads**, in `library.md`.

**Cut:** `sharing.md` (split appropriately between `library.md` and `security-map.md` already);
`figures-in-prose.md` (owned at `design-css-overview.md:231`, verified); `metadata-page.md`.

**Both candidate reusable docs — cut.** The trawl proposed *test at the real seam* and *an
independent external witness*, each behind four or five postmortems. Sol's argument is the one the
trawl half-made itself: `silent-success.md:95` already establishes the independent-witness rule, and
splitting one doctrine across three files makes it harder to find, not easier. **Sharpen that section
with one producer-owned-fixture example instead.** The evidence is worth keeping either way:
`260826c`, `260830b`, `260901a`, `260901d`, `260903e` for the seam; `260828f`, `260828d`, `260902c`
and `260903f` for the witness — the last titled *"the bucket allowlist drifted **again**, and the
check we built last time answered about the laptop"*.

---

## Tier 6 — two docs have outgrown themselves

`diagram.md` is 2,211 lines and holds several materially different products (Force/Drift/Trail,
Sketch, Illustrated, public access). `ingest-queue.md` is 1,871 and mixes upload transport, URL
canonicalisation, leases, worker recovery, reader copy and transactional publication.

Flagged, not recommended. A split costs every inbound link and every anchor, and both are actively
edited. Worth doing only if something else is already opening them.

---

## The policy question

Greg also asked what minimal change to `AGENTS.md` or a new documentation policy would help going
forwards. Fable's answer, which Sol confirmed and I agree with: **none.**

The rule already exists three times — `AGENTS.md:140` "Update the docs as you go", `AGENTS.md:164`
"Harness memory is not where knowledge lives", `engineering-manager.md:104`. Both shapes leaked past
all three. A fourth phrasing will not fire, because the problem is not that agents disagree with the
rule: Shape 1 leaks because writing a twenty-line commit body *feels* like documenting, and Shape 2
because memory-writing is a reflex the harness prompts for, at the moment a trap bites, when nobody
is in doc mode. A rule firing on every commit would also compete directly with "this is a beta, and
speed still wins".

Rejected, in order: a new `docs/reusable/improve-our-documentation.md` (a second weekly ritual is a
second thing nobody remembers to run); a `docs/project/documentation-policy.md` (two copies of a rule
become two different rules — [edit-important-docs.md](../reusable/edit-important-docs.md) says so);
a mechanical gate (measured: 227 of 1,023 commits in the last seven days have an essay body and touch
no doc — Sol reran it on a moved tree and got 229 of 1,031, so the command is reproducible and the
noise is real).

### Suggestion 1 — `docs/reusable/improve-the-codebase.md` *(the only one recommended)*

Sol's amendment, adopted: **the reusable doc gets the lens, and this plan keeps the shell loop and
the dated counts.** A repo-specific command with a 2026-09-04 measurement in it does not belong in a
doc meant to travel to other projects.

Inserted after "Replay the last few real changes", in § Finding the work — its twin: that paragraph
asks what told the author about each file; this one asks what the author knew that the docs don't.

> **Replay the commit bodies too, and the harness memory.** These are the two places knowledge goes
> when "update the docs as you go" fails to fire, and it fails the same two ways every time. An
> author who has just written twenty lines of *why* into a commit message has documented the
> decision and feels it — but a body is found by `git log --grep` and a doc by reading, and the
> agent opening that file next month does not know to grep. And a trap that bit mid-task goes into
> the agent's own memory directory as a reflex, where one agent on one machine reads it. Nominate
> from both: commits since the last sweep with a long body whose diff touched no doc, and every file
> under the memory directory. Most nominees are fixes whose reasoning belongs in the commit and
> nowhere else; move the ones that name a **decision**, a **rejected option**, or a **contract two
> places must keep** — one sentence each, with the SHA, in the doc that owns the area. A memory
> whose trap has an owner under `docs/` moves there and leaves a pointer; which credential a
> machine lacks stays a memory. The same finding runs the other way: a question answered in several
> docs and owned by none gets one home, and the others cite it.

The nomination command, kept here rather than there — 227 of 1,023 on 2026-09-04 in this tree:

```
git log --since='7 days ago' --no-merges --format='%H' | while read h; do
  n=$(git log -1 --format=%b $h | wc -l); d=$(git show --name-only --format= $h | grep -c '^docs/')
  [ $n -ge 8 ] && [ $d -eq 0 ] && git log -1 --format='%h %s' $h
done
ls ~/.claude/projects/*/memory/    # this machine's agents only; the other machine has its own
```

Sol's caveat, worth keeping with it: this counts every non-merge commit with an eight-line body and
no path under `docs/`, so it treats source docblocks, `AGENTS.md` and infra READMEs as "no docs". It
shows *this* heuristic is noisy, not that a better one is impossible.

### Suggestions 2 and 3 — two one-clause edits to `AGENTS.md` — **withdrawn**

Fable proposed sharpening `AGENTS.md:140` ("a commit body that explains why is not that fix") and
`AGENTS.md:164` ("write that line first, and let the memory point at it"). Sol rejected both: they
repeat rules already loaded into every agent's context on every turn without supplying a new trigger
or check, which is the same reason the existing three did not fire.

I think Sol has the better of it, and the exact wording is in this file's history if you disagree.

---

## What the review killed, and why the method let it through

Six findings died. **Five died the same death, and it is worth more than the findings were.**

A trawl proves absence by grepping for a phrase it invents and finding nothing. That works on
identifiers and fails on prose, because prose says the same thing in different words across a line
break. Every one of these was in the docs already:

| The trawl's claim | Where it actually was | What the grep missed |
|---|---|---|
| `drizzle-kit generate` TTY trap undocumented | `database.md:817` § *That rename question needs a terminal, and without one you get silence* | I searched `drizzle-kit generate.*(tty\|prompt)`. The doc says "The rename prompt above is interactive, and an agent has no TTY" — two lines apart, wrong order |
| Diagram shape claims undocumented | `diagram.md:1723` § *The shapes make claims, and the prompt says so* | I searched `diamond claims\|numbered ladder`. The doc says "decision diamond" and "numbered priority ladder" |
| Headless `claude -p` MCP trap undocumented | `infra/hetzner/README.md:669` | I searched `docs/` only. The box's runbook is not under `docs/` |
| Playwright absolute paths undocumented | `playwright-browser-control.md:258` | matched only the consequence I happened to remember, not the rule |
| `whyNotLocalStorage` unnamed in any doc | `deployment.md:855` | I truncated the verification grep at `head -2` |

And one died of being right about a dead thing: the **importer exemption** contract is genuinely in
no doc, and should stay that way — `verifyImportingJob` and `activeJobHolds` no longer exist, the
importer having been deleted in `b73ad746`. Documenting it would have been the register's own Shape 1
in reverse.

**The sixth is mine and it is the worst one.** The trawl's original Tier 1.1 said
`ingest-queue.md:1700` described retention behaviour that had been removed. It does not: `f8b72549`
changed the doc in the same commit as the code, four lines of it, and the sentence I called stale —
"favouring failures where the two kinds compete for a slot" — is the *corrected* wording. The commit
body says so plainly: "Failures still take a slot the two compete for… what they no longer do is
starve successes out entirely." I read the doc, read the commit that fixed it, and confirmed a
contradiction that was not there, because I stopped at the clause that matched what I expected to
find. Four Luna axes agreed with me, which felt like corroboration and was four models sharing one
bad premise.

That is [silent-success.md](../reusable/silent-success.md) with the roles swapped — not a check that
agreed with a bug, but a check that agreed with a bug *report*. If any single sentence from this
exercise is worth keeping, it is that **a doc-gap trawl needs the same discipline as a test: prove
the absence by a route that does not share the searcher's vocabulary.** Reading the owning doc's
table of contents beats grepping it, and asking a model that has not seen your hypothesis beats
asking four that have.

## Progress log

**2026-09-04, stage 1 — Tier 2 and Suggestion 1 applied.** Greg: *"let's do all that you think are
valuable, get input from Fable if unsure."*

| Edit | File | New heading or paragraph |
|---|---|---|
| the tmux/SIGTERM trap | `testing.md` | § *Run the suite in tmux, because a killed run and a passing run look the same* |
| the worktree fixture cut | `testing.md` | § *An eval run in a worktree measures the fixture cut, not the corpus* |
| `build:api` refusing a stale shell | `deployment.md` | a paragraph in § *The build is two passes* |
| `pkill -f vite` | `browser-testing.md` | a paragraph beside the listening-PID recipe — Sol's placement, not the trawl's |
| the shared scratchpad | `engineering-manager.md` | a paragraph in § *Delegate* |
| the repo-root screenshot | `playwright-browser-control.md` | one clause on the existing absolute-`path` rule |
| the intermittent 404 | `codex-cli-as-subagent.md` | a paragraph after *check that a verdict actually arrived* |
| **Suggestion 1**, the lens | `improve-the-codebase.md` | two paragraphs after *Replay the last few real changes* |

Four of those are `docs/reusable/`, whose wording is a rule. They were **applied rather than
proposed**, on the precedent of
[260903c-experimental-features-doc-proposal.md](260903c-experimental-features-doc-proposal.md):
Greg reviews them here rather than before the fact, and reverts any by reading the *before* back out
of this commit's diff. The second lens paragraph — *proving a doc gap needs the same discipline as
proving a bug* — was not in Fable's draft; it is this run's own lesson from
§ [What the review killed](#what-the-review-killed-and-why-the-method-let-it-through), and it is the
one most worth keeping.

**Not applied here, and why.** Tier 1.2 (`comments.md` → `ai-gateway.md`) is owned by the background
agent finishing the `classifyEnd` migration, since the doc fix and the code fix are the same job.
Tier 1.1 (the PDF quality contradiction) and Tier 4 are waiting on Fable — 1.1 because it may be a
code fix rather than a doc fix, Tier 4 because the repetition may earn its place.

**2026-09-04, stage 2 — Tier 1.1, five Tier 3 items, `article-images.md`, z-index, offline.**
Fable was asked the three calls I was unsure about and its answers changed three of them.

| Edit | File |
|---|---|
| **Tier 1.1** rewritten: checked, publishes since 2026-08-30, and the saying-so is unbuilt | `content-extraction.md` |
| the 3 MB planning bound vs the 30 MB request ceiling, and that it cannot split a page | `content-extraction.md` |
| the bucket allowlist, no SVG, enforced on both sides, and the drift class | `database.md` |
| the allowance prorates and the column is a **delta** | `billing.md` |
| adding a billing dimension turns harmless rules into policy | `billing.md` |
| process-wide state must have process lifetime — a rule, signposting the queue's story | `architecture.md` § Conventions |
| **new doc**, plus its stage-4.5 row in the table and its line in `AGENTS.md` | `article-images.md` |
| the stacking order transcribed; the old claim was stale | `design-css-overview.md` |
| the three deliberate offline limits | `library.md` |

**What Fable changed about the plan, all three verified against the tree before acting:**

1. **Tier 1.1 is not "the doc is stale".** `meta.quality` is on `Meta` and **rendered nowhere in
   `src/web/`** — so Greg's 2026-08-30 call, *"publish it and say what looked wrong"*, shipped its
   first half only, and the comment in `runPdfExtract` saying "if the reader does not look, nobody
   looks" describes a reader who *cannot*. That is a better finding than the one I had, and it is a
   product question rather than a doc fix — put to Greg separately, not folded in here.
2. **Restoring the gate as I framed it would reintroduce the false refusals.** `coverageOf`'s
   `missing` is *any requested page with no record at all*, so a gate on it refuses a blank verso or
   a full-page figure. A safe gate needs a baseline word-count guard, which is code with a test.
3. **`design-css-overview.md`'s own z-index claim was stale** — "nine values between 1 and 80… the
   tooltip 80". Counted 2026-09-04: 28 declarations from 0 to 100, and the tooltip is 100. So the
   section that flagged the gap had itself drifted, which is the tidiest possible illustration of why
   the gap mattered.

**Cut on Fable's advice**, and I agree with all four: the generic write-boundary validation (it
documents an absence, which is a plan not a paragraph); the cascade governor (`hierarchy.md` already
says the module is unwired, and zero is shorter than short); the latched-props item (`260903d` is its
home and a `web-client.md` copy is Shape 3 exactly); a tweets section (`library.md` already has the
`/tweets` row). `chat.md` deferred — `reading-view-overview.md` deliberately says chat is in the
plans, and that pointer plus `chat-tools.md` covers it for now.

**Also corrected here:** this register claimed "every source file over 400 lines is cited by some
doc". False, and it is how `article-images.md` nearly got missed — the original check searched all of
`docs/`, so a file cited *only by a plan* counted as covered. `src/assets.ts` and
`src/collect-assets.ts` were cited by no doc under `docs/project/` or `docs/reusable/` at all.

**Still not done: Tier 4.** It needs an edit to `reading-view-overview.md`, an entry point, and
Fable found the catch that makes it more than a tidy-up — see § Tier 4.

## Where this stands

**Done enough to stop here.** The trawl is finished, the findings are verified, the review is in and
folded. If Greg approves nothing, the cost of stopping is that ~15 small true things stay unwritten
and Tier 1 leaves one doc contradicting the code — real, but not urgent, and all of it is recorded
here rather than lost.

The work divides cleanly and can be taken in any order or not at all:

| | Effort | Risk of leaving it |
|---|---|---|
| **Tier 1** (2 items) | under an hour | a doc promises the pipeline refuses bad transcriptions when it publishes them; another sends the next author to copy an unmigrated implementation |
| **Tier 2** (5 items) | an hour | each is a trap that has already cost somebody a session, and they re-accumulate anyway — this is the leak the ritual is meant to catch |
| **Tier 3** (8 items) | 2–3 hours | ordinary decay; the reasoning is still in `git log` |
| **Tier 4** (the `useAutoRun` triplication) | under an hour | three docs drift apart at the next change to one hook |
| **Tier 5** (2 new docs, 3 sections) | half a day | `article-images.md` is the only pipeline stage with no owner |
| **Suggestion 1** (the ritual lens) | 20 minutes | the leak goes on being found by trawls rather than by the sweep |

**Two things a future editor should know before picking this up.** Tiers 1–4 are edits to docs whose
wording is a rule, so they go through
[edit-important-docs.md](../reusable/edit-important-docs.md) — one approved set at a time, before and
after shown, which is most of the elapsed time rather than the writing. And Tier 5's two new docs each
need a line under their entry point (`architecture.md` for `article-images.md`,
`reading-view-overview.md` for `chat.md`) or `tests/doc-links.test.ts` goes red.

**Cost/benefit, honestly.** Tiers 1, 2 and 4 are worth doing: they are cheap, and each is a thing
that is currently false or about to become false. Tier 3 is worth doing opportunistically — fold each
item in when something else opens that doc, rather than as a pass. Tier 5 is a real half-day and only
`article-images.md` clearly earns it. Tier 6 (splitting `diagram.md` and `ingest-queue.md`) should not
be done now.

**The most valuable output was not a finding.** It is § What the review killed: five of six dead
findings died because a grep for invented phrasing cannot prove absence in prose. That belongs in the
ritual lens whether or not any other tier is approved.

## See also

- [improve-the-codebase.md](../reusable/improve-the-codebase.md) — the ritual this proposes a lens for
- [260903a-improve-the-codebase-sweep-doc-proposals.md](260903a-improve-the-codebase-sweep-doc-proposals.md)
  — the previous sweep's doc edits, which were edits from a code sweep rather than a gap trawl
- [silent-success.md](../reusable/silent-success.md) — the class most of Tier 2 belongs to, and the
  one this register fell into itself
- [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — Tier 1 is two
  instances of it
