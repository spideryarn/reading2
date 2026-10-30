---
id: q-khr37j
report: none
status: answered
asked: 2026-10-29
title: [Q-agents-rename] May tidy-renames-sweep apply its five AGENTS.md edits for product-vision.md and principles.md?
refs: session tidy-renames-sweep · worktree /var/tmp/spideryarn-worktrees/tidy-names-and-drift · scratch AGENTS.proposed.md in session 82630029's scratchpad · docs/reusable/edit-important-docs.md
acted: spya-sh2nv9
---
May the session tidy-renames-sweep make exactly the five AGENTS.md edits below, so it can finish renaming vision.md to product-vision.md and push?

A. Yes, apply exactly these (recommended). The Overseer applies them, the session's tests pass, and it pushes the rename with the rest of its tidy-up.

B. Not as written. Reply with what to change, and the session redrafts.

C. Hold the whole rename. Nothing is pushed; about 165 files of finished tidy-up sit unpushed in its worktree until you decide.

Recommended: A. They are the edits your 27 October asks imply, and nothing else.

Details

What this is. On 27 October you asked for vision.md to be renamed product-vision.md, since it is about the product, and said principles.md is about how we build. The session did the rename everywhere except AGENTS.md (CLAUDE.md is the same file). It will not edit that file on another agent's say-so, and that rule is right, so it has been waiting since 27 October at a prompt in its terminal window. Until AGENTS.md changes, the doc-link tests fail and it cannot push.

The five edits:

```
1. "Start with [vision.md]"  →  "Start with [product-vision.md]"

2. "Then there are seven entry-point docs … Only these seven"
   →  "eight" in both places

3. The vision.md bullet becomes:
   - product-vision.md — the intent, the principles of reading,
     and the anti-goals.
   (principles.md moves out of the list beneath it)

4. A new bullet after it:
   - principles.md — how we build: a few short, general rules,
     each added only with Greg's yes — prefer boring and its two
     exceptions, simpler first, improve forwards.

5. Under "Writing code", the two links
     vision.md § Principles     →  principles.md § Prefer boring
     vision.md § Simpler first  →  principles.md § Simpler first
```

Prefer boring and Simpler first move from vision.md into principles.md in the same push. Their wording is unchanged.

How you answer reaches the session. Your reply here is your approval. The Overseer applies the edit itself and tells the session to carry on. It does not ask the session to treat a relayed message as your yes.

Greg's answer, 2026-10-29 09:13 UTC (in the Feedback dialog, reply spya-sh2nv9)

> Approved.

Settled: A. The Overseer applied the five edits word for word to AGENTS.md in the tidy-names-and-drift worktree, and told tidy-renames-sweep to test and push with the rest of its tidy-up.
