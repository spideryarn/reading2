---
reports: spya-mdp0em
ending: shipped
comment: Built as you chose (option A). The public shelf now has topic pills, kept up to date by themselves up to 20 shared articles and billed to a site account; past 20, a Rebuild button on the admin page. They appear once 8 articles are shared.
---
# Topic pills on the public shelf

SPIDERYARN-READING2-BX (`spya-mdp0em`), from Greg (admin, proved by `feedback-reporter.ts` exit 0),
filed 2026-10-04 10:00 UTC from an article page. This session had no Sentry sign-in; the words are
from the report's production row.

> Show the topic-pills on the page for filtering public/shared articles as well.

**First ending, 2026-10-04: waiting on a decision.** Nothing built. Mark BX ignored, with this reason; the next feedback sweep
does the Sentry status write.

Two things stopped it. Every way of showing pills on `/read/public` edits a listed security defence
(the page, its query, or what a stranger may receive), which an unattended session does not do. And
the public shelf holds 6 articles today, under the 8 the pills need before they appear anywhere.

The plan sets out four options for Greg, with what each looks like and costs: a model-named tree
stored for the public shelf (recommended once that shelf is bigger); phrase pills worked out in the
browser (weak); nothing until the shelf is bigger (recommended now); or, if he meant the *Include
public* section of his own shelf, a smaller change that touches no defence.

Queue entry `qi-8a52pdxh`. Plan:
[261004j § Part 2](../plans/261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md#part-2-pills-on-the-public-shelf-spya-mdp0em-not-built-a-question-for-greg).
The other report handled in the same session shipped:
[its note](261004_1039-shelf-topic-pills-take-in-more-articles.md).

**The question for Greg is now a file**, `docs/user-feedback/questions/q-deh67j.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).

**2026-10-08: Greg answered** (reply `spya-hbtqvc`): the public shelf, `/read/public`; automatic and
billed to the site if a regeneration is half a cent or less, otherwise an admin-only button. Measured
([investigation 261008a](../investigations/261008a-public-shelf-topic-rethink-cost.md)): 0.03–0.04¢
for a re-think of today's 6 public articles, about 0.01¢ to file one new share, about half a cent at
45 articles, where one run was already over the bar. So the plan is automatic up to 20 public
articles, billed to a site account, with a rebuild button on `/admin` beyond
([261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md)). Still
**awaiting**: building it edits listed defences, so it waits for his yes, asked as
`docs/user-feedback/questions/q-p5h2a7.md`. Queue item `qi-4far27sc`.

**2026-10-09: Greg chose A** (`q-p5h2a7 A`, in the Overseer's terminal), and it was built the same
day: automatic up to 20 public articles, billed to a new site account, with a Rebuild button on
`/admin` beyond; pills from 8 public articles; an un-share hides them until the rebuild. **Ending:
Shipped** on `dev`. What was built, and where it differs from the plan, is
[261008j § As built](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md#as-built-2026-10-09);
the site account reaches production with the migration, at the Overseer's next deploy.
