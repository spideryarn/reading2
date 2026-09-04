# The evidence behind 260904d, kept so the numbers can be recomputed

Every figure in [260904d-deepen-fat-sections.md](../../../docs/plans/260904d-deepen-fat-sections.md)
comes from these files. They are here because GPT Sol's second review pointed out that the plan
quoted a lot of measurements from throwaway scripts whose output was not in the repository, so
nothing in the tree could check them. ⟨2026-09-04, finding 5.⟩

Two Project Gutenberg texts, both public domain: `2701-h` is *Moby-Dick* (2,569 blocks, 209,219
words) and `1228-h` is *On the Origin of Species* (1,326 blocks, 155,478 words). Their `blocks.json`
is not kept — it is deterministic and free to rebuild from the extracted HTML, which is at
`output/2701-h.html` and `output/1228-h.html` in the primary checkout.

| file | what it is |
|---|---|
| `2701-h.tree.json` | Moby-Dick through the **incumbent** whole-document structure call |
| `1228-h.tree.json` | Origin of Species, the same |
| `1228-h.deeper.tree.json` | Origin of Species through the **conditional four-level** prompt |
| `expand-moby-0.json` | one scoped expansion of Moby-Dick's fattest section — run A, 10 children |
| `expand-moby-0b.json` | the same call again — run B, 20 children. The variance is the finding |
| `expand-darwin-0.json` | one scoped expansion of Darwin's fattest section |

The three `.tree.json` files are the spike output with the model's raw answer stripped and the
`elapsed`, `usage`, `stop` and `tree` fields kept — enough for every script below. The three
`expand-*.json` files keep their raw answers, because the variance between run A and run B is only
visible in them.

**Not kept: the four failed Moby-Dick runs of the conditional four-level prompt.** The first threw
before the answer was saved, which is why `scripts/spike-book-structure.ts` now writes the answer
before it builds anything. Their failure messages are quoted in the plan.

## Recomputing

The scripts that produced the plan's tables were throwaway and live in the session scratchpad, not
here. They are three-line walks over `tree.json` and `blocks.json` and are quoted in the plan where
the numbers appear. The two that are in the repo:

```
npx tsx scripts/spike-book-structure.ts <blocks.json> <out.json>
SPIKE_SYSTEM_FILE=<prompt.txt> npx tsx scripts/spike-book-structure.ts <blocks.json> <out.json>
npx tsx scripts/spike-expand-section.ts <tree.json> <blocks.json> <rank> <out.json>
```

Both make **paid model calls**. A whole-document call on Moby-Dick is about $1; a scoped expansion is
a few cents.
