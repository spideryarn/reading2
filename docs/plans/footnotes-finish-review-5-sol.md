Verdict: **BLOCK**. The owner path is much closer, but the inventory is not closed.

## Blockers

1. **Public articles lose `TreeNode.treatment`.**

[`publicTree`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:150) copies every tree field except `treatment`. The existing test explicitly asserts that it is dropped ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dto.test.ts:336)).

My probe through the real DTO produced:

```text
owner:  supplement nodes 1, parts 1, sections 1
public: supplement nodes 0, parts 2, sections 2
```

Consequently, for public readers:

- Notes are numbered as an argument part.
- Fisheye collapsing switches off.
- Spine and Outline descend into individual note leaves.
- Summary mode restores the phantom numbered rows.
- Diagram Tree and Force include apparatus nodes.
- Public metadata counts remain wrong.

Block treatment does cross the DTO, so word counts and Drift/Trail membership remain correct. It is specifically the tree-side consumers that break.

2. **The apparatus can still add a granularity column.**

[`buildGeometry`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:90) computes `leafDepth` from every node, including supplement leaves.

For a valid shallow body tree:

```text
body maximum depth:       1
supplement leaf depth:    2
articleStats.depth:       1
geometry.leafDepth:       2
gist depths offered:      [0, 1]
```

That creates an L1 gist column whose body cell is actually a leaf with no gist. It also contradicts the metadata’s claim about how many granularity levels the article offers. The ladder’s maximum must be derived from the body branches, while supplement continuations can still be projected into those columns.

3. **`bodyRows` is correct for coordinates, but not for the spoken paragraph count.**

Keeping `lastBodyRow + 1` is right for Drift’s raw-row axis and defensible for progress hue: positions stay monotonic and the last body row reaches the final step.

But [`node()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:428) uses that extent as “paragraph N of M”. With one stranded note between two body paragraphs, the labels are:

```text
paragraph 1 of 3
paragraph 3 of 3
```

It must use body ordinals for the spoken count. The coordinate extent and paragraph count are now two different quantities.

## Consumer inventory

| Consumer family | State at `6bc1021` |
|---|---|
| ToC generation, labels, validation, flat ToC | Handled |
| Summary generation and root-summary reattachment | Handled |
| Arc, glossary, ideas and tweets | Handled |
| Embedding, similarity and projection membership | Handled |
| Fisheye, `?at=`, keyboard navigation and arc cells | **Partial:** owner handled; public DTO breaks it; granularity depth remains wrong |
| Spine | **Partial:** public DTO breaks supplement treatment |
| Outline mode | **Partial:** public DTO restores note-leaf descent |
| Summary mode | **Partial:** public DTO restores numbering and phantom rows |
| Diagram Tree | **Partial:** public DTO makes Notes ordinary structure |
| Diagram Force, Drift and Trail | **Partial:** public Force breaks; stranded spoken count is wrong |
| Shelf words/parts/sections | Handled |
| Reader/public metadata counts | **Partial:** owner handled; public counts remain wrong |
| Search, chat, explain, prose and note previews | Handled as intentionally inclusive |

There is also a previously missed fourteenth consumer: **the public tree projection itself**, currently unhandled.

## `articleStats.depth`

The exclusion is correct. The only reader is the Metadata “Levels” stat ([Metadata.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:592)), whose copy explicitly defines it as the argument’s granularity ladder. Nothing reads it as the physical tree maximum.

The problem is `buildGeometry`, not `articleStats`. Add a direct depth assertion, though: the current agreement test asserts only parts and sections ([block-policy.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/block-policy.test.ts:312)).

One documentation nit: [`footnotes.md`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/footnotes.md:3) still says “plan, unbuilt,” and the public DTO test still describes this lane as uncommitted.