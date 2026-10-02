Verdict: revise the plan before building. The overall shape is good, with no P0 findings, but four P1 issues should be resolved first.

## Findings

### P1 — Minimal-paper cards would make a false claim

The plan says a minimal paper has “title and abstract only” and that showing an abstract would require another endpoint ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/docs/plans/261002f-paper-card-on-topic-article-links.md:22)). Both are inaccurate:

- `LibraryEntry.abstract` is already on the wire ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/src/types.ts:2000)).
- Abstracts are optional; legitimate minimal papers have none.
- “Not read yet” is ambiguous: the reader may have opened it, while the AI has not processed it.

Change the minimal case to the established product language:

- Omit `Length`, or say `Status — Not AI-processed yet`.
- Never print `0 min` or `0 words`.
- Use a bounded abstract as the preview when available: `gist ?? truncated abstract`. If abstracts are deliberately omitted, record that as a presentation choice, not a missing-data limitation.

Test minimal entries both with and without an abstract.

### P1 — Repeating the title creates an accessibility restatement

Visually repeating the title is defensible, but the detail link’s accessible name is already the exact `LibraryEntry.title`. A plain `Tooltip` attaches all card text as the link’s `aria-describedby` ([Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/src/web/Tooltip.tsx:298)). On keyboard focus, a screen reader will therefore announce a potentially long title twice.

Keep the visual title, but let this caller mark it hidden from the accessible description—for example, `titleIsTriggerName` on `PaperCard`, causing only the title element to receive `aria-hidden="true"`. Future callers whose visible link is a slug or short label can leave it exposed.

Add an integration test that focuses the real `Link`, verifies exactly one tooltip opens, verifies `aria-describedby` points to it, and verifies the description does not repeat the link’s title. Ref forwarding itself is already correctly supported by [Link.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/src/web/Link.tsx:16) and pinned by `tests/tooltip-on-link.test.tsx`.

### P1 — The row tooltip needs `keepSide`

The proposed `placement="bottom-start"` omits `keepSide` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/docs/plans/261002f-paper-card-on-topic-article-links.md:36)). These are adjacent triggers carrying a wide card—the exact case for which `Tooltip` documents `keepSide`: otherwise Floating UI may move a card onto the horizontal axis and cover the neighbouring links the reader is scrubbing toward.

Use:

```tsx
<Tooltip placement="bottom-start" keepSide ...>
```

The browser check should include a link near the right edge and verify the card remains above or below the row without covering its neighbouring links.

### P1 — Scope and missing-entry behavior need one explicit invariant

The plan promises that a slug absent from loaded entries remains a bare link. In the real flow, `topArticles` first filters against `inScope` ([ShelfTermChip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/src/web/ShelfTermChip.tsx:41)); `inScope` itself is built from loaded active entries plus archived entries only when archive is enabled ([useShelfTerms.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbf28vqj-topic-article-hover-card/src/web/useShelfTerms.ts:252)). Consequently, a genuinely unloaded slug is omitted before `entryOf` is called. The proposed “bare link” test would require an impossible production state.

Build `inScope` and `entryOf` from the same scoped entry array:

- Active entries always.
- Archived entries only while archived is enabled and loaded.

Then state the contract as: out-of-scope or unloaded slugs are omitted from the top-article links. A bare-link fallback may remain defensively, but should not be presented or tested as the normal behavior.

For duplicate titles, keep the current slug-based lookup: the selected first copy’s link must show that exact copy’s added/opened/archive/share state and topics, not metadata looked up by title. Add a fixture where two same-title copies have different metadata to pin this.

### P2 — `TermTipScope` is the wrong owner for paper-card lookup

Adding `entryOf` and `topicsOf` to `TermTipScope` couples every topic chip—including the pill view—to a facility only `ShelfTermsDetail.Titles` needs. It also invites a `PaperCard`/`ShelfTermChip` dependency cycle because `PaperCard` uses `TopicDot`.

Keep:

```ts
PaperCard(entry: LibraryEntry, topics: readonly { label: string; slot: number }[])
```

That is a good v1 reusable seam: `LibraryEntry` contains the owner-specific facts, while the topic projection remains supplied by the shelf caller.

But pass a separate paper-card scope directly to `ShelfTermsDetail`, such as:

```ts
{
  entryOf(slug): LibraryEntry | undefined;
  topicsOf(slug): readonly PaperTopic[];
}
```

Leave `TermTipScope` limited to what `TermTip` consumes. Also replace the separate `titleOf` map with `entryOf(slug)?.title`; one map is simpler and cannot drift.

### P2 — The planned tests are too happy-path-heavy

The fact-function plus one hover test does not pin the risky parts. Add coverage for:

- Keyboard focus and the actual `aria-describedby` text.
- Ref forwarding through the real `Link`.
- Exactly one open card while moving between a topic chip, count bar, and paper link, proving there is no nested `TooltipGroup`.
- `keepSide` in the browser at the right edge and narrow width.
- Minimal papers with and without abstracts.
- Archived and shared entries.
- Same-title copies with different reader-state metadata.
- An outside-scope slug being omitted.
- Topics drawn from every server term, including a currently hidden zero-count topic.
- Six-topic cap, rank order, and `+N more`.

## What is already right

- A per-link `Tooltip` is simpler than delegated machinery at this scale.
- Reusing the existing `TooltipGroup`, without adding an inner group, is correct.
- A non-interactive card is correct because it contains no controls.
- No touch reveal is consistent with the table title links.
- Computing topics from the entire server answer, rather than currently drawn topics, is correct.
- `LibraryEntry + topic labels/hues` is the right reusable boundary once lookup/scope remains outside `TermTipScope`.