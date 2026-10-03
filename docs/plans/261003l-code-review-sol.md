No P0/P1 findings. Fixed these P2 findings:

- **Guard bypasses** — [test:170](/home/greg/code/spideryarn2/.claude/worktrees/fb-trg9kz-footnote-line-breaks/tests/prose-marks-stay-inline-in-chrome.test.ts:170). Commas, repeated classes and nested negations hid unsafe selectors such as `:not(.foo,mark.cite.foo)`. Preserved function context, checked every occurrence and added regression cases seen red before fixing.
- **Incorrect history** — [postmortem:41](/home/greg/code/spideryarn2/.claude/worktrees/fb-trg9kz-footnote-line-breaks/docs/postmortems/261003e-two-components-sharing-one-bare-class-name.md:41), [plan:70](/home/greg/code/spideryarn2/.claude/worktrees/fb-trg9kz-footnote-line-breaks/docs/plans/261003l-citation-marks-break-the-line-because-a-chat-chip-class-shares-their-name.md:70). Git confirms summaries prompted the August rename; the interval was three weeks; footnote linking’s commit is dated 1 October. Corrected those claims.
- **Overstated layout check** — [test:70](/home/greg/code/spideryarn2/.claude/worktrees/fb-trg9kz-footnote-line-breaks/tests/prose-marks-stay-inline-in-chrome.test.ts:70). It checks the following comma, not the following word. Corrected the name and plan wording.

No remaining chip consumers select `.cite`, and no current stylesheet false positives were found.

Requested run: **114 passed; Chrome failed to launch** with `setsockopt: Operation not permitted`, so layout remains unverified here. Typecheck passed; lint reported one complexity advisory. The full suite was blocked by sandbox access to Postgres/Docker. No commits made.

VERDICT: ship with the fixes I made.