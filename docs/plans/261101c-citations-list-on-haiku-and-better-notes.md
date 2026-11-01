# Citations list on Haiku, and then better notes from Haiku

Queue item `qi-9vtdezfs`: Greg's answer to [q-ns76uq](../user-feedback/questions/q-ns76uq.md), on his
report `spya-d5e2jk`.

> Okay, I'm leaning towards A, but I'm wondering if we can split this into two stages. PMaybe Haiku
> to find them all, and then try some experiments to see if you can make this work better with Haiku
> to improve the notes.
>
> — Greg, 2026-11-01 (`spya-mgvawf`)

Up: [bibliography.md](../project/bibliography.md). The evidence is
[investigation 261101a](../investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md),
made under [plan 261101a](261101a-citations-every-work-cheaply-with-haiku.md), whose § GPT Sol's plan
review, items 4–7, lists what shipping had to touch. GPT Sol's review of this plan is
[261101c-plan-review-sol.md](261101c-plan-review-sol.md).

**Prior work.** No earlier commit pins `bibliography` or raises `MAX_CITATIONS` (`git log -S`
checked). Queue item `qi-mf9r5hjk` (recall on long articles) was waiting on q-ns76uq; stage 1 does
its "more recall from the model" half, so it is edited down to what is left (rows from footnotes made
by code, and asking Greg to remake LeCun's list).

## Stage 1 — Haiku finds them all (option A, as asked)

1. **The model.** `BIBLIOGRAPHY_MODEL = "anthropic/claude-haiku-5.5"` (src/models.ts), held by
   `PINNED_MODEL["bibliography"]`, so Haiku at both powers. The stored list's `generator` and the
   run's `model` are `modelFor("bibliography", power)`, the model that ran, not `generatorFor`'s
   Sonnet or Opus.
2. **The expected stamps follow it** (Sol 1). The pipeline step's stamp (src/pipeline.ts) and the
   store's current-or-not check (src/store/pg.ts) both expected `CAPABLE_MODEL`; `sameStamp` compares
   by generation, so every Haiku list would have looked not current. Both now expect
   `modelFor("bibliography", …)`. The two lookup hashes take the lookup's own model, so they are
   untouched.
3. **Effort `high`.** `xhigh` overflowed on Synesthesia and took 7 minutes on Butlin (261101a).
4. **The prompt, `citations/8`**: the eval's candidate moved into `SYSTEM` word for word (every work
   up to 300, the citation shapes, block by block), and the user turn "List every work this article
   cites."
5. **`MAX_CITATIONS` 80 → 300** (src/types.ts), and its dependents:
   - **Past the cap, the first 300 listed are kept** (`keepFirstListed`), as the prompt now says,
     instead of the highest relevance (Sol 3).
   - **The capped note names neither number nor rule** (Sol 4): "This piece cites more works than
     this list holds. The model that made it listed N works." An old list was cut at 80 by
     relevance and a new one at 300 by order, and a visitor's copy carries no version to tell them
     apart, so a note true of both is simpler than a versioned one.
   - `MAX_REGISTRY_LOOKUPS` stays 80. `citation-blurbs` is **not** bounded by it (Sol 5): it takes
     every row, and its title searches stop at 60 a run. Measured below.
6. **The answer budget.** 300 rows' estimate (105,400) plus `budgetFor`'s 40K headroom is over
   128K and would throw, so the call sends `MODEL_MAX_TOKENS` straight (`bibliographyMaxTokens`).
7. **One request builder** (Sol 9). `bibliographyRequest` builds the whole body; `generateBibliography`
   and the eval's new arm `P` both call it, so the eval measures what production sends. The
   `citations/7`-era arms refuse to run now, rather than silently sending the new prompt.
8. **The step's time budget** (`STEP_BUDGET_MS.bibliography`) 360 → 480 s, from the measured times
   and the 128K ceiling at Haiku's rate. The empty band's promise becomes "a minute or two for a
   short piece, up to five on a long one" (the longest production-request run was 263 s).
9. **Docs**: bibliography.md § Who makes the list, high-powered-ai.md (it no longer moves this
   step), setup-dev.md's model table.

### Stage 1, measured

**The ship rule** (tightened from the first draft by Sol 2): on every article, every completed run
of the production request gives a reader (code's fill included, 300 cap) **at least what today's
Sonnet list gives**, the four short articles **≥ 99%**, and **no invented work** among the rows that
match no truth work, read by hand. A call that fails counts as a failure and is reported, not
dropped. Greg accepted the observed worst case when he chose A (q-ns76uq: "Haiku found 99%, 73% and
61% of the Wikipedia page in three runs").

**Arm `P`, production's request, 2026-11-01**: three runs on Synesthesia and LeCun, two on the rest
(`evals/results/citations-recall/261101a/P-*`). Reader recall at 300:

| article (works) | today's Sonnet (S0) | P runs |
|---|---|---|
| LeCun (105) | 97% | 98%, 98% |
| Butlin (251) | 96% | 100%, 98% |
| Synesthesia (148) | 22% | **failed (network)**, 99%, 98% |
| Layfield (70) | 6% | 99%, 99% |
| Dropout (36) | 97% | 100%, 100% |
| Clark & Chalmers (17) | 100% | 100%, 100% |
| Vaswani (40) | 100% | 100%, 100% |
| cost, all seven | $0.89 | $0.13 |

- **Passes.** Every completed run beats or matches today on every article; no short article below
  99%.
- **One call failed**: Synesthesia's first run died after 161 s on a dropped connection
  (`UND_ERR_SOCKET`, status 200). That is transport, not the model; in production the step fails
  and the job's own retry runs it again.
- **No invented work.** The unmatched rows, read by hand: Synesthesia's 14 are its *Further reading*
  list (the truth's known gap, 261101a § Review caveat), Butlin's one is a reference-list entry
  (Shanahan 2010), Layfield's one is a name its text cites ("Monaco et al. described").
- **Times**: 25–110 s short, 121–263 s long. The longest answer was Butlin's 76K output tokens in
  263 s, under the 480 s budget.

**The real step, then the notes, on Butlin locally** (`scripts/stage.ts`, 2026-11-01):

- `bibliography --force`: **272 works**, 180 s, $0.035, logged as `anthropic/claude-haiku-5.5`,
  `capped: false`.
- `citation-blurbs`, first run: 90 s, $0.022, 41 calls, 36 new notes, and **154 rows left to try
  again** (`transient:over-cap`: the 60 title searches a run). Second run: 154 s, 12 more notes, 94
  rows left. So a long list's notes fill in over several runs, and none fails. This was already true
  of a long list's rows from code before the raise (Butlin had 214 rows then), so it is recorded in
  bibliography.md as a known limit, not changed here: raising the title-search cap is a choice about
  how hard we lean on Crossref and OpenAlex, which is its own plan.

## Stage 2 — better notes from Haiku (experiments)

**What "the notes" are**: each row's `why` (what this piece uses the work for), `relevance` and
`influence`. In 261101a's blind read, Sonnet's were preferred 10 to 6 (8 ties), with Haiku making 3
slips to Sonnet's 1, and scoring relevance too confidently 3 times to Sonnet's 1.

**The yardstick** (Sol 6 and 7):

- **A fixed sample, frozen before any arm runs**: a manifest of truth-work keys, 8 per article on the
  six non-PDF articles (48), chosen from works today's Sonnet row and the stage-1 row both cover. Every
  arm is judged on exactly those keys. **A work an arm has no row or no `why` for counts as a loss
  and an error**, so an arm cannot win by dropping hard rows.
- **The first 24 pairs informed the candidate prompt**, so N1's examples are written from them and
  the decision is read on the other 24 as well as on all 48.
- **Two blind judges**: an Opus subagent and GPT Sol (cross-family, so a Claude-family preference
  for Sonnet's style cannot decide it), each reading only the citing passage and the two sides,
  randomised by hash. The instructions are 261101a's judge's.
- **`influence` is not judged** from the passage; only a confident number where null was safer is
  counted, as before.

**Arms** (Haiku 5.5 throughout; cheapest first):

- **N0, the baseline**: stage 1's rows (arm `P`), against Sonnet's (S0-1). Re-measures the gap on 48.
- **N1, a better notes section in the one call.** *THE FIELDS* for `why` and `relevance` gains the
  slips the judge found, as rules with a short good and bad example: say what the piece uses the
  work for, from the passage that cites it, never a summary of the work; nothing the passage does
  not support; relevance 1 only when the piece is built on it. A prompt change, so it re-runs recall
  (all seven, twice) and must pass stage 1's rule again.
- **N2, a second Haiku pass that writes only the notes**, only if N1 fails. Code gives it each row
  found — its id, title, authors, and the text of the blocks that cite it, resolved from `citedAt` and
  the reference — and asks for `why` and `relevance` by id. **Its answer must name exactly the ids it
  was given**, each once; any batch that does not keeps the first pass's notes for its rows. It never
  adds, drops or edits a row's other fields, and a test holds that the rows and ids are unchanged.
  Its own ledger job, so its cost shows.

**What decides it.** An arm ships only if, **under both judges**, it is preferred at least as often
as Sonnet over the 48, has **no more probable errors and no more "relevance clearly off" than
Sonnet**, and recall stays inside stage 1's rule, with the list still **under half of today's
Sonnet cost**. If both N1 and N2 pass, N1 (fewer parts). If none does, nothing ships and the
write-up (investigation 261101c) says what each arm did. A shipped N1 is `citations/9`; a shipped N2
puts its prompt version and model in the stored list's stamp.

## Passed over

- **Sonnet writing the notes in a second pass.** Would likely close the gap, but output for 250 rows
  plus the article brings back much of the cost Greg asked to save, and he asked for Haiku.
- **A second finding call over the notes the first one skipped** (Synesthesia's 61–99% spread). Not
  what Greg asked for here; it stays in `qi-mf9r5hjk` with code-made footnote rows, which would make a
  footnoted page complete without trusting a model's stamina.
- **A versioned capped note**, naming 80 or 300 by the list's version. It needs the version across
  the public boundary, for a sentence that is just as true without the number.
- **Re-making stored lists.** An older list is `outdated` (older prompt), which the panel
  deliberately does not announce (Greg, 2026-09-29, plan 260929c); a reader who wants the new one
  presses *Find them again* on the Metadata page (principles.md § 1).

## GPT Sol's plan review, and what changed

[261101c-plan-review-sol.md](261101c-plan-review-sol.md): nine findings.

1. Expected stamps named Sonnet — **taken**, stage 1 item 2.
2. A loose ship rule — **taken**: the absolute rule above, failures reported, invented works read by
   hand. The truth's Synesthesia gap is the known list-only one; it was not rebuilt, because every
   unmatched row was read.
3. "First 300" against a relevance cut — **taken**, `keepFirstListed`.
4. A versioned note cannot reach a visitor — **taken**, by a note that names no number.
5. The notes step is not bounded by 80 — **taken as a measurement**: it runs every row, finishes
   partial and catches up over runs. Not changed here (above).
6. A stage-2 sample that skips missing rows — **taken**: a frozen manifest, a missing row is a loss.
7. One judge, raw wins — **taken in part**: two blind judges, one cross-family, and errors and
   relevance in the gate. A formal non-inferiority test on 48 correlated pairs was passed over as
   more precision than the sample has.
8. N2's join — **taken**: exact id sets, the first pass's notes kept on any mismatch, rows unchanged.
9. One request builder, the time budget and the band's promise — **taken**, stage 1 items 7 and 8.
