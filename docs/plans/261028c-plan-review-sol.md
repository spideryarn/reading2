The feature direction is right, but the plan should not be built exactly as written. The main problems are rollout before evidence, unresolved prose-mark interactions, contradictory sharing policy, incomplete chat-origin wiring, and an over-precise cost claim.

## P0

None.

## P1

**PR-1 — § Stages / § What waits for 1 November / § Simpler option — the plan commits to two calls and rollout before testing the premise.**

Greg offered Haiku followed by Opus as “one way” that “might” work, not a requirement. Yet the plan builds the complete two-call contract, enables automatic imports, and calls the feature done before seeing one real answer. The November evaluation could invalidate the flag pass, caps, labels, prompts, or model choice after their storage and UI have landed.

A single capable call can identify and explain passages while preserving the profile, checks, mode, margin, marks, and chat. It removes a task, inter-call schema, phase provenance, latency, and failure boundary.

Concrete change: make a real-output evaluation the first gate after 1 November, comparing:

- One capable pick-and-write call.
- Haiku flags followed by the capable writer.
- Sonnet versus Opus writing, on the same short, long, and technical articles and at least two profiles.

Build canned parsing/storage tests now if useful, but keep the mode experimental and out of `AUTO_MODE_STEPS` until one live end-to-end run passes. Make the single-call version the default unless Haiku materially improves selection.

**PR-2 — § What the reader gets / Stage 3 — passage marks are an unresolved design, not a small final stage.**

[`annotateHtml`](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/src/web/annotate.ts:425) merges overlapping kinds into one `<mark>`. Each existing kind then has explicit CSS and hover/touch precedence. Glossary already owns a dotted `border-bottom`; comments and chats also use that channel, citations use text decoration, and cross-references shadow other hover cards.

A multiword explanation will routinely contain glossary terms and citations even though it is not itself a lone term. “Avoid lone terms” does not avoid those overlaps. The proposed faint dotted underline collides directly with Glossary’s visual vocabulary.

Concrete change: before Stage 3, specify and test the matrix for Explanation × term/citation/xref/comment/chat/search/quote:

- Which visual channel each keeps.
- Whether the hover card combines sections or one kind wins.
- What first and second taps do.
- Whether the paragraph remains selectable.
- Keyboard accessibility and focus.
- The new class/data attribute and sanitiser treatment.

Include a real-browser specimen with dense overlaps.

**PR-3 — § The step / migration / Ask in chat — the chat-origin implementation is substantially underspecified.**

Widening the database CHECK and adding a sender is not sufficient. [`chat-from-a-mode.md`](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/docs/project/chat-from-a-mode.md) lists the full seam: `ThreadOrigin`, `ORIGIN_MODES`, `sameOrigin`, route parsing, column conversion both ways, title/list/filter words, handoff, one-chat-per-item reopening, way back and focus, plus route/transaction/export/rendered-reader tests.

Some omissions fail loudly; others silently save the thread and read it back as an ordinary chat with no origin. The proposed hash format is also unspecified: the generic item parser expects a Spideryarn-shaped ID unless a dedicated parser is added, as Situate has for `si-…`.

Concrete change: add the complete origin checklist to Stage 2, specify a versioned ID grammar, and include the origin round-trip and way-back tests.

**PR-4 — § On import / § Not built — owner and visitor behaviour is contradictory and conflicts with the established policy.**

The plan says both “owner only” and “a visitor’s band says it is the owner’s.” More importantly, “everything written for a profile is owner only” is false: public articles currently show the owner’s personalised generated artefacts, explicitly recorded in [`reader-profile.md`](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/docs/project/reader-profile.md:1017). Generated artefacts normally receive public projections; owner-only is a deliberate exception.

Concrete change: ask Greg whether visitors to a shared article may read the owner-written explanations. State separately:

- Who may generate or regenerate.
- Who may read the band.
- Whether visitors receive prose marks and margin items.
- Whether visitors see the profile provenance.
- Which actions, including chat, remain owner-only.

My default would follow Glossary: visitors may read the stored owner-written result and its marks, but may neither generate nor start the owner’s chat.

**PR-5 — § The step / freshness — the existing stamp cannot represent “both models.”**

`StepStamp` has one model and one prompt version. Situate solves the equivalent multi-call problem with per-phase provenance and a separate phase freshness check. A straightforward implementation here would stamp only the writer, so changing the flag prompt or pinned Haiku could leave old explanations appearing current.

The plan also does not define the no-flags case, where no writer ran, or whether stale/outdated/profile-changed artefacts remain in prose and Marginalia.

Concrete change:

- Store phase provenance, e.g. `flag: {version, model}` and `write: {version, model} | null`.
- Use one phase-current function in both pipeline and Metadata freshness paths.
- Add agreement tests like Situate’s.
- Define a state table: stale should not feed prose or the margin; outdated may remain visible; profile-changed should remain visible with an explicit rewrite action.
- Suppress a relations `explain` note only when a fresh, quote-holding Explanation is actually placed.

**PR-6 — § What it costs — “adds about 10%” is too strong for the method used.**

The arithmetic is correct for the chosen numbers: `$0.12 / $1.15 ≈ 10.4%`. The statistical claim is not. `$1.15` is a sum of separate step medians; a sum of medians is not the median per-article import cost. Likewise, adding component p90s does not produce the p90 of their sum. Automatic mode generation can also be switched off, so this is not every import.

Using comparable ledger medians is a sound rough planning method. It supports “roughly a dime per ordinary article, plausibly around a tenth of the listed automatic-mode spend.” It does not yet support a measured 10% increment.

Concrete change:

- Call the current figures constructed estimates, not a measured import distribution.
- State sample sizes, power/model filters, and whether calls came from import successor jobs or arbitrary reruns.
- Remove or qualify the p90 sum.
- After 1 November, group all relevant costs by article/import cohort and measure the distribution of `explanations cost / complete automatic-arrival cost`.

The weekly multiplication is reasonable as a rough scenario.

**PR-7 — § Both quotes are checked / Stage 3 — a valid stored explanation may silently receive no underline.**

FAQ-style validation accepts a quote found in `block.text`. The proposed reuse of `citeMarks` searches rendered text and deliberately refuses a quote occurring more than once because its stored offset is from a different text space. Thus an explanation can appear correctly in the band and margin but lack its principal proactive cue. Writer narrowing increases this risk.

Concrete change: use the same ambiguity rule before storage, prompt for enough surrounding words to make the target unique, and count ambiguous targets as drops. Test repeated phrases and quotations crossing HTML element boundaries. If repeated targets must work, store a rendered-space location as a disambiguator, never as the proof.

**PR-8 — q-B / § Decisions taken without asking — q-B is referenced but is not actually present.**

The candidate repeatedly says “question q-B” but provides no wording or options. Model choice and activation timing are also independent decisions and should not be bundled.

Concrete change: write two clear questions:

- Writer policy: always Sonnet, follow article power, or always Opus—ideally asked after the live comparison supplies quality evidence.
- Trigger policy: automatic-mode imports, first deliberate Margin press, or first Explanations-mode opening.

The latter must say how existing articles behave and that `AUTO_MODE_STEPS` respects the reader’s automatic-modes setting.

## P2

**PR-9 — § Idea 1 q-A — it asks the right broad question, but “when the margin opens” is ambiguous.**

Current Sources deliberately distinguishes a press from arrival by pasted URL, reload, Back/Forward, or restored state. Relations runs on a mounted visible margin; applying that exact rule to a ~$0.30–0.48 literature search is a larger spending change than “the reader pressed Margin.”

Concrete change: make the options explicit:

- First deliberate press that turns Margin on.
- Any arrival with Margin visible.
- Every eligible import.
- Leave the Sources press rule unchanged.

Recommend the deliberate-press interpretation unless Greg explicitly authorises arrival-triggered spending.

**PR-10 — § Idea 1 — “fewer options” and broader Sources-to-margin work are deferred without being fully surfaced.**

q-A only covers the literature dossier that already feeds Marginalia. Current Claims/checks still do not feed it, and Reception and Claims retain their own spending controls. The plan refers to q-A “details” naming these follow-ups, but those details are absent.

Concrete change: explicitly list the remaining request as deferred work, with costs and current margin behaviour, or ask separately whether Greg wants Reception/Claims work folded into the proactive Sources run.

**PR-11 — § No backfill — the cited principle requires a corpus-cost calculation.**

Principle 1 says to backfill when it costs under about $5 and touches no reader-made data. At the plan’s estimate, the dividing line is roughly 42 standard-power articles. The plan cites the principle but does not count eligible articles.

This also matters because the report came from an existing article, while the hidden More mode is something Greg says readers mostly will not open directly.

Concrete change: estimate the eligible corpus-wide cost. Backfill if below the principle’s threshold; otherwise explicitly choose between new-only, first Margin press, and first Explanations opening.

**PR-12 — § Stages — “store wiring” hides several silent checklist items.**

The plan should name the non-compiler residues from [`mode.md`](/var/tmp/spideryarn-worktrees/fbnkq6rj-marginalia-explanations/docs/project/mode.md), notably:

- Revision carry policy, artefact shape and stamp source.
- Export.
- Route cacheability and `withProfileChanged` concurrency.
- Public projection/DTO or an explicit owner-only exclusion.
- Read-error and rewrite-hold matrices.
- Metadata freshness/current status.
- Mode activation and first-open generation.
- Marginalia’s mounted read-only feed and completion refresh.
- Cost disposition.
- Help page and stylesheet manifest.

Concrete change: replace “store wiring” with a linked implementation checklist and name the tests guarding the silent seams.

**PR-13 — § Web search / Decisions taken without asking — v1 implements only part of Greg’s request.**

The omission is disclosed, but *Ask in chat* is not equivalent to allowing the proactive explanation itself to search. Greg’s request permits search when useful and asks provenance to be clear. The proposed result may instead show an unchecked-memory explanation and require another action to obtain the searched version.

Concrete change: either ask Greg to approve no search in v1, or present selective search for uncertain/outside items as an option with cost and latency. Do not treat the equally tentative Opus suggestion as a question while treating the search suggestion as settled engineering policy.

**PR-14 — § Item ids — the stability claim should be narrower or the identity stronger.**

A hash of block ID and exact quote is stable only while both remain byte-equivalent. A changed profile, punctuation, whitespace, or writer narrowing can mint a new item for the same conceptual passage.

Concrete change: either call this best-effort stability, or derive identity from the verified flag target before writer narrowing and inherit IDs across reruns using an explicit matching rule. Specify hash truncation and collision handling.

## P3

None.

The plan’s feature shape—an Explanations mode feeding Marginalia, with short explanations and chat—is sound. The materially simpler v1 is one capable pick-and-write call, with the two-pass version earned by the November evaluation. q-A should remain a question but distinguish press from arrival; q-B must actually be written and split; public visibility is the additional product question the plan cannot decide silently.

**Verdict: build with the listed changes.**