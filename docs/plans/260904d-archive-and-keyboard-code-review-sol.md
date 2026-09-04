1. **Blocker — the keyboard fix does not address the reported iOS PWA case.**

   [index.html](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/index.html:12) relies on `interactive-widget=resizes-content`, while [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/styles.css:13371) sizes a fixed dialog using the layout viewport and `90dvh`. WebKit’s implementation issue remains open; iOS resizes/pans the visual viewport, not the initial layout viewport the CSS depends on. The standard describes the desired behavior, but WebKit does not reliably provide it. [WebKit issue](https://bugs.webkit.org/show_bug.cgi?id=259770), [CSS Viewport specification](https://www.w3.org/TR/css-viewport-1/#interactive-widget).

   A 390×340 browser viewport proves the flex layout works after the layout viewport shrinks; it does not reproduce iOS keyboard behavior. A real keyboard may instead pan the visual viewport to the focused textarea, leave `dvh` at full height, and keep the footer below the keyboard. Rotation and keyboard dismissal introduce additional known fixed-position/offset problems.

   Keep the new `.fb-scroll`/footer structure, but do not close the report until it passes in the installed PWA. If it fails, constrain and position the dialog using `visualViewport.height` and `visualViewport.offsetTop`, updated on `resize` and `scroll`. Test opening, closing, refocusing and rotating. The claims in [feedback.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/feedback.md:77), [index.html](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/index.html:24), and [feedback-dialog.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/feedback-dialog.test.tsx:627) should meanwhile say this is a Chromium fix and an unverified iOS attempt, not that standalone iOS resizes the layout viewport “on its own.”

2. **High — archived public articles should leave the public listing, without being unshared.**

   [public-library.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/store/public-library.ts:247) filters on visibility and readability but not `archived_at`. The direct-link predicate in [public-slug.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/store/public-slug.ts:40) also ignores archiving.

   I would add `isNull(articles.archivedAt)` to `publicLibraryQuery`, but leave `publicSlug` unchanged. That gives the clearest distinction: visibility controls whether the link works; archiving removes the article from listings. Otherwise the owner loses sight of the article on their normal shelf while strangers can still discover it—a poor privacy asymmetry.

   The privacy paragraph’s substantive claims are otherwise true: archive only updates `archived_at` ([pg-shelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/store/pg-shelf.ts:87)); both library-search implementations exclude archived articles; restoration remains available; and the HTTP surface has no article-deletion route ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/routes.ts:10)). Still, change “out of search” in [PrivacyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/PrivacyPage.tsx:373) to “out of your library search,” and state what happens to an already-shared article.

   Separately, [library.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/docs/project/library.md:176) currently says it remains “listed at `/read/public`,” but [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/App.tsx:403) still renders a 404 there. At present only the public API listing exists. Phrase this as the query’s current behavior or the forthcoming showcase.

3. **High — the Enter sweep exposes an unfixed dictation race in the main chat composer.**

   [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/ChatPanel.tsx:1943) refuses submission while transcribing but not while `dictation.armed`; its Send button is likewise enabled at [line 2046](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/ChatPanel.tsx:2046). Pressing the newly labelled Send key while recording can therefore post rough/incomplete text and leave the microphone running.

   Add `dictate.dictation.armed` to both the submit guard and disabled condition. Audit the other dictation-backed submitters for the same class: Annotate and Quiz also guard only `readOnly`.

   The new Comment follow-up guard is correct, but its button remains visibly enabled while armed at [CommentDialog.tsx:430](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/CommentDialog.tsx:430); pressing it silently does nothing because the submit guard returns. Disable it while armed too.

4. **Medium — the email key sometimes says “Next” and signs in instead.**

   [SignInControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/src/web/SignInControls.tsx:175) moves focus only when `password === ""`. If a password manager has filled the password, pressing a key labelled Next submits the form.

   Always prevent submission and focus the password field when Enter comes from the email input. Prefer a ref over the global `getElementById`. Submission should happen from the password field or button. Add a test with a prefilled password.

5. **Medium — parts of the Enter-key test assert a decision table, not actual behavior.**

   The inventory assertion in [what-the-enter-key-promises.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/what-the-enter-key-promises.test.tsx:166) is useful and non-vacuous. But “labels no textarea Send unless Enter really sends” at [line 171](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/what-the-enter-key-promises.test.tsx:171) neither distinguishes inputs from textareas nor exercises Enter; it even includes the CommentDialog `<input>`. Removing a handler while retaining the attribute leaves it green.

   Keep the sweep as an omission guard, but add interaction tests for the four Send boxes and the sign-in Next behavior, including busy/armed states.

   There is also no equivalent test of the metadata button itself: [metadata-page-order.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-reports-260904b/tests/metadata-page-order.test.tsx:215) pins only the section heading. A Metadata button relabelled “Delete,” rewired, or changed back to a bin would pass. Add one label/icon/handler test there.

6. **Fine — the three archive presentation judgements are right.**

   `Archive` is the correct icon, removing destructive red is consistent with reversibility, and deleting `IconButton.destructive` is preferable to preserving a dead affordance. The app-wide shadcn `Button` still has its destructive variant, so no general design capability was lost.

7. **Fine — omitting `enterKeyHint` on ordinary multiline boxes is correct.**

   It lets the platform present its normal Return/Enter key and avoids promising submission. Explicit `enterKeyHint="enter"` would add no useful behavior.

I ran both new files together: 2 files passed, 9 tests passed. `shelf-archive-label.test.tsx` passes for the right reason: it finds and presses the accessible Archive control in both shelf renderers and observes `shelf.archive`. The Enter-key inventory also genuinely scans the current native controls, but its behavioral limitation is finding 5 above. Additional feedback/privacy/metadata tests passed; the Postgres parity suite skipped because this sandbox could not reach the local database.