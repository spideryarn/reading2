No findings.

- **S1-R2-1 — Closed; no severity.** Repository and filename greps found no SUBTLEX-derived data, generator logic, imports, or runtime path. Remaining tracked mentions explicitly document the rejected approach. `common-words.ts` and the old `concreteness.ts` are absent.
- [ATTRIBUTION.md](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/data/ATTRIBUTION.md:10) correctly provides the work, authors, source, CC BY 4.0 link, and modifications. This satisfies the publisher’s [license statement](https://link.springer.com/article/10.3758/s13428-018-1099-3) and [CC BY 4.0 attribution requirements](https://creativecommons.org/licenses/by/4.0/).
- [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/shelf-terms/choose.ts:174) matches § Measurements: exact word, plural, then `-s/-es/-ed/-d/-ing→e/-ing`; the first rated form decides. Unrated words remain ordinary, as specified. The dropped-e-before-plain-`ing` protection remains intact.
- The stale SUBTLEX statement in the untracked feedback note was not treated as a code/data path and was not edited.
- **What changed:** nothing.

Test tail:

```text
Test Files  1 passed (1)
     Tests  43 passed (43)
  Duration  3.05s
```

**Verdict: S1-1 is closed.**