# Twelve reports from one afternoon's reading

**Status: done.** All twelve reports resolved in Sentry with a note each under
[`docs/user-feedback/`](../user-feedback/). Two halves were deferred on purpose and their reasons are
in *Stages* below: the Illustrated steering box, and persistent glossary additions. The loose ends
worth picking up next are in *Left undone*.

**Status was: in progress**, started 17:05 London on 2026-09-04 (Greg held it back until then so usage
limits would have reset). Fable's product memo was written at 14:45 and kept rather than re-spent;
GPT Sol's review of the plan arrived at 17:30 and reorganised it — see *Stages*, below, which is the
part to read if you are picking this up.

**Done so far:** -S (already fixed, undeployed at the time — see its note).

The process is [feedback-reports.md](../project/feedback-reports.md); the shape of the run is
[engineering-manager.md](../reusable/engineering-manager.md). This runs unattended, so **questions,
decisions and assumptions go in this file** rather than into a chat nobody is reading — the last
section is for them.

## The queue

Twelve unresolved reports, all from Greg, all dictated, most from one article
(`xanadu-spya-ueuvaf`) on an iPad on 2026-09-04. Sentry: org `greg-detre`, project
`spideryarn-reading2`, `issue.category:feedback is:unresolved`.

| id | what it says | kind |
|---|---|---|
| [-16](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-16) | feedback dialog: show the bug-report guidance when *Problem* is picked; drop "Not sure what to write?" | suggestion |
| [-15](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-15) | is there something better than Whisper for the microphone? | suggestion |
| [-14](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-14) | footnotes: number them at the bottom, a way back, and make them look like notes | suggestion |
| [-13](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-13) | only the sketch diagram sub-mode is good enough for everyone; gate the rest | suggestion |
| [-12](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-12) | illustrated: a prompt box with a mic, and text inside the image | suggestion |
| [-11](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-11) | dictation spells "Spideryarn" wrong; add it and "Greg Detre" to the vocabulary | problem |
| [-10](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-10) | iPad: a link should preview, then open in a new tab, never replace Spideryarn | suggestion |
| [-Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Z) | hierarchy mode should default to Spine, L1, L2 | suggestion |
| [-Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Y) | glossary: a box to look a term up and add it, tolerant of spelling | suggestion |
| [-X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-X) | glossary "check the web" says the phrase doesn't exist when it plainly does | problem |
| [-V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-V) | "couldn't upload PDF" | problem |
| [-S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-S) | hierarchy build failed on `dhammatalks.org/suttas/MN/MN10.html` | problem |

The reader's own words are in the Sentry issue and in the per-report notes under
`docs/user-feedback/`. Read them there rather than trusting this table's summaries.

## Fable's product memo, 2026-09-04

Kept close to verbatim, because the three findings that matter are the ones where it says the
request is wrong, and a paraphrase would soften exactly those.

### Where the literal request is wrong

> - **#2 [-15]**: not Whisper, and a model swap won't fix the symptom. The 2026-09-03 measurement
>   says vocabulary is the limit; #6 [-11] is the real ticket.
> - **#5 [-12]**: text painted by the image model is the wrong place for words — garbled and
>   uncheckable, and the plan already learned this. The checked words belong in HTML beneath; only
>   short titles belong in the picture. And "readable at thumbnail" is not achievable for a
>   five-vignette plate in a 288px band whatever the font; the product answer is to make Enlarge the
>   normal reading state for Illustrated (or open it enlarged), not to shrink the whitespace.
> - **#9 [-Y]**: "add it to the glossary" for a term the piece doesn't contain contradicts the
>   glossary's rule (defined from the piece). The box should find the term in the prose; not found →
>   nearest matches, or hand off to chat.
> - **#4 [-13]**: putting Sketch in front of every reader puts a $0.20, two-to-three-minute button
>   in front of every reader. Fine if the press stays owner-only and the empty state is cheap — but
>   that's a billing decision, not a UI one.

**Each of those needs checking before it is believed.** Two are claims about what the code and the
earlier measurements say, and a memo written from reading is not evidence — `260903i` and the
Illustrated plan are.

### Per report

- **-16 feedback hints by kind** — one hint line under the label that depends on `kind`: unset → the
  current sentence; Problem → three short lines (steps / expected / saw); Suggestion → "what you'd
  like and what it's for". Delete the "Not sure what to write?" disclosure, folding anything worth
  keeping into those lines. *Tiny. Ship.* `FeedbackDialog.tsx` already has the sentence above the
  box **and** the disclosure — a tidy-up, not a rebuild.
- **-15 replace Whisper** — nothing to build; the premise is wrong. `DICTATION_MODEL` is
  `gemini-3.1-flash-lite` via OpenRouter, and the bake-off in `260903i` found every candidate got
  every hard term right *given a vocabulary*. *No work. Answer with the link and fold into -11.*
- **-14 footnotes** — the minimum good experience is three things: the notes range drawn as a
  set-apart region; every note numbered from marker order, by CSS counter where the source lost it
  (`notes.ts` already does this for Tufte); and the existing `↩` back-link
  (`data-spya-note-back`) made visible and 44px tappable, with the one you came from highlighted.
  **Something is also broken** — the number and the back-link exist in the data model but were not
  drawn on his page — so diagnose which site and why before styling. Defer margin/sidenotes, a
  floating return button, Back restoring position. *Small–medium. Ship.*
- **-13 gate the sub-modes** — flip Diagram's `experimental` to false in `MODES_UI`; add a per-chip
  `experimental` flag in `KIND_UI` (`force`/`drift`/`trail`/`illustrated` true, `sketch` false); the
  chips draw the non-experimental ones plus whatever `?dk=` names — the same "hidden never breaks a
  link" rule the mode bar already uses. Default kind becomes `sketch` with the switch off. Defer any
  generalised sub-feature gating; one boolean on one table is enough. *Small. Ship.*
- **-12 illustrated** — two cheap pieces. *Steering:* one optional box ("Anything to add?", ~300
  chars, mic is three lines), appended fenced to the brief call as the reader's instruction and
  included in the artefact fingerprint so a change repaints. *Legibility:* let the model letter each
  vignette with its **short title only** (≤4 words, large, uppercase — the one class of lettering
  the spike found legible and correct), instruct "fill the frame, no margins", and keep the checked
  legend beneath as the real text. Iterate in `evals/illustrated/`, not in production. Defer
  per-vignette regeneration, a house-style picker, OCR-verifying the lettering, hotspots.
  *Small + medium. Ship.*
- **-11 misspelt Spideryarn** — `Spideryarn` is **already first in `SITE_TERMS`**, so this is a bug,
  and dictation.md § failure 3 names the class: the vocabulary quietly stops being assembled. Add
  `Greg Detre`, then a test that the feedback box's transcript request carries the site terms, and a
  log line with the assembled vocabulary's length. *Tiny + a diagnosis. Ship.*
- **-10 links** — external `http(s)` links in the prose always `target=_blank rel=noopener`, desktop
  too. On coarse pointers, reveal-then-commit as touch.md already does for spine bands and glossary
  terms: first tap opens the link card, second opens the tab. Footnote markers already behave this
  way, so this makes links consistent with them. *Small. Ship.*
- **-Z hierarchy default** — in `layout.ts`'s automatic fit, prefer {L1, L2} and never auto-open L0;
  `?cols=` honoured exactly as today. Put it in the fit function so the pending Structure merge
  (260903b) inherits it. *Tiny. Ship.*
- **-Y glossary add-a-term** — cheap 80%: an "Add a term…" box → `POST /api/glossary/:slug/add` →
  find it in the prose with the existing matching rule (case/plural folding is most of "a tiny bit
  robust"); if not found, offer nearest matches from the article's proper-noun list dictation
  already computes (`vocabulary-sources.ts` § names) as "Did you mean…"; then one call through the
  existing `explain()` path with the term as quote and its first block as anchor, appended as a
  reader-added entry with its own provenance label. Defer edit-distance UI, batch adds, editing and
  removing entries, definitions for terms not in the piece. *Medium. Ship v1, last.*
- **-X check-the-web** — right behaviour: the lookup keys on **entry id** and never re-resolves by
  name; if the anchor block is gone it says "this glossary is out of date — Start again", never
  "doesn't exist". Hunch for the diagnoser: lookups live in a files-only sidecar
  (`data/<slug>/glossary-lookups.json`) and glossary.md says the lookup was waiting on the Postgres
  seam — likely a store-branch mismatch. *Small. Fix, with a postmortem.*
- **-V PDF** — right behaviour: a refused upload says the reason in one sentence with a code (size,
  pages > 250, not a PDF, network) and states the caps before the file is chosen. The 2026-09-04
  commits touched exactly this path, so check the feedback row's diagnostics and Sentry first.
  *Unknown, probably small. Diagnose; fix if it is ours.*
- **-S MN10** — hierarchy.md says this exact URL failed on 2026-09-03 and was fixed by
  `parseJsonAnswer` (`260903k`). Verify the fix is on production, re-run the step for that slug, and
  only if it fails again is there a new bug. *Tiny. Verify and re-run.*

### One change answering two reports

- **-15 + -11** — the model is fine; the vocabulary path is what to check.
- **-10 + -14** — a footnote marker *is* a link; one touch behaviour serves both.
- **-13 + -12** — one `KIND_UI` table, so the gating lands before the Illustrated work edits it.
- **-X + -Y** — the same per-entry `explain()` path: fix it, then build on it.

## Stages — revised after GPT Sol's review, 2026-09-04 17:30

The first version of this section is below under *What the review changed*. The review
([260904b-…-plan-sol.md](260904b-address-user-feedback-reports-batch-plan-sol.md)) opened with the
sentence that reorganised the plan:

> The plan should not be built unchanged. The `KIND_UI` overlap is not a real dependency; the
> expensive dependencies are glossary persistence, Illustrated steering provenance, and a second
> paid-provider seam.

That is right, and it is the kind of thing only a reader with the code in front of it finds: the
plan had sequenced two stages around which file they both edit, and missed three dependencies that
are about what the code *guarantees*.

1. **The feedback dialog and dictation** — -16, -11, and the answer to -15. -11 is **diagnosis
   before change**.
2. **Three bugs, three independent commits** — -S, -X, -V. Not one stage: *"the unknown PDF should
   not hold two unrelated repaired bugs hostage."* -S is done.
3. **The prose touch surface** — -10 and -14 only. The riskiest stage in the batch; see below.
4. **The column default** — -Z alone. Pure layout, shares no machinery with stage 3.
5. **Diagram gating** — -13, once the spend sentence below is written down and accepted.
6. **Illustrated, in three** — (a) the Nano evaluation, in `evals/`; (b) provider and input
   architecture, *if* (a) says direct Google is worth it; (c) the UI. Only (a) is in this run.
7. **Glossary** — -Y, cut down to find-and-explain with a Chat handoff. **Persistence deferred.**

Every stage ends by **resolving its Sentry issues and writing the notes** in
`docs/user-feedback/` — including for anything deferred, which is finished the moment the deferral
is written down.

### The two blockers the review found

**Stage 7 would have published a reader's private note.** `src/db/schema.ts:691` says the glossary
is a wholesale JSON document, and that the moment a reader can edit it, it must become a table with
entry ids as a durable contract. Appending a reader-created entry to the JSONB would have hit two
late failures: a later "find more terms" run recomputes generated entries wholesale and could merge
the reader's away, and `src/store/public-reader.ts:252` publishes that whole glossary blob — only
`lookup` is stripped from the public DTO (`src/public-types.ts:228`), so **an entry the reader added
would be published with an already-shared article.** So v1 is find-the-term-and-explain-it with a
Chat handoff when it is not found, and nothing new is persisted. Persistence, if we want it, is its
own stage with an additive `reader_glossary_entries` table.

**Stage 6's steering box is not a text field, it is a provenance change.** `guidance` was
*deliberately removed* from the job API (`src/routes.ts:4451`), from `Job` (`src/types.ts:2276`) and
from `sameWork` (`src/jobs.ts:2997`), because a job freezes its inputs so that a restart or a
dedupe cannot change an artefact. Illustrated freshness is computed only from the Sketch and fixed
model settings (`src/illustrated.ts:197`), and `npm run illustrated` must stay runnable from a slug
alone. Passing transient UI text into one enqueue would break retry-after-restart, dedupe, freshness
and the CLI at once. A steering box needs an article-scoped *stored* instruction, frozen onto the
job, included in `sameWork` and fingerprinted — a migration and a public-projection decision.
Deferred, and now written down as the reason rather than as a size.

### The spend sentence, for -13

The review's most useful correction: "owner only" and "every reader" were both imprecise, and the
truth is worth stating exactly because Greg should accept it consciously rather than inherit it.

> Every **article owner** may explicitly start unlimited paid Sketch reruns; shared visitors remain
> Force-only; entering Diagram or following a URL buys nothing; there is no in-repo per-owner or
> cumulative spend cap.

Evidence: a shared visitor is pinned to free Force with the picker removed
(`src/web/DiagramPanel.tsx:541`); the picker is owner-only, meaning the *article's* owner, not Greg
(`:1436`); only a chip gesture arms the paid run, so a URL or a Back navigation cannot auto-buy
(`:1504`); pipeline re-runs consume no billing slot (`billing.md:568`) and the concurrency limit of
three only slows spend (`src/jobs.ts:366`). Experimental status is control *visibility* only — the
server does not enforce it, so gating is not a security boundary and must not be relied on as one.

So **-13 changes discoverability, not authority**, which makes it safe to ship. It also means
`docs/project/security-map.md:134` is stale — it still says Diagram is unconditionally owner-only —
and that gets fixed in the same stage.

### Stage 3 is the dangerous one

`docs/project/touch.md:85` records that this exact machinery already failed on **every real touch
device while 24 synthetic-event tests stayed green**, because `pointerup` generates the leave events
that closed the card. Green tests are therefore not evidence here, and the agent has been told to
report "not verified" rather than "done" if all it can drive is synthetic events.

And a collision the plan had not seen: ~13% of article links contain a glossary term, and the
composed-card rule gives the *term* priority — its second tap opens Glossary, not the link
(`links.md:52`, `src/web/ProseHoverCard.tsx:227`). "Second tap opens the tab" would silently reverse
a rule the reader has already learned.

**Decision (orchestrator, 2026-09-04): the existing rule wins.** A link containing a glossary term
keeps today's behaviour; only a plain external link gets reveal-then-open. The glossary term is what
this app is *for*; the link is what every other app has.

#### What stage 3 found and built

**-14 was a rendering bug, and the review's guess about it was wrong in a useful direction.** The
plan said "the number and the back-link exist in the data model but were not drawn". Read out of
`xanadu-spya-ueuvaf`'s own public payload: nine notes, all three fields on every one, nine markers
labelled `1`…`9`, and nine of the author's own `↩︎` back-links carrying `data-spya-note-back`. So
the data was complete and *the back-link was in fact drawn* — as a faint glyph with three pixels of
padding at the end of 126 words, which the reader was looking straight at. The number was never
drawn at all: a note's body is an `<li>`, stage 3 gives every block its own row, and an orphan
`<li>` numbers nothing. Nothing needed re-extracting; the whole fix is in the reading view.
[links.md § What the reader meets at the note](../project/links.md#what-the-reader-meets-at-the-note).

**One design call worth recording**: the number beside a note is **the author's own marker text**,
not a count and not a CSS counter. Counting drifts the moment one note of a piece goes unrecognised,
and then the marker says `6` and the note says `5` with nobody able to say which is lying. Wikipedia
keeps its `[5]`. The ordinal is the fallback for a note nothing cites.

**Verified in a real browser, with real touch.** Chrome at 834×1194, `hasTouch`, driving CDP
`Input.dispatchTouchEvent` rather than synthetic events — which is the whole point, given
[260903g](../postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md). Every case the
review asked to see pinned came back right: first tap reveals and navigates nothing; a tap on a
*different* link reveals that one; the second tap opens exactly one tab at the right URL with
`window.opener === null`; a 140px drag opens nothing; a glossary term inside a link goes to
`?mode=glossary&term=…` and opens no tab; a footnote marker still previews and then jumps, landing
with its own back-link on screen and highlighted. On a 1440×900 mouse viewport, plain, middle and
⌘-clicks and Enter each opened one tab and left the reading view where it was, and an in-article
fragment still jumped in place.

**Deferred, deliberately** — margin or side notes; a floating "return" button that follows the
reader down the notes; making browser Back restore the scroll position. Each is a bigger product
move than the report asked for, and the three things shipped are what the report actually named.

**One incidental correction**: `TableView.tsx` had claimed since August that the sanitiser keeps an
article's own `target`. It does not — DOMPurify drops it — and that turns out to be what makes the
new rule safe, since no publisher can opt a link into or out of it.

### What the review changed about the answers themselves

- **-15**: the answer is *"current evidence does not justify a swap"*, **not** *"a swap cannot
  help"*. The bake-off measured 1.8–2.5% WER and 90–92% hard-term recall
  (`260903i-which-model-transcribes-dictation.md:30`); the perfect score was 78 terms over seven
  synthetic clips (`:172`). That is enough to decline a swap and not enough to declare the ceiling.
- **-11**: "the vocabulary stopped assembling" was a *poor* first hypothesis, not a good one —
  `Spideryarn` is first in `SITE_TERMS`, every recipe starts with the infallible site source, and
  the Feedback dialog does pass a context (`vocabulary-sources.ts:320`, `FeedbackDialog.tsx:444`).
  A vocabulary-*length* log would also be insufficient, since a non-empty vocabulary can still omit
  the site terms: log safe source counts or a `siteTermsIncluded` boolean, **never the words**.
- **-Y**: "the glossary is defined from the piece" is false as a description of the existing
  glossary — unmatched entries are stored deliberately, because an empty `blocks` list is a quality
  signal (`glossary.md:253`), and `background` comes from model knowledge by design (`:430`). The
  narrower true reason for requiring an occurrence is that underline, navigation and explanation
  need a stable anchor. Also: "nearest proper nouns" gives no typo tolerance at all, because the
  shared matcher only folds case, plurals and possessives (`:258`). So v1 accepts those foldings and
  hands anything else to Chat; "Did you mean…" waits for a real ranking rule.
- **-12**: a good spelling sample proves the model can *letter*; it proves nothing about whether the
  words are *true* or well *placed*. Short verbatim titles only, and sentences would need an OCR or
  exact-text acceptance gate before we could trust them.

### The Nano measurement came back, and it moots the seam question

**Nano Banana 2 is served through OpenRouter**, on our existing key, with a settled `usage.cost` and
`is_byok: false` — `google/gemini-3.1-flash-image` on OpenRouter's `/v1/images` endpoint. So the
whole direct-Google question below is moot: the better accounting is on the gateway route, the
privacy page stays true, and there is no new seam to build.
[260904a-nano-banana-text-in-generated-images.md](../research/260904a-nano-banana-text-in-generated-images.md)
has the numbers.

**The old finding was wrong, and comfortably.** Across 15 plates and 111 supplied strings — 105
short labels and 6 full sentences — **not one character was wrong**, on both routes and both models.
`MÜNCHHAUSEN`, `EXPLOITGYM`, `SCALA NATURAE`, `533`: correct every draw. The nine-month-old "image
models cannot spell" rule was one model's behaviour generalised, exactly as suspected, and retesting
it cost one spike.

Three claims that must stay apart, because collapsing them is how this goes wrong again:

1. **It can letter** — measured, 111/111.
2. **It places text correctly** when each title is bound to a described scene — measured.
3. **It says nothing about the words being true.** Sketch remains the checkable diagram of record.
   A correctly-spelt caption on the wrong vignette is a *better-looking* lie than a garbled one, and
   that is why the checked HTML legend beneath the plate stays.

**Buy 1K, not 2K.** Cheaper ($0.0676 vs $0.1012), 40% faster (11.2 s vs 18.2 s), and *more* legible
at thumbnail — 10.5 px cap height at 288 px against 7.3 px, because at 2K the model spends the extra
pixels on detail rather than on type. Verified by eye at 288 px against the current `gpt-image-2`
baseline, which is a brown smudge with no readable text at all. The reader's actual complaint —
"readable even when the image is in thumbnail" — is answerable after all, which Fable had said it
was not.

**The one failure mode, and it is structural.** Every misspelling in the entire spike was a single
invented string, `MALL TISSUE BLOB`, on the one vignette the prompt drew but did not name. So the
rule is **caption every drawn vignette, or none** — enforced in the code, not requested in the
prompt. A numeric size clause works ("at least one fortieth of the page's height"); "large enough to
read easily" means nothing.

Two things to carry: `output_format: "jpeg"` is **not honoured** for this model (PNG comes back,
~1.9 MB at 1K) while `PLATE_MEDIA_TYPE` is JPEG-only, and drawn writing *surfaces* — scrolls,
ledgers — still get illegible pseudo-lettering, the same residual `260903c` already records.

### The Google seam, reconsidered — superseded by the above, kept for the reasoning

Greg's instruction stands and the spike is running. But the review is right that this is not merely
a second declared exception: `src/ai-call.ts:1276` is where the single key, the meter and the
`finally` that records failures as spend live, `:1439` validates the returned bytes, signatures and
dimensions, and `ProviderAccount` has no Google arm (`src/ai-spend.ts:264`). A raw production fetch
bypasses all of it.

**And it would make the privacy page false.** `src/web/PrivacyPage.tsx:212` tells readers that
OpenRouter carries every AI call but live voice, and that Google is used only for sign-in. That page
is a promise, so it changes in the same commit as the code or the code does not land.

So the order is: measure in `evals/`; **check whether Nano is reachable through OpenRouter**, which
would need no new seam at all; and only if direct Google clearly wins does anyone build the seam,
with provider-account typing, metering, output validation and the privacy page in the same stage.

### What this plan passed over — original section

Fable's grouping, adopted. Each ends green, committed and pushed.

1. **The feedback dialog and dictation** — -16, -11, and the answer to -15. Three tiny changes in
   one area.
2. **Bugs with a likely cause** — -S, -X, -V. Each is a diagnosis and a postmortem, no design.
3. **Reading on iPad** — -10, -14, -Z. The touch surface of the prose.
4. **Diagram gating** — -13. Self-contained, and it edits the table stage 5 also touches, so it
   goes first.
5. **Illustrated** — -12. Eval-driven prompt work first, the steering box second.
6. **Glossary add-a-term** — -Y. Last: most likely to balloon, least urgent, and it builds on the
   path stage 2 repairs.

Every stage ends by **resolving its Sentry issues and writing the notes** in
`docs/user-feedback/` — including for anything deferred, which is finished the moment the deferral
is written down.

### What this plan passed over

**Doing them in the order Sentry lists them**, which is arrival order and would have interleaved
four areas and edited `KIND_UI` twice. And **one stage per report**, twelve commits: the reports
overlap enough that four of them are answered in pairs, and pairing them is most of the saving here.

## Greg's steer on -12, 2026-09-04 17:05

> Re text in generated images, I have added GOOGLE_API_KEY to .env.local (and to .env.prod) - try
> with Nano Banana (even if that means we don't use OpenRouter) and see if that's better for text
>
> — Greg, 2026-09-04

This **overrules assumption 3 below as a foregone conclusion** and turns it back into a measurement.
Fable's memo, and the earlier Illustrated spike it was quoting, both concluded from one model's
behaviour that an image model cannot be trusted with words. That is a claim about a model, not about
image models, and it is now nine months old in a field that moves — so it gets retested rather than
inherited. `docs/research/` gets the finding either way, because a negative result here is worth as
much as a positive one and is exactly what stops the third agent re-running this spike.

**It is also a second declared exception to the OpenRouter rule.** [ai-gateway.md](../project/ai-gateway.md)
says every paid call goes through OpenRouter bar one declared exception; calling Google directly for
image generation makes two, and Greg declared it in the sentence above ("even if that means we don't
use OpenRouter"). If the spike says yes, the exception is written into `ai-gateway.md` in the same
stage as the code, with the reason and the date — an undeclared second exception is how the rule
stops meaning anything.

What does **not** change: the checked legend beneath the picture stays. Whatever the model can spell,
words we generated and checked are worth more than words it painted, and the legend is what makes the
plate answerable rather than decorative.

## Left undone, and why — for the next run of the loop

- **Nobody has looked at the new Feedback dialog hint in a browser.** jsdom pins its structure and
  four tests pass, but the three Problem lines have never been *seen*. Two attempts to shoot it
  failed: with six agents editing the tree, the dev server restarted twenty-plus times and the agent
  reported waiting rather than looking, twice. That is the box, not the task. **Do it first when the
  tree is quiet** — three toggle states, light and dark, one narrow width; the thing to judge is
  whether the Problem lines read as three distinct asks or as a wall.
- **Dictation has never been measured on human speech.** The 90–92% hard-term recall behind -11 and
  -15 comes from a synthetic corpus. A person, an iPad and a room is a different measurement and it
  is the open thread both reports leave behind.
- **`tests/client-imports.test.ts` is red on `dev`, and it is a real finding.**
  `src/web/useStepJob.ts` imports `StepBefore` from `../pipeline.js` — committed 2026-09-03 in
  `a9fd3197`, nothing to do with this batch. It is a *type-only* import and so erases at build time,
  but the test flags the erased form **deliberately**, and says so in its own comment. So the fix is
  to move `StepBefore` to a shared module, not to relax the rule. Left alone here because the
  judgment belongs to whoever owns that code, not to a passing batch.
- **Unexplained 404s in the browser console** on the dev box, seen repeatedly during the -13
  verification with no URL captured. None of the checks were affected and it is most likely a missing
  favicon or asset locally, but nobody has actually looked. Cheap to chase; worth one Sonnet.
- **The Illustrated steering box** (-12's other half) — deferred with its reason in *Stages*, above.
- **Persistent glossary additions** (-Y's other half) — deferred, and it needs a table.

## Questions, decisions and assumptions

For Greg to overrule later; nothing here blocks the run. Numbered so a note can cite one.

1. **-13: who may press Sketch** once Diagram is visible by default — it is a ~$0.20,
   two-to-three-minute call. *Assumption: owner only, as now, and the empty state stays cheap.*
   This is the one on the list with a bill attached.
2. **-13: the default sub-mode** — `sketch` for everyone; *assumption: also `sketch` when the
   experimental switch is on*, rather than reverting to `force`.
3. **-12: lettering in the picture** — *superseded, see Greg's steer above.* The assumption was
   "short titles only, unchecked, because a wrong four-word title is a smaller lie than a wrong
   sentence". It now waits on the Nano Banana measurement.
4. **-12: does Illustrated open enlarged?** *Assumption: no change for now* — it is a bigger
   product move than the report asked for, and the legend beneath is the real fix for legibility.
5. **-Y: a term that is not in the piece** — *assumption: nearest matches, then refuse politely*,
   because "defined from the piece" is the glossary's rule and this is not the place to break it.
6. **-Z: when only one column fits** (iPad portrait) — *assumption: L1.*
7. **-10: new tab on desktop too** — *assumption: yes*, so there is one behaviour to explain rather
   than two.
8. **-11: `Greg Detre` in every reader's vocabulary** — *assumption: fine.* Ten characters, and the
   author's name appears in the app's own copy.
9. **-14 and -V both need the specimen** — which site's footnotes, and which PDF. If neither can be
   reproduced, the report is written up as "could not reproduce, here is what we checked" rather
   than guessed at.
