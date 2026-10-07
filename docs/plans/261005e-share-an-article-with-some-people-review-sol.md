The direction is sound, but the plan needs changes before Greg decides from it. The main gaps are secret leakage through feedback, undefined behaviour when an article is both public and link-shared, and omitted client and HTML-page work.

Reviewed commit `8207bf8`. I changed nothing. The doc-link test passed **16/16**, using `--configLoader runner` after the default loader encountered the read-only filesystem.

1. **F1 — P1, established: feedback sends the key to Sentry and email.**

   The promise that “Sentry does not get it” is false for a signed-in link holder who files feedback. [FeedbackButton.tsx:230](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/web/FeedbackButton.tsx:230) captures `location.href`; `FeedbackDialog.tsx:354` submits it; `pg-feedback.ts:313` stores it. [feedback.ts:234](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/feedback.ts:234) puts that URL into a Sentry tag, and `feedback-notice.ts:127` includes the full URL in the admin email.

   This feedback path bypasses the error-event scrubbing on which the plan relies. Stage 1 should remove the sharing credential from automatically collected feedback URLs **before storage and forwarding**, with a server-side safeguard for older clients. Test the final Sentry envelope and email, alongside request-log redaction.

2. **F2 — P1, reasoned: public access must take precedence, and revocation promises need qualification.**

   The plan explicitly permits “public and also has a link”, but its access union does not say how that state is resolved. Selecting the link arm merely because `?key=` exists could make a public article reject an obsolete key, or display the private-link notice incorrectly.

   Specify that a public article remains publicly readable regardless of a missing, wrong or revoked key. Its notice and billing remain public. Turning off its private link removes that credential; it cannot make the public URL unreadable. Conversely, making it private leaves access through any still-active private link.

   This also changes the owner card: “It is not listed anywhere” and “the old one stays dead” are misleading without the public-state exception. Test both controls independently and in combination.

3. **F3 — P1, established: the proposed scope omits client credential plumbing.**

   The server union does not get a visitor into the article by itself. [public-api.ts:126](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/web/public-api.ts:126) builds a keyless article request. [access.ts:275](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/web/article/access.ts:275) keys loading on slug, reader and retry only; `access.ts:534` calls the keyless loader. `rehost.ts:1038` likewise builds keyless asset requests.

   Stage 1 must explicitly carry the key through article loading and both image-loading paths. The access hook must react to a key change on the same slug and avoid displaying an answer obtained under a different key. The owner also needs a way to reload existing link state and copy the token after reopening Metadata.

   **The asset lookup itself is straightforward:** [public-reader.ts:1030](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/store/public-reader.ts:1030) checks access before reading the manifest. `storedAssetFor` operates only on that manifest and needs no access union. Preserve its membership check and rebuild the storage key from the stored entry.

4. **F4 — P1, established: “the shell stays plain” leaves the HTML response unresolved.**

   [page.ts:338](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/public/page.ts:338) loads the head by public slug alone. At `page.ts:239`, a private article receives **404 with the plain application shell**, even if the proposed API would accept its key. The application may render after that response, but the HTTP status would still claim the shared article was unavailable.

   Specify the HTML GET/HEAD behaviour, including valid-key success, refusal and database failure, while withholding article-specific preview metadata. Add the page handler and its tests to the scope.

   Also replace “a chat app … learns nothing” with the narrower promise: **the automatic preview contains no article-specific metadata**. A service receiving the complete link receives the bearer credential and can redeem it.

5. **F5 — P1, established: “our own tables hold no email addresses” is false.**

   [schema.ts:5659](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/src/db/schema.ts:5659) stores voucher email addresses; `schema.ts:4889` stores feedback reporter addresses. `billing_voucher_emails` also stores recipient addresses. Existing voucher code already distinguishes existing readers from prospective readers and matches addresses to accounts.

   The accurate statement is: **there is no general application-owned directory of users’ current email addresses or commenter display names**. Stage 3 still needs invitation identity handling, but the existing voucher machinery is a relevant precedent for more than sending mail. Correct the repeated claim in stages 2 and 3.

6. **F6 — P1, reasoned: stage 2 already requires part of the access system attributed to stage 3.**

   Recording membership and allowing someone to return **without the key** requires authenticated non-owner read access in stage 2. That access cannot use the deliberately ownerless public namespace or the existing owner predicate. Stage 3’s item 4 therefore begins in stage 2.

   Membership also changes revocation: after Ann joins, does turning off the link remove her access, or only prevent new people joining? The sketch leaves a consequential privacy promise undecided.

   Stage 3’s size list should additionally name recipient removal and invitation revocation, interactions with existing public/link access, and account/address changes. Its AI list should include concurrency and authority over shared results, plus the distinction between recording provider cost and charging an account. Those are substantial work areas even without designing their solutions.

   “Medium” for stage 2 and “large” for stage 3 are plausible. “One session” for stage 1 is an optimistic estimate given F1–F4, rather than a measured commitment.

7. **F7 — P2, established: the test table omits guards and misstates which inventories change.**

   The important omissions are:

   - **`tests/public-reads.test.ts`**: its SQL assertions cover revision, asset, comments, searches and source-guess predicates. See [public-reads.test.ts:99](/home/greg/code/spideryarn2/.claude/worktrees/fb-hwdefp-share-with-some-people/tests/public-reads.test.ts:99), `:413` and `:501`. These need both access arms, preserving projections and row filters.
   - **`tests/public-dispatch.test.ts`**: reader argument assertions, such as `:815`, must move with the union. Add proof that only the named key reaches handlers, library remains unaffected, and GET/HEAD/refusal responses retain `no-store`.
   - **`tests/public-read-page.test.ts`**: pins private/absent/unreadable responses to 404 and exercises shell composition.
   - **`tests/public-client-fetch.test.ts`** and **`tests/rehost.test.ts`**: cover article-key delivery, asset-key delivery and omitted credentials.
   - Client coverage for mode changes, Metadata round trips, key changes on the same slug, copied passage links and exclusion from remembered view state.
   - Owner-route coverage for ownership, rights confirmation, minimal-paper refusal, token lifecycle and atomic audit writes.
   - Feedback credential-redaction coverage from F1.

   The plan correctly identifies the two marketing/privacy test suites needing attention, but does not include them in its table.

   **`tests/public-imports.test.ts` does not inherently need its table allowlist changed.** That claim is correct if the audit stays owner-side and the new leaf reaches only existing permitted dependencies. However, add a leaf-closure assertion for the new predicate, matching its current `publicSlug` assertion at `:200`.

   Adding a predicate does **not** add a public route or necessarily another article query. Keep the existing route/query inventories intact unless the implementation actually adds sites; the fourth sanctioned slug leaf is the necessary change.

8. **F8 — P2, reasoned: cleartext storage is defensible, but “hashing protects nothing” is not.**

   A complete database disclosure exposes article text, so hashing offers limited protection against that particular event. It still prevents a stolen database snapshot—or a narrower token-only disclosure—from supplying reusable credentials for later revisions and asset requests.

   Cleartext can be a reasonable v1 choice because the owner can recopy the link and the token is revocable. State that trade-off accurately. Hashing with one-time token display is a simpler alternative worth naming; it gives up later recopying.

9. **F9 — P2, reasoned: the stage 2 sketch prescribes unnecessary schema work and conflicting read rules.**

   Multiple authors do not inherently require adding the author to `(article_id, id)`. Existing IDs can remain unique within an article, with author checks governing mutations. The proposed primary-key change would instead allow duplicate IDs between authors, requiring author identity wherever a comment is addressed.

   “Every read … filters by author” also conflicts with the recommended shared-discussion option and owner moderation. State the need for explicit authorship and audience rules; leave the key and query design to the separate stage 2 plan.

10. **F10 — P1, reasoned: the first question omits Greg’s most important alternative.**

    Greg’s second report says commenting and highlighting are among the most important benefits. Q-share-v1 offers a read-only link, email-only reading, or nothing. It does not offer **a link with signed-in comments/highlights first**. Calling read-only sharing “most of the value” assumes the answer to that priority question.

    The three questions are otherwise understandable. Improve them without adding a fourth:

    - **Q-share-v1:** offer read-only link now, link plus signed-in annotations first, named-email reading first, or defer. State explicitly that stage 1 has **no recipient comments or highlights**.
    - **Q-share-comments:** the Ann/Bo example works. Distinguish shared discussion from private highlights/notebook entries, and explain that “everyone joined” may include anyone who received a forwarded link. Qualify owner moderation for the private-notebook option.
    - **Q-share-price:** understandable; specify that this concerns **article allowance usage**, and that an article also made public retains its existing public rate. Existing account holders need only sign in under the email option, rather than “everyone” creating an account.

The remaining measured claims largely check out:

| Claim | Result |
|---|---|
| Two visibility values and four CHECKs repeating them | Accurate. |
| Public means every article is listed | Too absolute: the query excludes archived/unreadable articles and caps results at 200. |
| Archiving preserves public access but removes shelf discovery | Accurate, but deliberate: `public-library.ts:274` documents the policy. |
| Slugs are unsuitable secrets | Accurate: approximately 30 bits, generated with `Math.random`, and disclosed in existing outputs. |
| Signed-in non-owners remain read-only | Accurate for article permissions; their network and feedback capabilities differ from signed-out visitors. |
| Comments/highlights/bookmarks share a table; author is not checked by the owner store | Accurate. Current public comments also filter out referee and unfinished/failed entries. |
| 58 owner-lookup call sites | 58 textual occurrences, including the helper declaration; not 58 calls or AI operations. |
| Another person’s ordinary AI ledger record would lose its article FK | Accurate for `pgCostStore.record`; it retains the historical article slug. The schema itself already permits actor and article to differ. |
| Google/password sign-in, no magic-link sign-in UI, tab-scoped ten-minute return | Accurate. |
| Resend allowance and historical decisions | Consistent with repository evidence; live provider configuration and historical database contents were not verifiable here. |

**F11 — P3, established:** tighten the listing, “accidental unlisted”, and occurrence-count wording above. These do not overturn the recommendation.

The token-column approach remains simpler for the proposed independent controls. A third visibility value would give a mutually exclusive private/unlisted/public model, which is attractive **if that is the intended product**. It cannot also retain a separate private credential while public without another field. Keeping visibility as discoverability and token presence as a separate grant is reasonable, provided F2 defines the interaction.

The four guarantees in the security map—no authenticated fallthrough, read methods only, no request owner, and allowlist DTOs—can all remain intact. Passing one bounded, named credential field does not require weakening them. A query string is also reasonable for this v1: a path segment would enter existing path logs, while a fragment would require additional client handling and cannot authorize the initial HTML request. Query-string use still needs the leakage fixes above; `no-referrer` does not protect URLs deliberately copied or submitted by application code. Mode and Metadata navigation preserve unknown query parameters today; `last-view.ts:342` excludes the key from its storage allowlist. Passage permalinks deliberately retain the query, and sign-in returns can retain it in session storage.

**Verdict: sound with the listed changes.**