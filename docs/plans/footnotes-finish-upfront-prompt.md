# Finishing the footnotes feature — input wanted before I build

You reviewed stage 4 of this feature and returned BLOCK with eight findings
(`docs/plans/footnotes-stage4-review-sol.md`). Four are fixed and shipped in commit
`d385ce4`. **Four remain**, and Greg has asked for a working, good-enough-for-now
version rather than the complete one. I want your input on the plan *before* I build,
and I will send you the diff for review afterwards.

Please be concrete. Where you think a proposed fix is wrong, say what it should be
instead. Where you think a fix is not worth doing for v1, say so — "leave it" is a
useful answer here and I would rather ship four small correct things than four large
ones.

## What the feature is

An article's footnotes are pulled out of the body and hung under one node — a
**supplement node**, an authored title ("Notes"), a depth-one child of the root,
deliberately with **no gist**, so the apparatus is present in the structure and absent
from the argument. Greg, 2026-08-28:

> I feel there should be a way to see it in the structure of the doc (e.g. in the
> Spine, so that I could jump to the Footnotes), but we don't necessarily need to
> summarise and include it in the argument.

A note is a **range of blocks**, not one block (gwern: 34 notes across 41 blocks).

## The four findings, and what I propose to do about each

### F6 — a leaf-shaped supplement passes the invariants and then splits the projections

`checkSupplements` in `src/tree-invariants.ts` states six things a supplement node must
be. Invariant 5 is "only leaves beneath it", and it is written as *"no child of mine has
children"*:

```ts
    const deep = node.children
      .map((id) => tree.nodes[id])
      .filter((c): c is TreeNode => !!c && c.children.length > 0);
    if (deep.length > 0)
      fail(`${node.id}: supplement has ${deep.length} internal child(ren) ...`);
```

A supplement node with **zero** children satisfies that vacuously. `appendSupplement`
never builds one, so this is a guard against a future bug rather than a live defect —
but you pointed out that when it happens the two projections disagree: `navigableItems`
(`src/web/tree.ts`) merges supplement cells by ancestor lookup and the childless node
contributes none, while the `?at=` position tracker walks blocks and includes its range.

**Proposed fix:** one more line in `checkSupplements` — a supplement node must have at
least one child — with its own message and its own mutation test.

**Question for you:** is "at least one child" the right rule, or should it be the
stronger "its children tile its range exactly, one leaf per block"? The stronger one is
what `appendSupplement` actually builds. I lean stronger *if* it is a handful of lines,
because the failure mode you named is precisely a range/child disagreement — but the
generic tiling invariant may already cover it and I do not want two checks that can
disagree.

### F5 — `checkTree` is never called on the filesystem write path

`checkTree` runs in `src/validate-tree.ts` (a CLI a human invokes) and in
`src/store/pg-revisions.ts:1052` (a **publish guard** — it collects reasons, it does not
throw). `generateToc` in `src/toc.ts` builds a tree, appends the supplement, merges
labels, and writes `tree.json` without ever asking whether the result is valid. So a
stage-4 regression is invisible in exactly the workflow I do most of my testing in.

**Evidence I gathered before proposing anything:** I ran `checkTree` over every
`tree.json` in `data/` — 8 articles have one, **8 are clean, 0 have problems**. So
turning this into a hard failure costs nothing on today's local corpus.

**Proposed fix:** after `mergeLabels`, before the three `writeAtomic` calls, run
`checkTree(blocks, tree)` and **throw** if `problems.length > 0`, with the problems in
the message (capped, the way the pg guard caps them). Rationale for throwing rather than
warning: a warning here is the "guard that goes quiet when defeated" pattern this repo
has been bitten by repeatedly — and the tree is one model call old, so the honest
response to "the model returned a structure that violates the invariants" is to fail the
step and let the queue retry it.

**Questions for you:**
1. Is throwing right, or does it turn a recoverable article into an unpublishable one?
   The failure I can construct in my head is an article where the structure model
   returns something `buildTree` accepts and `checkTree` rejects — I do not know
   whether that set is empty.
2. Should the check go **before** `generateLabels` (on `structure`, so a broken tree
   costs zero label calls) or **after** `mergeLabels` (on `tree`, which is what is
   actually written)? Before is cheaper; after is what is on disk. I lean **after**,
   because the thing I want to guarantee is a property of the file, and doing it before
   would leave `mergeLabels` unchecked. But then a bad tree costs a full label run
   first. A third option is both, and I am wary of two calls.

### F7 — the return path marks every back-link from the passage, not the note followed

A reader clicks a footnote marker; we remember the passage they left so the note can
show which of its back-links is theirs. Wikipedia has a note in this corpus cited
thirteen times, so this matters.

`src/web/App.tsx:1692` stores **only the block id**:

```ts
  const [noteReturn, setNoteReturn] = useState<BlockId | null>(null);
  const followNote = useCallback((from: BlockId | null, to: BlockId) => {
    setNoteReturn(from); jumpTo(to);
  }, [jumpTo]);
```

and `markReturnPath` in `src/web/notes-view.ts:290` selects on the href alone:

```ts
  const marked = Array.from(root.querySelectorAll(`a[${NOTE_BACK_ATTR}][href="#${fromBlockId}"]`));
```

So **one passage citing two different notes** lights up the back-link in *both* notes.
(The mirror case — one note cited from two passages — is fine, and is what the browser
pass happened to check.)

**Proposed fix:** carry the note id alongside the block id. `NOTE_BACK_ATTR`
(`data-spya-note-back`) already holds the note's id — it is written by stage 2 — so the
selector becomes
`a[data-spya-note-back="<noteId>"][href="#<fromBlockId>"]`, `noteReturn` becomes
`{ from: BlockId; noteId: string } | null`, and the call site in `TableView.tsx:624`
already has the `NoteMarker` in hand, so `note.note.id` is free.

**Questions for you:**
1. `fromBlockId` is validated with `/^[A-Za-z0-9_-]+$/` before being interpolated into a
   selector, for obvious reasons. The note id comes from the same pipeline. I plan to
   validate it the same way rather than trusting it. Agreed, or is there a reason to
   reach for `CSS.escape` instead?
2. Is there a case where marking **both** is right — a reader who followed one marker in
   a passage that cites two notes, and might plausibly want either way back? I do not
   think so, but you have been right about this kind of thing before.

### F4 — the legacy `structureHash` framing collision

`src/source-hash.ts`. A tree with any `treatment` hashes through a versioned
JSON framing (collision-free). A tree with none takes the **legacy** path, which is what
keeps today's whole corpus from mass-invalidating every `labels.json` and `ideas.json`:

```ts
  const canonical = supplemented
    ? `spya-tree/2\n${JSON.stringify(ids.map((id) => [...row(id), tree.nodes[id]!.treatment ?? ""]))}`
    : ids.map((id) => row(id).join("\u0000")).join("\n");
```

The legacy branch joins fields with U+0000 and rows with a newline. Both can occur in
`title` and `gist`, which are **model prose**. You reproduced a collision; so did I
(two trees differing only in where a U+0000 sits hash identically).

**Proposed fix, and this is the one I most want you to shoot at.** Rather than reframing
the legacy form — which changes every existing hash and re-runs every paid stage — make
the legacy branch **conditional on being unambiguous**: take the legacy path only when
no field of any node contains U+0000 or a newline; otherwise fall through to the
versioned JSON framing.

```ts
  const rows = ids.map(row);
  const ambiguous = rows.some((r) => r.some((f) => f.includes("\u0000") || f.includes("\n")));
  const canonical = supplemented || ambiguous ? `spya-tree/2\n...` : legacy;
```

Every real tree in the corpus keeps its fingerprint byte for byte (I will verify this by
pinning the existing hash of `example/tree.json`, `5bb2ef0284bce2cd`, which is already
pinned in `tests/supplement.test.ts`). The collision becomes unreachable, because the
only inputs that could collide are exactly the ones routed to the safe framing.

**Questions for you:**
1. Does this actually close it? My reasoning is that two canonical strings can only
   collide if both took the legacy path, and any pair that collides under the
   NUL-and-newline join requires at least one of the two to contain a delimiter, which
   routes it away. I would like you to try to break that argument rather than agree
   with it.
2. Does `hashBlocks` above need the same treatment? Its legacy branch is
   `` `${b.id}\t${b.text}` `` joined with a newline, and **`text` is article prose**,
   which is far more likely to contain a tab or a newline than a tree title is to
   contain a NUL. This looks to me like the same bug in a much more reachable form and
   I did not see it in your eight findings. Am I missing a reason it is safe?

## What I am deliberately not doing for v1

- Stage 6 (PDFs) — cut by Greg.
- Stage 3b (the block-id carry-over key) — briefed, never started, and it is a
  correctness improvement to re-extraction rather than something a reader meets.

Tell me if either of those is a mistake to defer.

## Process

Every fix here gets a test **watched go red against the bug before the fix goes in**;
that is a rule in this repo because most of a day's bugs turn out to be something
reporting success while doing nothing. If you think one of these fixes cannot be given a
test that fails first, say so — that is a finding in itself.
