/**
 * **Which steps the Metadata page offers a re-run row for, in its *AI processing* section.**
 *
 * An explicit list, and the explicitness is the design rather than a
 * shortcut: a control that spends our money on a press needs three answers the
 * pipeline's own sets do not give — how many metered calls one press buys,
 * whether the step has a prerequisite it will refuse without, and whether a
 * "successful" run is safe to publish **over** a good artefact. Deriving it
 * from `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) would sweep every future
 * member in on those three unexamined, which is exactly what the first draft of
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md did and
 * what a cross-family review refused it for.
 *
 * What the plan settled, so it is not re-litigated a row at a time:
 *
 *  - **`structure` was out until 2026-10-29, and is in now.** The objection
 *    was a second paid call hiding behind the press: a forced run writes an
 *    empty pending-label manifest (src/structure.ts § the merge), so the
 *    article loses its paragraph labels and the free-of-quota but dear `labels`
 *    successor is queued to write them again (682 s measured).
 *
 *    Greg asked for it by name (`spya-cqg70c`, 2026-10-29: *"I can't see a way
 *    to rerun just the structure mode"*), to see a newer Structure on an
 *    article that already had one. Two things answer the objection rather than
 *    overrule it. **The cost is said on the row** (`RERUN_COST_NOTE` in
 *    src/web/rerun-commands.ts): the labels follow and are missing until they
 *    land. **And it is usually cheap when nothing is new**: the structure
 *    answer and each labels batch are checkpointed on the exact request, model
 *    and prompt version (docs/project/structure-step.md), so a press over an
 *    unchanged article replays them. It buys a new tree when how Structure is
 *    made has changed, which is the case it is for, or when a checkpoint is
 *    missing. The arc is not left truncated: `loadArticle` leaves out an arc
 *    that no longer fits the tree, so the owner's `useArc` makes it again
 *    (src/arc.ts § `fitsTree`). The other modes made from the old tree may
 *    say they are out of date, as after a reset; none remakes itself.
 *    docs/plans/261029l-re-run-structure-from-metadata-and-start-again-from-the-command-bar.md.
 *
 *    **Its one known gap**: the row is free again once the Structure job
 *    publishes, before the labels successor has finished. A second press then
 *    replays the tree and queues the labels again: wasted, not wrong (plan
 *    261029l, GPT Sol's finding 5).
 *
 *    Structure mode's *Try again*, on a tree built from the author's headings
 *    (src/web/StructureNotice.tsx), is the same forced run, offered where the
 *    reader sees the stand-in.
 *  - **`illustrated` is out.** It refuses without a usable Sketch and does not
 *    pull the prerequisite in, and a run whose every plate failed returns
 *    *successfully* — so it can replace a good picture with an empty one.
 *  - **`labels` is out.** It is not a mode a reader goes to, and with
 *    `structure` out there is nothing on that page that invalidates it.
 *  - **`blocks` is out** because a lone button could only fail:
 *    `unrunnableStepPlan` (src/jobs.ts) refuses `{ steps: ["blocks"] }` with a
 *    400.
 *  - **`fetch` and `extract` are out** because that door already exists — the
 *    shelf row's *Refresh from source* — and it replaces the article's **text**,
 *    which is a different action from regenerating a mode on top of it.
 *  - **`assets` is out**: no model call, and nobody has wanted it again.
 *
 * ## Why this is a leaf of its own
 *
 * `tests/client-imports.test.ts` forbids anything under `src/web/` reaching a
 * server module, and `src/pipeline.ts` is one. `src/step-order.ts` exists
 * because exactly this was tried for `STEP_ORDER` and reverted inside a day —
 * read its header. So the list has to live in a module that imports almost
 * nothing whatever else is decided, and this is that module: one type import,
 * no side effects.
 *
 * **Beside `src/step-order.ts` rather than inside it**, because that file
 * answers *what order do the steps run in* and this one answers *which of them
 * may a reader ask for again*. The second is a product judgement that changes
 * when a step's failure semantics change, and the first is the pipeline's own
 * shape; braiding them would mean a UI decision landing in the module
 * `orderSteps` and `isStepName` are read off.
 */
import type { StepName } from "./types.js";

/**
 * The list, in `STEP_ORDER`'s order so the page's rows read down the pipeline.
 *
 * **`skim` joined on 2026-09-29**, when the modes lost their standing
 * redo buttons and Metadata became the one place to ask for one
 * (docs/plans/260929b-one-place-to-re-run-ai-processing.md). The three answers:
 * one metered call (Quotes and Ideas are not named, so they do not run); it
 * refuses without Quotes, and says so in the row; and a route that planned is
 * safe to publish over the old one, draft-then-publish.
 *
 * **`faq` and `bibliography` (then `citations`) joined the same day**, when their out-of-date banner
 * went — it was their only redo
 * (docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md).
 * The three answers, the same for both: **one** metered call a press, and no
 * web search — each step is a single `streamMessage` with no tools
 * (`generateFaq`, `generateBibliography`); Bibliography's per-row *Find it* is the
 * search, and it is its own route that a press here never reaches. **No
 * prerequisite** beyond the article itself; the one refusal is Bibliography's
 * `previousBibliographyFrom`, which throws before the call if the list already
 * there is unreadable, rather than minting fresh ids over it. And **safe to
 * publish over a good list**, draft-then-publish: an answer that validation
 * empties throws and writes nothing (`buildFaq`, `buildBibliography`); only the
 * model's own empty list is kept, as a real answer. A work found again keeps
 * its id (`keysOf` in src/bibliography.ts), and with it any link *Find it* stored.
 * Both modes were behind the experimental switch when these rows arrived;
 * Bibliography is now inside Sources and outside it. Metadata's rows remain
 * independent of that switch, as Timeline's, Quiz's and Reception's are — the
 * switch hides bar clutter, never a way to redo something already made
 * (docs/project/experimental-features.md).
 *
 * `satisfies` rather than a `StepName[]` annotation, so the members stay
 * literal and `MetadataRerunStep` below is these rather than every `StepName` —
 * which is what makes a per-step copy or label map a compile error when
 * somebody adds one.
 */
export const METADATA_RERUN_STEPS = [
  /* **Joined on 2026-10-29**, Greg's `spya-cqg70c`; why it was out and what
     changed is the first bullet of this file's header. */
  "structure",
  "arc",
  "tweets",
  "glossary",
  "quotes",
  "ideas",
  "timeline",
  "quiz",
  "faq",
  /* **Joined on 2026-10-03 with the step**, the way to redo the margin's
     relation words by hand (the column makes them the first time its owner
     sees it, and again when they are stale). The three answers: **one**
     metered call a press — a single `streamMessage`, no tools
     (`generateRelations`), and none at all on an article with fewer than two
     paragraphs; **no prerequisite** beyond the article itself; and **safe to
     publish over a good one**, draft-then-publish — an answer covering fewer
     than half the paragraphs throws and writes nothing (`toRelations`). Not a
     mode, so no switch hides it.
     docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. */
  "relations",
  /* **`explanations` is not here yet, deliberately.** It would pass the three
     questions (one metered call, no prerequisite, safe to publish over a good
     list), but a row here is shown to every owner whatever the experimental
     switch says, in Metadata and in the command bar — and until stage 2 of
     docs/plans/261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md
     there is no mode to show what it made, and after it the mode is behind
     the switch until q-gkrkf5. It joins when the feature leaves the switch. */
  "sketch",
  "skim",
  "reception",
  "bibliography",
  /* **Joined on 2026-10-18 with the step** (*Notes on cited works*, plan 261017h
     stage 3). The three answers: **about a cent** a press — a few registry
     lookups that cost nothing, then one Haiku call per twenty works with an
     abstract and one small check per note (`generateCitationBlurbs`); it
     **refuses without a Bibliography** and does not make one; and it is **safe
     to publish over a good set**, draft-then-publish — a pressed run asks every
     work again, and a work whose lookup or call fails this time keeps the note
     it had. Not a mode, so no switch hides it. */
  "citation-blurbs",
  /* **Joined on 2026-09-30 with the step**, the one way to make cross-references
     for an article already on the shelf (the after-import box covers new ones).
     The three answers: **one** metered call a press — a single
     `streamMessage`, no tools (`generateCrossrefs`); **no prerequisite** beyond
     the article itself; and **safe to publish over a good list**,
     draft-then-publish — an answer that validation empties throws and writes
     nothing (`buildCrossrefs`). An empty list is kept as a real answer: the
     model's own, or one whose every link pointed next door, which replaces a
     good list the way the model's `[]` would (plan 261024c). Not a mode, so no
     switch hides it.
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  "crossrefs",
  /* **Joined on 2026-09-30 with the step.** The three answers: **one** metered
     call a press — a single `streamMessage`, no tools
     (`generateSimpleSummary`); **no prerequisite** beyond the article itself;
     and **safe to publish over a good one**, draft-then-publish — an answer
     that fails validation throws and writes nothing (`buildSimpleSummary`).
     Summary is a core mode, so no switch hides it.
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. */
  "simple",
] as const satisfies readonly StepName[];

/** One of the list. */
export type MetadataRerunStep = (typeof METADATA_RERUN_STEPS)[number];
