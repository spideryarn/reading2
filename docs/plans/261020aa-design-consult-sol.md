## Recommendation

Choose **C: a paired reference**, for example:

```json
"start": {"line": 582, "id": "spya-xcf0dz"}
```

Require both fields and accept the reference only when:

1. `line` is an in-range integer;
2. `id` matches the exact Spideryarn pattern;
3. `blocks[line].id === id`.

If they disagree, **neither wins**: reject the answer and re-ask. Falling back to either value would turn useful redundancy into a silent wrong boundary.

The exact pattern is not `^spya-[a-z0-9]{6}$`. From [ids.ts](/var/tmp/spideryarn-worktrees/fbmxdf6r-structure-json-schema/src/ids.ts:14), it is effectively:

```regex
^spya-[abcdefghjkmnpqrstuvwxyz][abcdefghjkmnpqrstuvwxyz023456789]{5}$
```

This rejects every observed malformed value, including `spya-76bd1a`, whose body starts with a digit. More importantly, if constrained decoding turns a splice into a well-formed but wrong ID, the line/ID disagreement makes the error loud.

No supported schema can enforce the correspondence between the two fields. This design therefore makes **shape and ID syntax valid by construction**, while one small deterministic check establishes identity. That is the strongest safe contract available without an enum.

Keep `[i]` and IDs in `renderBlocks`. Change only the whole-document prompt, schema and starts converter:

- Long-document slices automatically inherit the paired format because they use `wholeDocumentRequest`.
- Scoped expansion keeps its current string format and shared renderer; migrate it separately when it gains a strict schema. Changing it now unnecessarily enlarges the experiment.
- Keep effort at `low`. Higher effort previously brought cost, truncation risk and the worse silent “welding” failure; it does not provide a validity guarantee.
- B loses the independent witness. A and D leave wrong-copy failures. E is only a contingency if the paired format itself performs poorly.

Bump `PROMPT_VERSION`; the schema-bearing wire digest already changes the checkpoint key, and the expansion stamp will honestly miss once. Remove splice recovery and last-answer dropping from the **new live path**. Old checkpoints cannot match the new request. If historical raw answers still need replaying, retain a clearly named legacy `toc/11` decoder outside the production kernel.

## Paid eval

Run four validity arms: incumbent, exact-pattern-only A, integer-only B, and paired C. D and E need not be paid contenders.

Use the established 70-answer shape per arm:

- 40 draws on the failing 648-block article;
- 10 each on three varied articles: heading-heavy, over 1,000 blocks, and shorter/dense.

That is roughly $32 for four arms at the stated historical rate. Treat consecutive draws as simulated two-answer steps.

Record per-reference pattern failures, out-of-range lines, pair mismatches, unknown/wrong-real IDs, repairs, heading snaps, dropped children/headings, two-answer step success, thinking tokens, output tokens, cost and latency.

Gates for C:

- zero mismatches or unknown references accepted;
- zero recovery and zero child drops;
- every simulated two-answer step builds a sound tree;
- no regression in repairs, authored headings or gross section counts;
- then run only incumbent versus C through the existing blind eight-article, two-draw panel and its pre-registered U thresholds. Any “possible loss” goes back for a decision rather than shipping automatically.

## Other calls

Free-string block IDs also occur in Ideas, Simple, Tweets, Timeline, Quiz, FAQ, Crossrefs, Bibliography, Sketch, Illustrated, Relations, Sources Claims, and Matter (`from`/`to`/`heading`). Add the exact ID pattern broadly, but adopt ordinals or paired references per call only after measuring: many use `articleWithIds`, which currently has no ordinal. Labels already maps checked ordinals to IDs, and Quotes never asks the model to return an ID.