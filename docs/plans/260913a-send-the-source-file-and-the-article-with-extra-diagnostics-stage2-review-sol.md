No files changed. I found five issues.

### S2-1 — P0: “never” is false for the report as a whole

Evidence: [FeedbackDialog.tsx:1012](../../src/web/FeedbackDialog.tsx:1012) and [PrivacyPage.tsx:497](../../src/web/PrivacyPage.tsx:497).

A reader can type notes or profile information into the report itself, and a screenshot can visibly contain notes, comments, chats, highlights, profile text, or purpose. The privacy page explicitly acknowledges both routes at lines 476–486, then contradicts itself with “A bug report never carries…”. The dialog’s unqualified “Never” has the same problem.

Scope the promise to the automatically gathered extra diagnostics.

In `src/web/FeedbackDialog.tsx`:

Before:
```tsx
              our copy of its text, within a size limit, so we can reproduce the problem.{" "}
              <em>Never</em> your notes, comments or chats, or what you've told us about yourself.
```

After:
```tsx
              our copy of its text, within a size limit, so we can reproduce the problem. These
              extra diagnostics <em>never</em> include your notes, comments or chats, or what you've
              told us about yourself.
```

In `src/web/PrivacyPage.tsx`:

Before:
```tsx
          rest of the report, so that we can reproduce what went wrong. Otherwise we don’t attach
          the article’s text — though a screenshot you add will show whatever was on your screen. A
          bug report never carries your notes, comments, highlights or chats, or what you’ve written
          about yourself and why you’re reading.
```

After:
```tsx
          rest of the report, so that we can reproduce what went wrong. Otherwise we don’t attach
          the article’s text — though a screenshot you add will show whatever was on your screen.
          The extra diagnostics never include your notes, comments, highlights or chats, or what
          you’ve written about yourself and why you’re reading.
```

In `tests/privacy-page.test.ts`:

Before:
```ts
    expect(prose).toContain("A bug report never carries your notes");
```

After:
```ts
    expect(prose).toContain("The extra diagnostics never include your notes");
    expect(prose).not.toContain("A bug report never carries your notes");
```

In `tests/feedback-dialog.test.tsx`, after the existing profile assertion:

Before:
```ts
    expect(words).toContain("what you've told us about yourself");
```

After:
```ts
    expect(words).toContain("what you've told us about yourself");
    expect(words).toContain("extra diagnostics never include your notes");
```

Status: **NO-CHANGE** — read-only review.

### S2-2 — P1: three docs imply both attachments always arrive

Evidence: [feedback-article.ts:124](../../src/feedback-article.ts:124), [feedback-article.ts:159](../../src/feedback-article.ts:159), and [feedback-article.ts:185](../../src/feedback-article.ts:185).

The two outcomes are independent. A source can be absent, too large, or failed while `article.json` is attached, and vice versa. Therefore:

- [feedback.md:411](../../docs/project/feedback.md:411) incorrectly says the event “gets two attachments”.
- [privacy.md:136](../../docs/project/privacy.md:136) says it “carries” both without “may”.
- [feedback-reports.md:30](../../docs/project/feedback-reports.md:30) uses `or` but then claims both files are present and reproduction is possible.

In `docs/project/feedback.md`:

Before:
```md
Now, when the box is ticked, the report names a slug, **and the
reporter owns that article**, the Sentry copy gets two attachments, read server-side from what we
already hold — nothing new leaves the browser and the Postgres row is unchanged:
```

After:
```md
Now, when the box is ticked, the report names a slug, **and the
reporter owns that article**, the Sentry copy may get up to two attachments, read server-side from
what we already hold — nothing new leaves the browser and the Postgres row is unchanged:
```

In `docs/project/privacy.md`:

Before:
```md
**The tick-box can also bring the reader's own article, since 2026-09-13.** Ticked, on a page of an
article the reporter owns, the Sentry copy carries the original file (up to 10 MiB) and
`article.json` — the text, tree, headings and summaries the page loaded, up to 5 MiB, with the
reader's profile and purpose left out.
```

After:
```md
**The tick-box can also bring the reader's own article, since 2026-09-13.** Ticked, on a page of an
article the reporter owns, the Sentry copy may carry the original file, when one is held and it is
no more than 10 MiB, and `article.json` — the text, tree, headings and summaries the page loaded —
when that is no more than 5 MiB. The reader's profile and purpose are left out.
```

In `docs/project/feedback-reports.md`:

Before:
```md
looking at. When the `source_file` or `article_json` tag says `attached`, the reader's own article
is on the event — the original file and the page's payload — so you can reproduce from Sentry alone
```

After:
```md
looking at. Read `source_file` and `article_json` independently: when either says `attached`, that
attachment is on the event. When both say `attached`, the original file and the page's payload are
both available, so you can reproduce from Sentry alone
```

Status: **NO-CHANGE** — read-only review.

### S2-3 — P1: permanent-deletion copy does not clearly disclose the Sentry attachments

Evidence: [PrivacyPage.tsx:510](../../src/web/PrivacyPage.tsx:510) promises that permanent deletion erases the article, while lines 530–539 enumerate what survives but call the remaining provider material only “logs”. A complete source file and `article.json` are materially more than a log. The plan’s current “Open questions for Greg” section identifies the same gap.

In `src/web/PrivacyPage.tsx`:

Before:
```tsx
          Three kinds of thing outlive an erasure, and it is worth saying which.
```

After:
```tsx
          Four kinds of thing outlive an erasure, and it is worth saying which.
```

Before:
```tsx
          else added the same document it is the same file and deleting your copy cannot take
          theirs. Backups and our providers’ own logs take a little longer to age out.
```

After:
```tsx
          else added the same document it is the same file and deleting your copy cannot take
          theirs. If you sent the article with a bug report, its
          <strong className="tw:text-foreground"> Sentry attachments</strong> also remain until
          Sentry’s retention ages them out. Backups and our providers’ own logs take a little longer
          to age out.
```

In `docs/project/privacy.md`:

Before:
```md
naming the slug. None of them holds the article's text — though the Sentry copy of a consented bug
report may, until Sentry's own retention ages it out (§ What a bug report carries); the page's *"our
providers' own logs take a little longer to age out"* is the sentence that covers it.
```

After:
```md
naming the slug. None of them holds the article's text — though the Sentry copy of a consented bug
report may, until Sentry's own retention ages it out (§ What a bug report carries). The page names
those attachments explicitly alongside the other things deletion cannot reach.
```

Status: **NO-CHANGE** — read-only review.

### S2-4 — P2: the JSX comment creates a broken documentation link

Evidence: [PrivacyPage.tsx:470](../../src/web/PrivacyPage.tsx:470).

The filename is split after `source-file-`. The source-comment link parser consequently reads only `and-the-article-with-extra-diagnostics.md`. After `src/feedback-article.ts` appeared, `tests/doc-links.test.ts` still failed solely on this reference.

Before:
```tsx
          and the paragraph says what does and does not go instead. The wording
          and why each clause hedges: docs/plans/260913a-send-the-source-file-
          and-the-article-with-extra-diagnostics.md § The proposed reader-facing
          wording. */}
```

After:
```tsx
          and the paragraph says what does and does not go instead. The wording
          and why each clause hedges are in:
          docs/plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md#the-proposed-reader-facing-wording. */}
```

Status: **NO-CHANGE** — read-only review.

### S2-5 — P2: the new tests do not pin the ownership boundary they claim to pin

Evidence: [feedback-dialog.test.tsx:351](../../tests/feedback-dialog.test.tsx:351) and [privacy-page.test.ts:96](../../tests/privacy-page.test.ts:96).

Both test names/comments say they protect “the reader’s own article”, but both would remain green if “own” disappeared. The privacy test also does not pin the size hedge or Sentry-only destination. Those are the clauses that distinguish visitors, oversized inputs, and the unchanged Postgres row.

In `tests/feedback-dialog.test.tsx`:

Before:
```ts
    expect(words).toContain("Send extra diagnostics.");
    expect(words).toContain("may also send the file the article was made from");
```

After:
```ts
    expect(words).toContain("Send extra diagnostics.");
    expect(words).toContain("On one of your own articles");
    expect(words).toContain("may also send the file the article was made from");
```

In `tests/privacy-page.test.ts`:

Before:
```ts
    expect(prose).toContain("the report may also carry that article");
```

After:
```ts
    expect(prose).toContain(
      "If you tick “send extra diagnostics” on a page of one of your own articles",
    );
    expect(prose).toContain("the report may also carry that article");
    expect(prose).toContain("up to a size limit");
    expect(prose).toContain("That goes to Sentry with the rest of the report");
```

Status: **NO-CHANGE** — read-only review.

Checks:

- Requested focused tests: **passed**, 43/43.
- `tests/doc-links.test.ts`: **failed**, solely on the split filename after `src/feedback-article.ts` existed.
- The new 10 MiB and 5 MiB figures match Stage 1 constants; the 20 MB envelope figure traces to the cited plan/Sentry limit. I found no unsupported new number.

Verdict: **CHANGES REQUIRED — one false reader-facing data promise, two materially misleading documentation areas, one broken gate, and incomplete copy pins.**