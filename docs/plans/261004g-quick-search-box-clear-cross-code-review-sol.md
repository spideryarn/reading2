| ID | Severity | Evidence | Result |
|---|---|---|---|
| F1 | P1 | Established | **Fixed:** keyboard focus on the cross collapsed the Search field. Focus now belongs to the whole control. |
| F2 | P1 | Established | **Fixed:** responsive hiding ignored focus on the cross. Handoff now checks every focused descendant. |
| F3 | P3 | Reasoned | **Prose fixed:** the declared 40px finger target is clipped vertically. Geometry unchanged. |
| F4 | P3 | Established | **Unfixed, wider:** `close.css:67` incorrectly says the dock input has no cross. |

Validation: 138 related tests passed, including all 37 component tests. Regression tests were red before fixes; disabling clearing caused three candidate tests to fail. Full typecheck, scoped lint and diff checks passed.

Browser checks remain unverified: sandbox restrictions blocked Chrome and Vite. No commits, pushes or deployment.

**Verdict: ship after these fixes; browser verification remains outstanding.**

Changed files:

- [DockQuickSearch.tsx](../../src/web/DockQuickSearch.tsx)
- [dock-quick-search.css](../../src/web/styles/dock-quick-search.css)
- [dock-quick-search.test.tsx](../../tests/dock-quick-search.test.tsx)
- [Plan and review record](261004g-quick-search-box-clear-cross.md)
- [Root-cause postmortem](../postmortems/261004i-a-focus-boundary-must-grow-when-a-control-gains-a-second-focusable-child.md)

Reviewed commit `cdb7642e8`; the fixes landed in the commit that follows it. (The five links above
were repo-relative as the reviewer wrote them and were made file-relative by the author.)