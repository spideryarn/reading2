The direction is sound—reuse the checked citation blurb, and keep source notes in the existing paid call—but the plan needs revision around provenance, attribution safety, caps, and evaluation.

## Findings

**F1 — P1 — The note kind is being asked to enforce a provenance boundary it cannot enforce.**

Evidence: the plan says only `source` may use memory and therefore “a kind is the label” ([plan:89](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:89)). But the model writes `kind` inside one undifferentiated `notes` array ([relations.ts:532](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/relations.ts:532)); validation checks only that the kind is on the list, not whether an `explain` or `aside` contains memory ([relations.ts:352](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/relations.ts:352)). The Glossary precedent deliberately uses separate fields because field-level separation is clearer and more robust than tagging mixed prose ([glossary.md:642](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/project/glossary.md:642), [glossary.md:654](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/project/glossary.md:654)).

Concrete fix: keep the single call, but give it a separate top-level `sourceNotes` array whose rows do not contain a model-selected kind; code assigns `kind: "source"` after validation. Leave today’s `notes` array under the unconditional “article only” rule. Use a separate validator/drop accounting and a shared block-placement set so the two arrays cannot produce two notes beside one passage. If the eval still finds memory leaking into existing kinds, a separate call becomes necessary.

**F2 — P1 — The visible label distinguishes memory from the article, but does not visibly say it is unchecked.**

Evidence: the plan displays *from AI’s memory*, while “nothing checked it” is only in the hidden card ([plan:77](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:77)). The sibling rule for a specific fact from memory is explicitly *from memory and unchecked* ([wider-world.ts:61](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/src/wider-world.ts:61)); its settled scheme likewise names the visible form as “from memory, unchecked” ([261018h:204](/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md:204)).

Concrete fix: make the visible provenance read **AI memory · unchecked**. Avoid letting the bare stamp *Source* imply that a source was consulted; either use *Background*/*Origin*, or render *Source · AI memory, unchecked* as one compact label rather than a stamp plus a second provenance line. Keep the card for the fuller explanation.

**F3 — P1 — “Not when unsure” is not an operational attribution rule, and “why it is apt” can slide into invented authorial intent.**

Evidence: the prompt bar relies on the model’s confidence ([plan:81](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:81)). The only code check proves that the article contains the quoted passage, not that the claimed attribution is true ([plan:86](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:86), [relations.ts:367](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/relations.ts:367)). This project already records that quotation matching alone accepted a claim saying the opposite of its evidence, which is why citation blurbs gained an independent support check ([citation-blurbs.ts:23](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/citation-blurbs.ts:23)).

Concrete fix: add an attribution ladder and negative examples:

- Name an exact work only when confident of that exact work.
- Otherwise attribute only at the level supported—author, tradition, commonly attributed saying—or abstain.
- Say when an attribution is disputed or merely common.
- Never reconstruct or quote remembered wording as though checked.
- Never claim why the author “chose” or “intended” the reference. At most describe the observable connection that makes it fit here, explicitly as an interpretation.

If two eval runs cannot achieve zero wrong or over-specific attributions, exclude unattributed-quote origins from this memory-only v1; keep named people, works and allusions until runtime verification exists.

**F4 — P1 — The cap arithmetic is wrong and the proposed cap can double the mode’s generated-note density.**

Evidence: the plan gives sources “a separate cap of the same size” but claims this adds at most two notes ([plan:91](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:91)). `noteCap` is 2–8, so this actually permits 2–8 additional notes and as many as 16 total ([relations.ts:282](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/relations.ts:282)). That conflicts with Marginalia’s explicit “second article down the margin” risk ([notes.ts:10](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/web/marginalia/notes.ts:10)).

Concrete fix: a separate allowance is defensible so Source does not starve Tension and Explain, but make it a fixed **maximum of two source notes per article** for v1. Then:

- `answerTokens = base + paragraphs × relation tokens + (noteCap(paragraphs) + 2) × note tokens`;
- `budgetFor` needs no other change;
- source over-cap must have its own counter rather than disappearing into today’s aggregate `overCap`;
- the existing and source validators must share the one-note-per-passage set;
- ordering remains “most valuable first” within each array.

**F5 — P1 — Stage 1 is technically safe, but the plan misses a provenance card that becomes false.**

Evidence: the margin receives only an owner’s ready, non-stale Bibliography ([Reader.tsx:2186](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/web/reader/Reader.tsx:2186)), and attached blurbs have passed `shownBlurb`’s identity and validation checks ([citation-blurbs-identity.ts:165](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/citation-blurbs-identity.ts:165)). So reuse is correct and does not expose owner-only margin citations to visitors.

However, the current Cites card promises that opening shows only the article’s title, authors and entry ([tips.ts:64](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/web/marginalia/tips.ts:64)). That becomes false once an AI-written abstract note appears.

The 261003j rule does not forbid this change. It actually says: “nothing about a paper beyond what’s available in the bibliography … better to say less and allow the user to ask for more” ([261003j:7](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261003j-citations-say-only-what-the-bibliography-supports.md:7)). The later, checked abstract blurb is already recorded as the labelled exception requested by Greg ([bibliography.md:349](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/project/bibliography.md:349)).

Concrete fix:

- Specify `<CiteBlurb blurb={work.blurb} owned linked />`; `linked` is safe because this is inside a disclosure panel, not another tooltip, and supplies the code-built work link.
- Update `MARG_TIPS.citation` to distinguish article-owned bibliographic fields from the AI-written, checked abstract note.
- Add red-first rendering tests for a blurb, no blurb, several works, retained exclusion of `why`, link safety, and provenance text.
- Browser-check one and several opened works at the 288px column width, including the inner card and long two-sentence blurbs.

**F6 — P1 — The proposed eval can confirm counts, but cannot yet earn the attribution or regression claims.**

Evidence: the plan checks attributions only “where I am not sure,” requires one note per rich article without pre-identifying valid opportunities, and calls qualitative readings “inside the control’s spread” without a numerical bar ([plan:105](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:105)). The prompting guide requires like-for-like controls, balanced blind judging for qualitative changes, and reading for provenance failures ([prompting-guide.md:196](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/project/prompting-guide.md:196)). The current eval output also omits each note’s `quote`, making later auditing harder ([run.ts:27](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/evals/margin-notes/run.ts:27)).

Concrete fix: the six articles are directionally good, but create a case manifest before the after arms: passage, expected positive/negative behaviour, maximum defensible attribution granularity, and authoritative verification source. Include an ambiguous or commonly misattributed quotation, an already explained attribution, and a formal citation.

Pass/fail should be:

- Every specific attribution is independently verified, not only ones the reviewer doubts; one wrong, disputed-but-unqualified, or over-specific attribution fails.
- Zero author-intent claims.
- Zero memory in `explain`/`aside` and zero Source notes for formal citations or references already explained by the article.
- Each predeclared rich article gets at least one correct, useful Source note in both after runs; negative cases get none.
- Both after arms’ relation agreement must stay within a predeclared non-inferiority margin of `before-1` versus `before-2`; “about as well” is not a gate.
- New-source validation drops are zero; existing drops and existing-kind quality do not regress.
- Use authoritative manual checking for facts and a fresh, arm-neutral judge for usefulness, redundancy, provenance clarity, and harm to the existing notes.

**F7 — P2 — The implementation map is incomplete and makes definite work conditional.**

Evidence: the plan says “the help page if it lists the kinds” ([plan:99](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/docs/plans/261018i-marginalia-notes-that-save-a-click.md:99)); it does list exactly *Note, Recall or Tension* ([help marginalia:34](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/web/help/pages/modes/marginalia.md:34)). The mode catalogue also describes only confusing passages and internal cross-references ([mode-catalog.ts:651](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/mode-catalog.ts:651)). Export descriptions currently say only “a few margin notes” ([export-bundle.ts:680](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/src/store/export-bundle.ts:680)), and tests pin the exact top-level schema order and current cap calculation ([relations.test.ts:537](/var/tmp/spideryarn-worktrees/fbw99qsz-marginalia-saves-a-click/tests/relations.test.ts:537)).

Concrete fix: make the checklist explicit: help source plus regenerated help corpus, mode catalogue/generated artefacts, both export descriptions, `bibliography.md`’s now-stale “Marginalia does not show notes,” `marginalia.md`, source/citation cards, relations/schema/cap tests, marginalia placement/card/shut-note tests, and browser coverage. No new public DTO is needed because relations remain owner-only; no new plain-words mechanism is needed; `relations/4` is the only freshness-version bump.

REVISE