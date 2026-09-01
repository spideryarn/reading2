## Recommendation

Keep an in-DOM carrier, but stop making attribute names the schema.

I would introduce a small, typed **markup-facts bridge** between stages 2 and 3:

- One reserved attribute, such as `data-spya-facts="f12 f19"`, containing only opaque IDs minted by stage 2.
- A versioned `markup-facts.json` beside `article.html`, mapping those IDs to typed facts and their provenance.
- Stage 3 resolves the IDs, writes proper domain fields, then removes the transport attribute before serialising block HTML.

For example:

```json
{
  "version": 1,
  "articleHash": "…",
  "facts": {
    "f12": {
      "type": "context",
      "context": "callout",
      "recognizedBy": "substack-data-callout"
    }
  }
}
```

Every surviving element from that callout carries `data-spya-facts="f12"`. The shared fact itself supplies the group identity.

This is a corrected version of (c): a sidecar alone cannot work, but a sidecar plus one opaque correspondence token can. The DOM carries coordinates; the sidecar carries meaning.

The one rule that keeps it from rotting should be:

> Only the bridge module may read or write `data-spya-*` transport attributes. Recognisers use its typed `createFact`/`attachFact` API; stage 3 uses its typed resolver.

That module owns the one template-aware scrub, validation, artefact-version check, unknown-reference failure, and final removal. A fourth recogniser should not implement any of those again.

## Why this shape fits this repo

Readability is not merely selecting a subtree. It moves siblings, changes tags, unwraps containers, creates paragraphs and conditionally deletes descendants. There is no stable path or node identity outside the transformed DOM. Therefore:

- Pure (c) has no trustworthy key.
- (d) replaces a reliable explicit signal with probabilistic alignment. Duplicate paragraphs make misassociation unavoidable, and misassociation is the failure [the block-ID contract](/home/greg/code/spideryarn2/docs/project/block-ids.md) explicitly treats as worse than losing an anchor.
- (e) means owning an extraction engine. Readability’s selection and cleanup are coupled; “use it only to choose the subtree” is not an API boundary it actually has. It would also change tags and block boundaries across the existing library, putting permanent IDs at risk.
- Raw (b), `marks: string[]`, moves the problem into a stringly typed vocabulary. `note:abc`, `callout:c7`, `lang:fr` and `deleted` do not have the same semantics, lifetime or validation rules.

A JSON sidecar is boring machinery in a pipeline already built from independently runnable artefacts. The additional complexity is justified here because it solves three problems together: central trust handling, group identity, and persisted provenance.

It will not make recogniser files disappear. Most of the 880 lines in `notes.ts` are publisher adapters and careful canonicalisation, not attribute plumbing. The win is that future recognisers stop inventing their own transport and security protocol.

The HTML and sidecar must be bound together, preferably by storing the exact `article.html` hash in the sidecar. Stage 3 should fail if the hash differs or a referenced fact is missing. Otherwise two individually valid artefacts from different extraction runs could produce plausible but wrong classifications.

## `kind` should stop absorbing callout

The clean invariant is:

> `kind` describes the block’s primary form, using the block itself. `context` describes an enclosing authored grouping.

Thus:

- A paragraph in a callout is `kind: "text"` in a callout context.
- A heading there remains `kind: "heading"` with the same context.
- A quotation there remains `kind: "quote"` with the same context.
- `role` continues to say what the content is: footnote, reference, appendix.
- `treatment` continues to drive argument-level policy: body or supplement.

I would call the new axis **contexts**, not `presentation` or `marks`. “Presentation” makes the UI authoritative; “marks” collides conceptually with inline `<mark>` and reader annotations. A callout is an authored context that happens to affect presentation.

Conceptually:

```ts
interface Block {
  kind: BlockKind;
  contextIds?: ContextId[];
  role?: BlockRole;
  treatment?: BlockTreatment;
}

interface BlockContext {
  id: ContextId;              // revision-local, not a public anchor
  type: "callout" | string;
  members: BlockId[];
  provenance: {
    recognizer: string;       // fixed code, not an arbitrary copied class value
  };
}
```

The rules should be:

- Contexts may nest and a block may have several.
- A context groups blocks; it is not copied into `kind`.
- Context IDs are revision-local implementation identities. URLs, comments and highlights must continue to address block IDs only.
- Context membership does not itself decide summarisation, search or reading-time policy. Those decisions remain named predicates, as [footnotes already established](/home/greg/code/spideryarn2/docs/plans/footnotes.md).
- Inline semantics that survive normally—`time`, `lang`, `dir`, `mark`, `ins`, `del`—stay in sanitised HTML unless a real consumer needs a block-level representation.

In Postgres, contexts that reach the reading view want context and membership rows with foreign keys, not another JSON column on every block. The stage-2 `markup-facts` sidecar can reasonably be opaque JSON because the database never queries its internals; it exists only to reproduce and debug stage 3.

## The one-way doors

The dangerous one-way doors are not the temporary attributes.

1. **Changing tag, text or block boundaries**

   That changes the matching key and can orphan comments. Avoid (e), broad canonicalisation and “cleaner” rewrites until block identity has a stronger migration mechanism. Adding or correcting metadata is safe precisely because it leaves tag and words unchanged.

2. **Creating another permanent address space**

   Do not make callout or figure group IDs public anchors. A group is revision metadata over permanent block IDs. If group-level comments are ever wanted, design that anchoring explicitly rather than accidentally making today’s extraction ID permanent.

3. **Letting `kind` become a feature registry**

   Every new value changes a CHECK constraint, projections, CSS and unknown consumers. More importantly, inherited presentation cannot fit a single-valued field. `"callout"` should be the last contextual `kind`, not the precedent for `"verse"`, `"rtl"`, `"table-header"` and so on.

4. **Leaving fact-only changes out of freshness fingerprints**

   Reclassifying a block can change summaries, structure or presentation without changing its text. Contexts, roles and treatments must enter the relevant input fingerprints or cause an explicit recipe-version bump. The footnote work already found this exact trap.

`kind: "callout"` is not itself permanent in the way a block ID is. It can be migrated to `kind: "text"` plus a context without changing tag or text. The costly part is compatibility across stored rows and consumers, not reader anchors.

## Incremental migration

I would not rewrite notes or callouts now.

The next feature that genuinely needs to carry destroyed evidence past Readability should first introduce the bridge and use it. That prevents a fourth attribute family without putting the existing stable-ID machinery at risk.

Then migrate in this order:

1. **Callouts first.** One fact per container, attached to all likely survivors. Stage 3 emits intrinsic `kind` plus a callout context. The reader temporarily supports both legacy `kind: "callout"` and the new context representation.
2. **Leave old rows and artefacts readable.** Keep `"callout"` in the CHECK during the compatibility period. Newly extracted revisions use contexts.
3. **Notes last.** Their marker/back-link contribution to the carry-over key is specialised and already heavily defended. Move them only after the bridge has proved itself on simpler facts; keep `role`, `treatment` and `noteId` as their domain representation.
4. **Keep author-anchor stamps separate for now.** They cross a sanitiser reparse inside stage 3, not the stage-2/3 boundary, and deliberately carry an author-supplied value before erasing it. They share a technique, but not the same trust contract.

The cost is one new stage-2 artefact, store/import/export plumbing for it, a typed codec, artefact-pair validation, and context storage plus compatibility in the reader. That is materially more than `reserved.ts`, but it is incremental rather than a pipeline rewrite. After it exists, a new lossy-markup feature adds a recogniser and a fact type—not another scrub, attribute parser, grouping invention and `BlockKind` migration.

## Two corrections to the framing

First, stage 2 is not really “writing into the stranger’s DOM”. `raw.html` remains untouched; stage 2 mutates a disposable working DOM owned by Spideryarn. The danger is not mutation. It is allowing untrusted input to impersonate trusted intermediate facts. A central scrub plus a sidecar that only stage 2 can produce gives that boundary a much clearer shape.

Second, the list of likely future features overstates how many need this bridge. Tables, definition lists, figures, `time`, `lang`, `dir`, `mark`, `ins` and `del` should first be handled by preserving their native markup and teaching the sanitiser/splitter about it. The bridge is only for facts whose evidence Readability demonstrably destroys. MathML damage may be an extraction or sanitiser problem, not a classification problem.

So the long-term answer is not “replace Readability” and not “keep inventing trusted attributes”. It is: keep the only reliable carrier available, reduce it to one centrally owned opaque channel, and move the actual meaning into typed, inspectable artefacts.