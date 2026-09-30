# 260930f: Cross-reference links between blocks, with a rich hover preview

> A couple of actions. So it would be really nice if it annotated things by adding, you know, anchor
> links or whatever to relevant other parts of the article. So, for example, if it describes a
> result, then it would create an anchor link to the block that actually, you know, the results in
> detail that underlie that statement or conclusion. So you can always jump around the paper to get
> to the thing being described. And maybe this would be a preprocessing step that always happens.
> And you'd have a cool tooltip, a rich tooltip that you could hover over that would preview that
> linked-to block.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-5Z, on `nihms-536461-spya-nr87dn`)

Status: **planned**. Unattended run from a feedback sweep: Greg is an admin, so the report is
trusted, and this run builds it. The calls his words leave open are under
[Assumptions](#assumptions).

## What the reader gets

In the prose, a phrase that summarises something the piece shows in detail elsewhere is underlined
as a link. Examples: an abstract's "reduced error by 40%", or a discussion's "as the second
experiment showed". Hovering it, or focusing it with the keyboard, opens the same card every block
link already has: the section the target sits in, and the start of the target paragraph. The card
adds one plain line saying what is there, for example *"The table with the per-condition error
rates."* Clicking the phrase jumps there. The jump flashes the target, and the back chip offers the
way home. Both come free from `beginJump` ([260928b](260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md)).

```
  … we found that sleep deprivation ┈reduced recall by 38%┈ in older adults …
                                     ╰── hover ──────────────────────────────╮
                                     │ 3.2 Results › Recall                  │
                                     │ The table with recall by age group.   │
                                     │ ───────────────────────────────────── │
                                     │ Participants over 60 recalled 38%     │
                                     │ fewer words after one night without … │
                                     ╰───────────────────────────────────────╯
                                     click → jump, flash, "↩ back to Abstract"
```

The links are there in every mode, like quote marks and glossary terms. They are not a mode, and
they have no band.

## The design

### 1. A pipeline step, `crossrefs`, shaped like Ideas

Ideas is the template, not Quotes. Ideas has the model name block ids, then validates them, and a
cross-ref needs two ids. Quotes never names an id.

- **The prompt** ([`src/crossrefs.ts`](../../src/crossrefs.ts), `CROSSREFS_SYSTEM`) gets the
  article through `articleWithIds`. It returns
  `{ links: [{ from, phrase, to, why }] }`, meaning *the words in block `from` that refer to what
  block `to` shows in detail*. The rules:
  - Link only when the target holds the detail, evidence, method, figure or derivation behind the
    words. A target that merely mentions the same topic does not count.
  - Never link a block to itself or to the block right next to it, since the reader is already
    there.
  - The phrase is short (2–12 words) and copied exactly from `from`.
  - At most one link per phrase, and one target per link.
  - `why` explains, so it takes `plainWords("explain")`. It is one short sentence saying what the
    target holds, not repeating the phrase.
  - Few and good beats many. The cap scales with length: about one link per four blocks, and never
    more than 60.
- **Validation** (`buildCrossrefs`), copied from Ideas' `validateOccurrences` and from the referee
  claims' `"spaced"` match:
  - An unknown `from` or `to`, a self-link, or a phrase not found in its block is dropped and
    counted in `dropped`.
  - The stored phrase is **the article's own slice**, not the model's string.
  - If two links claim overlapping phrases in one block, the first in document order wins.
  - A `why` that fails a length bound is emptied rather than kept long.
  - If the model returned links and validation emptied them all, that throws. Nothing is published
    over a good artefact. An empty list from the model is kept as a real answer.
- **Storage**: one `jsonb` column `crossrefs` on `article_revisions`, as Ideas has. It gets a
  migration that adds the column and re-adds the step CHECK, a stamp over
  `articleWithIdsFingerprint`, `PROMPT_VERSION`, the model, and the whole artefact-half checklist
  in [new-mode.md § The artefact](../project/new-mode.md#the-artefact-if-the-mode-shows-one).
  Carry policy is the same as Ideas.
- **Model**: `CAPABLE_MODEL` (Sonnet 5) at `medium` effort, `ARTICLE_RENDERER: "ids"`. It is a
  batch job nobody watches line by line, so it does not stream. Its progress shows as a job, like
  every other step.
- **The route**: `GET /api/crossrefs/:slug`, cacheable. It is visitor-readable, because it is
  derived from the article like Ideas, so it goes in `PUBLIC_PROJECTIONS`.

### 2. In the prose: a new `annotate.ts` mark kind, `xref`

- It is modelled on the `cite` kind, which cost *"one entry in a union, one `if`, one class and one
  attribute"*.
- `xrefMarks(blocks, crossrefs)` finds each phrase in its block's rendered text with the same
  quote finder `citeMarks` uses.
- The mark renders as `<mark class="xref" data-xref="<i>" data-block-link="spya-…">`. Because it
  has `data-block-link`, **`BlockLinkCard` gives it the rich preview with no new card code.** The
  card grows one optional line, the link's `why`, looked up by `data-xref` from the artefact. It
  never reads the line from the DOM.
- `data-xref` joins the sanitiser's `FORBID_ATTR`, like every annotation attribute, so an
  article's own HTML cannot forge one.
- **Click**: TableView's delegated click gains a `mark.xref` branch that calls `onJump(to)`, the
  same jump everything else uses. Modified clicks and clicks that end a text selection are left
  alone, as `internal-links.ts` does.
- **Inside an author's `<a>`**: the author's link wins. An xref whose range intersects an `<a>` is
  dropped on the client, so two cards and two click targets never overlap.
- **Keyboard**: a `<mark>` takes no focus. v1 gives the mark `tabindex="0"` and `role="link"`, so
  Tab reaches it, Enter follows it and focus opens the card. If that turns out to fight
  `annotateHtml`'s one-mark-per-piece rule, the fallback is a v1 without keyboard reach. That
  fallback would be recorded here and not slipped past.
- **Touch**: a tap goes straight there, as `BlockRef` does. The flash and the back chip are the
  confirmation.
- **The look** is a dotted underline in the link colour, visibly different from a quote's wash and
  a glossary term's style. The tokens come from `/design`, not new hex.

### 3. When it runs: "a preprocessing step that always happens"

- **After import**, with the add page's *generate the main modes* box
  ([260930c](260930c-auto-generate-the-main-modes-after-import.md)). That list is derived from
  non-experimental *modes*, and this is not a mode, so `crossrefs` is added to `autoModeRequests`
  by hand. It reads nothing, so it goes in the first, parallel group. `autoModesDetail` names it,
  and `tests/auto-modes.test.tsx` is updated.
- **For an article already on the shelf**: a row in Metadata's *Re-run AI processing*
  (`METADATA_RERUN_STEPS`). The three answers `rerun-steps.ts` asks for:
  - one metered call per press;
  - no prerequisite beyond the article;
  - safe to publish over a good list, because a draft that validation empties throws.
- **Not in the blocking import itself**: Greg asked for import to be as fast as possible (5Y).

### Cost

The closest measured analogue is Ideas: an `"ids"` render at Sonnet 5, $0.131 median and $0.183 max
per article on the local corpus ([260930c](260930c-auto-generate-the-main-modes-after-import.md)).
Cross-refs send the same input and write more output (up to 60 short links), at medium rather than
high effort. **Estimate: $0.08–0.20 for a paper-length article**, which takes the after-import
total from about $0.31 to about $0.45. A book-length article costs proportionally more, under the
same token budget Ideas uses (`budgetFor`). The stage measures a real run and records it here.

## Assumptions

- **Not a mode, and no off switch in v1.** Greg described annotation in the text, not a panel. If
  the underlines prove noisy, a switch comes next, and the cap is the first dial.
- **Everybody sees it; it is not behind the experimental switch.** Greg asked for "a preprocessing
  step that always happens". The cost only lands when an import has the box ticked or somebody
  presses re-run.
- **One target per link.** A claim backed by three passages links to the most direct one. Several
  targets would need a card listing them, which is deferred.
- **Within one article only.** Links out to other articles are
  [citations.md](../project/citations.md)' business.

## Stages

1. **The step.** Prompt, validation, store column and migration, stamp, route, public projection,
   rerun row and auto-run entry. Tests: validation red first (unknown id, self-link, phrase not in
   block, overlap, all dropped → throws, empty kept), and the stamp and the step tables through the
   existing total tests. One real run on `entropy-24-00930-spya-pywwkq` locally, with its cost
   recorded here. Sol code review.
2. **The prose.** `xref` mark kind, `xrefMarks`, TableView marks and click, the card's `why` line,
   sanitiser attribute, CSS, keyboard. Tests: an annotate unit test (the mark and attributes,
   overlap with `<a>` dropped), a TableView click test (the jump is called with `to`), a card test
   (`why` shown). A browser check in a Sonnet subagent: hover, click, flash, back chip, at desktop
   and touch widths. Sol code review.
3. **Docs.** A `docs/project/cross-references.md` under reading-view-overview.md, a line in
   block-ids.md § Showing an id, the feedback note, and this plan updated.

## What was passed over

- **Reuse Referee Claims.** It already links claims to passages. But it is scoped to the
  front-matter claims (at most 20), stored owners-only in its own table, streamed on demand, and it
  marks the *passage*, not the claim's words. Its validation discipline is reused; its storage and
  UI are not.
- **On demand only, from a button.** Cheaper, but it contradicts "always happens". The after-import
  box already is the "always" for new articles, and it can be unticked.
- **A mode with a band listing the links.** That is the machinery of a whole mode for something
  whose value is in the prose itself.
- **Real `<a href="#spya-…">` injected into the prose.** `annotateHtml` only emits `<mark>`, and an
  `<a>` cannot nest in an author's `<a>`. A mark with a click branch is one `if`.
- **Folding it into the Ideas call.** That would save a call, but it braids two artefacts' freshness
  and prompts together, and Ideas' prompt version is pinned to its own evals.

## Deferred

- Several targets per link, and a card listing them.
- A reader-facing switch to hide the underlines.
- Back-references: "this result is referred to from the abstract" on the target.
- Generating it for existing articles automatically when an owner opens them.
