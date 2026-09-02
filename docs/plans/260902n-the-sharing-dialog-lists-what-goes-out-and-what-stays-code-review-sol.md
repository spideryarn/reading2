## Verdict

I would request changes. The five presence flags are computed correctly, and I found no route exposing comments, notes, lookups, conversations, profile data, private titles, or uploaded bytes. But the inventory is not yet complete or wholly honest: `arc` and `assets` escape the derivation, several sentences contradict the actual DTO, and the optional-field fallback still permits publication without the promised disclosure.

## Findings

1. **`arc` is computed but never affects the inventory.**

   [`shareableArtefacts`](/home/greg/code/spideryarn2/src/store/pg.ts:1846) correctly reports `arc`, and [`publicArticle`](/home/greg/code/spideryarn2/src/public/dto.ts:445) conditionally sends it. But [`sharedInventory`](/home/greg/code/spideryarn2/src/web/shared-inventory.ts:94) never reads `available.arc`: Outline is always shared, while only tweets receive special treatment.

   The comment claiming tweets are “the one artefact … with no mode of its own” is false; arc also has no mode of its own. Mapping `arc` to the permanently shared Outline row conceals whether an arc exists and prevents a missing arc appearing under “Not built yet.”

   I would give Arc its own row and bucket it using `available.arc`, just as tweets are.

2. **`assets` is a second variable public artefact missing from `available`.**

   `publicArticle` sends the entire optional assets manifest. That includes original URLs, hashes, content types, byte counts, fetch times, and failures from [`Assets`](/home/greg/code/spideryarn2/src/assets.ts:84). Therefore:

   - When `assets` is absent, the current Pictures detail falsely promises “the record of which of them we hold a copy of.”
   - When assets are built later, that manifest appears publicly without another sharing confirmation.
   - The manifest is internal pipeline/provenance information, despite “How it was made” being listed as private.

   The current source has already corrected the supplied diff’s stronger and false “served from our copy” claim, but the replacement still overstates delivery.

   I would preferably stop putting the manifest in the public DTO until cached asset delivery exists. If it must remain public, add assets presence to the availability shape and disclose the manifest separately.

3. **“How it was made … stays with you” is false.**

   [`NEVER_SHARED`](/home/greg/code/spideryarn2/src/messages.ts:1731) says model, version, run time, and related pipeline facts stay private. Yet:

   - [`publicTree`](/home/greg/code/spideryarn2/src/public/dto.ts:258) sends `version`, `generator`, and `provisional`.
   - [`publicArc`](/home/greg/code/spideryarn2/src/public/dto.ts:277) sends `version` and `generator`.
   - `assets` sends version, source hash, fetched time, and failures.
   - [`PublicQuotes.discarded`](/home/greg/code/spideryarn2/src/public-types.ts:297) sends pipeline rejection counts.

   Either remove those fields from the public DTO or narrow the copy to exact private facts, such as prompts, cost, elapsed time, and personalization inputs. The plan and security documentation currently overstate this too.

4. **“Whatever the model has written about it” is materially false.**

   [`SHARING_WHAT_VISITORS_SEE`](/home/greg/code/spideryarn2/src/messages.ts:1410) immediately contradicts the withheld list: model-written chat answers, search responses, quizzes, referee results, timeline, and diagrams do not go out.

   I would say “the AI-generated reading aids listed below,” or explicitly name the public set.

5. **Hierarchy, Outline, and Summary copy does not handle provisional trees.**

   The DTO deliberately forwards `tree.provisional`, but the three mode descriptions promise model-written headings and a gist for every section. A provisional heading-derived tree has no such gists.

   I would make these conditional: for example, “the nested contents and zoom levels, including generated headings and gists when available.”

6. **Other public-wire details are only loosely represented.**

   Nothing private appears to cross, but a literal inventory omits:

   - `meta.excerpt`;
   - `Block.html`, meaning formatting and hyperlinks, not just extracted text;
   - tree `treatment` and `provisional`;
   - quote discard counts;
   - technical assets metadata.

   The public HTML head also exposes the canonical source URL and a root gist—or excerpt fallback—as `<title>`, description, and social metadata. The tweets page consumes the same public article payload; it does not add an additional private-data path. I found only the two public API endpoints, article and metadata.

7. **Presence rather than currency is correct for the five named artefacts.**

   For arc, tweets, glossary, ideas, and quotes, [`shareableArtefacts`](/home/greg/code/spideryarn2/src/store/pg.ts:1846) matches `publicArticle`: non-null content is public even when stale. None of those five is revision-only/private, and none of those five is missing from the DTO.

   The problems are that `arc` is ignored downstream and `assets` is a sixth optional public payload outside this type.

8. **Keeping `available` optional is right; silently omitting the disclosure is not.**

   Rejecting the whole sharing object would prevent an already-shared owner from unsharing, so [`asArticleSharing`](/home/greg/code/spideryarn2/src/web/AccessSharing.tsx:141) is right to preserve valid visibility.

   However, a private owner can still proceed through confirmation and publish while the inventory is silently absent. That defeats the feature precisely during a contract or rolling-version failure.

   I would:

   - keep the visibility switch usable;
   - show “We couldn’t load the sharing inventory”;
   - always allow an already-shared article to be made private;
   - disable a new publication until the inventory can be loaded, or require an explicit uncertainty acknowledgment.

9. **The three-bucket lifecycle is otherwise correct.**

   Completing a pipeline job publishes the new revision; visibility remains an article-level setting. Therefore an already-public article receives newly completed glossary, ideas, quotes, tweets, or arc without another confirmation.

   The precise moment is successful revision publication, not merely writing an artefact into a draft. The claim is correct for represented artefacts, but not complete while arc and assets are missing from “Not built yet.”

10. **The glossary separation is true, but its intended note disappears when absent.**

    Public reading does not select glossary lookups, so “Your lookups … are not part of this” is honest. But [`sharedInventory`](/home/greg/code/spideryarn2/src/web/shared-inventory.ts:109) replaces the descriptive `OWNER_MODE_NOTE` with `sharedNotBuilt` for missing artefacts. Consequently, the absent-glossary row no longer carries that clarification—or any description of what Glossary is.

    The heading and column note already state “not built” and “would go out.” I would retain the mode-specific detail and remove the repetitive per-row `sharedNotBuilt` text.

11. **The tooltip is inaccessible to sighted keyboard and touch users.**

    A non-focusable `<li title=…>` provides hover text and an accessible name for screen readers, but no keyboard or dependable touch disclosure. The comment saying the information is not sighted-hover-only overstates the implementation. Important publication details should be visible or exposed through a focusable tooltip/disclosure.

## Tests that miss real regressions

The existing tests cover broad partitioning and the glossary stale-content trap, but these mutations would remain green:

- Make `available.arc` always false, or remove all use of it. It is already unused.
- Make tweets, ideas, quotes, or arc always false in `shareableArtefacts`; only glossary is tested independently.
- Cross-wire parser fields, such as `arc: row.tweets`. The accepted fixture has all flags true.
- Make Glossary consult `available.ideas`. The inventory tests compare only all-false with all-true.
- Have `asArticleSharing` discard a valid `available` object. Parser and rendering are tested separately, not end to end.
- Put every rendered array under the wrong heading. The card test asserts headings and explanatory text, but not which labels occur beneath which heading.
- Add a nested public field to `PublicBlock`, `Tree`, `Assets`, or `PublicQuotes`. `WIRE_ROW` only guards top-level `keyof PublicArticle`.
- Map a new public field to any unrelated existing inventory key. The total record proves that somebody typed a mapping, not that the sentence is accurate.

The malformed-flags card test is especially weak: it passes malformed data directly as a component prop and does not open the private confirmation, so it does not exercise the parser or the location where the inventory renders.

I would add one-hot tests for every flag and one Metadata-response → parser → confirmation test using an asymmetric fixture.

## Documentation and naming

`PublicArtefacts` is a reasonable name, and moving it into a deeper shared module is defensible. The stated justification is inaccurate, though: the cycle check passed despite existing type-only imports between `types.ts` and `messages.ts`, so “the gate counts type-only cycles” is not supported by the actual tooling.

Several quantity comments are also stale: they say “five fixed things,” while the implementation contains three always-shared rows, six never-shared rows, and tweets.

Separately, the public Metadata page displays four generated-artefact rows and omits Quotes even though Quotes is one of its five flags.

## Verification

The focused sharing tests passed: 71 tests. The broader public-route, DTO, page-head, visitor-gap, and network tests passed: 171 tests. The standalone typecheck and import-cycle check passed. The combined `npm run check` wrapper could not start because the sandbox denied its `tsx` IPC socket; that was an environment failure, not a reported code failure.