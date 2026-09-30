---
reports: spya-sufetx
ending: shipped
---
# The main modes generate after an import

SPIDERYARN-READING2-5Y (report `spya-sufetx`), from Greg (admin, verified by account id), in
production, build `6d09e3cc`, on `https://www.spideryarn.com/`. The time in the file name is when this
session received the report; it runs on a pool account and could not read Sentry.

> When I start importing a paper, and the import process is running and I can see it's doing a bunch
> of stuff, give me a tick box that's probably default-true that will automatically run the
> generation for all of the main modes, i.e. the ones that are not experimental features. So in
> other words, it'll automatically generate the structure and the summary and the quotes and ideas
> and trajectory and glossary. Probably trajectory will be last because it depends on all of those
> others. And we really want the import process to be as fast as possible. So in an ideal world, it
> would do the absolute bare minimum and open the paper and then immediately kick off all of those
> other activities, you know, perhaps in parallel. So even now, I think it first generates the
> structure and the summary before it opens. In an ideal world, it would open the paper before
> they're ready and immediately kick them off. And those modes would say something like, Ah, you
> know, it's still in progress. I don't know how complicated that would be. So if that's making this
> much harder, do the simpler thing first of just a way to automatically kick off the other modes
> once the paper is open, because I know that that's already possible, I think.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5Y (the next feedback sweep does the Sentry
status write).

What we did: Greg's simpler version. The add page now has a tick box, on by default, while the
import runs. When the import finishes it opens the article and starts Tweets, Glossary, Quotes, Ideas
and Trajectory in the background. Tweets, Glossary, Quotes and Ideas are queued together; Trajectory
is queued last and waits for Quotes and Ideas. A mode you open while its job is running shows the
job's progress. Structure and Summary were already there when the article opened, because the import
builds them.

Two things for Greg:

- **Cost.** About $0.31 per import with the box ticked, $0.49 at the most we have seen. These are
  local figures, and a long paper costs more.
- **Deferred.** Opening the paper before Structure and Summary exist would mean an article with no
  tree yet, and every surface that reads the tree would need to handle that. It has its own plan.

Plan: [260930c](../plans/260930c-auto-generate-the-main-modes-after-import.md).
