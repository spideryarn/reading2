Found and fixed three issues; one low-severity layout limitation remains.

- S1 — P2 — [item-focus.ts](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/item-focus.ts:105): a zero-height scroller was flashed and marked handled before layout, permanently losing the landing. Fixed by retaining the focus and retrying through `ResizeObserver`. Red test: [item-focus.test.tsx](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/tests/item-focus.test.tsx:79).

- S2 — P3 — [item-focus.ts](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/item-focus.ts:158): browsers clamp the first and last rows to the list edges, so they cannot be perfectly centred. Not fixed: doing so requires persistent blank half-panel gutters across all four lists. The flash still clearly identifies these rows; comments now state the limitation.

- S3 — P3 — [item-focus.ts](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/src/web/item-focus.ts:172): centring measured from the border box, placing a row high by the scroller’s top border. Fixed using `clientTop`. Red test covers a bordered scroller and nested positioned content: [item-focus.test.tsx](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/tests/item-focus.test.tsx:59).

- S4 — P3 — [block-flash.test.ts](/var/tmp/spideryarn-worktrees/fbm53cdk-sources-scroll-and-blurbs/tests/block-flash.test.ts:169): the band-only inset rule had no regression test, so removing it left the suite green while reintroducing a temporary horizontal scrollbar. Fixed with a mutation-checked CSS assertion.

The `(i)` condition and all six `hiddenNote` adopters are correct; Search and Claims still suppress the note when nothing is hidden.

Checks: 8 scoped files/374 tests passed; typecheck covered all 3,776 source files; Biome passed. Full `npm test` could not start because local Postgres was unavailable. No commit made.

ship after fixes (made)