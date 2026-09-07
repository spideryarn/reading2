The overall strategy is sound, but I would not approve the proposal unchanged. I found two concrete dev-side files the conflict list misses, one incorrect doc correction, and a real hole in the proposed sanitiser regex.

No files were changed.

## Concrete corrections

1. `tests/conversation-band-live.test.tsx` is new on dev, so it cannot conflict. It still imports `ConversationBand` from `src/web/App.js`. Retarget it to:

   ```ts
   ../src/web/modes/conversation/ConversationModes.js
   ```

   Typechecking should catch this, but it is exactly the “new files never conflict” class.

2. `tests/rehost.test.ts` is also new on dev and reads `src/web/App.tsx` to inspect `useArticleAccess`. Both source slices must move to `src/web/article/access.ts`, with explicit start/end anchor assertions. Otherwise its two important guards—second image draw and load release—are aimed at the wrong file.

3. In `url-state.md`, do not change “in `App.tsx`” merely to “in `Reader`”. The push override is owned by [`useReadingPosition.ts`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/reader/useReadingPosition.ts:139), not [`Reader.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/reader/Reader.tsx). Cite the hook/file explicitly.

4. `docs/project/article-images.md` arrived from dev citing `useArticleAccess` in `App.tsx`. Retarget that citation to `src/web/article/access.ts`.

5. Several new dev test comments still describe internals as living in `App.tsx`: notably `comment-jump`, `jump-history`, `nav-label-status`, `paragraph-labels-withheld`, `chat-help-route`, and `mode-surface-changes-no-markup`. They do not necessarily break execution, but they are live explanatory comments rather than historical plans and should follow the moved owners.

6. I would use `readerCssNoComments()` in `referee-band-fits.test.ts`, not `readerCss()`. Its `bodyOf()` is a regex source scan; retaining CSS comments gives a deleted rule a plausible second place to match. This is hardening rather than evidence the proposed version currently misfires.

Everything else in the ten textual conflicts looks right:

- `diagram.md`, `quotes.md`, and `summaries.md`: union the controller and stylesheet changes.
- `new-mode.md`: union all totals and keep dev’s improved `BAND_SAYS` explanation.
- `aimed-column`, `referee-band-fits`, and `text-alone-centring`: stylesheet helper from dev, moved source owner from your branch.
- `site-footer`: keep the AST tooling and drop `CONTACT_EMAIL`.
- `App.tsx`: per-declaration integration plus the manual Outline port is the right shape.

## Q1 — Is the per-declaration merge sound?

Yes—as a way to produce candidate merged bodies. It is much safer than resolving the 5,543-line hunk by hand. It is not itself evidence that the integrated program is right.

The cross-declaration seams I would inspect explicitly are:

| Dev feature | Split seam where half-loss is plausible |
|---|---|
| Feedback | `FeedbackHost` in `App`, corner triggers in `ArticlePage`, Dock triggers elsewhere. A trigger without a host silently renders nothing. |
| Image rehosting | `useArticleAccess` → `resolveAccess` → `findArticle` → `rehostImages`; ownership must be claimed before the payload request and released from the effect cleanup. |
| Jump return | `useReadingPosition` now returns `rowOf`; `Reader` passes it to `ReturnChip`; comment-list jumps use the pushing path while dialog arrows do not. |
| Paragraph labels | Notice/pill logic, `TableView`’s slug, and `OutlinePanel`’s new `paragraphLabels` prop must arrive together. |
| Live conversation | The whole behavioral change is inside `ConversationBand`, but its new dev-only test still imports the old owner. |
| Feedback/public-sharing/changelog routes | `App` and `SignedIn` are separate declarations but jointly cover signed-in and signed-out route behavior. |

Your four checks are good, with one qualification: the JSX multiset result of “241 features, zero diffs” predates these dev changes. Rerun it after resolution using `origin/dev:src/web/App.tsx` as the old tree. The count should change because dev added Feedback, ReturnChip, ViewportProbe, public-sharing, and label markup.

The fifth check I would add is a 64-hunk provenance ledger: every hunk in `0977d6f6..origin/dev -- src/web/App.tsx` gets one destination file or an explicit reason it disappeared. Then grep the entire resolved tree for the moved declarations plus `App.tsx`. That simple sweep already found the two missed dev-only tests above.

Also run the targeted tests before the undifferentiated suite:

```text
conversation-band-live
conversation-band-send-new
rehost
sanitize-client
jump-history
comment-jump
dock-corner-controls
paragraph-labels-withheld
every-mode-draws-its-surface
the-marks-in-the-prose-belong-to-the-mode-showing
```

A browser smoke of feedback persistence, a deliberate jump/return, and an article switch during image loading is the most assumption-independent final check.

## Q2 — Should `DRAWS` be compared directly with `band()`?

No. The duplication is the check.

`DRAWS` already compares against `band()` behaviorally: it drives each mode through `<App/>` and requires the resulting real body or an explicit positive control. A direct source/table comparison would either duplicate that assertion or derive the expectation from the implementation it is meant to challenge.

`selectPassages` is a different policy, not a third spelling of the same mapping. Nine modes legitimately draw a band while publishing no passage marks. It should be total and correctly wired, but it should not “agree” with `DRAWS` row-for-row.

The missing cross-layer assertion already exists in [`the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:1): it mounts the whole app and verifies that the open producer, prose marks, ring, rail, transitions, Back, StrictMode, and article changes agree. Keep the three independently authored totals; do not add a fourth static table comparison.

## Q3 — Sanitisation

Combining the two sides verbatim is not enough. The proposed exemption:

```ts
article:\s*(?!article\b|Article[,)])\S
```

does not prove `article: Article,` is a parameter annotation. It also exempts a value property:

```ts
{ article: Article, other: 1 }
```

So the docblock’s claim that the delimiter distinguishes declarations from value expressions is false for the comma arm. Today the type-only `Article` import gives incidental compiler protection, but the security guard should not depend on that accident.

I would replace that property scan with AST inspection now; the repository already has `tests/helpers/ts-ast.ts`. At minimum, distinguish TypeScript parameter annotations from object properties structurally.

More importantly, the comment saying a mounted test requires a testing-library is obsolete: this repo now has several substantial `createRoot`/`act` App harnesses, including [`the-marks…`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx:16). Add a behavioral ingress test with dirty owned and public payloads and assert the rendered DOM is sanitised. Keep the static wiring guard too; the two catch different failure classes.

The corresponding known-gap prose in [`security.md`](/home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/project/security.md:1106) should be corrected when that lands.

## Q4 — Where silent damage is most likely

In this merge, the highest-risk places are new dev files that name old owners, source-reading tests, and cross-component topology—not the eleven conflicts.

The two concrete functional misses are `conversation-band-live.test.tsx` and `rehost.test.ts`. The concrete documentation miss is `article-images.md`. The remaining likely silent class is a dev feature whose JSX survived but landed under the wrong gate—for example a Feedback trigger outside its host or an owner-only band losing its owner check. That is why the post-merge JSX comparison must use dev as its baseline and why the mounted route/mode tests matter more than compilation alone.

With those corrections, the per-declaration `App.tsx` resolution is the right approach.