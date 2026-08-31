# Review: the reserved namespace and the context axis, as built

You are reviewing **built code**, and it is the code that came out of your own design answer earlier
today ([the question](260831af-carrying-markup-facts-past-readability-design-prompt.md),
[your answer](260831af-carrying-markup-facts-past-readability-design-sol.md)). Be adversarial and
concrete. For each finding, name the file and line, say what input or sequence produces the wrong
behaviour, and say what the fix is. Rank by severity. Say plainly if something is fine — and say
plainly where the build **departed** from your recommendation and you think it was wrong to.

## What was asked for

Greg, after reading your answer summarised: *"Proceed, including tests, with final review from GPT
Sol, then commit these changes."* Two of your three pieces are built; the third is deliberately not.

- **A — one module owns the reserved namespace.** `src/reserved.ts` now holds every `data-spya-*`
  name, the one template-aware scrub, and `mintContextId`. `src/notes.ts` (four attributes),
  `src/callouts.ts` (one) and `src/blocks.ts` (two, stage-3-internal, erased after reading) all call
  it. `src/web/notes-view.ts` and `src/web/graph.ts` had been re-spelling three of the names in the
  browser and now import them, which is why that module has no imports of its own.
  `tests/reserved.test.ts` scans `src/` for the literal prefix and fails on an unregistered name.
- **B — `kind` stops absorbing presentation.** A callout paragraph is `kind: "text"` again and
  carries `context?: {id, type: "callout"}`. Stage 2 mints the id (hash of the container's text, so
  it is stable across re-runs) and puts it in the stamp's *value*; stage 3 reads it with `closest()`
  and re-validates the shape. This fixes the defect your answer named: a heading inside a callout
  kept `kind: "heading"` and lost the box entirely. It now renders indented, in the softer ink, with
  **no** quote mark — confirmed in a browser: `td.ctx-callout.kind-heading .prose` computes
  `padding-inline-start: 38.4px` and `::before` content `none`, beside the paragraph's `"“"`.
- **C — the typed `markup-facts.json` sidecar is not built**, for the reasons in the plan: it buys
  debuggability rather than behaviour and costs a new artefact kind across both stores, import,
  export and the manifest. So **the attribute name still carries the type**, and `CONTEXT_ATTRS` in
  `reserved.ts` maps one to the other rather than assuming there will only ever be one.

## Storage, and the shape you may disagree with

`revision_blocks` gains **two nullable columns** — `context_id`, `context_type` — with a CHECK that
they are both null or both set and a CHECK that the type is in `('callout')`. Not the membership
table your answer implied, and the plan argues why: nothing today can produce a block in two
contexts, because stage 2 collapses a callout inside a callout into one; two nullable columns is the
path `role`/`treatment`/`note_id` cut three days ago; and the migration to a table, when a second
type has to co-exist, would then have a real case to design against. **Tell me if that trade is
wrong**, and in particular whether it is wrong in a way that gets expensive later.

`kind: "callout"` stays in the union and in the CHECK, produced by nothing, because revisions
extracted during the few hours it existed carry it. The stylesheet answers to both spellings.

## The two places this deliberately departed from your advice

1. **`context` is not folded into `hashBlocks`.** Your one-way door #4 says fact-only changes must
   enter the freshness fingerprints. `role` and `treatment` are in there because a reclassification
   changes no text and would leave every summary, idea and vector reporting itself current. The
   argument does not seem to carry for a context: **nothing downstream of the fingerprint reads
   one** — it changes how a paragraph is set and nothing else — and folding it in would flip every
   article with a callout onto the framed canonical form and re-run the whole *paid* pipeline for a
   presentational fact. The stated trigger for revisiting: the day anything derived reads `context`,
   it joins the fingerprint in that same change. **Is that reasoning sound, or is there a consumer I
   have not noticed?**
2. **Notes were not moved onto the context axis**, per your own migration order — they keep `role`,
   `treatment` and `noteId`. So there are now two spellings of "this block belongs to an authored
   group" in `Block`. Is that an acceptable interim, or does it need a comment somewhere it will be
   read?

## What is in front of you

The new module, the new test, the migration, and a diff of everything else. Note that this tree is
shared by several agents and a 25-file merge landed in the middle of this work; the diff is scoped
to the files this change touches.

## The specific questions

1. **`wrapLooseRuns`** (src/callouts.ts) is new since your last review: it wraps each contiguous run
   of loose phrasing content inside a callout container in a `<p>` of our own, because Readability
   builds a fresh paragraph from loose text and our stamp would not be on it. It runs **before** the
   descendant query, and it moves the author's nodes into a new element. Does it change anything
   about block identity (`exactKey` matches tag + text), block *boundaries*, or Readability's
   scoring? What markup makes it produce a wrong grouping?
2. **The id is minted from the container's text** (`mintContextId(`callout:${textOf(container)}`)`),
   with a `taken` set so two boxes holding the same words get different ids. Is stability the right
   call at all, and is hashing the text the right key — given that the text can be large, can contain
   anything, and is a stranger's? The hash is FNV-ish, not cryptographic, deliberately (the module
   must stay import-free for the browser). What breaks on collision?
3. **`contextFor`** (src/blocks.ts) re-validates the id against `CONTEXT_ID_PATTERN` at the seam
   where a DOM attribute becomes a value in `blocks.json`, Postgres and the public payload. Is that
   the right seam and the right check? What gets through it?
4. **The scrub moved.** `scrubReserved(root, attrs)` is now shared by three families with different
   contracts — two stage-2 (values we mint, kept in the artefact) and one stage-3-internal (a value
   the *page* supplied, erased after reading). Is sharing the walk right, or does the third one want
   to stay separate as your answer suggested? Note `blocks.ts` still clears `<html>`/`<body>` by
   hand because it scrubs from `doc.body`, while `callouts.ts` scrubs from the document.
5. **The browser now imports `reserved.ts`.** It has no imports and uses no Node APIs, on purpose.
   Is there anything in it that should not be in a browser bundle, and does importing it from
   `notes-view.ts` create a cycle or a payload problem?
6. **The public payload.** `context` crosses to a visitor via `publicBlock` in src/public/dto.ts,
   copied by reference rather than rebuilt field by field — the one shortcut, on the grounds that
   `BlockContext` is a closed two-field type stage 3 mints. `tests/public-dto.test.ts` pins the exact
   recursive key set. Is anything of the owner's reachable through it?
7. **The store paths.** Six files select or write the two columns. Is one of them missed, and would
   anything notice if it were? (`tests/store-block-roles-pg.test.ts` now round-trips a context and
   was confirmed red against a `writeBlocks` that writes `contextId: null`.)
8. **The CSS.** `td.text.ctx-callout .prose` and `td.text.kind-callout .prose` share a rule; the mark
   is `td.text.ctx-callout:not(.kind-heading) .prose::before, td.text.kind-callout .prose::before`.
   Is the legacy arm right — in particular, does a legacy `kind-callout` heading exist, and if so
   what does it get?
9. **The tests.** Would a plausible wrong implementation pass them? The namespace scan strips
   comments first, in both directions, because these files quote the attribute names in prose.
10. **Anything wrong, dangerous or over-built** — including whether A was worth doing at all given
    that it moved three correct copies of a walk into one place and changed no behaviour.
