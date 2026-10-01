# An article's markup keeps only the `data-*` attributes and classes we allow

Follow-up to SPIDERYARN-READING2-5Z (cross-reference links), closing Sol's P0 from
[260930f code review 2, D3](260930f-cross-reference-links-code-review-2-sol.md). The open item was
[260930f § Left for Greg](260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md#left-for-greg-two-defence-edits),
item 1. Item 2, showing cross-references to visitors, is not part of this plan.

> Yes to the filter fix (or any other fix that feels clean, general, robust, clean)
>
> — Greg, 2026-10-01, relayed by the Overseer

## The problem, and why it is a class of problem

The reading view marks the prose with its own attributes and classes: a comment, a glossary term, a
quote stroke, a citation, a block link, a cross-reference. Then it trusts them. `BlockLinkCard` opens
a real preview card on anything matching `[data-block-link]`, and `Reader.tsx` treats a click inside
`.mode-band` as a click in the mode band.

The sanitiser (`src/sanitize-policy.ts`) is the only thing between a stranger's HTML and those
readers, and **it works from a denylist**. It keeps every `data-*` attribute and every class except
the ones someone remembered to list. Each new marking must therefore be added to that list by hand.
The file's own history records the cost: versions 2 to 7 are six additions, and four of them were
caught by a reviewer rather than by the change that needed them. 5Z is the fifth:
`data-block-link`, `data-block-preview`, `data-block-missing`, `data-xref` and the `xref` class are
all unlisted, so an imported article can put our preview card on words we never linked.

The hole is wider than those five names. App chrome classes appear in click handlers too, and none
of them is reserved: `.mode-band`, `.blk-permalink`, `.gloss-list`, `.dock`. A denylist cannot keep
up with them, because nothing tells whoever adds a class to `Reader.tsx` that the sanitiser exists.

## What we are doing: turn both lists round

An imported article may keep only **the `data-*` attributes and classes we name**. Everything the
app adds afterwards is outside that list by construction, so it cannot be forged, and a new feature
has nothing to remember.

1. **`data-*` attributes.** Set DOMPurify's own `ALLOW_DATA_ATTR: false`, and put the survivors in
   one declared list, `ARTICLE_DATA_ATTRS`, added through `ADD_ATTR`. It has two parts:
   - **The pipeline's own namespace**: every value of `RESERVED_ATTRS` (`src/reserved.ts`, the
     `data-spya-*` family). Stage 2 writes the note and callout stamps for stage 3; stage 3 stamps
     `wasId`/`wasName` *before* its sanitise and reads them straight after; the PDF renderer writes
     its figure stamp; and extraction evals temporarily write `sourceRef`. The reading view reads
     the note and PDF figure stamps. Each one is scrubbed from a stranger's markup on import by
     `scrubReserved`, under reserved.ts's own rule. Importing the constants keeps that file the only
     place that names one.
   - **Two publisher facts the pipeline reads**: `data-url-original` and `data-href-mobile`, gwern's
     real addresses behind an archive link, which `src/citations.ts` reads off the stored block HTML.
     Stage 3 wrote that HTML through this sanitiser, so dropping the pair would lose it on the next
     re-run. No client code reads either one.
2. **Classes.** A hook keeps a class token only if it is declared:
   - on any element: `ARTICLE_CLASSES = ["pdf-uncertain"]`, the one class our PDF renderer writes;
   - on a MathML element only: `TEMML_CLASSES`, the class names Temml's own stylesheet
     (`temml/dist/Temml-Local.css`) gives a meaning to. The reading view renders TeX with Temml
     (`src/web/maths.ts`) and then sends that output through this same sanitiser. Temml runs with
     `trust: false`, so a formula cannot choose its own classes, only Temml's vocabulary.

   Every other class token goes, and an emptied `class` attribute goes with it. The old seven-name
   strip (`cmt`, `chat`, `term`, `hit`, `cite`, `zoomable`, `zoom-btn`) is replaced by the new rule,
   which covers all seven.
3. **The per-name `FORBID_ATTR` entries for our annotation attributes stay.** They cost nothing, and
   the file already argues that un-forbidding a name is how a hole reopens. They become belt to the
   new braces, and a comment says so.
4. **`SANITIZER_VERSION` 7 → 8.** The policy is stricter, which is the rule for a bump.

### Evidence that nothing real is lost

A read-only survey of production (`Target: aws-0-eu-west-2.pooler.supabase.com:6543`, inside
`begin read only` … `rollback`) covered 101,526 stored blocks:

- **Classes:** one token in the entire corpus, `pdf-uncertain` (123 blocks). Readability's
  `keepClasses: false` has always stripped publisher classes, so turning the class list round
  loses nothing stored.
- **`data-*`:** 32 names. They are `data-spya-*` (ours) plus publisher tracking and metadata:
  `data-track*`, `data-test`, `data-doi`, `data-link-icon*`, `data-ga-action`, `data-url-*` and so
  on. `src/` reads only three of them after sanitising: `data-url-original` and `data-href-mobile`
  (citations) and the `data-spya-*` family. `data-track-action` (`furniture.ts`),
  `data-component-name` (`notes.ts`) and `data-callout` (`callouts.ts`) are read in stage 2, on the
  raw document, *before* any sanitise.
- The local corpus (50,045 blocks) adds Wikipedia's `data-mw*` and image-size attributes. Nothing
  reads those either.

### Do articles already in production carry forged markings?

**No.** The same read-only survey searched for every client-owned marking attribute (`data-block-*`,
`data-xref`, `data-comment`, `data-term`, `data-hit`, `data-quote*`, `data-cite`, `data-wash`,
`data-dir`, `data-*-open`, …) and every reserved class, including `xref` and `block-ref*`. Both
searches found **0 rows**. A control query with the same pattern shape over a name we know is
present was run alongside, so the zero is a real zero; its result is under § As built.

**No re-sanitising job is needed in any case.** Every path that *renders* an article applies the
policy on read. That covers the browser pass (`sanitizeArticle` at ingress,
`src/web/article/access.ts`) and the render-facing server loads (`src/store/pg.ts`,
`src/store/public-reader.ts`, which call `sanitizeStoredBlocks` with no stamp). So the fix reaches
every reader of every stored article the moment it is deployed.

Not every read re-sanitises, though (Sol, plan review, finding 3): pipeline artefact reads
(`src/store/artifacts-pg.ts`), publication validation (`src/store/pg-revisions.ts`) and the faithful
export bundle (`src/store/export-bundle.ts`) take `revision_blocks.html` raw. They go on seeing
publisher `data-track*` noise until that article's next stage-3 run. None of them renders it or
keys anything off it, and the survey found no forged markings for them to carry. It is not worth a
write to production.

## The tests

The tests are written first and must be seen red.

1. **Each 5Z forgery is stripped**: `<a data-block-link="spya-…" data-block-preview="on"
   data-block-missing>` and `<mark class="xref" data-xref="…">` come out bare. Red today.
2. **Chrome classes are stripped**: `class="mode-band"`, `class="blk-permalink"`. Red today.
3. **The collision tests.** Because the rule fails closed, a *new* marking is stripped with no
   edit anywhere, so no test needs to go red for it. What can still go wrong is a collision: the
   app keying something off a name an article is allowed to keep. The first draft of this item
   overclaimed here, and Sol corrected it (plan review, finding 1). The tests scan `src/` (not
   tests) for `data-…` literals, `dataset` properties and `RESERVED_ATTRS` references, and scan
   `src/web` for classes in seven spellings: stylesheet selectors,
   `closest`/`matches`/`querySelector` arguments, `*SELECTOR*` constants, `*CLASS*` constants,
   `className` literals and assignments, `setAttribute("class", …)` writes, and `classList` calls.
   They put data names through the real `sanitizeHtml` on a `<span>`, and classes through it on a
   `<p>` and a MathML `<mi>`, and assert that whatever survives is declared. They also
   assert that the only surviving `data-*` names present in browser source are the four
   `data-spya-*` stamps, and that the only class we share with Temml is `tml-display`. The failure
   message names the file.
4. **`TEMML_CLASSES` is pinned to Temml's stylesheet.** The test parses the class selectors out of
   `Temml-Local.css` and asserts the two sets are equal. After a Temml upgrade this goes red rather
   than letting maths lose a class without anyone noticing.
5. **Maths survives.** A battery of TeX (fractions, `aligned`, `\cancel`, `\vec`, `\overline`,
   `\boxed`, tags) goes through the real Temml renderer and the sanitiser, and every styled class it
   emits survives. A separate synthetic loop checks every declared Temml class.
6. **What must be kept, is kept**: every `RESERVED_ATTRS` value, `data-url-original`,
   `data-href-mobile`, `pdf-uncertain`, and a block id.
7. The existing suites: `tests/sanitize*.test.ts`, the maths tests, `tests/reserved.test.ts`,
   citations, notes, callouts and blocks.

## Which defence this touches

The DOMPurify policy in `src/sanitize-policy.ts` — the defence named by a row in
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
— is touched with Greg's approval (above). Nothing in that table is touched: its existing row
already names the shared policy. security.md's description is updated to say it is now an allowlist
for `data-*` and classes.

## What was passed over

- **Add the five missing names to the two lists.** This is the smallest edit and it closes 5Z.
  Stage 3 already picked it as the one-line fix. It is also the seventh episode of the same bug,
  and it leaves the chrome classes open. Greg asked for the class of bug to be closed, not this
  instance of it.
- **Move every app marking into one `data-sy-*` namespace and strip the prefix.** This is general,
  but it renames around twenty attributes and seven classes across CSS, TSX and tests. A class
  cannot carry a `data-` prefix, so classes would still need their own rule. It also still fails
  open for anything added outside the namespace. The allowlist fails closed and renames nothing.
- **A class allowlist with no MathML exception.** Temml's vocabulary is about sixty names
  (`mord`, `chr-*`, `wbk-*`, `ff-squash`, the strikes). Keeping it on every element would let an
  article carry `class="upstrike"` on a paragraph. Scoping it to MathML elements costs one
  namespace check.
- **Strip the class attribute entirely outside `<math>`.** Simpler still, but it would drop
  `pdf-uncertain`, which our own PDF renderer writes and `shell.css` styles.

## Not in scope

- The public DTO for cross-references (260930f item 2).
- `id`, `href="#…"` and `aria-*`. Block ids are the contract in
  [block-ids.md](../project/block-ids.md). An article's own fragment links are real content, and
  `aria-*` is not something our handlers key on.
- `RISKY_ROOT_ATTR`, which applies to `<body>` in stage 3. Its attributes are never serialised into
  a block.

## Stages

1. This plan, reviewed by GPT Sol (`--sandbox review`).
2. Tests red → policy edit → green; `npm test`, `npm run typecheck`, lint on touched files. GPT Sol
   code review (`--sandbox workspace-write`). Commit, push to `dev`.
3. Docs: security.md, the 5Z feedback note, awaiting-approval.md, 260930f's
   § Left for Greg.

## As built

Built as planned, 2026-10-01, with both GPT Sol reviews in this folder: the plan review
(`261001a-article-markup-allowlist-plan-review-sol.md`, approve after tightening) and the code
review (`…-code-review-sol.md`, approve, no P0–P2).

- **Production evidence.** The forged-marking queries returned 0 rows for both attributes and
  classes. The controls, using the same pattern shapes on names known to be present, returned
  1,563 and 123 rows. The script is
  [261001a-article-markup-allowlist-production-survey.mjs](261001a-article-markup-allowlist-production-survey.mjs),
  read-only. Run it from the repo root with an env file; the review prompts call it by its working
  name, `data/survey-5z.mjs`.
- **Red, then green.** The new tests went red against the old policy with ten failures: every
  forgery survived. They went green after the change.
- **Mutation-checked.** Each of three plants turned the intended test red, and each was then
  removed: `data-url-original` in a `src/web` file, `className="sout"`, and `data-block-link`
  added to `ARTICLE_DATA_ATTRS`.
- **Sol's code-review fixes.** `src/extract.ts` now scrubs a publisher's `data-spya-src` as well as
  `data-spya-pdf-figure`, since the whole namespace now passes the sanitiser (red→green in
  `tests/extract-sanitize.test.ts`). The scanners also read `dataset.*`, `RESERVED_ATTRS.*`,
  `*CLASS*` constants, `.className =` and `setAttribute("class", …)`. Every Temml class is tested
  on MathML and rejected on HTML.
- **Three existing tests needed their premise changed, not their purpose:**
  - `tests/sanitize.test.ts`: two tests pinned the denylist's "keeps a publisher's `data-*` and
    class" behaviour, and are reversed.
  - `tests/empty-blocks-keep-their-ids.test.ts`: two `<hr>`s are now told apart by `title`/`lang`
    rather than by `class`/`data-x`.
  - `tests/store-roundtrip.test.ts`: the expected `blocks.json` is now the fixture cleaned by the
    current policy, because the export cleans on the way out. Previous bumps never changed the
    fixtures' html, so this had not come up.
- **One finding the survey's names did not show.** Noema keeps its footnote text in a
  `data-note` attribute (64 production blocks). Nothing in `src/` ever displayed it: no JS and no
  CSS `attr()`. So dropping it changes nothing a reader sees, and a Noema footnote recogniser would
  read the raw page in stage 2, before any sanitise, like `notes.ts` does.
- **Gates.** The full `npm test` before the review fixes had 9 failures in 8 files:
  - 4, in 3 files, were this change's and are fixed above;
  - 5 were the fresh-worktree ones (`cold-start-lazy-imports`, `pdf-bundle-trace` and three
    `fleet-*`), all green after `npm run build` and `npm run build:fleet` (112 tests).
- **After the fixes.** 56 affected files and 1,479 tests green, plus `store-roundtrip` with 95.
  `npm run typecheck` exit 0, and lint clean on every touched file.
- **Not done.** The entry-point row in `security-map.md` is unchanged, because it is still true;
  `security.md` carries the new rule. The public DTO for cross-references (260930f item 2) waits
  on Greg.
