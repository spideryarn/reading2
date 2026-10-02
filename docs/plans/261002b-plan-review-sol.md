No P0 findings. One P1 and several P2s. The separate public section is the right v1, and I found no security/privacy blocker.

## Findings

- **P1 — The plan omits the public section’s failure contract.** `loadPublicLibrary()` returns `PublicRead<PublicLibrary>`, not a bare library; a 404 or rejected request must be a failure, never an empty public shelf. The existing hook deliberately models `loading | loaded | failed`, includes Retry, and guards overlapping responses ([PublicLibraryPage.tsx:378](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/PublicLibraryPage.tsx:378), [PublicLibraryPage.tsx:390](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/PublicLibraryPage.tsx:390), [PublicLibraryPage.tsx:431](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/PublicLibraryPage.tsx:431)). The plan only specifies empty and capped states and tests neither failure nor Retry ([plan:102](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md:102)). Require the same state machine in the section and test failure → Retry → success, including a late superseded response.

- **P2 — “Search public articles” actually means “search the newest 200 public cards.”** The anonymous endpoint is capped before the browser filters it ([public-library.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/store/public-library.ts:86)). Consequently an older matching article can produce “no match.” Reusing `PUBLIC_SHELF_TRUNCATED` verbatim, as proposed at [plan:48](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md:48), only says that the page is capped; it does not explain that the search was incomplete ([messages.ts:3247](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/messages.ts:3247)). Use section-specific copy such as “Only the most recently shared articles are searched here.” Do not claim “nobody else has shared anything” when the returned window is truncated and deduplication removed every returned row.

- **P2 — The phone predicate needs an “unknown dimensions” guard.** The proposed conjunction is a reasonable device heuristic, but the implementation’s fallback dimensions are `0 × 0`, which satisfies `< 600` whenever the pointer is coarse ([small-screen-hint.ts:156](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/small-screen-hint.ts:156), [small-screen-hint.ts:190](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/small-screen-hint.ts:190)). Require both dimensions to be finite and positive. Add cases for 599, exactly 600, 0, and `NaN`.

- **P2 — Orientation copy is not demonstrably reactive.** The plan promises different copy when already sideways ([plan:80](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md:80)), but the phone facts are read once and the orientation is merely sampled during render ([ShelfPhoneHint.tsx:27](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/ShelfPhoneHint.tsx:27), [ShelfPhoneHint.tsx:34](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/ShelfPhoneHint.tsx:34)). After the reader follows the advice and rotates, nothing here guarantees a render. Either subscribe to orientation/resize, or explicitly decide that the sentence only reflects arrival orientation.

- **P2 — The empty-shelf test does not test the promised behaviour.** Checking only that the link targets `#add-url` ([plan:104](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md:104)) does not prove the plan’s “scrolls and focuses” promise. The target really is the input ([AddArticle.tsx:288](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/AddArticle.tsx:288)); click it in the test, assert `document.activeElement`, and spy on `scrollIntoView`.

- **P2 — The documentation changes need to be explicit in the plan.** The current public-shelf doc says the owner’s shelf is only “your articles” and retains the badge-not-filter decision ([public-shelf.md:13](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/project/public-shelf.md:13)). The library doc stresses one integrated list for archived articles and “two different shelves” ([library.md:301](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/project/library.md:301), [library.md:899](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/project/library.md:899)). `touch.md` also describes one banner and one dismissal bit ([touch.md:588](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/docs/project/touch.md:588)). The new second section does not invalidate the underlying distinction, but all three docs need wording that records it.

## Security and privacy

I found no leak in the proposed anonymous call:

- `publicFetch` cannot attach an authorization header and explicitly uses `credentials: "omit"` ([public-api.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/public-api.ts:55), [public-api.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/public-api.ts:103)).
- The public listing projection excludes owner ID, private rename, purpose, archive/open state, source URL, excerpts, and prose ([public-library.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/store/public-library.ts:194)).
- `byline` is the article’s author, not the reader who shared it ([public-library-types.ts:41](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/public-library-types.ts:41)).
- Search is client-side, so the signed-in reader’s query is not sent to the anonymous endpoint.
- Slug-based deduplication is safe because article slugs are globally unique ([schema.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/db/schema.ts:154)).

Calling public data anonymously from an authenticated page is therefore the correct boundary: it prevents the public response from becoming personalized or accidentally dependent on a session.

## Can a signed-in reader open another reader’s public article?

Yes.

1. `PublicCard` links to the normal `/read/<slug>` address through `readHref` ([PublicLibraryPage.tsx:319](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/PublicLibraryPage.tsx:319)).
2. With a session, access first requests the owner-scoped `/api/article/<slug>` ([access.ts:479](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/access.ts:479)).
3. Its 404 means “not mine,” after which the client requests `/api/public/article/<slug>` ([access.ts:481](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/access.ts:481), [access.ts:509](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/access.ts:509)).
4. A public 200 becomes `kind: "public"`; `ArticlePage` mounts `VisitorArticle`, not owner components ([ArticlePage.tsx:220](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/ArticlePage.tsx:220)). The visitor reader receives an explicit visitor capability ([ArticlePage.tsx:635](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/ArticlePage.tsx:635)).

That is exactly the supported `owned 404 + public 200` case documented in the access seam ([access.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/article/access.ts:162)).

## Additional test cases

Add:

- Public 404/failure, Retry, and overlapping-response ordering.
- One own public row plus one other row, proving dedup removes only the own row.
- Public response resolves before the owner shelf; never briefly label an own article as “other.”
- Empty endpoint, all returned rows deduped, and query-matched-none as distinct states.
- `truncated: true` with and without a query.
- Unread/topics visibly leave public results unchanged.
- Back/Forward around `?public=1`, including a pending debounced `?q=`.
- Actual phone-banner rendering, dismissal click, portrait copy, landscape copy, and rotation if live updating is intended.
- The anonymous integration request carries neither credentials nor the shelf query.

## Simpler design and conclusion

The separate section is the right v1. `PublicLibraryEntry` deliberately lacks the owner relationship fields that make the main shelf work ([public-library-types.ts:12](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/public-library-types.ts:12)). Merging it into the owner list would either invent meaningless values or spread owner/visitor branches through sorting, table rows, actions, topics, and Unread. Greg explicitly asked for inclusion and search; he did not explicitly require one interleaved order.

The simplest implementation shape is one `ShelfPublicSection`, mounted only while the chip is on, owning the existing public state machine and rendering the existing `PublicCard`. If exporting page internals feels awkward, move `PublicCard` and `usePublicShelf` into a neutral public-shelf module used by both pages; do not create a fake `LibraryEntry` adapter.

The phone rule is sound as a pragmatic proxy, not as perfect device detection. It will miss phones whose primary pointer reports fine and treat some small coarse-pointer tablets/foldables as phones, but browser APIs offer no clean literal “phone” test. With positive-dimension guards and boundary tests, the proposed rule is a sensible v1.