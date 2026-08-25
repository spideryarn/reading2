# Their block ids — the same problem, solved the other way

[block-ids.md](../block-ids.md) is [the one contract](../../../AGENTS.md) this repo has. They faced
exactly the same problem and went the opposite way, so this is the most useful head-to-head in the
folder: two answers to one failure, and a list of rules that holds whichever you pick.

The failure both schemes exist to prevent is the same: **reader state silently pointing at the wrong
paragraph after re-extraction.** A highlight, a note, a scroll position that quietly moves one
paragraph down and never tells anybody.

Planning: `docs/planning/finished/250526d_deterministic_id_generation.md`,
`docs/planning/finished/250528c_standardise_id_generation_tooltips.md`. Code:
`lib/services/deterministicId.ts`.

## Their scheme: deterministic, computed from content

An id is `syr-` plus the first 8 hex characters of a UUIDv5 over a fingerprint of the element:

```
fingerprint = [
  path,          // hierarchical DOM path, e.g. /div[0]/p[1]
  className,
  dataAttrs,     // all data-* attributes, "key=value,key=value"
  role,
  type,
  textContent    // first 100 characters, trimmed
].filter(Boolean).join('|')

id = 'syr-' + uuidv5(fingerprint, FIXED_NAMESPACE).substring(0, 8)
```

Our `spya-` prefix serves the same purpose as their `syr-`: an id you can grep for and never
mistake for anything else.

## The durable part: what must and must not move an id

This list is worth more than either scheme, because it is the specification both are trying to
satisfy. Quoted from their planning doc:

> Changes that should NOT affect IDs:
> - Whitespace/formatting in text
> - Style attributes
> - Head content changes
> - HTML comments
> - Attribute order
>
> Changes that SHOULD affect IDs:
> - Adding/removing/reordering elements
> - Changing tag names
> - Changing class names or data-* attributes
> - Significant text content changes
> - Element hierarchy changes

**Use this as a test list.** Our ids survive re-extraction by matching old blocks to new ones
([block-ids.md § Surviving stage 2](../block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)),
and every line above is a case that matcher should be checked against. The two halves fail
differently and both failures are silent: too eager and every id churns, too lax and two paragraphs
collide.

## Where the two schemes genuinely differ

| | Theirs (deterministic) | Ours (random, carried forward) |
|---|---|---|
| Where the id comes from | recomputed from the element every time | minted once, then matched forward |
| An edited paragraph | becomes a **different** paragraph | stays the same paragraph |
| What can go wrong | a trivial edit orphans reader state | the matcher pairs the wrong blocks |
| What it costs | nothing at write time | an explicit matching step |

**Neither gets stability for free**, which is the thing worth saying plainly. Theirs pays at read
time (any input change moves the id); ours pays at write time (we must run a matcher, and the matcher
can be wrong). Ours is the better trade for a reading app, because an author fixing a typo should not
detach a reader's note — but it is a trade, not a free win.

## The bug that proves the rule

Their own code carries this comment, and it is the best argument in either repo for taking ids
seriously:

> Preserve existing IDs if present. We must NEVER overwrite a pre-existing id attribute because
> other application features – such as AI-generated heading operations – rely on stable IDs
> remaining unchanged between page loads. Overwriting them here breaks cached mutations that
> reference those IDs and results in lost enhancements on page refresh (see issue: headings vanish
> after reload).

Deterministic ids were supposed to make preservation unnecessary — that is the whole selling point —
and they still had to add an explicit "never overwrite an existing id" rule to stop features
vanishing on reload. **The preservation step is not avoidable.** We do it openly
([block-ids.md](../block-ids.md)); they arrived at it by having reader state disappear.

## Three more things they learned the hard way

1. **A collision is fatal, not something to paper over.** Their `validateIdUniqueness` throws
   `FATAL: ID collision detected!` rather than appending a suffix. Right instinct: a silently
   deduplicated id is a wrong id that nothing will ever report. Ours are random and checked at
   generation; keep the check loud.
2. **Never fold a timestamp into a content-derived id.** Their regeneration path appended
   `Date.now()` to the seed to force freshness, and headings accumulated without bound across
   repeated runs — the bug in
   [ai-headings.md § And it still shipped a real bug](ai-headings.md#and-it-still-shipped-a-real-bug).
   An id that changes every run is not an id.
3. **Two id schemes in one app is a bug generator.** AI-inserted headings originally got a
   *content-only* id (no path, no prefix, full UUID) while original elements got the position-based
   one. Tooltip lookups then had to fall back to matching text, which is exactly the fragile thing
   ids exist to replace. They unified on one scheme, computing the DOM path an inserted element
   *would* occupy before inserting it.

   Greg's recorded worry at the time, before that decision:

   > One possible argument in favour of the existing purely content-based approach for generating IDs
   > for new content is that it will be more robust if we apply/compose multiple mutations - in that
   > case, the content-based approach might be more consistent. That said, I worry about whether
   > there might be a greater chance of collisions with the content-based approach.

   Both halves of that worry were reasonable, and the deciding factor turned out to be neither: it
   was that **having two schemes at once** cost more than either scheme's weakness.

## What this means for us

We already hold the stronger position, and the reason is architectural rather than clever: **we never
insert anything into the article**, so there is no second population of elements needing ids. Every
id in this system is minted by stage 3 over extracted prose
([architecture.md § Pipeline](../architecture.md#pipeline)), and everything else — tree nodes, arc
entries, comments — refers to them.

Two rules to keep, both of which their experience justifies:

- **One id scheme, for one kind of thing.** Node ids (`n0003`) are positional and regenerated;
  block ids are minted once and preserved. That distinction is already load-bearing and already
  written down ([url-state.md](../url-state.md#the-unit-is-a-section-not-a-position)) — the arc
  matches by block range for exactly this reason
  ([granularity-zoom.md § The arc](../granularity-zoom.md#the-arc)). Do not let a third scheme in.
- **Test the matcher against their list above**, both directions.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../block-ids.md](../block-ids.md) — ours: why random, and what it took to survive re-extraction
- [extraction.md](extraction.md) — the stage that produces the elements being identified
- [ai-headings.md](ai-headings.md) — the feature whose ids churned, and why
