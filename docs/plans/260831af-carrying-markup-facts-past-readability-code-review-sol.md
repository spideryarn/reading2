Do not commit this as-is. The overall direction is right, but there are two commit-blocking correctness defects and one visible CSS defect.

## Findings, ranked

1. Blocker — `wrapLooseRuns` can change block boundaries and permanently remint an ID.

[`src/callouts.ts:142`](/home/greg/code/spideryarn2/src/callouts.ts:142) treats anything absent from `INSIDE_TAGS` as loose phrasing content. That confuses “stage-3 leaf” with “HTML phrasing content.”

This input reproduces it:

```html
<div class="callout">
  Before list.
  <ul><li>First item…</li></ul>
  <span>After list in a span.</span>
</div>
```

The function creates an invalid `<p>` containing the `<ul>`. After Readability serialises it and stage 3 reparses it, the blocks change from:

```text
P("Before") → LI("First") → P("After")
```

to:

```text
P("Before") → LI("First") → SPAN("After") → empty P
```

The trailing block loses its context and changes tag, so [`exactKey`](/home/greg/code/spideryarn2/src/blocks.ts:572) cannot carry its ID. Direct `hr`, `dl`, `section`, `article`, `ul` and `ol` children produce related failures. I also reproduced Readability choosing different article content because the newly created `<p>` changes scoring.

Fix: mirror Readability’s phrasing-content test. Only text and genuine phrasing elements may join a run; every non-phrasing child flushes it. Separately, stamp every descendant that might survive, rather than deriving that set from `LEAF_BLOCKS`.

Add real-pipeline tests with `text + ul/hr/section + trailing span`, asserting:

- the same meaningful tag/text boundaries as the unwrapped extraction;
- no extra empty block;
- every resulting block has the same context;
- IDs carry from equivalent classless markup.

2. High — freshness ignores a policy input that context changes.

[`contextFor` is used to change `gistable`](/home/greg/code/spideryarn2/src/blocks.ts:229), but [`hashBlocks`](/home/greg/code/spideryarn2/src/source-hash.ts:80) includes only `id`, `text`, `role` and `treatment`.

Concrete silent sequence:

1. A body paragraph is repeated inside a callout, so the callout copy is `gistable: false`.
2. The publisher removes only the callout wrapper; tag, text and block ID remain unchanged.
3. Stage 3 reruns. The block becomes `gistable: true`.
4. `hashBlocks` remains identical.
5. The hierarchy step has no currency stamp and skips when its files exist ([`src/pipeline.ts:1665`](/home/greg/code/spideryarn2/src/pipeline.ts:1665)).
6. Publishing accepts the old hierarchy. The newly gistable paragraph still has no navigation label.

The same unchanged hash reuses stale warm-process vector and similarity caches: [`articleVectors`](/home/greg/code/spideryarn2/src/article-vectors.ts:259) filters on `gistable` but keys on `hashBlocks`.

There is also a filesystem-specific context problem: hierarchy copies the complete blocks into the file the reader opens ([`src/hierarchy.ts:1623`](/home/greg/code/spideryarn2/src/hierarchy.ts:1623)). A partial stage-3 rerun can therefore leave the reader serving the old context.

Fix: do not blindly add raw context IDs to every paid pipeline fingerprint. Add a consumer-specific fingerprint containing `gistable` for hierarchy, vectors, similarity and projection. For presentation-only context changes, refresh or overlay the stage-4 filesystem block copy without rerunning the model.

So the stated reasoning is only half sound: raw context does not affect model prompts when `gistable` is unchanged, but the build does have downstream consumers that its current fingerprints cannot protect.

3. Medium — the callout glyph applies to quotations, code, media and captions.

[`src/web/styles.css:1308`](/home/greg/code/spideryarn2/src/web/styles.css:1308) excludes only headings:

```css
td.text.ctx-callout:not(.kind-heading) .prose::before
```

Therefore a `<blockquote>` inside a callout receives both its ordinary quotation treatment and the large callout quote mark. Code, figures, media and captions get the mark too, contrary to the comment immediately above.

Fix:

```css
td.text.ctx-callout.kind-text .prose::before,
td.text.kind-callout .prose::before
```

Keep the broader indentation/soft-ink selector if that treatment is intended for every contextual kind.

The legacy arm is correct. The old producer changed only an existing `kind: "text"` to `"callout"`, so no valid legacy `kind-callout` heading exists.

4. Low — the public DTO breaks its own nested allowlist rule.

[`src/public/dto.ts:187`](/home/greg/code/spideryarn2/src/public/dto.ts:187) copies `context` by reference. A runtime value such as:

```ts
context: { id, type: "callout", ownerSecret: "…" }
```

passes the extra property through, despite the file’s rule that public objects are reconstructed field by field.

No owner field is reachable today: the only production caller constructs exactly `{id, type}` in [`public-reader.ts`](/home/greg/code/spideryarn2/src/store/public-reader.ts:475). Nevertheless, the shortcut removes the protection against the next caller or optional field.

Fix: rebuild `{ id: block.context.id, type: block.context.type }` and add a canary-extra-key test.

5. Low — the namespace test is a tripwire, not the enforcement it claims to be.

[`tests/reserved.test.ts:53`](/home/greg/code/spideryarn2/tests/reserved.test.ts:53) only catches a prefix immediately following a quote. Both of these pass:

```ts
RESERVED_PREFIX + "rogue"
<div data-spya-rogue="" />
```

The “registers every attribute actually written” test at line 70 merely enumerates the registry itself. Also, `CONTEXT_ATTRS` is currently unused by the reader: [`contextFor`](/home/greg/code/spideryarn2/src/blocks.ts:267) hardcodes callout again.

Fix the scan to catch bare tokens/JSX and prohibit composing names from an exported prefix, or use an AST rule. Either consume `CONTEXT_ATTRS` exhaustively or delete it until a second type exists.

6. Low — callout transport remains in public block HTML.

Stage 3 resolves `context`, but [`src/blocks.ts:1130`](/home/greg/code/spideryarn2/src/blocks.ts:1130) serialises the cloned content without removing `data-spya-callout`. Thus the public block carries the same fact twice: in `context` and in `html`.

This departed from my recommendation to erase transport after resolving it, and I think it was wrong. Notes need their inline attributes in the browser; callouts do not. Remove the callout stamp from the cloned block HTML after resolving context, including stamped descendants.

## Direct answers

1. `wrapLooseRuns` is not identity-safe as built. Lists and other non-leaf block containers are the counterexample above. A correctly phrasing-aware implementation should preserve the boundaries Readability would have produced.

2. Deterministic IDs are reasonable as best-effort diff aids, not stable identity. Hashing the entire `textContent` is too broad: [`textOf`](/home/greg/code/spideryarn2/src/callouts.ts:242) includes script, style and template text that Readability removes. I confirmed that changing only a script nonce changes the context ID. Editing one paragraph also relabels every member of the box, and inserting an identical box changes duplicate suffix assignment. Remove non-surviving content before hashing and document the guarantee as “stable for identical visible extraction.” Collisions do not merge boxes because `taken` adds suffixes; today they cause only relabelling churn.

3. The DOM-to-`Block` seam is the right place to validate. The check is shape validation, not provenance: any page can guess a valid-looking value, and only the stage-2 scrub authenticates it. The regex also accepts mint-impossible suffixes such as `-0`, `-1`, `-0002`, and arbitrarily long decimals. Tighten it to mint’s canonical `n >= 2` representation and correct the comments that imply the regex proves provenance.

4. Sharing the mechanical scrub is fine. The author-anchor family still keeps its separate write/read/pre-and-post-scrub lifecycle, which is the important distinction. However, [`reserved.ts:18`](/home/greg/code/spideryarn2/src/reserved.ts:18) says no page-supplied value is ever carried, while lines 62–65 correctly say `wasId` and `wasName` do exactly that transiently. Fix that contract. Also, `scrubReserved(element, …)` omits the element itself; current callers compensate, but the generic API should either include its root or accept only `Document`/`DocumentFragment`.

5. The browser import is fine. The module is side-effect-free, has no Node dependency, and `npm run cycles` passed. Tree-shaking should make the payload effect negligible.

6. Nothing belonging to the owner is reachable through the current production public path. Rebuild the nested value anyway, as finding 4 explains.

7. No storage path is missing. The two columns are present in artifact PG read/write, import, export, draft carry-forward, owner reads and public reads. The positive PG test covers the artifact write plus owner read, but omission of public-reader, export/import or draft carry-forward could still pass. Add positive tests for those distinct paths.

8. The legacy CSS arm is right; the modern selector is not. No produced legacy callout heading exists.

9. Yes, plausible wrong implementations pass: block containers inside `wrapLooseRuns`, non-text CSS marks, the `gistable: false → true` freshness transition, computed/JSX namespace names, nested DTO extras, and several storage projections.

10. A was worth doing: central names and one template-aware walk are a useful small guardrail. C can remain deferred. The two-column schema is a sound simpler-first trade; migration to a membership table is a linear backfill, not a conceptual trap. Keeping notes on `role`/`treatment`/`noteId` is also acceptable and matches the recommended migration order. The wrong departures are the structural DOM mutation, the incomplete freshness model, and retaining callout transport in block HTML.

Checks: the read-only probes reproduced findings 1, 2 and the ID instability. Browser cycle checking passed. Vitest could not start because the sandbox forbids its temporary-directory writes. Typechecking completed for the browser project; the repository-wide check reported unrelated existing errors in shared files, not in this change.