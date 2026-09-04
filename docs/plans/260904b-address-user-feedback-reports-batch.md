# Twelve reports from one afternoon's reading

**Status: not started.** The work begins at the first run of the `feedback-reports` loop, 16:35
London on 2026-09-04 — Greg held it back so usage limits would have reset. What is in this file so
far is the queue and Fable's product memo, written 2026-09-04 14:45 and kept rather than re-spent.

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

## Stages

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

## Questions, decisions and assumptions

For Greg to overrule later; nothing here blocks the run. Numbered so a note can cite one.

1. **-13: who may press Sketch** once Diagram is visible by default — it is a ~$0.20,
   two-to-three-minute call. *Assumption: owner only, as now, and the empty state stays cheap.*
   This is the one on the list with a bill attached.
2. **-13: the default sub-mode** — `sketch` for everyone; *assumption: also `sketch` when the
   experimental switch is on*, rather than reverting to `force`.
3. **-12: lettering in the picture** — *assumption: short titles only, unchecked*, on the grounds
   that a wrong four-word title is a smaller lie than a wrong sentence. If Greg would rather have no
   lettering at all, that is a one-line change to the prompt.
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
