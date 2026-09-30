# /privacy stops listing which features read the reading-time totals

**Status:** shipped to `dev` · 2026-10-01 · follow-up to
[SPIDERYARN-READING2-61](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-61), whose
note is [260930_0037](../user-feedback/260930_0037-quiz-asks-only-about-what-you-have-read.md).

## Why

[260930e](260930e-quiz-only-asks-about-what-you-have-read.md) made the quiz read the stored
reading-time totals. The `/privacy` bullet said they were kept *"so that the article's outline and
margin can show you where you have been"*, which no longer named every use. That plan proposed adding
a clause for the quiz
([§ Privacy wording for Greg](260930e-quiz-only-asks-about-what-you-have-read.md#privacy-wording-for-greg)).
Greg answered with a different option:

> Perhaps just remove some of the low-level detail, because the user doesn't really care *exactly
> which modes* use it - so just say that some modes might?
>
> — Greg, 2026-10-01 (relayed by the Overseer)

## The change

`src/web/PrivacyPage.tsx`, § What we keep — only the purpose clause changes:

> **How long you have spent on each part of your articles** — with experimental features on, a
> running total of the seconds each passage has been on your screen. ~~so that the article's outline
> and margin can show you where you have been.~~ **Some of Spideryarn's features use it — to show you
> where you have been, for example.** We keep the totals, …

- **One example, not a list.** An example is plainer than "some features" alone, and cannot go stale
  the way a list does: the outline and margin will go on showing where you have been.
- **"Spideryarn's features"**, not "the reading view's": the page talks to readers, and names
  Spideryarn elsewhere; "reading view" is our word.
- **Present tense, "use"** rather than Greg's "might": the quiz and the outline use it today.
- Everything that is a claim about storage — the totals not a history, not shown to a shared link's
  reader, gone with the article, only with experimental features on — is unchanged.
- `LAST_UPDATED` moves to 1 October 2026, because the page's date is its version.

`docs/project/privacy.md § Reading time` records the change and Greg's words, and says where the
line now sits: another owner-only feature may use the totals in memory without changing the page;
one that stores something new from them, reveals them or a conclusion drawn from them to a shared
reader, or sends either outside Spideryarn (to a model, say) needs the wording reconsidered.

## The simpler option passed over

Adding "and the quiz can ask only about what you have read" (260930e's proposal). It is one clause,
but the next mode that reads the totals makes the page wrong again, and Greg preferred not to list.

## Checks

No test pins this sentence (`grep` over `tests/` for its phrases finds nothing);
`tests/privacy-page.test.ts` and the other page tests run as the gate. One GPT Sol review of the diff.
