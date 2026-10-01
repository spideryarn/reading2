# A signposting-and-single-source-of-truth doc, and AGENTS.md's A1–A5 as pointers

Two doc jobs Greg approved on 2026-10-01. Docs only; no code changes.

> A1-4 these seem reasonable. Where it makes sense to do so, push these points out to the relevant
> other docs as the single source of truth, and signpost to those. Perhaps improve the
> signpost-blurbs to make it more likely the agent will indeed read the relevant doc. That said,
> where you think it makes sense for these to be in AGENTS.md , then consider this approved.
>
> — Greg, 2026-10-01, on [261001i-probes/proposals.md § Set A](261001i-probes/proposals.md)

> create docs/reusable doc (if we don't already have one) re signposting and single source of truth
> to prefer everything to be in one canonical place, with other places signposting to that, rather
> than reproducing the same information in multiple places.
>
> — Greg, 2026-10-01

A5 and Set B were approved later the same day (Job 3 below). Sets C–K are **not** approved and are left alone.

## Job 1 — A1–A4

The 261001i sweep (`cc594a14`) already moved most of the substance into the owning docs. What is
left per item:

| | Owning doc — already has it? | What changes |
|---|---|---|
| A1 shared code | `architecture.md § Shared code (server)`, `web-client.md § Shared code (client)` — yes | AGENTS.md "Prefer simple over easy" gains a pointer to both, blurbed as *look here before writing a helper* — a trigger only; the probe evidence stays in 261001i |
| A2 streaming helper | `comments.md § streaming` names `runStream` and `readAnswerStream` — yes | AGENTS.md "Stream any model call" names the two symbols in passing and sharpens the existing pointer's blurb (*start here before adding a streaming route*). The contract stays in comments.md |
| A3 step count | `architecture.md § Conventions` already says "the answer is in `src/pipeline.ts` § `STEPS`" — no total step count; it names and explains the exceptional freshness mechanisms (its "four" is an inventory, right today: 21 `STEPS`, 17 with `stamp()`) | AGENTS.md drops "twelve of the fifteen … `STEP_ORDER`" and the exception list, and points at § Conventions: *which steps cache, which do not and how they decide freshness — read before trusting a skip* |
| A4 a sentence is not a fix | `written-down-is-not-checked.md` covers prose that is *wrong*, not prose that stands *in place of* a change | New short section there (generic, since the doc is reusable); a paragraph in `code-quality-overview.md` beside "A check you have never seen fail"; AGENTS.md gets one bullet pointing at it |

Kept in AGENTS.md, and why: each of the four is a moment an agent will not think to look (writing a
helper, writing a streaming route, trusting a skip, writing a TODO instead of a fix), so the *trigger*
stays in the always-loaded file. The facts — the lists, the contract, which steps cache, the species
of paper-trail fix — live only in the owning doc.

## Job 2 — `docs/reusable/signposting-and-single-source-of-truth.md`

Nothing covers it whole. `documentation-policy.md § One home per fact` has the core (cite don't
restate; cite code by file + symbol; counts rot) and § Keep it navigable has the blurb rule and
"enforce with a test". The new doc owns the topic; the policy's section shrinks to a two-line
summary and a pointer, and its bullets that are now the new doc's move there rather than being
copied. Contents, short and non-project-specific:

1. Greg's quote.
2. Choosing the home: code (a constant or the defining module) when the fact is executable; a test
   when the fact is an invariant; the owning doc when it is intent or a decision; never a plan,
   memory or index line.
3. Signposting: a deep link (`#anchor`), or `file` § `symbol` for code, never a line number; a blurb
   that says **when** to open it and what goes wrong without it.
4. Finding a duplicate: pick the home, merge the best of both into it, turn the rest into pointers;
   for code, name the canonical one even before consolidating.
5. Exceptions: a dated quote (deliberately copied, attributed); a count or measurement carried with
   its command, scope and date; a one-line restatement in a signpost is a trigger, not a second home.
6. Enforcement: link/anchor checkers, symbol-citation checkers, ownership tests, a test that derives
   a count from the code.

Also: a line in `docs/reusable/README.md`, one short line in AGENTS.md § How we write docs.

Other reusable docs that say the same thing in context (Sol's plan review): `edit-important-docs.md`
"Signpost, don't duplicate" and `write-postmortem.md` "Duplicating the lesson" stay as one-line
triggers and gain a link to the new doc; `written-down-is-not-checked.md` keeps the command/scope/date
rule for counts and the new doc points at it rather than restating it.

Renamed from `single-source-of-truth.md` at Greg's request, relayed by the Overseer, 2026-10-01.

## Job 3 — A5, Set B and a Keeping-it-true pointer (approved mid-session, 2026-10-01)

> Yes, it sounds like granularity-zoom has become Structure, and is still relevant/useful no longer
> totally central and/or critical reading. Update accordingly, consider this approved. Look for any
> other docs that you think are important for agents to read, and make minimal updates highlight
> those in AGENTS.md as appropriate.
>
> — Greg, 2026-10-01, on A5

> Yes, fix this.
> P.S. I do still have reservations about caching and browser-storage, so we should use this
> sparingly and for good reason.
>
> — Greg, 2026-10-01, on Set B

**A5.** AGENTS.md's "worth reading before you touch" line drops `granularity-zoom.md`. Evidence from
the 261001i probes for what replaces it ([diagnosis.md](261001i-probes/diagnosis.md)):
`security-map.md` was unopened in every run of P11 (what a visitor sees) — a stable miss on the one
area where a miss is a leak; `mode.md` § Adjacent shapes / § Where else to look was one of the
three signposts that did the most work (P02, P10, P11). `security-map.md` is a severity choice, not a demonstrated probe win — P11's
diagnosed gap was a missing visitor-mode table, and a miss there is a leak to a stranger.
`ingest-queue.md`'s lead block was the one change with held-out evidence, but it helped as a
signpost reached in context, not as a must-read, so it stays where it is. So the line becomes three: `block-ids.md`
(any id resolution), `security-map.md` (anything a visitor, a signed-out user or a model can reach),
`mode.md` (adding or changing a mode). Each with a when-to-open blurb. `granularity-zoom.md`'s
opening is rewritten to say what it is now — the tree that Structure, Summary, Diagram and the Spine
draw, with `structure.md` and `hierarchy.md` as the live owners — and that the tabular sections below
are history. The "one of the features this app is for" wording moves to Structure in
`reading-view-overview.md` only if that doc says granularity-zoom is "the core feature" (trawl B
§ line 264); checked while editing.

**Set B.** `url-state.md`'s opening rule rewritten as proposed in
[proposals.md § Set B](261001i-probes/proposals.md), with Greg's reservation quoted: the URL is the
default; browser storage only sparingly and for a stated reason. The per-key list is checked against
`grep -rln localStorage src/web` before it is written. Three code comments that still say
`localStorage` is banned are fixed: `src/web/SourceScanNotice.tsx` (the dismissible-notice paragraph),
`src/web/referee-card.ts` (its section heading) and `src/web/last-view.ts` ("url-state.md says
nothing is", "the other three exceptions" — found by Sol's plan review).

**Policy.** `documentation-policy.md § Keeping it true` gets one bullet pointing at
[engineering-manager.md § Along the way](../reusable/engineering-manager.md#along-the-way), where
the Overseer has put Greg's "fix docs that are out of date" permission. No restatement.

## The simpler option passed over

Copy A1–A4's "after" text into AGENTS.md verbatim. Rejected because Greg asked for the owning docs to
be the home and AGENTS.md to point; and A2/A3's verbatim text re-copies symbol lists and a partial
exception list into a file nobody re-checks.

## Checks

`npx vitest run tests/doc-links.test.ts`, `npm test` for docs suites, one GPT Sol review of the
whole diff for introduced duplication and broken pointers. Merge `origin/dev` before pushing.

## Shipped

On `dev`, 2026-10-01: `06255b9d` (the work) and `89b97a91` (GPT Sol's code-review fixes, two of
them overridden — the A4 blurb keeps its "what goes wrong", and the quote exception stays in the new
doc). Plan review and code review were both GPT Sol. Gates: typecheck, `tests/doc-links.test.ts`
and the six suites that read these docs; the full `npm test` was not run, since the only source
changes are comments.
