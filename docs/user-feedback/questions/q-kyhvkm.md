---
id: q-kyhvkm
report: spya-k06kam
repeats: spya-vm5enm
status: answered
asked: 2026-10-19
title: View another reader's account read-only, or inspect one article?
refs: qi-tgm93qpt · docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md · docs/research/261019a-admin-impersonation-best-practice.md · docs/user-feedback/261019_2010-view-another-readers-account-as-them.md · SPIDERYARN-READING2-KT · SPIDERYARN-READING2-M7
acted: spya-kpzvrk
---
You asked to see everything about other readers' articles, and to browse the site as another reader. Nothing is built yet, because it changes a security rule. Two questions.

1. Which first?
A. "View as": a View as button on /admin/users opens a new tab showing the app exactly as that reader sees it: their shelf, articles, modes, notes, chats and failed imports. It is strictly read-only, with a coloured bar at the top (who, minutes left, Stop). About two days of work.
B. "Inspect": an Inspect button on /admin/articles opens a plain admin page for one article: its text, the modes' output, the reader's notes and chats on it, and its import history and errors. It is not the app's own look, and there is no shelf. About half a day to a day.
C. B now, and A later if B turns out not to be enough.
Recommended: A. It is what you asked for, and the safeguards that made it heavy are now designed. Pick C if a cheaper start matters more.

2. What do readers get told?
A. Nothing new. The privacy page already says we may read their articles and what they wrote to fix a bug.
B. Add a few words to that sentence: "including by viewing the app as you, read-only".
Recommended: B.

Details

What you reported (2026-10-19): opening an article from /admin/articles gave "Not shared" and the table called it "Untitled"; "If I'm an admin, I should be able to see everything about other users' articles"; and a way to log in as someone from /admin/users, with a bar at the top and a clear way back, not too complex.

The first one is fixed, and that article is yours. Your PDF "Conscious artificial intelligence and biological naturalism" failed to import this morning, on the bug you reported at 10:15 (a NUL character), which is now fixed and deployed. The page wrongly said "Not shared" to you as the owner of a failed import. It now shows the import's card, with the reason and a Retry button. The admin table now says "Not published: its import failed or has not finished" instead of "Untitled". Please press Retry on it: the good parts are cached, so it costs only the three chunks that failed.

Why the other two wait for you: the admin pages promise never to show a title or a sentence of anybody's reading. Both options break that on purpose, so the rule is rewritten, and that is yours to approve. Your public privacy page already allows it.

What both options do, whichever you pick (decided, not asked):
- You press a button and give a one-line reason. The server records who, whom, when and why, and the session ends after 30 minutes.
- Nothing can write, spend money on a model, send email, fetch outside pages or reveal a private link's key. That is enforced on the server, not just hidden in the page.
- Admin accounts cannot be viewed.
- Other readers' titles stay out of the /admin/articles table. You see them only after pressing the button.
- The reader is not emailed each time.

What "read-only" costs in A: a bug that only shows when you press something (Retry, sending a chat, generating a mode) cannot be reproduced there. You still do those in your own account. Parts of the page that would write or spend (link previews, topic pills, the plan card) say "hidden while viewing as" rather than looking empty.

Passed over: real "log in as them" (a sign-in link for their account). It is the least code, but it gives full power with no bar you can trust and no record. It would write as them, spend their quota and our money, and change their sign-in history. Both reviewers (GPT Sol and Opus) and the research advise against it.

The reviewers split on question 1. Opus favoured A, trimmed. GPT Sol favoured B, as the simpler first step. Either is safe as now designed.

## Greg's answer, 2026-10-20 (in the Feedback dialog, reply `spya-kpzvrk`, 16:21 UTC)

> A

He answered part 1 only: option A, "View as". Part 2 was not answered, so its recommendation, B,
was taken by default: the privacy page's sentence now says "including by viewing the app as you,
read-only". Built from plan 261019n § Part 3.
