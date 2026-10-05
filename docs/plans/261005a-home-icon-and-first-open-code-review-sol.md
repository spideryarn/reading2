**F5 — P1, established; fixed locally.** A bare `/read/x/metadata` visit with empty storage wrote the first-open marker without applying a default. The subsequent `/read/x` visit stayed Plain. Both remount and same-component cases failed first. A stronger test using `navigate()` also exposed the departing metadata listener writing ahead of the arrival effect.

The fix scopes claims to the article view, observes view transitions, prevents empty metadata saves from creating a key, and guards saves by both slug and view. Existing restoration behaviour is preserved.

**F6 — P3, established; corrected.** The added prose overstated eligibility and timing. A fresh shelf visit does not load experimental settings; those settings can subsequently arrive before or after the article payload. Help also promised Summary without qualifying sign-in or browser eligibility. The wording now reflects those conditions.

No further P0/P1 finding emerged. The measurement refactor preserves its previous calculations. No charging path was found: the default selects Brief and arms no paid activation. Admin spacing was assessed from source; there was no browser verification.

Validation: **91 tests passed across five individually run files**, full typechecking passed, and touched-file lint passed with the existing informational App complexity warning. Nothing was committed.

Every file I changed:

- [last-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/last-view.ts)
- [ArticlePage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/article/ArticlePage.tsx)
- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/App.tsx)
- [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/help/help-topics.tsx)
- [url-state.md](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/docs/project/url-state.md)
- [first-open-default-wiring.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/tests/first-open-default-wiring.test.tsx)
- [debate-navigation.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/tests/debate-navigation.test.tsx)
- [First-open marker postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/docs/postmortems/261005a-a-downstream-guard-cannot-protect-an-upstream-first-open-marker.md)

**Verdict: reject `815a2608e` as committed; accept with the uncommitted fixes.**