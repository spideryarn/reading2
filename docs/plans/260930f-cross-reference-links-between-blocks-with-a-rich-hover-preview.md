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

Status: **planned, plan reviewed**. GPT Sol returned *build with changes*, and all 13 findings are
taken; see [§ Plan review](#plan-review). This is an unattended run from a feedback sweep. Greg is an
admin, so the report is trusted and this run builds it. The calls his words leave open are under
[Assumptions](#assumptions). **Two pieces need edits to listed defences, which an unattended run may
not make.** They are written up for Greg under
[§ Left for Greg](#left-for-greg-two-defence-edits) rather than built.

## What the reader gets

In the prose, a phrase that summarises something the piece shows in detail elsewhere is underlined
as a link. Examples: an abstract's "reduced error by 40%", or a discussion's "as the second
experiment showed".

- **Hover or keyboard focus** opens the card every block link already has: the section the target
  sits in, and the start of the target paragraph.
- **Clicking** jumps there. The jump flashes the target, and the back chip offers the way home.
  Both come free from `beginJump`
  ([260928b](260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md)).

```
  … we found that sleep deprivation ┈reduced recall by 38%┈ in older adults …
                                     ╰── hover ──────────────────────────────╮
                                     │ 3.2 Results › Recall                  │
                                     │ ───────────────────────────────────── │
                                     │ Participants over 60 recalled 38%     │
                                     │ fewer words after one night without … │
                                     ╰───────────────────────────────────────╯
                                     click → jump, flash, "↩ back to Abstract"
```

The links are there in every mode, like quote marks and glossary terms. They are not a mode, and
they have no band. **In v1 only the article's owner sees them**; visitors wait on a defence edit
([§ Left for Greg](#left-for-greg-two-defence-edits)).

## The design

### 1. A pipeline step, `crossrefs`, shaped like Ideas

Ideas is the template, not Quotes. Ideas has the model name block ids, which it then validates. A
cross-ref needs two ids, and Quotes never names one.

**The input.** It sends exactly what Ideas sends: `articleWithIds` plus the tree. Section names
are what tell the model where the Results and Methods are, and sending the same input means Ideas'
fingerprint can be reused unchanged (Sol F11: the fingerprint must cover exactly the bytes sent).
The call streams internally through `streamMessage` and ends at `finalMessage()`, so the spend is
recorded and a large budget does not outlive the SDK's non-streaming timeout (F9). Nobody watches
it line by line, so there is no incremental UI. It gets its own answer estimate for `budgetFor`,
not Ideas' item formula.

**The model** is `CAPABLE_MODEL` (Sonnet 5), at `medium` effort, with `ARTICLE_RENDERER: "ids"`.

**The answer** (`src/crossrefs.ts`, `CROSSREFS_SYSTEM`) is `{ links: [{ from, phrase, to }] }`. It
means *these words in block `from` refer to what block `to` shows in detail*. There is **no `why`
line** (F10). Greg asked for a preview of the target, and the target's own words are the safest
account of what is there.

The prompt asks for these, and **validation enforces every one** (F3), each with a `dropped`
counter:

| rule | enforced by |
|---|---|
| `from` and `to` are ids in this article | unknown id → `unknownIds` |
| not a self-link, and not the adjacent block (±1 in document order) | → `nearby` |
| the phrase is 2–12 words | → `length` |
| the phrase occurs **exactly once in the rendered text of `from`** (F4: that is the only occurrence the client can mark); the stored phrase is the article's own slice | no match → `unquoted`, several → `ambiguous` |
| no two links share an overlapping phrase in one block; first in document order wins | → `overlap` |
| cap `min(60, max(3, round(blocks / 4)))` | the rest → `truncated` |
| malformed row (a missing or non-string field) | → `malformed` |

Only an explicit `{ "links": [] }` is a valid empty answer. A missing or non-array `links` throws,
and so does an answer that validation empties entirely. Nothing is published over a good artefact.
"Rendered text" means `renderedText(block.html)`, the text space `annotate.ts` marks in. It is
shared through an import-safe module, or computed server-side from `block.html`, whichever the
code allows without a client-to-server import.

**Storage.** One `jsonb` column, `crossrefs`, on `article_revisions`, as Ideas has. It takes a
migration that adds the column and re-adds the step CHECK, a stamp, `PROMPT_VERSION`, and the whole
registration inventory (F12):

- `ArtifactKind`, `SHAPE` and `STAMP_SOURCE`;
- `StepName`, `STEP_ORDER`, `STEP_BUDGET_MS` and `STEPS`;
- the `models.ts` tables;
- `REVISION_CARRY_POLICY`, `STEP_SHARING`, `RESET_ROLE` and `JOB_DISPOSITION` (cost categories);
- the metadata icon and label maps;
- the export put-chain;
- the authenticated-route inventory and `CACHEABLE`.

The compiler and the existing total tests find most of these. The list is here so that none is
believed complete without checking.

**Stale is not drawn** (F8). Carry the artefact the way the revision system expects. But a link
whose fingerprint no longer matches may still name two surviving ids and a matching phrase while no
longer being true, and the prose has no panel to say "out of date" in. So the owner hook hands the
prose nothing when the artefact is stale.

**The route** is `GET /api/crossrefs/:slug`. It is **owner-authenticated** like every other
`/api/…` artefact route, and it joins the owner's offline cache (F1). There is no anonymous
endpoint.

### 2. In the prose: an `xref` mark kind that an article cannot forge

**The mark** is a new `MarkKind`, `"xref"`, in `annotate.ts`, modelled on `cite`.
`xrefMarks(blocks, crossrefs)` places each phrase using the same unique-occurrence rule the server
validated with. It renders as `<mark class="xref" data-xref="<nonce>-<i>">`:

- **`<nonce>`** is random per page load, held in memory, and never stored.
- **`<i>`** indexes the validated artefact.

Hover, focus, click and Enter all resolve a mark **only if its nonce matches**, and then take `to`
**from the artefact, never from the DOM**. An article's own HTML therefore cannot make a working
xref, because it cannot know the nonce. That closes Sol's F2 without touching the sanitiser. The
reservation at ingress, which is how the other five kinds are protected, is the defence edit left
for Greg below. Until it lands, a forged `class="xref"` can only draw an underline that does
nothing.

**The card.** `BlockLinkCard` also accepts a nonce-valid `mark[data-xref]` and resolves its target
through an xref resolver in its context. The mark carries no `data-block-link` at all, so it adds
nothing to the existing, pre-existing forgeability of that attribute (see below).

**Precedence: xref wins on a piece that carries it** (F5).

- `ProseHoverCard` ignores `.xref` pieces, both its hover and its touch-reveal path.
- `TableView.onMouseUp` returns after a genuine selection but *before* comment or chat activation
  when the target is an xref.
- The click jumps.
- **An author's `<a>`** is the one exception: an xref whose range intersects an author's link is
  dropped on the client, so the author's link keeps its card and its click.

**Keyboard** (F6). One phrase can be split into several `<mark>` pieces.

- Only the **first** piece gets `tabindex="0"` and `role="link"`, so there is one Tab stop per link.
- A delegated Enter handler runs the same validated jump.
- Continuation pieces are clickable but not in the tab order.
- **Modified clicks do nothing special.** There is no real `href`, so ⌘-click is not "open in a new
  tab" here. This is stated, not hidden.

**Touch.** A tap goes straight there, as `BlockRef` does. The flash and the back chip are the
confirmation.

**The look** is a dotted underline in the link colour, distinct from a quote's stroke, a cite mark
and a glossary term. It uses `/design` tokens, not a new hex.

**The data path** (F7). It follows the path the standing cite marks take:

- the owner read hook `useCrossrefs`;
- then `ArticlePage`, fetched unconditionally like the other standing annotations;
- then `ReaderCapability`;
- then `Reader`, into `TableView` and the card's context.

The crossrefs go into TableView's `ProseEntry`, its `sameInputs` equality key and the memo
dependencies. That exact omission once made cite marks appear intermittently.

### 3. When it runs: "a preprocessing step that always happens"

- **After import**, with the add page's *generate the main modes* box
  ([260930c](260930c-auto-generate-the-main-modes-after-import.md)). That list is derived from
  non-experimental *modes*, and this is not a mode, so `crossrefs` is added to it by hand. It
  reads nothing, so it goes in the first, parallel group. `autoModesDetail` names it, and
  `tests/auto-modes.test.tsx` is updated.
- **For an article already on the shelf**, a row in Metadata's *Re-run AI processing*
  (`METADATA_RERUN_STEPS`). The three answers `rerun-steps.ts` asks for:
  - one metered call per press;
  - no prerequisite beyond the article;
  - safe to publish over a good list, because a draft that validation empties throws.
- **Not in the blocking import itself.** Greg asked for import to be as fast as possible (5Y).

### Cost

**Provisional** (F13). The closest measured analogue is Ideas, an `"ids"` render at Sonnet 5:
$0.131 median and $0.183 max per article on the local corpus
([260930c](260930c-auto-generate-the-main-modes-after-import.md)). Cross-refs send the same input
and write more output (up to 60 short links), at medium rather than high effort. **Estimate:
$0.08–0.20 for a paper-length article**, which takes the after-import total from about $0.31 to
about $0.45. Stage 1 measures two real runs and records the input, cache, reasoning and output
tokens and the exact cost here:

- `entropy-24-00930-spya-pywwkq`, a scientific paper of 99 blocks;
- one longer article.

It also records what happens past the one-call context ceiling, which comes from `budgetFor`'s
refusal rather than a claim.

**Stage 1's real runs**, 2026-09-30, local, Sonnet 5 at `medium`, from the `ai_calls` ledger (the
provider's own cost). No cache read or write on any of them: each was its own job.

| article | prompt | input | reasoning | output (incl. reasoning) | time | cost | kept | dropped |
|---|---|---|---|---|---|---|---|---|
| `entropy-24-00930-spya-pywwkq` (99 blocks) | `/1` | 19,951 | 4,479 | 5,516 | 54 s | $0.0951 | 12 | nearby 7, length 1 |
| `the-mythology-of-conscious-ai-spya-rn5m0q` (141) | `/1` | 18,813 | 12,234 | 13,474 | 119 s | $0.1724 | 24 | none |
| `entropy-24-00930-spya-pywwkq` | `/2` | 20,174 | 1,729 | 2,472 | 25 s | $0.0651 | 7 | nearby 6, unquoted 2 |
| `the-mythology-of-conscious-ai-spya-rn5m0q` | `/2` | 19,036 | 0 | 1,216 | 17 s | $0.0502 | 11 | nearby 6, length 4, unknownIds 1, unquoted 1 |

So **$0.05–0.17 an article**, inside the estimate, and 17–119 s, which is why `STEP_BUDGET_MS` is
300 s rather than the 150 s first guessed.

**Why `/2`.** `/1` gave, on the paper, mostly explicit references ("see Section 6", "Figure 4C")
plus three citation lists (`[2–4,20,28]`, `see [9]`) linked to blocks that cite the same works;
on the essay, ten of 24 were pull-quotes linked to the sentence they repeat. `/2` asks for a claim
linked to its backing first and names citations, repeats and targets that add nothing as not
links. On `/2` those failures are gone. The essay's summary paragraph now links each summarised
claim to where it is argued ("well-understood cognitive biases" → the three biases; "Computational
functionalism" → where it is challenged; "brain-as-computer metaphor" → "brains are not
computers"). The paper's links are still mostly explicit figure and section references. It is a
review, and its abstract states few findings that a results block then reports. A couple on each
are weak: a link to a section heading, and a conclusion linked to a paragraph that only restates it.

The ceiling: `budgetFor("crossrefs", …)` refuses before the call when the article and the answer
budget will not fit in one call's context, as it does for `faq`. That refusal was not exercised
here.

## Left for Greg: two defence edits

[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
lists both files, and an unattended run does not edit a defence.

1. **Reserve the `xref` mark at ingress** (`src/sanitize-policy.ts`). Add `data-xref` to
   `FORBID_ATTR`, reserve the `xref` class and bump `SANITIZER_VERSION`, in one edit. This is the
   file's own three-part rule for a new `MarkKind`. While Sol was reviewing, it also found that
   **`data-block-link`, `data-block-preview` and `data-block-missing` are not forbidden today**.
   So an article can already forge a genuine block-preview card on words it chooses. That gap
   predates this plan, and v1 does not widen it. The same edit should close it.
2. **Let visitors see cross-refs** (`src/public/dto.ts`, the allowlist). This means a `crossrefs`
   key in `PUBLIC_PROJECTIONS`, the DTO and the visitor capability, omitted when stale, plus a test
   that an anonymous request cannot tell a private slug from an absent one. Until then, a visitor
   sees the prose without the links.

## Assumptions

- **Not a mode, and no off switch in v1.** Greg described annotation in the text, not a panel. If
  the underlines prove noisy, a switch comes next, and the cap is the first dial.
- **Not behind the experimental switch.** Greg asked for "a preprocessing step that always
  happens". It costs money only when an import has the box ticked or somebody presses re-run.
- **One target per link.** A claim backed by three passages links to the most direct one.
- **Within one article only.** Links out to other articles are
  [citations.md](../project/citations.md)' business.

## Stages

1. **The step.** Prompt, validation, store column and migration, stamp, owner route, rerun row,
   auto-run entry and the registration inventory.
   - **Tests.** Validation, red first: every row of the table above; `{}` throws; all-dropped
     throws; `{links:[]}` is kept. The stamp and step tables go through the existing total tests.
   - **Real runs.** Two, locally, with their cost recorded here.
   - **Review.** Sol code review.
2. **The prose.** The `xref` mark with its nonce, `xrefMarks`, the data path, TableView's click,
   mouse-up and Enter handling, the card's resolver, the `ProseHoverCard` exclusion, and the CSS.
   - **Tests.**
     - The mark and its attributes; one Tab stop for a split phrase.
     - A forged `class="xref" data-xref` in the source HTML does nothing.
     - Overlap with an author's `<a>` is dropped.
     - The xref wins over a term, cite, comment and search wash, on mouse and touch.
     - A click jumps to `to`, and Enter does the same.
     - A stale artefact draws nothing.
     - A late GET makes the marks appear.
   - **Browser check.** In a Sonnet subagent: hover, click, flash and back chip, at desktop and
     touch widths.
   - **Review.** Sol code review.
3. **Docs.** A `docs/project/cross-references.md` under reading-view-overview.md, a line in
   block-ids.md § Showing an id, the feedback note, the awaiting-approval line for the two defence
   edits, and this plan updated.

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
  `<a>` cannot nest in an author's `<a>`.
- **Folding it into the Ideas call.** That would save a call, but it braids two artefacts'
  freshness and prompts together, and Ideas' prompt version is pinned to its own evals.
- **Stopping at "awaiting Greg"** because of the two defence edits. The nonce makes the owner-only
  v1 safe without them, so the value lands now and the defence edits follow.

## Deferred

- Several targets per link, and a card listing them.
- A reader-facing switch to hide the underlines.
- Back-references: "this result is referred to from the abstract" on the target.
- Generating it for existing articles automatically when an owner opens them.
- The two defence edits above.

## Plan review

GPT Sol, 2026-09-30, `--sandbox review`, on `f25496a0`:
[260930f-cross-reference-links-plan-review-sol.md](260930f-cross-reference-links-plan-review-sol.md).
The verdict was *build with changes*, with 13 findings (F1–F13), all taken:

- **F1** (P0): the route is owner-only, and visitors go through the DTO.
- **F2** (P0): the nonce design. The sanitiser half is left for Greg.
- **F3–F9** (P1): all taken as written.
- **F10**: `why` dropped.
- **F11**: Ideas' input and fingerprint reused.
- **F12**: the inventory above.
- **F13**: cost marked provisional, and measured.

## Stage 2 as built

Client only; the server files from stage 1 are untouched.

- **`src/web/xref.ts`** holds the nonce: twelve hex characters from `crypto.getRandomValues`,
  kept in module memory. It also holds `xrefTarget(el, links)`, the one resolver every handler
  uses. The resolver is strict about shape (`<nonce>-<digits>`) and reads `to` from the links by
  index, never from the DOM.
- **`src/web/useCrossrefs.ts`** is the owner read. It goes through `useOrderedRead`, so
  StrictMode sends one GET rather than two. It yields `null` on a 404, an error, or a stale
  artefact.
  - It does not revalidate after a crossrefs job finishes. This is the same named gap the
    glossary, quotes and citations have.
- **The data path** is `OwnedReader` → `ReaderCapability.crossrefs` (owner arm only) → `Reader` →
  `TableView` (`xrefs`, put into `ProseEntry`, `sameInputs` and the `proseHtml` dependencies) and
  → `BlockLinkProvider` (`resolveXref`).
- **`xrefMarks`** in `annotate.ts` uses the same `"spaced"` unique rule as the server. On top of
  that it drops a phrase that crosses an author's `<a href>`, and a phrase that overlaps one already
  kept.
  - `annotateHtml` gives the first piece it draws `tabindex="0"`, `role="link"` and the whole
    phrase as its `aria-label`.
  - The section name reaches assistive technology through the card's `aria-describedby`, not
    through the label.
- **The handlers:**
  - `TableView`'s delegated click jumps unless the selection is not collapsed. A modified click does
    nothing.
  - A delegated Enter keydown jumps too. This replaced the `useKeyWithClickEvents` suppression.
  - `onMouseUp` returns for an xref after the selection branch and before comment or chat.
  - `mark.hit.xref` joined `NOT_A_BLOCK_SELECTION`. This was not in the plan; it is the
    citation's line, repeated for the xref.
  - `ProseHoverCard`'s `selector` and `tapSelector` exclude `.xref`, so a tap on a term or citation
    under an xref falls through to the jump.
- **The CSS** (in `annotations.css`) is a 2px dotted `text-decoration` in `--highlight-ink`, with a
  `:focus-visible` outline in `--highlight`. The words keep their colour.
- **Tests:**
  - `tests/xref-marks.test.ts` (7) and `tests/xref-prose.test.tsx` (15), which use the real
    TableView, BlockLinkCard and ProseHoverCard and the real hook with a mocked `apiFetch`.
  - `tests/the-ideas-extraction-changed-no-requests.test.tsx` now expects one
    `GET /api/crossrefs/…` per owned article view.
- **Mutations.** Each of these was checked by breaking it, watching a test go red, and restoring
  it:
  - the nonce prefix check (3 tests red);
  - the `:not(.xref)` exclusions (3);
  - the mouse-up return;
  - Enter;
  - the selection guard;
  - the memo dependency;
  - the stale filter;
  - the author-link drop;
  - the one-focus-stop set.

  Most of the TableView tests were written after the handlers. Their red was shown this way rather
  than first.

**The browser check** (Sonnet, Playwright, `the-mythology-of-conscious-ai-spya-rn5m0q`, port 5273)
passed underlines, hover card, click jump with flash and back chip, Tab with Enter (one stop for a
three-piece phrase), and a tap at 390×844.

- **The local artefact was stale at first**, so nothing was drawn. That is correct behaviour, and
  the agent regenerated it locally (about $0.05).
  - The review's in-progress edits to the fingerprint inputs had moved it.
- Screenshots: `260930f-xref-underlines.png`, `-hover-card`, `-after-jump`, `-focus-ring`,
  `-touch-before`, `-touch-after-tap`, `-touch-jump-chip`.

Seen and not fixed:

- A Tab-focused mark can sit behind the bottom dock.
- The back chip rendered below the emulated touch viewport. This is possibly an emulation artefact
  and wants a real phone.
- The xref's dotted rule is close to a glossary term's; the difference is mainly the warmer colour.
